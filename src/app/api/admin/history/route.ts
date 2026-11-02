import { NextResponse } from "next/server";
import { ensureSchema, getDb } from "@/lib/db";
import { requireOrganizationAdminMfa } from "@/lib/auth";
import { ADMIN_PAGE_SIZES, getAdminHistoryPage, readAdminPagination } from "@/lib/admin-data";
import { apiError } from "@/lib/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { limit, offset } = readAdminPagination(request, ADMIN_PAGE_SIZES.history);
    const page = await getAdminHistoryPage(limit, offset);
    return NextResponse.json({ records: page.items, hasMore: page.hasMore, nextOffset: page.nextOffset });
  } catch (err) {
    return apiError(err, "读取生成历史失败。");
  }
}

export async function DELETE() {
  try {
    await requireOrganizationAdminMfa();
    await ensureSchema();
    const db = getDb();
    await db.query(`DELETE FROM curtain_generations`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err, "清空生成历史失败。");
  }
}
