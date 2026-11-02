import TeamManager from "@/components/royalzen/team-manager";
import { requireOrganizationAdminMfa } from "@/lib/auth";
import { listTeam } from "@/lib/platform-db";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const actor = await requireOrganizationAdminMfa();
  return <div className="rz-admin-page"><TeamManager currentUserId={actor.userId} currentUserRole={actor.role} initialItems={await listTeam(actor)} /></div>;
}
