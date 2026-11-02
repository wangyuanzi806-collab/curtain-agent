import { getAgentModelById } from "@/lib/agent-models";
import { searchKnowledgeDocs, type KnowledgeDoc } from "@/lib/knowledge-base";
import { getCachedSkuCatalog } from "@/lib/catalog-cache";
import { PATTERN_LABELS, type SkuCatalogItem } from "@/lib/sku-catalog";
import { analyzeRoomColor } from "@/lib/room-color";
import {
  assessRoomTrust,
  diversifyByHarmony,
  fallbackTarget,
  filterByHarmony,
  harmonyTarget,
  type HarmonyTarget
} from "@/lib/curtain-harmony";
import { rerankCandidates } from "@/lib/curtain-rerank";
import { describeSurvey, filterBySurvey, type SurveyAnswers } from "@/lib/curtain-survey";

/** 送给模型的候选上限。全量塞入会超出模型 token 限制，且模型也无从比较 */
const MODEL_CANDIDATE_LIMIT = 40;
/** 和谐硬筛至少要留下这么多款才算数，否则只排序不过滤 */
const MIN_HARMONY_POOL = MODEL_CANDIDATE_LIMIT / 2;
/** 最终给客户看几款。组内平等呈现，不标首选备选 */
const RECOMMENDATION_COUNT = 5;
/** 表单占位符，不是客户的诉求，不该进提示词 */
const PREFERENCE_PLACEHOLDERS = new Set([
  "自动",
  "自动搭配",
  "自动判断",
  "兼顾采光与隐私",
  "不确定"
]);
import { WINDOW_TYPE_OPTIONS, normalizeWindowType } from "@/lib/window-types";

type AgentRequestInput = {
  modelId: string;
  locale?: AgentLocale;
  roomType: string;
  style: string;
  desiredColor: string;
  opacityNeed: string;
  extraInstruction: string;
  sceneImageDataUrl?: string;
  /** 六题问卷答案。缺省时不做偏好硬筛，只按房间配色挑 */
  survey?: SurveyAnswers | null;
  /** 顾问在第二屏更正过的窗型。给了就以它为准，不再采信模型推断 */
  windowTypeOverride?: string;
  /**
   * 只读空间、不选品。第一屏用它拿窗型与场景描述——
   * 那时问卷还没答，跑完整选品链路等于把 26~30 秒白花一遍，
   * 结果必然在第三屏被整个覆盖。
   */
  sceneOnly?: boolean;
};

type AgentRecommendation = {
  summary: string;
  recommended_sku_ids: string[];
  recommended_render_instruction: string;
  reasoning: string;
  inferred_window_type: string;
  window_type_reason: string;
  /** 每款的四段理由。重排不可用时为空，此时界面回退到整体搭配结论 */
  sku_reasons?: SkuReason[];
  /** model = 模型重排；rules = 已降级为规则序 */
  ranking_source?: "model" | "rules";
};

/** 从照片直接读出的空间信息，供第二屏如实展示 */
export type RoomColorReading = {
  tone: "warm" | "cool" | "neutral";
  toneLabel: string;
  wallBrightness: string;
  floorBrightness: string;
  trusted: boolean;
  issues: string[];
};

export type SkuReason = {
  sku_id: string;
  space: string;
  why: string;
  /** 结论下面那行实测值，可能为空（模型没给或走了降级路径） */
  evidence?: string;
  matched: string[];
  caveat: string;
};

type KnowledgeMatch = Pick<
  KnowledgeDoc,
  "id" | "title" | "category" | "tags" | "source" | "score" | "excerpt"
>;

type ProviderConfig = {
  url: string;
  apiKey?: string;
  temperature: number;
  maxTokens: number;
};

type ChatCompletionPayload = {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
      reasoning_content?: string;
    };
  }>;
  error?: { message?: string };
};

