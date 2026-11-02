import { NextResponse } from "next/server";
import { ensureSchema, upsertFabric, deleteFabric } from "@/lib/db";
import { requireOrganizationAdminMfa } from "@/lib/auth";
import { revalidateFabricCatalog } from "@/lib/catalog-cache";
import { ADMIN_PAGE_SIZES, getAdminFabricsPage, readAdminPagination } from "@/lib/admin-data";
import { apiError } from "@/lib/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { limit, offset } = readAdminPagination(request, ADMIN_PAGE_SIZES.fabrics);
    const page = await getAdminFabricsPage(limit, offset);
    return NextResponse.json({
      fabrics: page.items,
      hasMore: page.hasMore,
      nextOffset: page.nextOffset,
    });
  } catch (err) {
    return apiError(err, "读取面料失败。");
  }
}

export async function POST(request: Request) {
  try {
    await requireOrganizationAdminMfa();
    await ensureSchema();
    const body = await request.json();
    const fabric = await upsertFabric(body);
    revalidateFabricCatalog();
    return NextResponse.json({ fabric });
  } catch (err) {
    return apiError(err, "保存面料失败。");
  }
}

export async function DELETE(request: Request) {
  try {
    await requireOrganizationAdminMfa();
    await ensureSchema();
    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    await deleteFabric(id);
    revalidateFabricCatalog();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err, "删除面料失败。");
  }
}
