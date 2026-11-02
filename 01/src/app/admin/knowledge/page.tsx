import KnowledgeManager from "@/components/royalzen/knowledge-manager";
import { getAdminKnowledgePage } from "@/lib/admin-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const initialPage = await getAdminKnowledgePage();
  return <KnowledgeManager initialPage={initialPage} />;
}
