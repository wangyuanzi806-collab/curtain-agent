import HistoryManager from "@/components/royalzen/history-manager";
import { getAdminHistoryPage } from "@/lib/admin-data";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const initialPage = await getAdminHistoryPage();
  return <HistoryManager initialPage={initialPage} />;
}
