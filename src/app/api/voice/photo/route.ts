import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { getCurrentActor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getConsultation, updateConsultation } from "@/lib/platform-db";
import { safeUploadBytesToR2 } from "@/lib/r2";
import { analyzeRoomColor, describeRoom } from "@/lib/room-color";
import { logVoice } from "@/lib/voice-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 这张表既是白名单也是扩展名查询表 */
const PHOTO_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

/** 页面已经压到 1600px，远在这条线以下。这个上限是给不走页面的东西设的 */
const PHOTO_MAX_BYTES = 8 * 1024 * 1024;


/**
 * 门店平板拍的顾客房间。
 *
 * **存 R2，并挂到这一场 consultation 上。** 原先存 Supabase 的私有桶，
 * 那是从对方项目移植时带过来的；而效果图那条链路（`consultations/[id]/generate`）
 * 只认 consultation 的 `sceneR2Key`，照片存在别处就永远做不出效果图。
 * 统一到 R2 之后还顺带解决了另一件事：顾问和业务人员终于能看到顾客的房间原图，
 * 而那本来就是存它的理由。
 *
 * 请求体是原始二进制而不是 JSON 里的 base64——base64 在门店 wifi 上要多传三分之一，
 * 而页面已经先缩过图了。
 */
export async function POST(request: Request) {
  try {
    const actor = await getCurrentActor();

    const mime = (request.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!PHOTO_MIME[mime]) {
      return NextResponse.json({ error: "unsupported_type", mime }, { status: 415 });
    }

    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength === 0) {
      return NextResponse.json({ error: "empty_body" }, { status: 400 });
    }
    if (bytes.byteLength > PHOTO_MAX_BYTES) {
      return NextResponse.json(
        { error: "too_large", bytes: bytes.byteLength, limit: PHOTO_MAX_BYTES },
        { status: 413 }
      );
    }

    const photoId = crypto.randomUUID();
    const uploaded = await safeUploadBytesToR2(bytes, mime, `consultations/voice/${photoId}`);
    if (!uploaded) {
      await logVoice("photo_upload_failed", { reason: "r2_upload_failed" });
      return NextResponse.json({ error: "upload_failed" }, { status: 502 });
    }

    const sessionLabel = request.headers.get("x-session-label");
    await getDb().query(
      `insert into voice_room_photo (photo_id, storage_path, mime, bytes, session_label)
       values ($1, $2, $3, $4, $5)`,
      [photoId, uploaded.key, mime, bytes.byteLength, sessionLabel]
    );

    // 挂到这一场咨询上。没带 id 也照存不误——照片本身不该因为会话没建起来就丢掉，
    // 但那样它就出不了效果图，所以前端在拍照前会先把 consultation 开出来。
    const consultationId = request.headers.get("x-consultation-id")?.trim() ?? "";
    if (consultationId) {
      const current = await getConsultation(actor, consultationId);
      if (current) {
        await updateConsultation(actor, current.id, {
          sceneR2Key: uploaded.key,
          sceneImageUrl: `/api/assets?key=${encodeURIComponent(uploaded.key)}`
        });
      }
    }

    // 取色跑在存好之后：分析失败不该让照片丢掉，助手照旧可以反问顾客。
    let room: ReturnType<typeof describeRoom> | null = null;
    try {
      const analysis = await analyzeRoomColor(bytes);
      room = describeRoom(analysis);
    } catch (error) {
      await logVoice("room_analysis_failed", { photo_id: photoId, error: String(error) }, sessionLabel);
    }

    await logVoice(
      "room_photo",
      { photo_id: photoId, bytes: bytes.byteLength, mime, analyzed: room !== null },
      sessionLabel
    );

    return NextResponse.json({ photo_id: photoId, bytes: bytes.byteLength, room });
  } catch (error) {
    return apiError(error, "照片上传失败。");
  }
}

/**
 * 店里那台在等顾客手机上传。
 *
 * **为什么是轮询而不是推送**:要等的只有一件事、最多十分钟、而且只在二维码
 * 摆在屏幕上的那段时间里等。为它拉一条 SSE 或 WebSocket,要多一个长连接、
 * 一套重连、一份服务端状态——而这条链路上真正难的部分(建连、看门狗)刚被修好,
 * 不值得再往上压一条新的长连接。二维码一收起,轮询就停。
 */
export async function GET(request: Request) {
  try {
    const actor = await getCurrentActor();
    const consultationId = new URL(request.url).searchParams.get("consultationId")?.trim() ?? "";
    if (!consultationId) return NextResponse.json({ pending: true });

    const item = await getConsultation(actor, consultationId);
    const preferences = (item?.preferences ?? {}) as {
      photoFrom?: string;
      photoAt?: string;
      roomReading?: unknown;
    };
    // 只认顾客手机传来的那一张:顾问自己拍的走的是 POST，那条路当场就有回执
    if (!item?.sceneR2Key || preferences.photoFrom !== "customer_phone") {
      return NextResponse.json({ pending: true });
    }
    return NextResponse.json({
      url: item.sceneImageUrl,
      at: preferences.photoAt ?? null,
      room: preferences.roomReading ?? null
    });
  } catch (error) {
    return apiError(error, "查不到照片。");
  }
}
