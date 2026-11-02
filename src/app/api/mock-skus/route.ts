import { NextResponse } from "next/server";
import { searchSkuCatalog } from "@/lib/sku-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get("q") || undefined;
    const color = url.searchParams.get("color") || undefined;
    const opacity = url.searchParams.get("opacity") || undefined;
    const productType = url.searchParams.get("product_type") || undefined;
    const windowType = url.searchParams.get("window_type") || undefined;
    const limit = Number(url.searchParams.get("limit") || "20");

    const items = await searchSkuCatalog({
      q,
      color,
      opacity,
      productType,
      windowType,
      limit
    });

    return NextResponse.json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "加载 SKU 列表失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
