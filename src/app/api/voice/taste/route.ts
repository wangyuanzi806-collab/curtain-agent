import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { getCurrentActor } from "@/lib/auth";
import { getConsultation, updateConsultation } from "@/lib/platform-db";
import { CHOICE_KINDS, describeChoice, type ChoiceKind } from "@/lib/voice-choices";
import { appendTap } from "@/lib/voice-sessions";
import { logVoice } from "@/lib/voice-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 顾客在屏幕上点了一个选项。
 *
 * 这条路存在的理由:**点击必须和说话一样算数**。顾客指着屏幕说「就这种」的时候,
 * 他已经回答了颜色 + 质感 + 风格三个问题——比他开口说「我想要那种…摸起来
 * 有点粗的」精确得多。以前语音端只有嘴,顾客不会形容就卡住,助手就绕回去
 * 换个说法再问一遍,那正是「机械」的来源。
 *
 * 落库在前、注入会话在后(前端的顺序):万一这一刻网络断了,重连后偏好还在,
 * 顾客不必重指一次。这也是推荐闸门的判据之一——它读的就是这里写的 taste。
 */
export async function POST(request: Request) {
  try {
    const actor = await getCurrentActor();
    const body = (await request.json().catch(() => ({}))) as {
      kind?: unknown;
      id?: unknown;
      consultationId?: unknown;
      voiceSessionId?: unknown;
      sessionLabel?: unknown;
    };

    const kind = String(body.kind ?? "");
    const id = String(body.id ?? "").trim();
    const voiceSessionId = typeof body.voiceSessionId === "string" ? body.voiceSessionId.trim() : "";
    if (!(CHOICE_KINDS as readonly string[]).includes(kind) || !id) {
      return NextResponse.json({ error: "不认识的选项。" }, { status: 400 });
    }
    const sessionLabel = typeof body.sessionLabel === "string" ? body.sessionLabel : null;
    const spoken = describeChoice(kind as ChoiceKind, id);

    await logVoice("taste_tapped", { kind, id, label: spoken }, sessionLabel);
    // 也记进这一场的过程记录：后台跟线索的人要看到「他在屏幕上指了什么」，
    // 那比任何生成的摘要都能说明他的口味
    if (voiceSessionId) {
      await appendTap(actor, voiceSessionId, { kind, id, label: spoken, at: new Date().toISOString() });
    }

    // 咨询单还没开出来也不该丢——助手照样收得到这次点击，
    // 只是这条偏好等到有单了再累进
    const consultationId = typeof body.consultationId === "string" ? body.consultationId.trim() : "";
    if (consultationId) {
      const current = await getConsultation(actor, consultationId);
      if (current) {
        const preferences = (current.preferences ?? {}) as Record<string, unknown>;
        const taste = { ...((preferences.taste as Record<string, string[]>) ?? {}) };
        const picked = new Set(taste[kind] ?? []);
        // 再点一次就是取消：顾客改主意在门店里天天发生
        if (picked.has(id)) picked.delete(id);
        else picked.add(id);
        // 光线和花纹是单选（互斥的表述），质感和颜色可以多选
        taste[kind] = kind === "light" || kind === "pattern" || kind === "layer"
          ? [...picked].slice(-1)
          : [...picked].slice(0, 3);
        await updateConsultation(actor, current.id, {
          preferences: { ...preferences, taste, tasteUpdatedAt: new Date().toISOString() }
        });
      }
    }

    return NextResponse.json({ ok: true, spoken });
  } catch (error) {
    return apiError(error, "记下这次选择失败。");
  }
}