const ERRORS = {
  modelUnavailable: "\u5f53\u524d\u9009\u62e9\u7684\u667a\u80fd\u4f53\u6a21\u578b\u4e0d\u53ef\u7528\u3002",
  providerUnavailable: "\u5f53\u524d provider \u5c1a\u672a\u63a5\u5165\u3002",
  emptyContent: "\u667a\u80fd\u4f53\u8fd4\u56de\u5185\u5bb9\u4e3a\u7a7a\u3002",
  invalidJson: "\u667a\u80fd\u4f53\u8fd4\u56de\u5185\u5bb9\u4e0d\u662f\u53ef\u89e3\u6790\u7684 JSON\u3002",
  requestFailedPrefix: "\u667a\u80fd\u4f53\u8bf7\u6c42\u5931\u8d25\uff1a",
  repairFailed: "\u667a\u80fd\u4f53\u8fd4\u56de\u4e86\u5185\u5bb9\uff0c\u4f46\u6ca1\u80fd\u6574\u7406\u6210\u53ef\u7528\u7684\u63a8\u8350\u7ed3\u679c\u3002",
  missingModel: "\u672a\u627e\u5230\u5bf9\u5e94\u7684\u667a\u80fd\u4f53\u6a21\u578b\u3002",
  imageUnsupportedPrefix: "\u5f53\u524d\u6a21\u578b ",
  imageUnsupportedSuffix:
    " \u6682\u4e0d\u652f\u6301\u5bb6\u5ead\u573a\u666f\u56fe\u7406\u89e3\uff0c\u8bf7\u5207\u6362\u5230 Kimi 2.5\u3002",
  missingApiKey: "\u5f53\u524d\u6a21\u578b\u7f3a\u5c11 API Key\u3002",
  timeout: "\u667a\u80fd\u4f53\u8bf7\u6c42\u8d85\u65f6\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\uff0c\u6216\u5148\u6362\u4e00\u5f20\u66f4\u5c0f\u7684\u573a\u666f\u56fe\u3002"
} as const;

const WINDOW_TYPE_GUIDE = WINDOW_TYPE_OPTIONS.join("\u3001");
const PROVIDER_TIMEOUT_MS = 25_000;

/** \u4e0e\u524d\u7aef Locale \u4e00\u4e00\u5bf9\u5e94 */
export type AgentLocale = "zh" | "en" | "nl" | "fr";

/**
 * \u544a\u8bc9\u6a21\u578b\u7528\u54ea\u79cd\u8bed\u8a00\u4f5c\u7b54\u3002
 *
 * \u539f\u5148\u56db\u5904\u90fd\u5199\u6210 `locale === "en" ? "English" : "Simplified Chinese"`\u2014\u2014
 * \u987e\u95ee\u628a\u754c\u9762\u5207\u5230\u8377\u5170\u8bed\u6216\u6cd5\u8bed\uff0c\u6a21\u578b\u6536\u5230\u7684\u4ecd\u662f"\u7528\u4e2d\u6587"\uff0c\u5ba2\u6237\u62ff\u5230\u4e00\u4efd\u4e2d\u6587\u65b9\u6848\u3002
 * \u8ba4\u4e0d\u51fa\u7684\u8bed\u8a00\u4e00\u5f8b\u56de\u843d\u4e2d\u6587\uff0c\u522b\u8ba9\u6a21\u578b\u81ea\u5df1\u731c\u3002
 */
const LANGUAGE_NAMES: Record<AgentLocale, string> = {
  zh: "Simplified Chinese",
  en: "English",
  nl: "Dutch",
  fr: "French"
};

function languageName(locale?: string) {
  return LANGUAGE_NAMES[(locale || "zh") as AgentLocale] || LANGUAGE_NAMES.zh;
}

class ProviderRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ProviderRequestError";
    this.status = status;
  }
}

function getProviderConfig(modelId: string): ProviderConfig {
  const option = getAgentModelById(modelId);
  if (!option || !option.enabled) {
    throw new Error(ERRORS.modelUnavailable);
  }

  if (option.provider === "qwen") {
    return {
      url: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      apiKey: process.env.QWEN_API_KEY,
      temperature: 0.2,
      maxTokens: 800
    };
  }

  if (option.provider === "kimi") {
    return {
      url: "https://api.moonshot.cn/v1/chat/completions",
      apiKey: process.env.KIMI_API_KEY,
      temperature: 1,
      maxTokens: 4096
    };
  }

  throw new Error(ERRORS.providerUnavailable);
}

