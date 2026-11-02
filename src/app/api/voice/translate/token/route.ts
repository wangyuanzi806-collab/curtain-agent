import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { getCurrentActor } from "@/lib/auth";
import { consumeRateLimit, RequestSecurityError } from "@/lib/request-security";
import { logVoice } from "@/lib/voice-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 只转录、不出声的会话凭证。翻译页用它。
 *
 * 成本形状和销售助手完全不同：这里音频只进不出，按分钟计费的转录是大头，
 * 翻译本身每句几百个文本 token，相比之下约等于免费。不生成任何音频，
 * 这就是它比一场完整语音会话便宜一个数量级的原因。
 */
const TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";

export async function POST() {
  try {
    const actor = await getCurrentActor();
    consumeRateLimit(`voice-translate-token:${actor.userId}`, { limit: 30, windowMs: 3600_000 });

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json({ error: "语音服务尚未配置 OPENAI_API_KEY。" }, { status: 503 });
    }

    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        expires_after: { anchor: "created_at", seconds: 600 },
        session: {
          type: "transcription",
          audio: {
            input: {
              format: { type: "audio/pcm", rate: 24000 },
              turn_detection: { type: "server_vad" },
              // 不传语言提示：这个模型不接受 languages 参数（那是贵 5.7 倍的
              // gpt-live-transcribe 才有的），而钉死单个 language 会把每一句法语
              // 都塞进荷兰语解码器。它自己会判断，这正是一间双语门店需要的。
              transcription: { model: TRANSCRIBE_MODEL }
            }
          }
        }
      })
    });

    const body = await response.text();
    if (!response.ok) {
      await logVoice("translate_token_failed", { status: response.status, body: body.slice(0, 500) });
      return NextResponse.json({ error: "凭证铸造失败。", status: response.status }, { status: 502 });
    }
    return new NextResponse(body, { status: 200, headers: { "content-type": "application/json" } });
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return apiError(error, "凭证铸造失败。");
  }
}
