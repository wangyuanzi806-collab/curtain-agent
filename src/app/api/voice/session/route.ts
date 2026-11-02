import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { getCurrentActor } from "@/lib/auth";
import { createConsultation, getConsultation, listConsultations } from "@/lib/platform-db";
import { attachConsultation } from "@/lib/voice-sessions";
import { logVoice } from "@/lib/voice-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 一场语音 = 一条 consultation。
 *
 * 不新建表：consultations 已经有房间照片、推荐方案、选中的款、效果图和状态机，
 * `preferences.source = "voice"` 标出来源就够了。业务人员因此在同一个列表里
 * 看到所有线索，不分是网页来的还是门店语音来的；效果图那条接口本来就绑
 * consultation，语音有了它几乎不用写新代码。
 *
 * **点球不建。** 顾问点了没说话就走的空场次会把列表塞满垃圾，
 * 所以等到第一次真有产出（拍了照片 / 出了推荐 / 转了人工）才落库。
 *
 * **没有"结束"这个动作。** 顾客走了顾问不会去点结束——他手里还拿着手机，
 * 下一位五分钟后就进来。让人去点的按钮在门店里必然形同虚设，点不点全看
 * 记不记得，数据反而更脏。所以状态由内容决定（有推荐 recommended、
 * 有效果图 ready），能不能接着聊由时间决定。
 */

/** 两小时内还有动静的，才算"刚才那场" */
const RESUMABLE_MS = 2 * 60 * 60 * 1000;

function isVoiceConsultation(item: { preferences?: Record<string, unknown> }) {
  return item.preferences?.source === "voice";
}

function defaultClientName() {
  // 门店不会当面问顾客姓名，先给个认得出的占位，顾问事后能改。
  // 用布鲁塞尔时间：这条名字是给比利时同事看的，不该让他心算时区。
  const stamp = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Europe/Brussels",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date());
  return `门店语音 · ${stamp}`;
}

/** 最近一条还能接着聊的语音咨询 */
export async function GET() {
  try {
    const actor = await getCurrentActor();
    const items = await listConsultations(actor, 20);
    const resumable = items.find(
      (item) =>
        isVoiceConsultation(item) &&
        item.status !== "archived" &&
        Date.now() - new Date(item.updatedAt).getTime() < RESUMABLE_MS
    );
    if (!resumable) return NextResponse.json({ item: null });
    return NextResponse.json({
      item: {
        id: resumable.id,
        displayCode: resumable.displayCode,
        clientName: resumable.clientName,
        roomType: resumable.roomType,
        status: resumable.status,
        updatedAt: resumable.updatedAt,
        hasScene: Boolean(resumable.sceneR2Key),
        sceneImageUrl: resumable.sceneImageUrl,
        pickCount: Array.isArray((resumable.recommendation as { skus?: unknown[] })?.skus)
          ? ((resumable.recommendation as { skus: unknown[] }).skus).length
          : 0
      }
    });
  } catch (error) {
    return apiError(error, "读取语音咨询失败。");
  }
}

/**
 * 拿到这一场的 consultation。幂等：
 * 带了 id 就核对归属后原样返回，没带就新建一条。
 * 前端在第一次真有产出时才调它。
 */
export async function POST(request: Request) {
  try {
    const actor = await getCurrentActor();
    let body: { id?: unknown; sessionLabel?: unknown; voiceSessionId?: unknown } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      /* 空 body 就是要新建 */
    }

    if (typeof body.id === "string" && body.id.trim()) {
      const existing = await getConsultation(actor, body.id.trim());
      if (existing) {
        return NextResponse.json({ item: { id: existing.id, displayCode: existing.displayCode } });
      }
    }

    const sessionLabel = typeof body.sessionLabel === "string" ? body.sessionLabel : null;
    const voiceSessionId = typeof body.voiceSessionId === "string" ? body.voiceSessionId.trim() : "";
    const created = await createConsultation(actor, {
      clientName: defaultClientName(),
      preferences: {
        source: "voice",
        // 串起 voice_logs：铸凭证、工具调用、违禁词命中都带着这个标签
        sessionLabel,
        openedAt: new Date().toISOString()
      }
    });
    // 会话在点球时就开了，咨询单要等到真有产出——所以是单子回头挂到会话上
    if (voiceSessionId) await attachConsultation(actor, voiceSessionId, created.id);
    await logVoice("consultation_opened", { consultation_id: created.id, display_code: created.displayCode }, sessionLabel);
    return NextResponse.json({ item: { id: created.id, displayCode: created.displayCode } });
  } catch (error) {
    return apiError(error, "开一条语音咨询失败。");
  }
}
