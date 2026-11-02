import "server-only";

import { revalidateTag, unstable_cache } from "next/cache";
import { listFabrics } from "@/lib/db";
import { listKnowledgeDocs } from "@/lib/knowledge-base";
import { getSkuCatalog } from "@/lib/sku-catalog";

const FABRIC_CATALOG_TAG = "fabric-catalog";
const KNOWLEDGE_CATALOG_TAG = "knowledge-catalog";
const SKU_CATALOG_TAG = "sku-catalog";
/**
 * 商品与知识库都不常变，且导入和后台改动会主动 revalidateTag 失效缓存，
 * 不必靠时间兜底。原先 5 分钟一过期，每 5 分钟就有一个访客要等冷查询——
 * 生产实测商品目录首开 20.7 秒，缓存命中后只要 0.2 秒。
 */
const CATALOG_REVALIDATE_SECONDS = 1800;

export const getCachedKnowledgeDocs = unstable_cache(
  async (limit: number) => listKnowledgeDocs(limit),
  ["royalzen-knowledge-catalog"],
  { revalidate: CATALOG_REVALIDATE_SECONDS, tags: [KNOWLEDGE_CATALOG_TAG] },
);

export const getCachedSkuCatalog = unstable_cache(
  async (limit: number) => getSkuCatalog(limit),
  ["royalzen-sku-catalog"],
  { revalidate: CATALOG_REVALIDATE_SECONDS, tags: [SKU_CATALOG_TAG] },
);

export const getCachedFabricCatalog = unstable_cache(
  async () => listFabrics(),
  ["royalzen-fabric-catalog"],
  { revalidate: CATALOG_REVALIDATE_SECONDS, tags: [FABRIC_CATALOG_TAG] },
);

export function revalidateFabricCatalog() {
  revalidateTag(FABRIC_CATALOG_TAG);
}

export function revalidateKnowledgeCatalog() {
  revalidateTag(KNOWLEDGE_CATALOG_TAG);
}

export function revalidateSkuCatalog() {
  revalidateTag(SKU_CATALOG_TAG);
}
