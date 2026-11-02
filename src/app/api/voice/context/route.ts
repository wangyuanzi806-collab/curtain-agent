import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { getCurrentActor } from "@/lib/auth";
import { getConsultation } from "@/lib/platform-db";
import { buildTurnContext, type Taste } from "@/lib/voice-context";
import { getVoiceSession } from "@/lib/voice-sessions";
import { logVoice } from "@/lib/voice-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 每一轮之后算一次「现在是什么情况」,前端把结果追加进对话。
 *
 * **状态从库里读,不让前端传。** 有没有照片、点过什么、已经叫过谁——
 * 这些服务端本来就有,让前端传一遍既多余又不可信(前端的那份可能是几轮前的)。
 * 前端只需要给三样它才知道的:顾客刚说了什么、已经放过哪几张情境卡、卡了几轮。
 *
 * 这条链路**不阻塞对话**:前端发完就往下走,注入在下一轮生效。
 * 阻塞的话会在顾客说完和模型开口之间插进一次往返,那正是「人机感」的来源之一。
 */
export async function POST(request: Request) {
  try {
    const actor = await getCurrentActor();
    const body = (await request.json()) as {
      consultationId?: string;
      sessionId?: string;
      said?: string;
      playbooksSeen?: string[];
      stalledTurns?: number;
    };

    let taste: Taste = {};
    let hasPhoto = false;
    let room: string | null = null;
    if (body.consultationId) {
      const item = await getConsultation(actor, body.consultationId);
      if (item) {
        hasPhoto = Boolean(item.sceneR2Key);
        const prefs = (item.preferences ?? {}) as {
          taste?: Taste;
          slots?: { room?: string };
        };
        taste = prefs.taste ?? {};
        room = prefs.slots?.room ?? null;
      }
    }

    let handoffs: string[] = [];
    if (body.sessionId) {
      const session = await getVoiceSession(actor, body.sessionId);
      handoffs = session?.handoffs ?? [];
    }

    const context = await buildTurnContext({
      said: String(body.said ?? ""),
      taste,
      room,
      hasPhoto,
      handoffs,
      playbooksSeen: Array.isArray(body.playbooksSeen) ? body.playbooksSeen : [],
      stalledTurns: Number(body.stalledTurns ?? 0)
    });

    /**
     * 每轮的缺口快照落库(SPEC §9.1 A3)。
     * 出了问题要能回溯「当时模型看到的是什么」——没有这个,
     * 事后只能猜它为什么那样说。
     */
    await logVoice(
      "turn_context",
      { line: context.line, playbook: context.playbook?.id ?? null, candidates: context.candidates },
      body.sessionId ?? null
    );

    return NextResponse.json({
      line: context.line,
      playbook: context.playbook ?? null,
      candidates: context.candidates,
      fingerprint: context.fingerprint
    });
  } catch (error) {
    return apiError(error, "算不出这一轮的情况。");
  }
}
