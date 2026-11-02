import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const policyModule = import("../src/lib/team-policy.ts");
const authPolicyModule = import("../src/lib/auth-policy.ts");
const displayTextModule = import("../src/lib/display-text.ts");
const mfaEnrollmentModule = import("../src/lib/mfa-enrollment.ts");
const organizationRoleModule = import("../src/lib/organization-role.ts");
const requestSecurityModule = import("../src/lib/request-security.ts");
const loginAccessModule = import("../src/lib/login-access.ts");

test("only organization owners and administrators receive admin navigation", () => {
  const shell = readFileSync("src/components/royalzen/app-shell.tsx", "utf8");

  assert.match(shell, /hasOrganizationAdminAccess\(actor\.role\)/);
});

test("advisor pages do not prefetch administrator-only destinations for advisors", () => {
  const pages = [
    ["src/app/app/page.tsx", "/admin/history"],
    ["src/app/app/history/page.tsx", "/admin/history"],
    ["src/app/app/products/page.tsx", "/admin/skus"],
    ["src/app/app/materials/page.tsx", "/admin/fabrics"],
    ["src/app/app/knowledge/page.tsx", "/admin/knowledge"],
  ];

  for (const [path, href] of pages) {
    const source = readFileSync(path, "utf8");
    /*
     * 链接本身被移除 = 没有可泄漏的入口,不必设闸。
     * 2026-08-05:主线把 materials 页的 /admin/fabrics 入口整个删了,
     * 这条测试原来无条件要求设闸,红的是测试不是防线。
     * 防护本意保留:只要这个 admin 链接出现,就必须挂在服务端角色判断之后。
     */
    if (!source.includes(`href="${href}"`)) continue;
    assert.match(source, /const actor = await getCurrentActor\(\)/, `${path} must resolve the server actor`);
    assert.match(
      source,
      new RegExp(`hasOrganizationAdminAccess\\(actor\\.role\\)[^]*?href=\"${href}\"`),
      `${path} must gate ${href} behind the server actor role`,
    );
  }
});

test("organization role hierarchy grants admin access without exposing owner invitations", async () => {
  const { hasOrganizationAdminAccess, canAssignOrganizationRole } = await organizationRoleModule;

  assert.equal(hasOrganizationAdminAccess("org_owner"), true);
  assert.equal(hasOrganizationAdminAccess("org_admin"), true);
  assert.equal(hasOrganizationAdminAccess("advisor"), false);
  assert.equal(canAssignOrganizationRole("org_owner", "org_admin"), true);
  assert.equal(canAssignOrganizationRole("org_admin", "org_admin"), false);
  assert.equal(canAssignOrganizationRole("org_owner", "org_owner"), false);
});

test("only an organization owner can appoint administrators", async () => {
  const { assertTeamInviteAllowed } = await policyModule;

  assert.doesNotThrow(() => assertTeamInviteAllowed({ actorRole: "org_owner", targetRole: "org_admin" }));
  assert.doesNotThrow(() => assertTeamInviteAllowed({ actorRole: "org_admin", targetRole: "advisor" }));
  assert.throws(
    () => assertTeamInviteAllowed({ actorRole: "org_admin", targetRole: "org_admin" }),
    /只有机构所有者可以任命管理员/
  );
  assert.throws(
    () => assertTeamInviteAllowed({ actorRole: "org_owner", targetRole: "org_owner" }),
    /不能通过邀请分配机构所有者/
  );
});

test("an organization administrator cannot alter owners or other administrators", async () => {
  const { assertTeamMutationAllowed } = await policyModule;

  assert.throws(() => assertTeamMutationAllowed({
    actorUserId: "user-admin",
    actorRole: "org_admin",
    targetUserId: "user-owner",
    targetRole: "org_owner",
    targetStatus: "active",
    targetIdentityBound: true,
    activePrivilegedCount: 2,
    nextStatus: "disabled",
  }), /只有机构所有者可以管理管理员权限/);
  assert.throws(() => assertTeamMutationAllowed({
    actorUserId: "user-admin",
    actorRole: "org_admin",
    targetUserId: "user-advisor",
    targetRole: "advisor",
    targetStatus: "active",
    targetIdentityBound: true,
    activePrivilegedCount: 2,
    nextRole: "org_admin",
  }), /只有机构所有者可以管理管理员权限/);
});

