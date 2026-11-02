import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const datasetDir = path.join(rootDir, "testsets", "curtain_eval_seedream_window_balanced_v1");
const manifestPath = path.join(datasetDir, "scene_window_eval.json");
const catalogPath = path.join(datasetDir, "mock_sku_catalog.json");
const reportJsonPath = path.join(datasetDir, "window_match_report.json");
const reportMdPath = path.join(datasetDir, "window_match_report.md");

const WINDOW_TYPE_ALIASES = {
  "凸窗": "飘窗",
  "bay window": "飘窗",
  "推拉门": "滑门/移门",
  "滑动门": "滑门/移门",
  "移门": "滑门/移门",
  "sliding door": "滑门/移门",
  "法式门": "法式门窗",
  "french door": "法式门窗",
  "french doors": "法式门窗",
  "弧形窗": "拱形窗",
  "arched window": "拱形窗",
  "全景窗": "大宽窗",
  "景观窗": "大宽窗",
  "落地玻璃窗": "落地窗"
};

function parseEnv(text) {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      })
  );
}

function normalizeWindowType(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  const alias = WINDOW_TYPE_ALIASES[trimmed] || WINDOW_TYPE_ALIASES[trimmed.toLowerCase()];
  return alias || trimmed;
}

function splitWindowTypes(value) {
  return String(value || "")
    .split(/[，,、;；]+/)
    .map((item) => normalizeWindowType(item))
    .filter(Boolean)
    .filter((item, index, array) => array.indexOf(item) === index);
}

