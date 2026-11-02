import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { getCurrentActor, isPlatformAdministrator } from "@/lib/auth";
import { consumeRateLimit, RequestSecurityError } from "@/lib/request-security";
import {
  buildTools,
  instructionSupplement,
  logVoice,
  readVoiceConfig,
  resolveModel
} from "@/lib/voice-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 转录配置。
 *
 * 2026-08-04 回放老板那场：「Üç」「りかり」「王昆是」「Já」——都是「嗯」「好」「是」
 * 这类**短促的语气词**被猜成了土耳其语、日语、捷克语。
 *
 * 根因不是模型弱，是**候选语言集里有土耳其语和日语**：一秒的音频里没有足够信息
 * 判断语种，模型就在全世界的语言里挑一个。而助手收到一句乱码只能答非所问，
 * 顾客于是重复一遍，越重复越短、越短越乱。
 *
 * `languages` 把候选压到门店真实会出现的四种，这才是根治的那一刀。
 * 实测（08-04 打 client_secrets）：**`gpt-4o-transcribe` 不支持 `languages`
 * 也不支持 `keywords`，两个都直接 400**——所以换模型是前提，不是优化。
 * `keywords` 服务端接受但不回显（传瞎编字段会 400，传错类型也会 400，说明它认识这个字段）。
 *
 * 出事回退：`VOICE_TRANSCRIBE_MODEL=gpt-4o-transcribe`，改 env 即可，不必重新部署。
 * 那两个字段会跟着一起摘掉——它们在老模型上是 400。
 */
function buildTranscription() {
  const model = process.env.VOICE_TRANSCRIBE_MODEL?.trim() || "gpt-live-transcribe";
  const prompt =
    "A conversation in a Belgian curtain shop. The speakers use Dutch, French, " +
    "English or Mandarin Chinese, and may switch between them. Short " +
    "acknowledgements are common: ja, oui, yes, 嗯, 好, 对, 是的, 可以, 行. " +
    "Topics: curtains, fabric, linen, wool, blackout, pleats, rails, living room, " +
    "bedroom, window, colour, samples, measuring, price.";
  if (model !== "gpt-live-transcribe") return { model, prompt };
  return {
    model,
    languages: ["nl", "fr", "en", "zh"],
    prompt,
    // 短应答排在最前：它们最短、最容易被猜错，也最常见
    keywords: [
      "ja", "nee", "oui", "non", "yes", "嗯", "好", "对", "是的", "可以", "行",
      "gordijn", "gordijnen", "rideau", "rideaux", "stof", "tissu", "linnen", "lin",
      "verduistering", "occultant", "blackout", "plooi", "rail", "roede",
      "woonkamer", "slaapkamer", "salon", "chambre", "raam", "fenêtre",
      "窗帘", "遮光", "亚麻", "纱帘", "客厅", "卧室", "量尺"
    ]
  };
}

/**
 * 铸一枚 OpenAI Realtime 的临时凭证。密钥只在服务端，永远不进浏览器。
 *
 * 合并前这一步在对方的 edge function 里，靠门店码鉴权；现在门店码退休，
 * 由本产品的登录接管——中途不再校验，一轮对话最长十几分钟而凭证 600 秒足够，
 * 屏幕跳登录页在顾客面前就是当场事故。
 */