function buildCandidateModelIds(input: AgentRequestInput) {
  const requested = getAgentModelById(input.modelId);

  if (!input.sceneImageDataUrl) {
    const textFallbackIds = [
      input.modelId,
      "qwen-qwen3-vl-flash",
      "kimi-k2.5"
    ];

    return textFallbackIds.filter((id, index, array) => {
      const option = getAgentModelById(id);
      return Boolean(option?.enabled) && array.indexOf(id) === index;
    });
  }

  const visualFallbackIds = ["qwen-qwen3-vl-flash", "kimi-k2.5"].filter((id) => {
    const option = getAgentModelById(id);
    return Boolean(option?.enabled && option.supportsImageInput);
  });

  if (requested?.supportsImageInput) {
    return [requested.id, ...visualFallbackIds.filter((id) => id !== requested.id)];
  }

  return visualFallbackIds.length > 0 ? visualFallbackIds : [input.modelId];
}

function createCatalogSnippet(items: SkuCatalogItem[]) {
  return items.map((item) => ({
    sku_id: item.sku_id,
    name: item.name,
    product_type: item.product_type,
    opacity: item.opacity,
    color: item.color,
    style_tags: item.style_tags,
    weight_gsm: item.weight_gsm ?? null
    // 不传 image_url：模型看不到图片内容，只会拿到一串带哈希的长地址，
    // 对选品毫无帮助，却是提示词里最大的 token 消耗项。
    // 也不传 window_types：面料适用于所有窗型，每条重复一遍纯属浪费。
  }));
}

function createKnowledgeSnippet(items: KnowledgeMatch[]) {
  return items.map((item) => ({
    id: item.id,
    title: item.title,
    category: item.category,
    tags: item.tags,
    source: item.source,
    excerpt: item.excerpt
  }));
}

function normalizeMessageContent(
  content?: string | Array<{ type?: string; text?: string }>
) {
  if (!content) return "";
  if (typeof content === "string") return content;

  return content
    .map((item) => (item?.type === "text" ? item.text || "" : ""))
    .join("");
}

function stripThinkingContent(content: string) {
  return content
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```json/gi, "```")
    .trim();
}

function extractJson(content: string) {
  const cleaned = stripThinkingContent(content);
  if (!cleaned) {
    throw new Error(ERRORS.emptyContent);
  }

  try {
    return JSON.parse(cleaned) as AgentRecommendation;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1)) as AgentRecommendation;
    }
  }

  throw new Error(ERRORS.invalidJson);
}

function getFinishReason(payload: ChatCompletionPayload) {
  return payload.choices?.[0]?.finish_reason || "";
}

function getContentFromPayload(payload: ChatCompletionPayload) {
  const choice = payload.choices?.[0];
  const content = normalizeMessageContent(choice?.message?.content);
  const reasoningContent = choice?.message?.reasoning_content?.trim() || "";

  if (content.trim()) return content;
  if (reasoningContent) return reasoningContent;
  return "";
}

function getRepairModelId() {
  if (process.env.QWEN_API_KEY) return "qwen-qwen3-vl-flash";
  if (process.env.KIMI_API_KEY) return "kimi-k2.5";
  return null;
}

function normalizeRecommendationShape(
  parsed: Partial<AgentRecommendation>,
  skus: SkuCatalogItem[]
): AgentRecommendation {
  const validSkuIds = new Set(skus.map((item) => item.sku_id));
  const modelPicked = Array.isArray(parsed.recommended_sku_ids)
    ? parsed.recommended_sku_ids
        .map((item) => String(item || "").trim())
        .filter((item) => validSkuIds.has(item))
    : [];
  // 视觉模型不再选品，这里用候选池顺序兜底。
  // 候选池已经过颜色协调过滤与分层，本身就是一份合理的规则序，
  // 重排失败时直接用它，不会让客户看到空结果。
  const recommendedSkuIds = (
    modelPicked.length > 0 ? modelPicked : skus.map((item) => item.sku_id)
  ).slice(0, RECOMMENDATION_COUNT);

  return {
    summary: String(parsed.summary || "").trim(),
    recommended_sku_ids: recommendedSkuIds,
    recommended_render_instruction: String(parsed.recommended_render_instruction || "").trim(),
    reasoning: String(parsed.reasoning || "").trim(),
    inferred_window_type: String(parsed.inferred_window_type || "").trim(),
    window_type_reason: String(parsed.window_type_reason || "").trim()
  };
}