function parseJsonFromText(text) {
  const cleaned = String(text || "")
    .replace(/```json/gi, "```")
    .replace(/```/g, "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
  }

  throw new Error("模型返回的内容不是有效 JSON。");
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function postWithRetry(url, apiKey, body, retries = 2) {
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });

    const payload = await response.json();
    if (response.ok) {
      return payload;
    }

    const message = payload?.error?.message || `HTTP ${response.status}`;
    lastError = new Error(message);

    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === retries) {
      throw lastError;
    }

    await sleep(900 * (attempt + 1));
  }

  throw lastError || new Error("请求失败。");
}

function buildCatalogSnippet(catalog) {
  return catalog.map((item) => ({
    sku_id: item.sku_id,
    name: item.name,
    product_type: item.product_type,
    opacity: item.opacity,
    color: item.color,
    window_types: item.window_types,
    usage_note: item.usage_note
  }));
}

function skuMatchesExpected(item, acceptableWindowTypes) {
  const itemWindowTypes = splitWindowTypes(item.window_types);
  return acceptableWindowTypes.some((expected) => itemWindowTypes.includes(expected));
}

function skuMatchesTargetWindowType(item, targetWindowType) {
  const itemWindowTypes = splitWindowTypes(item.window_types);
  return itemWindowTypes.includes(normalizeWindowType(targetWindowType));
}

function rankFallbackCandidates(catalog, acceptableWindowTypes) {
  return catalog
    .filter((item) => skuMatchesExpected(item, acceptableWindowTypes))
    .slice(0, 5)
    .map((item) => item.sku_id);
}

function toMarkdown(report) {
  const lines = [
    "# Window Matching Report",
    "",
    `- 场景数：${report.summary.total_scenes}`,
    `- 窗型识别命中：${report.summary.window_type_correct}/${report.summary.total_scenes}`,
    `- 至少命中 1 个匹配 SKU：${report.summary.has_relevant_recommendation}/${report.summary.total_scenes}`,
    `- 推荐的全部 SKU 都匹配窗型：${report.summary.all_recommendations_relevant}/${report.summary.total_scenes}`,
    "",
    "## 逐场景结果",
    ""
  ];

  for (const item of report.results) {
    lines.push(`### ${item.scene_id}`);
    lines.push(`- 预期窗型：${item.expected_window_type}`);
    lines.push(`- 可接受窗型：${item.acceptable_window_types.join("、")}`);
    lines.push(`- 识别窗型：${item.inferred_window_type || "-"}`);
    lines.push(`- 窗型是否命中：${item.window_type_correct ? "是" : "否"}`);
    lines.push(`- 推荐 SKU：${item.recommended_sku_ids.join(", ") || "-"}`);
    lines.push(`- 匹配的推荐 SKU：${item.relevant_recommended_sku_ids.join(", ") || "-"}`);
    lines.push(`- 兜底可选 SKU：${item.fallback_candidate_sku_ids.join(", ") || "-"}`);
    lines.push(`- 说明：${item.reasoning || item.error || "-"}`);
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

async function main() {
  const envText = await readFile(path.join(rootDir, ".env.local"), "utf8");
  const env = parseEnv(envText);
  if (!env.QWEN_API_KEY) {
    throw new Error("缺少 QWEN_API_KEY，无法运行窗型匹配评测。");
  }

  const [manifest, catalog] = await Promise.all([
    readFile(manifestPath, "utf8").then((text) => JSON.parse(text)),
    readFile(catalogPath, "utf8").then((text) => JSON.parse(text))
  ]);

  const enabledScenes = manifest.filter((item) => item.eval_enabled);
  const catalogSnippet = buildCatalogSnippet(catalog);
  const results = [];

  for (const scene of enabledScenes) {
    const scenePath = path.join(datasetDir, scene.local_path);
    const imageBuffer = await readFile(scenePath);
    const dataUrl = `data:image/jpeg;base64,${imageBuffer.toString("base64")}`;
    const acceptableWindowTypes = scene.acceptable_window_types.map((item) =>
      normalizeWindowType(item)
    );

    try {
      const payload = await postWithRetry(
        "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
        env.QWEN_API_KEY,
        {
          model: "qwen3-vl-flash",
          temperature: 0.1,
          max_tokens: 700,
          messages: [
            {
              role: "system",
              content:
                "你是窗型识别和窗帘匹配助手。请先识别场景主窗型，再从候选商品中选出最合适的 SKU。必须返回 JSON，不要输出 markdown。"
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      task:
                        "识别图片的主窗型，并推荐最多 3 个最适配的窗帘 SKU。每一个推荐 SKU 的 window_types 都必须包含你识别出的主窗型。优先考虑窗型结构适配，不要为了颜色和风格牺牲窗型适配。",
                      canonical_window_types: [
                        "标准窗",
                        "落地窗",
                        "大宽窗",
                        "阳台门",
                        "滑门/移门",
                        "法式门窗",
                        "飘窗",
                        "小窗",
                        "拱形窗"
                      ],
                      normalization_rules: {
                        凸窗: "飘窗",
                        推拉门: "滑门/移门",
                        法式门: "法式门窗",
                        弧形窗: "拱形窗",
                        全景窗: "大宽窗"
                      },
                      room_type_hint: scene.room_type,
                      expected_for_eval: scene.expected_window_type,
                      allowed_skus: catalogSnippet,
                      output_schema: {
                        inferred_window_type: "string",
                        reasoning: "string",
                        recommended_sku_ids: ["string"]
                      }
                    },
                    null,
                    2
                  )
                },
                {
                  type: "image_url",
                  image_url: {
                    url: dataUrl
                  }
                }
              ]
            }
          ]
        }
      );

      const content = payload.choices?.[0]?.message?.content || "";
      const parsed = parseJsonFromText(content);
      const inferredWindowType = normalizeWindowType(parsed.inferred_window_type);
      const rawRecommendedSkuIds = Array.isArray(parsed.recommended_sku_ids)
        ? parsed.recommended_sku_ids
            .map((item) => String(item || "").trim())
            .filter((item, index, array) => item && array.indexOf(item) === index)
            .slice(0, 3)
        : [];
      const matchingRawSkuIds = rawRecommendedSkuIds.filter((skuId) => {
        const item = catalog.find((candidate) => candidate.sku_id === skuId);
        return item ? skuMatchesTargetWindowType(item, inferredWindowType) : false;
      });
      const fallbackByInferredType = catalog
        .filter((item) => skuMatchesTargetWindowType(item, inferredWindowType))
        .map((item) => item.sku_id)
        .filter((skuId) => !matchingRawSkuIds.includes(skuId));
      const recommendedSkuIds = [...matchingRawSkuIds, ...fallbackByInferredType].slice(0, 3);
      const relevantRecommendedSkuIds = recommendedSkuIds.filter((skuId) => {
        const item = catalog.find((candidate) => candidate.sku_id === skuId);
        return item ? skuMatchesExpected(item, acceptableWindowTypes) : false;
      });

      results.push({
        scene_id: scene.scene_id,
        local_path: scene.local_path,
        expected_window_type: scene.expected_window_type,
        acceptable_window_types: acceptableWindowTypes,
        inferred_window_type: inferredWindowType,
        reasoning: parsed.reasoning || "",
        raw_recommended_sku_ids: rawRecommendedSkuIds,
        recommended_sku_ids: recommendedSkuIds,
        relevant_recommended_sku_ids: relevantRecommendedSkuIds,
        fallback_candidate_sku_ids: rankFallbackCandidates(catalog, acceptableWindowTypes),
        window_type_correct: acceptableWindowTypes.includes(inferredWindowType),
        has_relevant_recommendation: relevantRecommendedSkuIds.length > 0,
        all_recommendations_relevant:
          recommendedSkuIds.length > 0 && relevantRecommendedSkuIds.length === recommendedSkuIds.length
      });
    } catch (error) {
      results.push({
        scene_id: scene.scene_id,
        local_path: scene.local_path,
        expected_window_type: scene.expected_window_type,
        acceptable_window_types: acceptableWindowTypes,
        inferred_window_type: "",
        reasoning: "",
        raw_recommended_sku_ids: [],
        recommended_sku_ids: [],
        relevant_recommended_sku_ids: [],
        fallback_candidate_sku_ids: rankFallbackCandidates(catalog, acceptableWindowTypes),
        window_type_correct: false,
        has_relevant_recommendation: false,
        all_recommendations_relevant: false,
        error: error instanceof Error ? error.message : "未知错误"
      });
    }
  }

  const summary = {
    total_scenes: results.length,
    window_type_correct: results.filter((item) => item.window_type_correct).length,
    has_relevant_recommendation: results.filter((item) => item.has_relevant_recommendation).length,
    all_recommendations_relevant: results.filter((item) => item.all_recommendations_relevant).length
  };

  const report = {
    generated_at: new Date().toISOString(),
    model: "qwen3-vl-flash",
    summary,
    results
  };

  await writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(reportMdPath, toMarkdown(report), "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