test("a member cannot demote or disable their own account", async () => {
  const { assertTeamMutationAllowed } = await policyModule;
  const base = {
    actorUserId: "user-admin",
    actorRole: "org_admin",
    targetUserId: "user-admin",
    targetRole: "org_admin",
    targetStatus: "active",
    activePrivilegedCount: 2,
    targetIdentityBound: true,
  };

  assert.throws(
    () => assertTeamMutationAllowed({ ...base, nextRole: "advisor" }),
    /不能降低自己的管理员权限/
  );
  assert.throws(
    () => assertTeamMutationAllowed({ ...base, nextStatus: "disabled" }),
    /不能停用自己的账号/
  );
});

test("the final active administrator cannot be demoted or disabled", async () => {
  const { assertTeamMutationAllowed } = await policyModule;
  const base = {
    actorUserId: "user-owner",
    actorRole: "org_owner",
    targetUserId: "user-admin",
    targetRole: "org_admin",
    targetStatus: "active",
    activePrivilegedCount: 1,
    targetIdentityBound: true,
  };

  assert.throws(
    () => assertTeamMutationAllowed({ ...base, nextRole: "advisor" }),
    /至少保留一名活跃管理员/
  );
  assert.throws(
    () => assertTeamMutationAllowed({ ...base, nextStatus: "disabled" }),
    /至少保留一名活跃管理员/
  );
});

test("unaccepted administrator invitations do not count as active administrators", () => {
  const database = readFileSync("src/lib/platform-db.ts", "utf8");

  assert.match(database, /join app_users as app_user on app_user\.id = member\.user_id/);
  assert.match(database, /app_user\.auth_user_id is not null/);
});

test("only invitations without a bound identity can be revoked", async () => {
  const { assertInviteRevocationAllowed } = await policyModule;

  assert.doesNotThrow(() => assertInviteRevocationAllowed({
    actorUserId: "user-owner",
    targetUserId: "user-invited",
    targetIdentityBound: false,
  }));
  assert.throws(() => assertInviteRevocationAllowed({
    actorUserId: "user-owner",
    targetUserId: "user-active",
    targetIdentityBound: true,
  }), /只能撤销尚未接受的邀请/);
});

test("an administrator can update another advisor", async () => {
  const { assertTeamMutationAllowed } = await policyModule;

  assert.doesNotThrow(() => assertTeamMutationAllowed({
    actorUserId: "user-owner",
    actorRole: "org_owner",
    targetUserId: "user-advisor",
    targetRole: "advisor",
    targetStatus: "active",
    activePrivilegedCount: 1,
    targetIdentityBound: true,
    nextStatus: "disabled",
  }));
});

test("administrator access requires an aal2 session", async () => {
  const { hasRequiredAdminMfa } = await authPolicyModule;

  assert.equal(hasRequiredAdminMfa({ authAssuranceLevel: "aal1", isDemo: false }), false);
  assert.equal(hasRequiredAdminMfa({ authAssuranceLevel: "aal2", isDemo: false }), true);
  assert.equal(hasRequiredAdminMfa({ authAssuranceLevel: null, isDemo: true }), true);
});

test("admin pages redirect to MFA and admin APIs enforce it server-side", () => {
  const adminLayout = readFileSync("src/app/admin/layout.tsx", "utf8");
  const apiFiles = [
    ...readdirSync("src/app/api/admin", { recursive: true }),
    "../team/route.ts",
    "../knowledge/route.ts",
    "../knowledge/import/route.ts",
  ].filter((name) => String(name).endsWith("route.ts"));

  assert.match(adminLayout, /hasRequiredAdminMfa\(actor\)/);
  assert.match(adminLayout, /redirect\("\/app\/settings\/security\?next=\/admin"\)/);

  for (const relativeName of apiFiles) {
    const path = String(relativeName).startsWith("../")
      ? `src/app/api/admin/${relativeName}`
      : `src/app/api/admin/${relativeName}`;
    const source = readFileSync(path, "utf8");
    assert.match(source, /requireOrganizationAdminMfa\(\)/, `${path} must enforce MFA`);
  }
});

