import SkusManager from "@/components/royalzen/skus-manager";
import { getAdminSkusPage } from "@/lib/admin-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SkusPage() {
  const initialPage = await getAdminSkusPage();
  return <SkusManager initialPage={initialPage} />;
}
