import FabricsManager from "@/components/royalzen/fabrics-manager";
import { getAdminFabricsPage } from "@/lib/admin-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function FabricsPage() {
  const initialPage = await getAdminFabricsPage();
  return <FabricsManager initialPage={initialPage} />;
}