test("server-rendered admin data rechecks administrator MFA beside every query", () => {
  const adminData = readFileSync("src/lib/admin-data.ts", "utf8");
  // 2026-08-05:窗帘模板页(getAdminStylesPage)已被主线整个删除(ba051c7),
  // 清单同步删——留着一个不存在的 loader,红的是测试不是防线
  const loaders = [
    "getAdminFabricsPage",
    "getAdminSkusPage",
    "getAdminKnowledgePage",
    "getAdminHistoryPage",
  ];

  assert.equal((adminData.match(/await requireOrganizationAdminMfa\(\)/g) || []).length, loaders.length);
  for (const [index, loader] of loaders.entries()) {
    const start = adminData.indexOf(`export async function ${loader}`);
    const end = index === loaders.length - 1
      ? adminData.length
      : adminData.indexOf(`export async function ${loaders[index + 1]}`);
    const source = adminData.slice(start, end);
    assert.ok(start >= 0, `${loader} must exist`);
    assert.match(source, /await requireOrganizationAdminMfa\(\)/);
    assert.match(source, /await ensureSchema\(\)/);
  }

  for (const path of ["src/app/admin/page.tsx", "src/app/admin/team/page.tsx"]) {
    const page = readFileSync(path, "utf8");
    assert.match(page, /await requireOrganizationAdminMfa\(\)/, `${path} must recheck MFA before reading data`);
  }
});