export async function POST(request: Request) {
  try {
    const actor = await getCurrentActor();

    // 实时音频按音频 token 计费，一枚凭证能开一场会话，所以限的是「开场次数」
    consumeRateLimit(`voice-token:${actor.userId}`, { limit: 30, windowMs: 3600_000 });

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      await logVoice("token_mint_failed", { reason: "missing_openai_key" });
      return NextResponse.json(
        { error: "语音服务尚未配置 OPENAI_API_KEY。" },
        { status: 503 }
      );
    }

    let requestedModel: unknown;
    try {
      requestedModel = (await request.json())?.model;
    } catch {
      /* 用默认模型 */
    }
    // 正常默认正式版；平台管理员可以显式切到 mini 做对照。VOICE_FORCE_MINI
    // 才是全域应急回退，不能让前端默认请求 mini 把这里的正式版默认值抵消掉。
    const canChooseModel = isPlatformAdministrator(actor);
    const model = resolveModel(requestedModel, canChooseModel);

    // 提示词的真源在库里，改措辞是一条 update，不必重新部署。
    // 补充说明单独拼在后面：原文一个字不动，变化的部分（价格工具关、花纹三档）写在补充里。
    const instructions = [await readVoiceConfig("sales_instructions"), instructionSupplement()]
      .filter(Boolean)
      .join("\n\n");
    if (instructions.length < 2000) {
      await logVoice("token_mint_failed", { reason: "instructions_too_short", length: instructions.length });
      return NextResponse.json({ error: "销售话术尚未就绪。" }, { status: 503 });
    }

    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        expires_after: { anchor: "created_at", seconds: 600 },
        session: {
          type: "realtime",
          model,
          output_modalities: ["audio"],
          instructions,
          tools: buildTools(),
          tool_choice: "auto",
          audio: {
            input: {
              format: { type: "audio/pcm", rate: 24000 },
              turn_detection: { type: "semantic_vad" },
              transcription: buildTranscription()
            },
            output: { format: { type: "audio/pcm", rate: 24000 }, voice: "marin" }
          }
        }
      })
    });

    const body = await response.text();
    if (!response.ok) {
      await logVoice("token_mint_failed", { status: response.status, body: body.slice(0, 500) });
      return NextResponse.json({ error: "凭证铸造失败。", status: response.status }, { status: 502 });
    }

    // 只记失败的话，别人拿我们的账户开会话就只在账单上留痕。
    // 会话 id 足以和 OpenAI 自己的用量对上，凭证本身不留。
    let sessionId = "";
    try {
      sessionId = String((JSON.parse(body) as { session?: { id?: unknown } })?.session?.id ?? "");
    } catch {
      /* 记不到就算了 */
    }
    // model 记进日志：事后要能对上哪一通用的哪个模型，否则模型对比无从谈起
    await logVoice("token_minted", { model, session_id: sessionId, actor: actor.userId });

    return new NextResponse(body, {
      status: 200,
      headers: {
        "content-type": "application/json",
        /**
         * 页面据此决定引擎标签能不能点。**放响应头，不塞进 body。**
         *
         * body 是 OpenAI 铸的凭证，原样透传，一个字节都不该由我们重组。
         * 2026-08-03 为了加这个字段改成了 JSON.parse → 展开 → 再 stringify，
         * 而老板 08-02 成功的那两次走的是原样透传——之后 SDP 握手就开始失败。
         * 无论重组到底改坏了什么，凭证这条路上「不碰」才是对的。
         */
        "x-can-choose-model": canChooseModel ? "1" : "0"
      }
    });
  } catch (error) {
    // 铸不出凭证是「连不通」最靠前的一环，**必须留痕**：未登录走 apiError
    // 直接回 401，以前一条记录都不写，于是报「一直连不上」时库里干干净净。
    // 不记任何身份信息，只记发生过、是哪一类。
    //
    // **用 await 而不是 after**：after 的回调排在响应之后，实测在 Vercel 上
    // 跑不完就被冻结了——四次 401 一条都没落库。而留痕不可靠等于没有留痕，
    // 下一次再报「连不通」还是只能靠猜。这一次写库约几百毫秒，
    // 相比之下真正的瓶颈是刚修掉的那个静态 import（60 秒）。
    await logVoice("token_mint_failed", {
      reason: error instanceof RequestSecurityError ? "rate_limited" : "exception",
      message: error instanceof Error ? error.message.slice(0, 200) : "unknown"
    });
    if (error instanceof RequestSecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    // 未登录要回 401 而不是 500——500 的意思是「我们坏了」，
    // 把正常的未授权访问算进错误率，真出故障时就看不出来了
    return apiError(error, "凭证铸造失败。");
  }
}
