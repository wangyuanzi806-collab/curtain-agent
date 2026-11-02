type CreateTaskResponse = {
  id?: string;
  error?: { message?: string };
};

type PollTaskResponse = {
  status?: string;
  content?: {
    video_url?: string;
  };
  error?: { message?: string };
};

const API_BASE = "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks";
const MODEL = "doubao-seedance-1-5-pro-251215";
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 120_000;
const DEFAULT_PROMPT =
  "完全固定镜头，不移动不旋转不缩放，仅窗帘区域有轻微飘动，窗帘布料在微风中自然柔和地轻轻摆动，褶皱随风微微起伏，展现窗帘的垂坠质感和面料纹理，房间其余部分完全静止 --duration 5 --camerafixed true --watermark false";

function getApiKey() {
  if (!process.env.ARK_API_KEY) {
    throw new Error("ARK_API_KEY is missing.");
  }
  return process.env.ARK_API_KEY;
}

function authHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${getApiKey()}`
  };
}

export async function createVideoTask(imageUrl: string): Promise<{ taskId: string }> {
  const requestPayload = {
    model: MODEL,
    content: [
      {
        type: "text",
        text: DEFAULT_PROMPT
      },
      {
        type: "image_url",
        image_url: {
          url: imageUrl
        }
      }
    ]
  };

  let response: Response;

  try {
    response = await fetch(API_BASE, {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
      headers: authHeaders(),
      body: JSON.stringify(requestPayload)
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error("Seedance 创建任务超时，请稍后重试。");
    }
    throw error;
  }

  const raw = (await response.json()) as CreateTaskResponse;

  if (!response.ok) {
    throw new Error(raw.error?.message || `Seedance 创建任务失败，状态码 ${response.status}。`);
  }

  const taskId = raw.id;
  if (!taskId) {
    throw new Error("Seedance 未返回任务 ID。");
  }

  return { taskId };
}

export async function pollVideoTask(
  taskId: string
): Promise<{ status: string; videoUrl?: string; error?: string }> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE}/${taskId}`, {
      method: "GET",
      signal: AbortSignal.timeout(15_000),
      headers: authHeaders()
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return { status: "polling_timeout", error: "Seedance 查询任务状态超时。" };
    }
    throw error;
  }

  const raw = (await response.json()) as PollTaskResponse;

  if (!response.ok) {
    return {
      status: "error",
      error: raw.error?.message || `Seedance 查询任务失败，状态码 ${response.status}。`
    };
  }

  const status = raw.status || "unknown";

  if (status === "succeeded") {
    const videoUrl = raw.content?.video_url;
    if (!videoUrl) {
      return { status: "error", error: "Seedance 任务完成但未返回视频地址。" };
    }
    return { status, videoUrl };
  }

  if (status === "failed") {
    return { status, error: raw.error?.message || "Seedance 视频生成失败。" };
  }

  return { status };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function generateCurtainVideo(
  imageUrl: string
): Promise<{ videoUrl: string; taskId: string }> {
  const { taskId } = await createVideoTask(imageUrl);

  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    const result = await pollVideoTask(taskId);

    if (result.status === "succeeded" && result.videoUrl) {
      return { videoUrl: result.videoUrl, taskId };
    }

    if (result.status === "failed" || result.status === "error") {
      throw new Error(result.error || "Seedance 视频生成失败。");
    }
  }

  throw new Error("Seedance 视频生成超时（已等待 120 秒），请稍后查询任务状态。");
}
