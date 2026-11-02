import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { safeUploadBytesToR2 } from "@/lib/r2";
import { analyzeRoomColor, describeRoom } from "@/lib/room-color";
import { readUploadToken } from "@/lib/voice-upload-token";
import { logVoice } from "@/lib/voice-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PHOTO_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic"
};

/** 手机直出的原图可以很大,这里比店里那台松一档——顾客那边没有页面替他先缩图 */
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * 顾客用自己手机传进来的房间照片。**这条路不登录。**
 *
 * 唯一的凭证是 URL 里那枚 token,它签着「哪一条咨询单、哪个组织、哪个 nonce、
 * 什么时候过期」。所以这里每一条 SQL 都必须同时带 id 和 organization_id——
 * 没有 actor 兜底,写错一个 where 就是跨组织写别人的单子。
 *
 * **只能写,不能读。** 成功了只回一句「好了」,失败了只回一个粗粒度的原因。
 * 不回咨询单的任何内容、不回顾客姓名、不回照片地址——
 * 一枚十分钟的凭证换不到这些东西,那不是它该有的权限。
 */
export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const claims = readUploadToken(token);
  if (!claims) {
    // 不区分「签名不对」和「过期了」:分得越细，越方便别人拿它试探
    await logVoice("qr_upload_rejected", { reason: "bad_token" });
    return NextResponse.json({ error: "expired" }, { status: 403 });
  }

  try {
    const mime = (request.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!PHOTO_MIME[mime]) {
      return NextResponse.json({ error: "unsupported_type" }, { status: 415 });
    }
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength === 0) return NextResponse.json({ error: "empty" }, { status: 400 });
    if (bytes.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: "too_large" }, { status: 413 });
    }

    /**
     * **一次性靠这一步。** nonce 存在咨询单上,传成功就清掉,
     * 所以同一枚码传不了第二次——而消掉它的动作和「认领这次上传」是同一条语句,
     * 两台手机同时扫同一个码,只有先到的那条能改到行。
     */
    const claimed = await getDb().query(
      `update consultations
          set preferences = preferences - 'uploadNonce'
        where id = $1 and organization_id = $2
          and preferences->>'uploadNonce' = $3
        returning id`,
      [claims.consultationId, claims.organizationId, claims.nonce]
    );
    if (!claimed.rowCount) {
      await logVoice("qr_upload_rejected", { reason: "nonce_spent" });
      return NextResponse.json({ error: "expired" }, { status: 403 });
    }

    const uploaded = await safeUploadBytesToR2(
      bytes,
      mime,
      `consultations/voice/${crypto.randomUUID()}`
    );
    if (!uploaded) {
      await logVoice("qr_upload_failed", { reason: "r2_upload_failed" });
      return NextResponse.json({ error: "upload_failed" }, { status: 502 });
    }

    // 取色跑在存好之后:分析失败不该让照片丢掉,助手照旧可以反问顾客
    let room: ReturnType<typeof describeRoom> | null = null;
    try {
      room = describeRoom(await analyzeRoomColor(bytes));
    } catch {
      /* 取不出色就不给读数，别编 */
    }

    /**
     * 照片挂上去,同时把取色读数放进 preferences。
     *
     * 读数要存,是因为**取不到第二次**:店里那台是轮询知道有新照片的,
     * 它手上没有原图,而重新从 R2 拉回来再算一遍纯属浪费。
     */
    await getDb().query(
      `update consultations
          set scene_r2_key = $3,
              scene_image_url = $4,
              preferences = preferences || $5::jsonb,
              updated_at = now()
        where id = $1 and organization_id = $2`,
      [
        claims.consultationId,
        claims.organizationId,
        uploaded.key,
        `/api/assets?key=${encodeURIComponent(uploaded.key)}`,
        JSON.stringify({ roomReading: room, photoFrom: "customer_phone", photoAt: new Date().toISOString() })
      ]
    );

    await logVoice("qr_upload", { bytes: bytes.byteLength, mime, analyzed: room !== null });
    // 只说「好了」。顾客手机上不该出现这条咨询单的任何内容
    return NextResponse.json({ ok: true });
  } catch (error) {
    await logVoice("qr_upload_failed", { error: String(error).slice(0, 200) });
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
