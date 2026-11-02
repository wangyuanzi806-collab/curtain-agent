type ErrorPayload = {
  error?: string;
};

export async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const text = await response.text();
  let payload: T & ErrorPayload;

  try {
    payload = text ? JSON.parse(text) : ({} as T & ErrorPayload);
  } catch {
    throw new Error(response.ok ? "服务器返回了无法识别的数据。" : `请求失败（${response.status}）。`);
  }

  if (!response.ok) {
    throw new Error(payload.error || `请求失败（${response.status}）。`);
  }

  return payload;
}