test("security settings implements the complete TOTP enrollment and challenge flow", () => {
  const component = readFileSync("src/components/royalzen/mfa-manager.tsx", "utf8");

  assert.match(component, /mfa\.enroll\(/);
  assert.match(component, /mfa\.challenge\(/);
  assert.match(component, /mfa\.verify\(/);
  assert.match(component, /getAuthenticatorAssuranceLevel\(\)/);
  assert.match(component, /refreshSession\(\)/);
});

test("TOTP enrollment removes stale unverified factors returned only in the all collection", async () => {
  const { prepareTotpEnrollment } = await mfaEnrollmentModule;
  const calls = [];
  const enrollment = { id: "new-factor", totp: { qr_code: "qr", secret: "secret" } };
  const client = {
    listFactors: async () => ({
      data: {
        all: [
          { id: "verified", factor_type: "totp", status: "verified" },
          { id: "stale", factor_type: "totp", status: "unverified" },
        ],
        totp: [{ id: "verified", factor_type: "totp", status: "verified" }],
      },
      error: null,
    }),
    unenroll: async ({ factorId }) => {
      calls.push(`unenroll:${factorId}`);
      return { data: { id: factorId }, error: null };
    },
    enroll: async () => {
      calls.push("enroll");
      return { data: enrollment, error: null };
    },
  };

  assert.deepEqual(await prepareTotpEnrollment(client), enrollment);
  assert.deepEqual(calls, ["unenroll:stale", "enroll"]);
});

test("TOTP enrollment resolves a friendly-name race once and does not loop", async () => {
  const { prepareTotpEnrollment } = await mfaEnrollmentModule;
  let listCalls = 0;
  let enrollCalls = 0;
  const client = {
    listFactors: async () => ({
      data: {
        all: listCalls++ === 0 ? [] : [{ id: "raced", factor_type: "totp", status: "unverified" }],
        totp: [],
      },
      error: null,
    }),
    unenroll: async ({ factorId }) => ({ data: { id: factorId }, error: null }),
    enroll: async () => {
      enrollCalls += 1;
      return enrollCalls === 1
        ? { data: null, error: { code: "mfa_factor_name_conflict", message: "factor exists" } }
        : { data: { id: "new-factor", totp: { qr_code: "qr", secret: "secret" } }, error: null };
    },
  };

  const result = await prepareTotpEnrollment(client);
  assert.equal(result.id, "new-factor");
  assert.equal(enrollCalls, 2);
  assert.equal(listCalls, 2);
});

test("first authenticated login binds the identity and accepts a pending invitation", () => {
  const database = readFileSync("src/lib/platform-db.ts", "utf8");

  assert.match(database, /u\.auth_user_id is null[\s\S]+lower\(u\.email\) = lower\(\$1\)/);
  assert.match(database, /organization_invites invitation[\s\S]+accepted_at is null[\s\S]+expires_at > now\(\)/);
  assert.match(database, /update app_users[\s\S]+where id = \$1 and auth_user_id is null/);
  assert.match(database, /update organization_invites[\s\S]+set accepted_at = now\(\)[\s\S]+accepted_at is null[\s\S]+expires_at > now\(\)/);
});

test("new auth users require a pending unexpired invitation", () => {
  const migrations = readdirSync("supabase/migrations")
    .filter((name) => name.endsWith(".sql"))
    .map((name) => readFileSync(`supabase/migrations/${name}`, "utf8"))
    .join("\n");

  assert.match(migrations, /organization_invites[\s\S]+accepted_at is null[\s\S]+expires_at > now\(\)/);
  assert.match(migrations, /role in \('org_owner', 'org_admin', 'advisor'\)/);
});

test("login callback distinguishes workspace, organization admin, and platform access", async () => {
  const { getRequestedAccessError } = await loginAccessModule;

  assert.equal(getRequestedAccessError("/app", "advisor", false), null);
  assert.equal(getRequestedAccessError("/admin", "advisor", false), "admin_access");
  assert.equal(getRequestedAccessError("/admin/team", "org_admin", false), null);
  assert.equal(getRequestedAccessError("/platform", "org_owner", false), "platform_access");
  assert.equal(getRequestedAccessError("/platform", "advisor", true), null);
});

test("login errors use safe user-facing messages instead of authorization internals", async () => {
  const { getLoginErrorContent } = await loginAccessModule;

  assert.equal(getLoginErrorContent("access_denied")?.title, "你的账号没有权限");
  assert.equal(getLoginErrorContent("oauth")?.title, "你的账号没有权限");
  assert.match(getLoginErrorContent("access_denied")?.description || "", /未获得工作台访问权限/);
  assert.match(getLoginErrorContent("platform_access")?.title || "", /平台管理权限/);
  assert.equal(getLoginErrorContent("unknown-internal-error"), null);
});

test("email login failures are translated into visible actionable feedback", async () => {
  const { getEmailLoginFailure } = await loginAccessModule;

  assert.deepEqual(getEmailLoginFailure(new Error("Only invited staff accounts can be created.")), {
    kind: "access_denied",
    message: "你的账号没有权限，请联系管理员确认邀请邮箱是否完全一致。",
  });
  assert.equal(getEmailLoginFailure(new Error("429: email rate limit exceeded")).kind, "rate_limited");
  assert.match(getEmailLoginFailure(new Error("For security purposes, you can only request this after 31 seconds.")).message, /一分钟/);
  assert.equal(getEmailLoginFailure(new Error("Email address not authorized")).kind, "delivery_unavailable");
  assert.equal(getEmailLoginFailure(new Error("Failed to fetch")).kind, "network");
  assert.equal(getEmailLoginFailure(new Error("unexpected auth error")).kind, "unknown");
});

test("OAuth callback validates the actor before entering protected workspaces", () => {
  const callback = readFileSync("src/app/auth/callback/route.ts", "utf8");
  const loginActions = readFileSync("src/components/royalzen/login-actions.tsx", "utf8");
  const styles = readFileSync("src/app/royalzen.css", "utf8");

  assert.match(callback, /getCurrentActor\(\)/);
  assert.match(callback, /getRequestedAccessError\(/);
  assert.match(callback, /access_denied/);
  assert.match(loginActions, /role="alertdialog"/);
  assert.match(loginActions, /prompt:\s*"select_account"/);
  assert.match(loginActions, /aria-hidden="true" className="rz-google-logo"/);
  assert.match(loginActions, /rz-google-logo/);
  assert.match(loginActions, /aria-live="polite"/);
  assert.match(loginActions, /rz-login-feedback-/);
  assert.match(styles, /\.rz-auth-button\s*\{[^}]*width:\s*100%/s);
  assert.match(styles, /\.rz-login-feedback\s*\{[^}]*font-size:\s*12px/s);
});

test("browser mutations must originate from the same application origin", async () => {
  const { assertTrustedMutationRequest } = await requestSecurityModule;

  assert.doesNotThrow(() => assertTrustedMutationRequest(new Request("https://app.example/api/team", {
    method: "POST",
    headers: { origin: "https://app.example", "sec-fetch-site": "same-origin" },
  })));
  assert.throws(() => assertTrustedMutationRequest(new Request("https://app.example/api/team", {
    method: "POST",
    headers: { origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
  })), /请求来源不受信任/);
});

test("burst limiter rejects requests after the configured allowance", async () => {
  const { consumeRateLimit, resetRateLimitState } = await requestSecurityModule;
  resetRateLimitState();

  assert.doesNotThrow(() => consumeRateLimit("recommend:user-1", { limit: 2, windowMs: 60_000, now: 1_000 }));
  assert.doesNotThrow(() => consumeRateLimit("recommend:user-1", { limit: 2, windowMs: 60_000, now: 1_001 }));
  assert.throws(
    () => consumeRateLimit("recommend:user-1", { limit: 2, windowMs: 60_000, now: 1_002 }),
    /请求过于频繁/
  );
});

test("middleware emits nonce CSP and baseline browser security headers", () => {
  const middleware = readFileSync("src/middleware.ts", "utf8");
  const layout = readFileSync("src/app/layout.tsx", "utf8");

  assert.match(middleware, /nonce-/);
  assert.match(middleware, /frame-ancestors 'none'/);
  assert.match(middleware, /X-Content-Type-Options/);
  assert.match(middleware, /Referrer-Policy/);
  assert.match(middleware, /assertTrustedMutationRequest/);
  assert.match(layout, /await headers\(\)/);
  assert.doesNotMatch(layout, /dangerouslySetInnerHTML/);
});

test("expensive AI endpoints enforce a per-user burst limit", () => {
  for (const path of [
    "src/app/api/agent/recommend/route.ts",
    "src/app/api/consultations/[id]/generate/route.ts",
    "src/app/api/consultations/[id]/recommend/route.ts",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /consumeRateLimit\(/, `${path} must enforce a burst limit`);
  }
});

test("legacy replacement placeholders do not leak into consultation UI", async () => {
  const { normalizeStoredDisplayText } = await displayTextModule;

  assert.equal(normalizeStoredDisplayText("????", "待分析"), "待分析");
  assert.equal(normalizeStoredDisplayText("  ？？？  ", "待分析"), "待分析");
  assert.equal(normalizeStoredDisplayText("�", "待分析"), "待分析");
  assert.equal(normalizeStoredDisplayText("Is this suitable?", "待分析"), "Is this suitable?");
});

test("AI APIs preserve authentication status instead of reporting server failures", () => {
  const modelRoute = readFileSync("src/app/api/agent/models/route.ts", "utf8");
  const recommendationRoute = readFileSync("src/app/api/agent/recommend/route.ts", "utf8");
  const generationRoute = readFileSync("src/app/api/consultations/[id]/generate/route.ts", "utf8");
  const recommendRoute = readFileSync("src/app/api/consultations/[id]/recommend/route.ts", "utf8");

  // 断言的是性质——认证失败要按认证状态返回，不能报成 500——而不是某一种写法。
  // apiError 内部第一步就是 apiAuthError，两者等价；旧路由手写那一段是因为它
  // 还要在返回前做别的收尾，不该被当成唯一正确形态。
  for (const [name, source] of [
    ["agent/models", modelRoute],
    ["agent/recommend", recommendationRoute],
    ["consultations/generate", generationRoute],
    ["consultations/recommend", recommendRoute]
  ]) {
    assert.ok(
      /apiAuthError\(error\)/.test(source) || /apiError\(error,/.test(source),
      `${name} 必须把认证错误按认证状态返回，而不是当成服务器故障`
    );
  }
});
