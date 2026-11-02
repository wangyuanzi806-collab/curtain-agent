import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { getSkuCatalogSource, searchSkuCatalog } from "@/lib/sku-catalog";
import { getCurrentActor } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await getCurrentActor();
    const url = new URL(request.url);
    const q = url.searchParams.get("q") || undefined;
    const color = url.searchParams.get("color") || undefined;
    const opacity = url.searchParams.get("opacity") || undefined;
    const productType = url.searchParams.get("product_type") || undefined;
    const windowType = url.searchParams.get("window_type") || undefined;
    const limit = Number(url.searchParams.get("limit") || "100");

    const [items, source] = await Promise.all([
      searchSkuCatalog({
        q,
        color,
        opacity,
        productType,
        windowType,
        limit
      }),
      getSkuCatalogSource()
    ]);

    return NextResponse.json({
      items,
      source,
      total: items.length
    });
  } catch (error) {
    return apiError(error, "读取商品列表失败。");
  }
}
