import AdminShell from "@/components/royalzen/admin-shell";
import { redirect } from "next/navigation";
import { hasRequiredAdminMfa } from "@/lib/auth-policy";
import { isPlatformAdministrator, requireOrganizationAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireOrganizationAdmin();
  if (!hasRequiredAdminMfa(actor)) redirect("/app/settings/security?next=/admin");
  return <AdminShell actor={actor} showPlatformAdmin={isPlatformAdministrator(actor)}>{children}</AdminShell>;
}