function isRecommendationUsable(
  value: AgentRecommendation,
  hasSceneImage: boolean,
  requiresSkus: boolean
) {
  return Boolean(
    value.summary &&
      value.recommended_render_instruction &&
      (!requiresSkus || value.recommended_sku_ids.length > 0) &&
      (!hasSceneImage || (value.inferred_window_type && value.window_type_reason))
  );
}

/**
 * 定下最终窗型。顾问在第二屏改过就以他为准。
 *
 * 这里原先还按窗型给商品重排并截到 3 款，但面料适用所有窗型、匹配判断恒为真，
 * 排序部分从来没起过作用，那句 slice(0,3) 却是真的——
 * 重排一旦降级，客户就只会看到 3 款且理由全空。
 */
function resolveWindowType(parsed: AgentRecommendation, override?: string): AgentRecommendation {
  const corrected = normalizeWindowType((override || "").trim());
  if (corrected) {
    return {
      ...parsed,
      inferred_window_type: corrected,
      window_type_reason: "按你在上一步的更正处理。"
    };
  }

  const inferred = parsed.inferred_window_type.trim();
  if (!inferred) return parsed;
  return { ...parsed, inferred_window_type: normalizeWindowType(inferred) };
}

async function repairRecommendationJson(params: {
  rawContent: string;
  originalModelLabel: string;
  skus: SkuCatalogItem[];
  locale?: AgentLocale;
}) {
  const repairModelId = getRepairModelId();
  if (!repairModelId) {
    throw new Error(ERRORS.repairFailed);
  }

  const repairOption = getAgentModelById(repairModelId);
  const repairConfig = getProviderConfig(repairModelId);
  if (!repairOption || !repairOption.enabled || !repairConfig.apiKey) {
    throw new Error(ERRORS.repairFailed);
  }

  const payload = await postWithRetry(repairConfig.url, repairConfig.apiKey, {
    model: repairOption.model,
    temperature: 0,
    max_tokens: 900,
    messages: [
      {
        role: "system",
        content:
          "You repair model output into strict JSON. Return JSON only. Do not output markdown. Do not explain."
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            task:
              `Convert the following curtain recommendation draft into valid JSON with the exact schema. Keep natural-language fields in ${languageName(params.locale)}. Keep inferred_window_type as a canonical Chinese label. Only use sku ids that appear in allowed_sku_ids.`,
            schema: {
              summary: "string",
              recommended_sku_ids: ["string"],
              recommended_render_instruction: "string",
              reasoning: "string",
              inferred_window_type: "string",
              window_type_reason: "string"
            },
            allowed_sku_ids: params.skus.map((item) => item.sku_id),
            source_model: params.originalModelLabel,
            draft_output: params.rawContent
          },
          null,
          2
        )
      }
    ]
  });

  return extractJson(getContentFromPayload(payload));
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function postWithRetry(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
  retries = 2
) {
  let lastPayload: ChatCompletionPayload | null = null;
  let lastStatus = 0;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
      });
    } catch (error) {
      const isTimeout =
        error instanceof Error &&
        (error.name === "TimeoutError" || /aborted|timeout/i.test(error.message));

      if (attempt === retries) {
        throw new ProviderRequestError(
          isTimeout ? ERRORS.timeout : `${ERRORS.requestFailedPrefix}\u7f51\u7edc\u5f02\u5e38`,
          408
        );
      }

      await sleep(800 * (attempt + 1));
      continue;
    }

    lastStatus = response.status;
    const responseType = response.headers.get("content-type") || "";
    if (responseType.includes("application/json")) {
      lastPayload = (await response.json()) as ChatCompletionPayload;
    } else {
      const text = await response.text();
      lastPayload = {
        error: {
          message: text || `${ERRORS.requestFailedPrefix}${response.status}`
        }
      };
    }

    if (response.ok) {
      return lastPayload;
    }

    const shouldRetry = [429, 500, 502, 503, 504].includes(response.status);
    if (!shouldRetry || attempt === retries) {
      throw new ProviderRequestError(
        lastPayload.error?.message || `${ERRORS.requestFailedPrefix}${response.status}`,
        response.status
      );
    }

    await sleep(800 * (attempt + 1));
  }

  throw new ProviderRequestError(
    lastPayload?.error?.message || `${ERRORS.requestFailedPrefix}${lastStatus}`,
    lastStatus
  );
}

