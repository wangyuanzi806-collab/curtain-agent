import { cache } from "react";
import { hasRequiredAdminMfa } from "@/lib/auth-policy";
import { hasOrganizationAdminAccess } from "@/lib/organization-role";
import { createSupabaseServerClient, isSupabaseAuthConfigured } from "@/lib/supabase/server";
import {
  ensureDemoActor,
  resolveActorFromAuth,
  type WorkspaceActor
} from "@/lib/platform-db";

export class AuthenticationError extends Error {
  status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.name = "AuthenticationError";
    this.status = status;
  }
}

export function isDevelopmentAuthBypassEnabled() {
  if (process.env.VERCEL) return false;
  if (process.env.AUTH_BYPASS_ENABLED === "1") return true;
  return process.env.NODE_ENV !== "production" && process.env.AUTH_BYPASS_ENABLED !== "0";
}

async function resolveCurrentActor(): Promise<WorkspaceActor> {
  if (isDevelopmentAuthBypassEnabled()) return ensureDemoActor();

  if (!isSupabaseAuthConfigured()) {
    throw new AuthenticationError("登录服务尚未配置。", 503);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims as {
    sub?: string;
    email?: string;
    aal?: string;
    user_metadata?: Record<string, unknown>;
  } | undefined;
  if (error || !claims?.sub || !claims.email) {
    throw new AuthenticationError("请先登录。", 401);
  }

  const metadata = claims.user_metadata || {};
  const actor = await resolveActorFromAuth({
    authUserId: claims.sub,
    email: claims.email,
    displayName:
      String(metadata.full_name || metadata.name || "").trim() || claims.email.split("@")[0],
    avatarUrl: String(metadata.avatar_url || metadata.picture || "").trim() || null,
    authAssuranceLevel: claims.aal === "aal2" ? "aal2" : claims.aal === "aal1" ? "aal1" : null
  });
  if (!actor) {
    throw new AuthenticationError("该账号尚未被机构管理员邀请。", 403);
  }
  return actor;
}

// Layouts and pages often need the same actor. React cache keeps this request-scoped,
// so one render performs a single Supabase and database lookup without sharing users.
export const getCurrentActor = cache(resolveCurrentActor);

export async function requireOrganizationAdmin() {
  const actor = await getCurrentActor();
  if (!hasOrganizationAdminAccess(actor.role)) {
    throw new AuthenticationError("当前账号没有机构管理权限。", 403);
  }
  return actor;
}

export async function requireOrganizationAdminMfa() {
  const actor = await requireOrganizationAdmin();
  if (!hasRequiredAdminMfa(actor)) {
    throw new AuthenticationError("管理员操作需要先完成双重验证。", 403);
  }
  return actor;
}

export function isPlatformAdministrator(actor: WorkspaceActor) {
  if (actor.isDemo && isDevelopmentAuthBypassEnabled()) return true;
  const allowedEmails = (process.env.PLATFORM_ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  return allowedEmails.includes(actor.email.toLowerCase());
}

export async function requirePlatformAdministrator() {
  const actor = await getCurrentActor();
  if (!isPlatformAdministrator(actor)) {
    throw new AuthenticationError("当前账号没有平台管理权限。", 403);
  }
  if (!hasRequiredAdminMfa(actor)) {
    throw new AuthenticationError("平台管理操作需要先完成双重验证。", 403);
  }
  return actor;
}

export function toAuthErrorResponse(error: unknown) {
  if (error instanceof AuthenticationError) {
    return { status: error.status, message: error.message };
  }
  return null;
}
