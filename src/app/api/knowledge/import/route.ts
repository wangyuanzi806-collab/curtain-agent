import { NextResponse } from "next/server";
import {
  importKnowledgeDocs,
  importSampleKnowledgeDocs,
  parseKnowledgeImportText
} from "@/lib/knowledge-base";
import { requireOrganizationAdminMfa } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { revalidateKnowledgeCatalog } from "@/lib/catalog-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await requireOrganizationAdminMfa();
    const formData = await request.formData();
    const modeValue = String(formData.get("mode") || "replace");
    const mode = modeValue === "upsert" ? "upsert" : "replace";
    const source = String(formData.get("source") || "");

    if (source === "sample") {
      const result = await importSampleKnowledgeDocs(mode);
      revalidateKnowledgeCatalog();
      return NextResponse.json(result);
    }

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请上传一个知识库文件。" }, { status: 400 });
    }

    const rawText = await file.text();
    const docs = parseKnowledgeImportText(rawText, file.name);
    const result = await importKnowledgeDocs(docs, mode);
    revalidateKnowledgeCatalog();
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error, "导入知识库失败。");
  }
}
