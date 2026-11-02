import Link from "next/link";
import SettingsForm from "@/components/royalzen/settings-form";
import { getCurrentActor } from "@/lib/auth";
import { hasOrganizationAdminAccess, organizationRoleLabel } from "@/lib/organization-role";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const actor = await getCurrentActor();
  const accessDescription = `你是 ${actor.organizationName} 的${organizationRoleLabel(actor.role)}。`;
  return <div className="rz-page"><header className="rz-page-heading"><div><span className="rz-eyebrow">ACCOUNT</span><h1>账号设置</h1><p>管理个人资料、语言和当前机构权限。</p></div></header><div className="rz-settings-grid"><SettingsForm displayName={actor.displayName} email={actor.email} /><section><h2>当前权限</h2><p>{accessDescription}</p><Link className="rz-text-link" href="/app/settings/security">账号安全与双重验证 →</Link>{hasOrganizationAdminAccess(actor.role) ? <Link className="rz-text-link" href="/admin">进入机构管理后台 →</Link> : null}<form action="/auth/signout" method="post"><button className="rz-button rz-button-secondary" type="submit">退出登录</button></form></section></div></div>;
}
