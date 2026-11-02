export class RequestSecurityError extends Error {
  status: number;
  retryAfterSeconds: number | null;

  constructor(message: string, status = 403, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = "RequestSecurityError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function assertTrustedMutationRequest(request: Request) {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return;

  const expectedOrigin = new URL(request.url).origin;
  const requestOrigin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");

  if ((requestOrigin && requestOrigin !== expectedOrigin) || fetchSite === "cross-site") {
    throw new RequestSecurityError("请求来源不受信任，请刷新页面后重试。", 403);
  }
}

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const rateLimitGlobal = globalThis as typeof globalThis & {
  __royalzenRateLimits?: Map<string, RateLimitEntry>;
};

function getRateLimitState() {
  if (!rateLimitGlobal.__royalzenRateLimits) {
    rateLimitGlobal.__royalzenRateLimits = new Map();
  }
  return rateLimitGlobal.__royalzenRateLimits;
}

export function resetRateLimitState() {
  getRateLimitState().clear();
}

export function consumeRateLimit(
  key: string,
  options: { limit: number; windowMs: number; now?: number }
) {
  const now = options.now ?? Date.now();
  const state = getRateLimitState();
  const current = state.get(key);
  const entry = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + options.windowMs }
    : current;

  if (entry.count >= options.limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    throw new RequestSecurityError("请求过于频繁，请稍后再试。", 429, retryAfterSeconds);
  }

  entry.count += 1;
  state.set(key, entry);
  return {
    remaining: Math.max(0, options.limit - entry.count),
    resetAt: entry.resetAt
  };
}