function createUserMessages(
  input: AgentRequestInput,
  catalog: ReturnType<typeof createCatalogSnippet>,
  knowledgeMatches: KnowledgeMatch[]
) {
  const responseLanguage = languageName(input.locale);
  // 视觉模型只负责读懂空间。选品和理由交给重排——
  // 让它一并选品，既要多花十几秒，输出也会被重排整个覆盖，纯属浪费。
  // 商品目录同理不再传入：它不选品，就不需要看这 40 款。
  const basePayload = {
    task:
      "Describe the room and identify the window type. Do not pick any product.",
    output_schema: {
      summary: `string in ${responseLanguage}, one or two sentences about the room`,
      recommended_render_instruction: `string in ${responseLanguage}, how curtains should hang in this window`,
      inferred_window_type: "canonical Chinese window-type label",
      window_type_reason: `string in ${responseLanguage}, one sentence`
    },
    user_need: {
      room_type: input.roomType,
      extra_instruction: input.extraInstruction,
      has_scene_image: Boolean(input.sceneImageDataUrl)
    },
    domain_knowledge: createKnowledgeSnippet(knowledgeMatches)
  };

  if (input.sceneImageDataUrl) {
    return [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ...basePayload,
                task:
                  `First infer the main window type from the room scene image. Use exactly one canonical label from: ${WINDOW_TYPE_GUIDE}. If you think the image shows \u51f8\u7a97, output \u98d8\u7a97. If you think it shows \u63a8\u62c9\u95e8, output \u6ed1\u95e8/\u79fb\u95e8. If you think it shows \u6cd5\u5f0f\u95e8, output \u6cd5\u5f0f\u95e8\u7a97. Then recommend up to 3 curtain SKUs from the catalog. You must prioritize SKUs whose window_types fit the inferred window type, and explain why. Return natural-language fields in ${responseLanguage}, while keeping inferred_window_type as the canonical Chinese label.`
              },
              null,
              2
            )
          },
          {
            type: "image_url",
            image_url: {
              url: input.sceneImageDataUrl
            }
          }
        ]
      }
    ];
  }

  return [
    {
      role: "user",
      content: JSON.stringify(
        {
          ...basePayload,
          task:
            `Describe the room and identify the window type. Do not pick or mention any product. If there is no scene image, infer the window type from the user's textual description only when reasonable; otherwise keep it concise but still return the window-type fields. Use one canonical label from: ${WINDOW_TYPE_GUIDE}. Return natural-language fields in ${responseLanguage}, while keeping inferred_window_type as the canonical Chinese label.`
        },
        null,
        2
      )
    }
  ];
}

async function executeRecommendationWithModel(params: {
  modelId: string;
  input: AgentRequestInput;
  skus: SkuCatalogItem[];
  knowledgeMatches: KnowledgeMatch[];
}) {
  const option = getAgentModelById(params.modelId);
  if (!option) {
    throw new Error(ERRORS.missingModel);
  }

  const config = getProviderConfig(params.modelId);
  if (!config.apiKey) {
    throw new Error(ERRORS.missingApiKey);
  }

  const catalog = createCatalogSnippet(params.skus);
  const retries = params.input.sceneImageDataUrl ? 0 : 1;
  const payload = await postWithRetry(config.url, config.apiKey, {
    model: option.model,
    temperature: config.temperature,
    max_tokens: config.maxTokens,
    messages: [
      {
        role: "system",
        content:
          `You are a curtain recommendation assistant. Use the provided domain knowledge when it is relevant, but do not invent knowledge that was not supplied. If a scene image exists, first infer the window type, then prioritize catalog items whose window_types match it. Always return strict JSON only. Do not output markdown. Do not output explanation prefixes. Do not output <think> tags. Natural-language fields must be in ${languageName(params.input.locale)}; inferred_window_type must remain a canonical Chinese label.`
      },
      ...createUserMessages(params.input, catalog, params.knowledgeMatches)
    ]
  }, retries);

  const content = getContentFromPayload(payload);
  let parsed: AgentRecommendation;

  try {
    parsed = normalizeRecommendationShape(extractJson(content), params.skus);
  } catch {
    const finishReason = getFinishReason(payload);
    console.warn("[agent] invalid json from provider", {
      provider: option.provider,
      model: option.model,
      finishReason,
      preview: stripThinkingContent(content).slice(0, 800)
    });

    parsed = normalizeRecommendationShape(
      await repairRecommendationJson({
        rawContent: content,
        originalModelLabel: option.label,
        skus: params.skus,
        locale: params.input.locale
      }),
      params.skus
    );
  }

  parsed = resolveWindowType(parsed, params.input.windowTypeOverride);

  if (
    !isRecommendationUsable(
      parsed,
      Boolean(params.input.sceneImageDataUrl),
      !params.input.sceneOnly
    )
  ) {
    throw new Error(ERRORS.repairFailed);
  }

  return {
    option,
    parsed
  };
}

