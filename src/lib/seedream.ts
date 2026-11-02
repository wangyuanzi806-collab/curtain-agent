type GenerateCurtainImageInput = {
  prompt: string;
  sceneDataUrl: string;
  curtainDataUrl: string;
  referenceDataUrls: string[];
};

type SeedreamResponse = {
  data?: Array<{ url: string; size?: string }>;
  error?: { message?: string };
};

type SeedreamRequestPayload = {
  model: string;
  prompt: string;
  image: string[];
  sequential_image_generation: "disabled";
  response_format: "url";
  size: string;
  stream: false;
  watermark: false;
};

function getModelName() {
  return process.env.ARK_IMAGE_MODEL || "doubao-seedream-5-0-260128";
}

function getApiKey() {
  if (!process.env.ARK_API_KEY) {
    throw new Error("ARK_API_KEY is missing.");
  }
  return process.env.ARK_API_KEY;
}

function getOutputSize() {
  return process.env.SEEDREAM_OUTPUT_SIZE || "2K";
}

function getTimeoutMs() {
  return Number(process.env.SEEDREAM_TIMEOUT_MS || "240000");
}

function getRetryCount() {
  const retries = Number(process.env.SEEDREAM_RETRIES || "1");
  return Number.isFinite(retries) ? Math.max(0, Math.min(3, retries)) : 1;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeDataUrl(dataUrl: string, index: number) {
  const [header = "", base64 = ""] = dataUrl.split(",", 2);
  const mimeMatch = header.match(/^data:([^;]+);base64$/);

  return {
    index,
    role: index === 0 ? "scene" : index === 1 ? "curtain" : "reference",
    mimeType: mimeMatch?.[1] || "image/jpeg",
    base64Chars: base64.length,
    approxBytes: Math.round((base64.length * 3) / 4)
  };
}

function summarizeRequestPayload(payload: SeedreamRequestPayload) {
  return {
    ...payload,
    image: payload.image.map(summarizeDataUrl)
  };
}

async function readSeedreamResponse(response: Response): Promise<SeedreamResponse> {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text) as SeedreamResponse;
  } catch {
    return { error: { message: text.slice(0, 500) } };
  }
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function isRetryableMessage(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("overloaded") ||
    normalized.includes("temporarily") ||
    normalized.includes("timeout") ||
    normalized.includes("rate limit") ||
    normalized.includes("fetch failed") ||
    normalized.includes("econnreset") ||
    normalized.includes("etimedout")
  );
}

export function buildCurtainPrompt(userInstruction: string) {
  const basePrompt =
    "IMAGE ROLE: Image 1 is the immutable base room photo. Image 2 and any later images are curtain product references only. " +
    "Perform a localized product edit: install the referenced curtain on the main visible window in Image 1. " +
    "Return the exact same aspect ratio, crop, camera position and perspective as Image 1. Preserve every architectural " +
    "boundary and object outside the curtain area, including the number, size and position of window panels, window frames, " +
    "bay-window recesses, doors, walls, ceilings, floors, trims, furniture, fixtures, railings, exterior view and lighting. " +
    "Do not enlarge, replace or relocate the window. Do not remove a door or crop away part of the room. Do not copy the room " +
    "or background from the product reference. Only add the minimum physically plausible rod or track and the curtain itself " +
    "within or immediately above the existing window boundary. Match the product reference's color, material, weave, opacity, " +
    "heading and drape while respecting the exact geometry of the room photo. Keep untouched regions visually identical to " +
    "Image 1. The result must be photorealistic and suitable for an ecommerce curtain preview.";

  return userInstruction ? `${basePrompt} Extra instruction: ${userInstruction}` : basePrompt;
}

export async function generateCurtainImage(input: GenerateCurtainImageInput) {
  const requestPayload: SeedreamRequestPayload = {
    model: getModelName(),
    prompt: input.prompt,
    image: [input.sceneDataUrl, input.curtainDataUrl, ...input.referenceDataUrls],
    sequential_image_generation: "disabled",
    response_format: "url",
    size: getOutputSize(),
    stream: false,
    watermark: false
  };
  const storedRequestPayload = summarizeRequestPayload(requestPayload);
  const maxRetries = getRetryCount();
  // 只序列化一次：请求体有几百 KB，每次重试都重来是白烧 CPU
  const body = JSON.stringify(requestPayload);
  const startedAt = Date.now();

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    let response: Response;

    try {
      response = await fetch("https://ark.cn-beijing.volces.com/api/v3/images/generations", {
        method: "POST",
        signal: AbortSignal.timeout(getTimeoutMs()),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getApiKey()}`
        },
        body
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Seedream request failed.";
      const timeoutError = error instanceof Error && error.name === "TimeoutError";
      const retryable = !timeoutError && isRetryableMessage(message);

      if (attempt < maxRetries && retryable) {
        await sleep(1000 * (attempt + 1));
        continue;
      }

      if (timeoutError) {
        throw new Error("Seedream 响应超时，任务已停止，请稍后重试。");
      }

      throw error;
    }

    const rawResponse = await readSeedreamResponse(response);

    if (!response.ok) {
      const message = rawResponse.error?.message || `Seedream request failed with ${response.status}.`;
      const retryable = isRetryableStatus(response.status) || isRetryableMessage(message);

      if (attempt < maxRetries && retryable) {
        await sleep(1200 * (attempt + 1));
        continue;
      }

      throw new Error(message);
    }

    const imageUrl = rawResponse.data?.[0]?.url;
    if (!imageUrl) {
      throw new Error("Seedream returned no image URL.");
    }

    return {
      imageUrl,
      requestPayload: storedRequestPayload,
      rawResponse,
      attempts: attempt + 1,
      /** 请求体大小与模型耗时。没有这两个数，线上慢在哪只能靠猜 */
      requestBytes: Buffer.byteLength(body),
      tookMs: Date.now() - startedAt
    };
  }

  throw new Error("Seedream request failed after retries.");
}
