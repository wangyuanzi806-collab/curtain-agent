import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { getCurrentActor } from "@/lib/auth";
import { consumeRateLimit, RequestSecurityError } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TRANSLATE_MODEL = "gpt-4o-mini";

const TRANSLATE_SYSTEM = `
You translate between French and Dutch inside a curtain shop in Belgium.

The input is a single spoken utterance that has already been transcribed, so it
may be informal, unpunctuated, or cut off mid-sentence. Translate it anyway.

Direction is automatic:
- French in  -> Dutch out
- Dutch in   -> French out
- anything else in -> Dutch out

Rules:
- Reply with the translation only. No quotes, no notes, no language labels.
- Numbers, measurements, colours and product names stay exactly as they are.
- Keep the register of a shop conversation: plain, spoken, not literary.
- If the utterance is empty or pure filler, return an empty string.

Answer as JSON: {"src":"<fr|nl|other>","text":"<translation>"}
`.trim();

/** 店员说法语、顾客说荷兰语，一句一译 */
export async function POST(request: Request) {
  try {
    const actor = await getCurrentActor();
    // 一场对话就是几十上百句，这个额度是防跑飞不是防用
    consumeRateLimit(`voice-translate:${actor.userId}`, { limit: 600, windowMs: 3600_000 });

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json({ error: "语音服务尚未配置 OPENAI_API_KEY。" }, { status: 503 });
    }

    const text = String((await request.json())?.text ?? "").trim();
    if (!text) return NextResponse.json({ src: "other", text: "" });

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: TRANSLATE_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: TRANSLATE_SYSTEM },
          { role: "user", content: text }
        ]
      })
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "translate_failed", status: response.status },
        { status: 502 }
      );
    }

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content ?? "{}";
    try {
      const parsed = JSON.parse(raw);
      return NextResponse.json({ src: String(parsed.src ?? "other"), text: String(parsed.text ?? "") });
    } catch {
      // 模型没照 JSON 约定答时，门店拿到一句能用的译文，也好过拿到一个它没法处理的错误
      return NextResponse.json({ src: "other", text: String(raw) });
    }
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return apiError(error, "翻译失败。");
  }
}
