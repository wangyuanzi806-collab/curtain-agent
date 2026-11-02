import { NextResponse } from "next/server";
import { requireOrganizationAdminMfa } from "@/lib/auth";
import { revalidateSkuCatalog } from "@/lib/catalog-cache";
import { ADMIN_PAGE_SIZES, getAdminSkusPage, readAdminPagination } from "@/lib/admin-data";
import { setSkuStatus } from "@/lib/sku-catalog";
import { apiError } from "@/lib/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { limit, offset } = readAdminPagination(request, ADMIN_PAGE_SIZES.skus);
    const page = await getAdminSkusPage(limit, offset);
    return NextResponse.json({ skus: page.items, hasMore: page.hasMore, nextOffset: page.nextOffset });
  } catch (err) {
    return apiError(err, "读取商品失败。");
  }
}

/**
 * 唯一被允许的写操作：上下架。
 *
 * 不开放编辑颜色、花纹、质感、明度这些字段——它们由白底图 CV 与视觉模型算出，
 * 人工改了会被下一次重标覆盖，制造无人察觉的不一致。
 * 成分、克重之类的供应商填报字段要更正，走供应商数据重导。
 *
 * 此前这里是 upsertSku / deleteSku，读写的都是 curtain_skus——那张表 0 条，
 * 而推荐用的是 sku_material 的 985 条。管理后台因此既看不见真实商品，
 * 改动也不会影响前台。
 */
export async function POST(request: Request) {
  try {
    await requireOrganizationAdminMfa();
    const body = (await request.json()) as { skuId?: string; status?: string };
    const skuId = String(body.skuId || "").trim();
    const status = body.status === "inactive" ? "inactive" : "active";
    if (!skuId) {
      return NextResponse.json({ error: "缺少商品编号。" }, { status: 400 });
    }

    const updated = await setSkuStatus(skuId, status);
    if (!updated) {
      return NextResponse.json({ error: `没有找到商品 ${skuId}。` }, { status: 404 });
    }

    revalidateSkuCatalog();
    return NextResponse.json({ ok: true, skuId, status });
  } catch (err) {
    return apiError(err, "更新商品状态失败。");
  }
}