/**
 * 从房间照片读出色彩指标与可展示的读数。
 *
 * 取色失败一律返回 null——推荐可以少一层配色，但不能因为一张照片读不动就整个失败。
 */
async function analyzeRoom(sceneImageDataUrl?: string) {
  if (!sceneImageDataUrl) return null;
  try {
    const base64 = sceneImageDataUrl.split(",")[1] || "";
    const room = await analyzeRoomColor(Buffer.from(base64, "base64"));
    const trust = assessRoomTrust(room);
    const reading: RoomColorReading = {
      tone: room.roomB >= 3 ? "warm" : room.roomB <= -3 ? "cool" : "neutral",
      toneLabel: room.roomB >= 3 ? "暖调" : room.roomB <= -3 ? "冷调" : "中性调",
      wallBrightness:
        room.wallL >= 78 ? "墙面明亮" : room.wallL >= 55 ? "墙面中等明度" : "墙面偏暗",
      floorBrightness: room.floorL < 38 ? "地面偏深" : "地面较浅",
      trusted: trust.trusted,
      issues: trust.issues
    };
    return { room, trust, reading };
  } catch {
    return null;
  }
}

/** 第一屏只要色彩读数，不选品 */
async function readRoomColor(sceneImageDataUrl?: string) {
  return (await analyzeRoom(sceneImageDataUrl))?.reading ?? null;
}

type CandidateSelection = {
  candidates: SkuCatalogItem[];
  harmony: HarmonyTarget | null;
  roomColor: RoomColorReading | null;
  /**
   * 候选是否全部通过了和谐硬筛。
   * 池子太小、只做了排序没做过滤时为 false——此时理由里不许声称"已筛过配色"。
   */
  harmonyStrict: boolean;
};

/**
 * 从全量商品里挑出送给模型的候选。
 *
 * 不能把整个商品库塞进提示词——985 款直接超出模型 26 万 token 上限，请求被拒。
 * 更何况让模型在近千款里挑选，它既看不过来也无从比较。
 *
 * 只要有房间照片就一定会取色。哪怕问卷已经把池子筛得很小，
 * 排序也要按与这个房间的贴合度来——客户拍那张照片不是为了看它被跳过。
 */
async function selectCandidatesForModel(
  skus: SkuCatalogItem[],
  sceneImageDataUrl?: string
): Promise<CandidateSelection> {
  const byCatalogOrder = (roomColor: RoomColorReading | null = null): CandidateSelection => ({
    candidates: skus.slice(0, MODEL_CANDIDATE_LIMIT),
    harmony: null,
    roomColor,
    harmonyStrict: false
  });

  const analyzed = await analyzeRoom(sceneImageDataUrl);
  if (!analyzed) return byCatalogOrder();
  const { room, trust, reading } = analyzed;

  // 取色不可信时改用降级色域（只拦极端色），而不是退回目录字母序。
  // 字母序和这个房间毫无关系，比"筛得不够准"更差。
  const target = trust.trusted ? harmonyTarget(room) : fallbackTarget();
  const scorable = skus.map((item) => ({
    factorySku: item.sku_id,
    colorLabL: item.color_lab_l ?? null,
    colorLabB: item.color_lab_b ?? null,
    colorChroma: item.color_chroma ?? null,
    // 分桶用视觉判定的花纹档，不用供应商的织造分类：
    // 后者只有两档且 754/231 严重倾斜，与观感仅约五成吻合，
    // 拿它分桶等于按一个错的维度去凑多样性。
    textureType: item.pattern_level || item.texture_type || "",
    item
  }));

  // 协调只做减法，且绝不导致推荐失败：合格款不足下限就不过滤，
  // 但仍按贴合度排序并分层——排序过的池子总比字母序有意义。
  const harmonious = filterByHarmony(scorable, target);
  const strict = harmonious.length >= MIN_HARMONY_POOL;
  const picked = diversifyByHarmony(
    strict ? harmonious : scorable,
    target,
    MODEL_CANDIDATE_LIMIT
  );

  return {
    candidates: picked.map((row) => row.item),
    harmony: trust.trusted ? target : null,
    roomColor: reading,
    harmonyStrict: trust.trusted && strict
  };
}

