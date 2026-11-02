import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { getCurrentActor } from "@/lib/auth";
import { logVoice, runVoiceTool } from "@/lib/voice-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** recommend_for_room 要跑完整推荐链路（约 30 秒），默认超时不够它走完 */
export const maxDuration = 300;

/**
 * 模型要调工具时，页面把调用转到这里执行。
 *
 * 合并前这一跳是「比利时浏览器 → eu-west-1 edge → 跨洋 → 本产品 HTTP 接口 →
 * 数据库」；现在检索就在同一个进程里，跨洋那一跳整个消失。
 *
 * 未知的工具名不报错只记录：模型偶尔会凭记忆调一个不存在的名字，
 * 让它拿到一个明确的 unknown_tool 比让整轮对话断掉好。
 */
export async function POST(request: Request) {
  try {
    const actor = await getCurrentActor();
    const body = await request.json();
    const name = String(body?.name ?? "");
    const args = (body?.arguments ?? {}) as Record<string, unknown>;
    const sessionLabel = typeof body?.session_label === "string" ? body.session_label : null;
    // 咨询单是「转人工」和「保存咨询」的落点，也是给店员那张卡片的全部素材来源
    const consultationId = typeof body?.consultation_id === "string" ? body.consultation_id : null;

    const startedAt = Date.now();
    const result = await runVoiceTool(name, args, sessionLabel, { actor, consultationId });
    await logVoice("tool_call", { name, args, ms: Date.now() - startedAt }, sessionLabel);

    return NextResponse.json(result);
  } catch (error) {
    return apiError(error, "工具执行失败。");
  }
}
