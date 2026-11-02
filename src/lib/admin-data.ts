import "server-only";

import { listSkusForAdmin, type AdminSkuItem } from "@/lib/sku-catalog";
import { requireOrganizationAdminMfa } from "@/lib/auth";
import {
  ensureSchema,
  listFabrics,
  listKnowledgeDocs,
  listRecentGenerations,
  type CurtainFabric,
  type KnowledgeDoc,
} from "@/lib/db";
import type { GenerationRecord } from "@/lib/curtain-types";
import { ADMIN_PAGE_SIZES, type AdminDataPage } from "@/lib/admin-pagination";

export { ADMIN_PAGE_SIZES };

export function readAdminPagination(request: Request, fallbackLimit: number) {
  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const offsetParam = url.searchParams.get("offset");
  const requestedLimit = limitParam === null ? Number.NaN : Number(limitParam);
  const requestedOffset = offsetParam === null ? Number.NaN : Number(offsetParam);
  return {
    limit: Number.isFinite(requestedLimit)
      ? Math.min(1000, Math.max(1, Math.trunc(requestedLimit)))
      : fallbackLimit,
    offset: Number.isFinite(requestedOffset)
      ? Math.min(10_000, Math.max(0, Math.trunc(requestedOffset)))
      : 0,
  };
}

function toPage<T>(rows: T[], limit: number, offset: number): AdminDataPage<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    items,
    hasMore,
    nextOffset: offset + items.length,
  };
}

export async function getAdminFabricsPage(
  limit: number = ADMIN_PAGE_SIZES.fabrics,
  offset: number = 0,
): Promise<AdminDataPage<CurtainFabric>> {
  await requireOrganizationAdminMfa();
  await ensureSchema();
  return toPage(await listFabrics(limit + 1, offset), limit, offset);
}

export async function getAdminSkusPage(
  limit: number = ADMIN_PAGE_SIZES.skus,
  offset: number = 0,
): Promise<AdminDataPage<AdminSkuItem>> {
  await requireOrganizationAdminMfa();
  await ensureSchema();
  return toPage(await listSkusForAdmin(limit + 1, offset), limit, offset);
}

export async function getAdminKnowledgePage(
  limit: number = ADMIN_PAGE_SIZES.knowledge,
  offset: number = 0,
): Promise<AdminDataPage<KnowledgeDoc>> {
  await requireOrganizationAdminMfa();
  await ensureSchema();
  return toPage(await listKnowledgeDocs(limit + 1, offset), limit, offset);
}

export async function getAdminHistoryPage(
  limit: number = ADMIN_PAGE_SIZES.history,
  offset: number = 0,
): Promise<AdminDataPage<GenerationRecord>> {
  await requireOrganizationAdminMfa();
  await ensureSchema();
  return toPage(await listRecentGenerations(limit + 1, offset), limit, offset);
}