/**
 * 用重排模型在候选里定最终顺序并写理由。
 *
 * 失败时原样退回视觉模型的结果——重排是增强，不是必需。
 */
async function rerankRecommendation(params: {
  candidates: SkuCatalogItem[];
  parsed: AgentRecommendation;
  input: AgentRequestInput;
  harmony: HarmonyTarget | null;
  harmonyStrict: boolean;
}): Promise<AgentRecommendation> {
  const { candidates, parsed, input, harmony, harmonyStrict } = params;
  if (candidates.length === 0) return parsed;

  // 客户答过的题最优先。剩下几项是表单占位符，写进提示词只会让模型
  // 拿"兼顾采光与隐私"当成客户的诉求反复引用。
  const preferences: Record<string, string> = input.survey ? describeSurvey(input.survey) : {};
  const addIfMeaningful = (key: string, value: string) => {
    const trimmed = value.trim();
    if (!trimmed || PREFERENCE_PLACEHOLDERS.has(trimmed) || preferences[key]) return;
    preferences[key] = trimmed;
  };
  addIfMeaningful("房间", input.roomType);
  addIfMeaningful("风格", input.style);
  addIfMeaningful("颜色方向", input.desiredColor);
  addIfMeaningful("采光与隐私", input.opacityNeed);
  addIfMeaningful("补充要求", input.extraInstruction);

  const outcome = await rerankCandidates({
    candidates: candidates.map((item) => ({
      factorySku: item.sku_id,
      colorFamily: item.color_family || item.color || "",
      colorRgb: item.color_rgb || "",
      colorLabL: item.color_lab_l ?? 0,
      colorLabB: item.color_lab_b ?? 0,
      colorChroma: item.color_chroma ?? 0,
      // 给模型看视觉判定的观感，不给供应商的织造分类。
      // 否则客户选了「素净」、界面也显示「素净」，模型却在理由里谈"大肌理"。
      textureType: PATTERN_LABELS[item.pattern_level || ""] || item.texture_type || "",
      // 客户选「素净」时，理由里要能拿出数说话——这是那句话的证据
      patternContrast: item.pattern_contrast ?? 0,
      weightGsm: item.weight_gsm ?? 0,
      composition: "",
      penalty: 0
    })),
    sceneSummary: parsed.summary || "",
    windowType: parsed.inferred_window_type || "",
    harmonyReasons: harmony?.reasons ?? {},
    preferences,
    colorTrusted: Boolean(harmony),
    harmonyStrict,
    // 推荐理由要跟着界面语言走。少了这一项，四段理由永远是中文
    locale: input.locale
  });

  if (outcome.source === "rules") {
    // 降级不是异常，但要留下原因：不记的话，线上退化成规则序会毫无声息
    console.warn(`[rerank] 已降级为规则序：${outcome.degradeReason || "未知原因"}`);
  }

  // 降级时同样要用 outcome 里备好的那几款和模板理由。
  // 原先只改了 ranking_source 就原样返回，客户拿到的是上游兜底的编号且理由全空。
  return {
    ...parsed,
    recommended_sku_ids: outcome.picks.map((pick) => pick.factorySku),
    ranking_source: outcome.source,
    sku_reasons: outcome.picks.map((pick) => ({
      sku_id: pick.factorySku,
      space: pick.space,
      why: pick.why,
      evidence: pick.evidence,
      matched: pick.matched,
      caveat: pick.caveat
    }))
  };
}

