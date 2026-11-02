import MfaManager from "@/components/royalzen/mfa-manager";
import { getCurrentActor } from "@/lib/auth";
import { hasOrganizationAdminAccess } from "@/lib/organization-role";

export const dynamic = "force-dynamic";

export default async function SecuritySettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const actor = await getCurrentActor();
  const requestedNext = (await searchParams).next || "/admin";
  const nextPath = requestedNext.startsWith("/") && !requestedNext.startsWith("//") ? requestedNext : "/admin";

  return <div className="rz-page rz-security-page">
    <header className="rz-page-heading"><div><span className="rz-eyebrow">SECURITY</span><h1>账号安全</h1><p>为管理权限增加独立于 Google 登录的第二重保护。</p></div></header>
    <MfaManager isDemo={actor.isDemo} nextPath={nextPath} required={hasOrganizationAdminAccess(actor.role)} />
  </div>;
}
