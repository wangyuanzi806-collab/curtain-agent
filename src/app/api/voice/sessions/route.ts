import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { getCurrentActor } from "@/lib/auth";
import { collectFacts, findHandoff } from "@/lib/voice-intent";
import {
  appendTurns,
  briefFromSession,
  getVoiceSession,
  listVoiceSessions,
  markHandoff,
  openVoiceSession,
  type TranscriptTurn
} from "@/lib/voice-sessions";
import { postAutoHandoff } from "@/lib/voice-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 语音会话的开、记、翻。
 *
 * GET            → 最近的会话列表（语音页的「历史」抽屉、后台的会话记录都读它）
 * GET  ?id=xxx   → 某一场的完整转录 + 一段可注入新会话的交底
 * POST           → 开一场新的
 * PATCH          → 追加几轮转录（前端按批发送，不是每个字发一次）
 */

export async function GET(request: Request) {
  try {
    const actor = await getCurrentActor();
    const id = new URL(request.url).searchParams.get("id");
    if (id) {
      const session = await getVoiceSession(actor, id);
      if (!session) return NextResponse.json({ item: null }, { status: 404 });
      return NextResponse.json({ item: session, brief: briefFromSession(session) });
    }
    return NextResponse.json({ items: await listVoiceSessions(actor, 20) });
  } catch (error) {
    return apiError(error, "读取语音会话失败。");
  }
}

export async function POST(request: Request) {
  try {
    const actor = await getCurrentActor();
    const body = (await request.json().catch(() => ({}))) as {
      sessionLabel?: unknown;
      source?: unknown;
      consultationId?: unknown;
    };
    const session = await openVoiceSession(actor, {
      sessionLabel: typeof body.sessionLabel === "string" ? body.sessionLabel : null,
      source: typeof body.source === "string" ? body.source : "store",
      consultationId: typeof body.consultationId === "string" ? body.consultationId : null
    });
    return NextResponse.json({ item: session });
  } catch (error) {
    return apiError(error, "开一场语音会话失败。");
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await getCurrentActor();
    const body = (await request.json().catch(() => ({}))) as { id?: unknown; turns?: unknown };
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) return NextResponse.json({ error: "缺少会话 id。" }, { status: 400 });

    const turns: TranscriptTurn[] = Array.isArray(body.turns)
      ? body.turns
          .filter((turn): turn is { role: string; text: string; at?: string } =>
            Boolean(turn) && typeof turn === "object" && typeof (turn as { text?: unknown }).text === "string"
          )
          .map<TranscriptTurn>((turn) => ({
            role: turn.role === "assistant" || turn.role === "tool" ? turn.role : "user",
            // 一轮话再长也有限；截断是为了防止坏帧把 jsonb 撑爆
            text: String(turn.text).slice(0, 4000),
            at: typeof turn.at === "string" ? turn.at : new Date().toISOString()
          }))
          .slice(0, 50)
      : [];

    await appendTurns(actor, id, turns);

    /**
     * 顾客刚说的话里，有没有「只有人能做」的那件事。
     *
     * 放在这里而不是让模型自己判断：模型会忘、会讨好、会觉得自己答得挺好——
     * 而顾客问完价格听到一句「同事会给您确认」之后，在此之前**没有任何人
     * 被通知**。这条链路上最贵的一个洞就在这儿：问价格是最强的购买信号，
     * 我们却把它变成了死胡同。
     *
     * **必须 await。** 这里原来是 void (async()=>{})()——Vercel 在响应返回的
     * 那一刻冻结实例，fire-and-forget 根本跑不完：上线以来 handoffs 全是 []、
     * auto_handoff 事件 0 次，就是这一行。这条 PATCH 是攒批的后台落库请求，
     * 不在对话的关键路径上，多等几百毫秒没人感觉到；而不等的代价是这件事
     * 根本没发生。（同一个坑 08-03 在 token 路由踩过一次。）
     */
    const saidNow = turns
      .filter((turn) => turn.role === "user")
      .map((turn) => turn.text)
      .join(" ");
    if (saidNow.trim()) {
      await (async () => {
        try {
          const facts = await collectFacts(actor, { voiceSessionId: id, consultationId: null });
          if (!facts) return;
          const call = findHandoff(facts, saidNow);
          if (!call) return;
          // 每类每场只叫一次。抢不到就是别的请求已经叫过了
          if (!(await markHandoff(actor, id, call.reason))) return;
          const session = await getVoiceSession(actor, id);
          const brief = session?.consultationId
            ? await collectFacts(actor, {
                voiceSessionId: id,
                consultationId: session.consultationId
              })
            : null;
          await postAutoHandoff({
            action: call.action,
            why: call.why,
            said: call.said,
            soFar: brief
              ? `聊了 ${brief.minutes} 分钟，点了 ${brief.taps} 次` +
                (brief.pickedSku ? "，已经挑中一款" : "")
              : "",
            consultationId: session?.consultationId ?? undefined
          });
        } catch {
          /* 叫人失败绝不能弄断顾客的对话 */
        }
      })();
    }

    return NextResponse.json({ ok: true, appended: turns.length });
  } catch (error) {
    return apiError(error, "记录对话失败。");
  }
}
