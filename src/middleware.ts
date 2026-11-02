import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { assertTrustedMutationRequest, RequestSecurityError } from "@/lib/request-security";

const PROTECTED_PATHS = ["/app", "/admin", "/platform"];

/**
 * 语音顾问页。它比其余页面多要两样东西，所以单独放行而不是全站放开：
 * 浏览器与 OpenAI 直连收发音频（connect-src），以及麦克风（Permissions-Policy）。
 * 语音助手并入前，它的旧页面就是被这两条挡死的。
 */
const VOICE_PATH = "/app/voice";

function buildContentSecurityPolicy(nonce: string, allowRealtime: boolean) {
  const developmentScriptPolicy = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${developmentScriptPolicy}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data: https:",
    "font-src 'self' data:",
    allowRealtime
      ? "connect-src 'self' https://*.supabase.co https://api.openai.com"
      : "connect-src 'self' https://*.supabase.co",
    "media-src 'self' blob:",
    "frame-src https://challenges.cloudflare.com",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests"
  ].join("; ");
}

function applySecurityHeaders(
  response: NextResponse,
  contentSecurityPolicy: string,
  allowMicrophone: boolean
) {
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    allowMicrophone
      ? "camera=(self), microphone=(self), geolocation=(), payment=()"
      : "camera=(), microphone=(), geolocation=(), payment=()"
  );
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  return response;
}

export async function middleware(request: NextRequest) {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const isVoicePath =
    request.nextUrl.pathname === VOICE_PATH || request.nextUrl.pathname.startsWith(`${VOICE_PATH}/`);
  const contentSecurityPolicy = buildContentSecurityPolicy(nonce, isVoicePath);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);
  const createNextResponse = () => applySecurityHeaders(
    NextResponse.next({ request: { headers: requestHeaders } }),
    contentSecurityPolicy,
    isVoicePath
  );
  const secureResponse = (response: NextResponse) =>
    applySecurityHeaders(response, contentSecurityPolicy, isVoicePath);

  try {
    assertTrustedMutationRequest(request);
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return secureResponse(NextResponse.json({ error: error.message }, { status: error.status }));
    }
    throw error;
  }

  let response = createNextResponse();
  const isProtectedPath = PROTECTED_PATHS.some((path) =>
    request.nextUrl.pathname === path || request.nextUrl.pathname.startsWith(`${path}/`)
  );
  if (!isProtectedPath) return response;

  // Local development can use the seeded demo organization without requiring
  // a live Supabase session. Vercel must always enforce real authentication.
  if (!process.env.VERCEL && process.env.AUTH_BYPASS_ENABLED === "1") {
    return response;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    if (!process.env.VERCEL && (process.env.NODE_ENV !== "production" || process.env.AUTH_BYPASS_ENABLED === "1")) {
      return response;
    }
    return secureResponse(NextResponse.redirect(new URL("/login?error=unconfigured", request.url)));
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(items) {
        items.forEach(({ name, value }) => request.cookies.set(name, value));
        response = createNextResponse();
        items.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      }
    }
  });

  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return secureResponse(NextResponse.redirect(loginUrl));
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