export async function runAgentRecommendation(input: AgentRequestInput) {
  const requestedOption = getAgentModelById(input.modelId);
  if (!requestedOption) {
    throw new Error(ERRORS.missingModel);
  }

  // 第一屏只要窗型和空间描述，不必读商品库、不必筛候选、不必重排。
  // 那时问卷还没答，选出来的商品必然在第三屏被整个覆盖。
  const selection = input.sceneOnly
    ? {
        candidates: [] as SkuCatalogItem[],
        harmony: null,
        roomColor: await readRoomColor(input.sceneImageDataUrl),
        harmonyStrict: false
      }
    : await (async () => {
        // 走缓存那一份。问卷、面料库、商品库、partner API 早就都走了，唯独推荐这条
        // 最贵也最常点的路径漏在外面，每次点「让 AI 推荐」都要重新全量拉一遍商品。
        // 商品库从 25 款演示数据换成 985 款真实商品之后，这一下冷查询实测 20.7 秒：
        // 连接被它占着不放，别人就撞 EMAXCONNSESSION；自己则把函数预算烧掉大半，
        // 剩下的不够模型跑完，前端看到的就是那句"请求超时"。
        const catalog = await getCachedSkuCatalog(4000);
        // 先按客户答的题收窄，再按房间配色挑。
        // 顺序不能反：配色是系统的判断，客户明说的要求优先级更高。
        const surveyed = input.survey ? filterBySurvey(catalog, input.survey) : catalog;
        // 收窄过头就退回全量：宁可少一层偏好过滤，也不能让客户得到空结果
        const pool = surveyed.length >= 5 ? surveyed : catalog;
        return selectCandidatesForModel(pool, input.sceneImageDataUrl);
      })();
  const { candidates: skus, harmony, roomColor, harmonyStrict } = selection;
  const knowledgeMatches = (await searchKnowledgeDocs({
    roomType: input.roomType,
    style: input.style,
    desiredColor: input.desiredColor,
    opacityNeed: input.opacityNeed,
    extraInstruction: input.extraInstruction,
    limit: 4
  })) as KnowledgeMatch[];
  const candidateModelIds = buildCandidateModelIds(input);
  let lastError: Error | null = null;
  const attemptedModels: string[] = [];

  for (const candidateModelId of candidateModelIds) {
    try {
      const candidateOption = getAgentModelById(candidateModelId);
      if (candidateOption) {
        attemptedModels.push(candidateOption.model);
      }

      const result = await executeRecommendationWithModel({
        modelId: candidateModelId,
        input,
        skus,
        knowledgeMatches
      });
      // 视觉模型负责读懂空间，选品与理由交给重排。
      // 它自己挑出的三款常常彼此雷同——候选池是多样的，但提示词没要求区分度。
      const reranked = await rerankRecommendation({
        candidates: skus,
        parsed: result.parsed,
        input,
        harmony,
        harmonyStrict
      });

      // 按模型给出的顺序取，不能用 filter——filter 走的是商品目录顺序，
      // 会把模型排好的优先级打乱，界面上标"首选"的其实只是目录里靠前的那条。
      const byId = new Map(skus.map((item) => [item.sku_id, item]));
      const recommendedSkus = reranked.recommended_sku_ids
        .map((id) => byId.get(id))
        .filter((item): item is SkuCatalogItem => Boolean(item));

      return {
        provider: result.option.provider,
        model: result.option.model,
        route: {
          requestedModelId: requestedOption.id,
          requestedModel: requestedOption.model,
          usedModelId: result.option.id,
          usedModel: result.option.model,
          usedProvider: result.option.provider,
          attemptModels: attemptedModels
        },
        recommendation: reranked,
        roomColor,
        // 界面要据此说话：配色到底有没有参与这次排序，不能一律写"已按房间配色"
        harmonyStrict,
        skus: recommendedSkus,
        knowledgeMatches
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(ERRORS.repairFailed);
      const candidateOption = getAgentModelById(candidateModelId);

      console.warn("[agent] recommendation attempt failed", {
        requestedModel: requestedOption.model,
        candidateModel: candidateOption?.model || candidateModelId,
        message: lastError.message
      });
    }
  }

  throw lastError || new Error(ERRORS.repairFailed);
}
