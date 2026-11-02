import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type MockSku = {
  sku_id: string;
  name: string;
  brand: string;
  collection: string;
  product_type: string;
  opacity: string;
  color: string;
  mounting: string;
  layer_type: string;
  price_band: string;
  style_tags: string;
  page_url: string;
  image_url: string;
  local_image: string;
  source: string;
  usage_note: string;
};

const catalogPath = join(
  process.cwd(),
  "testsets",
  "curtain_eval_seedream_window_balanced_v1",
  "mock_sku_catalog.json"
);

let cache: MockSku[] | null = null;

export async function getMockSkus() {
  if (!cache) {
    const raw = await readFile(catalogPath, "utf8");
    cache = JSON.parse(raw) as MockSku[];
  }

  return cache;
}

export async function searchMockSkus(query: {
  q?: string;
  color?: string;
  opacity?: string;
  productType?: string;
  limit?: number;
}) {
  const items = await getMockSkus();
  const normalizedQ = query.q?.trim().toLowerCase();
  const limit = Math.max(1, Math.min(50, query.limit ?? 20));

  return items
    .filter((item) => {
      if (normalizedQ) {
        const haystack = [
          item.sku_id,
          item.name,
          item.color,
          item.opacity,
          item.product_type,
          item.style_tags
        ]
          .join(" ")
          .toLowerCase();

        if (!haystack.includes(normalizedQ)) {
          return false;
        }
      }

      if (query.color && item.color !== query.color) {
        return false;
      }

      if (query.opacity && item.opacity !== query.opacity) {
        return false;
      }

      if (query.productType && item.product_type !== query.productType) {
        return false;
      }

      return true;
    })
    .slice(0, limit);
}
