import { NextResponse } from "next/server";
import { toAuthErrorResponse } from "@/lib/auth";

export function apiAuthError(error: unknown) {
  const authError = toAuthErrorResponse(error);
  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: authError.status });
  }
  return null;
}

export function apiError(error: unknown, fallback: string) {
  const authResponse = apiAuthError(error);
  if (authResponse) return authResponse;

  const message = error instanceof Error ? error.message : fallback;
  console.error(`[api] ${fallback}`, error);
  return NextResponse.json({ error: message }, { status: 500 });
}
