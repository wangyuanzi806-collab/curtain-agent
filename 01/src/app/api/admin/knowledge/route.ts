import { NextResponse } from "next/server";
import { ensureSchema, upsertKnowledgeDoc, deleteKnowledgeDoc } from "@/lib/db";
import { requireOrganizationAdminMfa } from "@/lib/auth";
import { revalidateKnowledgeCatalog } from "@/lib/catalog-cache";
import { ADMIN_PAGE_SIZES, getAdminKnowledgePage, readAdminPagination } from "@/lib/admin-data";
import { apiError } from "@/lib/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { limit, offset } = readAdminPagination(request, ADMIN_PAGE_SIZES.knowledge);
    const page = await getAdminKnowledgePage(limit, offset);
    return NextResponse.json({ docs: page.items, hasMore: page.hasMore, nextOffset: page.nextOffset });
  } catch (err) {
    return apiError(err, "读取知识库失败。");
  }
}

export async function POST(request: Request) {
  try {
    await requireOrganizationAdminMfa();
    await ensureSchema();
    const body = await request.json();
    const doc = await upsertKnowledgeDoc(body);
    revalidateKnowledgeCatalog();
    return NextResponse.json({ doc });
  } catch (err) {
    return apiError(err, "保存知识文档失败。");
  }
}

export async function DELETE(request: Request) {
  try {
    await requireOrganizationAdminMfa();
    await ensureSchema();
    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    await deleteKnowledgeDoc(id);
    revalidateKnowledgeCatalog();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err, "删除知识文档失败。");
  }
}
