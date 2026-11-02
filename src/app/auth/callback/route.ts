import { NextResponse } from "next/server";
import { AuthenticationError, getCurrentActor, isPlatformAdministrator } from "@/lib/auth";
import { getRequestedAccessError, type LoginErrorCode } from "@/lib/login-access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function redirectToLogin(url: URL, error: LoginErrorCode, next: string) {
  const loginUrl = new URL("/login", url.origin);
  loginUrl.searchParams.set("error", error);
  loginUrl.searchParams.set("next", next);
  return NextResponse.redirect(loginUrl);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const requestedNext = url.searchParams.get("next") || "/app";
  const next = requestedNext.startsWith("/") && !requestedNext.startsWith("//")
    ? requestedNext
    : "/app";

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      try {
        const actor = await getCurrentActor();
        const accessError = getRequestedAccessError(
          next,
          actor.role,
          isPlatformAdministrator(actor),
        );
        if (accessError) return redirectToLogin(url, accessError, next);
        return NextResponse.redirect(new URL(next, url.origin));
      } catch (authError) {
        if (authError instanceof AuthenticationError) {
          if (authError.status === 403) {
            await supabase.auth.signOut();
            return redirectToLogin(url, "access_denied", next);
          }
          if (authError.status === 503) {
            return redirectToLogin(url, "unconfigured", next);
          }
          return redirectToLogin(url, "oauth", next);
        }
        return redirectToLogin(url, "server", next);
      }
    }
  }

  return redirectToLogin(url, "oauth", next);
}
