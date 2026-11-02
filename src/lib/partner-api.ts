import "server-only";

import { getCachedSkuCatalog } from "@/lib/catalog-cache";
import { colorLabelFromLab, type SkuCatalogItem } from "@/lib/sku-catalog";
import { COLOR_RULES, COLOR_SYNONYMS } from "@/lib/color-words";

export { COLOR_RULES, COLOR_SYNONYMS };

/**
 * 按槽位检索的共用逻辑。
 *
 * 语音顾问没有房间照片，所以只有「槽位筛选 + 分层多样化」这一层——
 * 房间取色与和谐色域对它不成立。检索与排序仍然只有一份实现，
 * 主线推荐与语音顾问共用它。
 *
 * 名字里的 partner 是历史：它原本是给线下语音销售助手的跨洋 HTTP 端点。
 * 2026-08-02 那个产品整体并进来之后，调用方变成同进程的 voice-tools，
 * 端点已删——少了一次跨洋往返，而语音场景对延迟最敏感。
 */

export const PATTERN_VALUES = ["solid", "texture", "pattern"] as const;
export const MATERIAL_VALUES = [
  "cotton_linen",
  "wool",
  "viscose_soft",
  "polyester_smooth",
  "blend"
] as const;
export const FABRIC_VALUES = ["cloth", "sheer"] as const;

export type PartnerSlots = {
  colors?: string[];
  pattern?: string | null;
  materials?: string[];
  fabricType?: string | null;
  weightGsm?: [number, number] | null;
};

/** 逐层放宽的顺序：越靠前越先被放弃。颜色放最后——客户对颜色最执着 */
const RELAX_ORDER: (keyof PartnerSlots)[] = ["weightGsm", "materials", "pattern", "colors"];

const FACET_LABELS: Record<string, string> = {
  colors: "颜色",
  pattern: "花纹",
  materials: "质感",
  fabricType: "布或纱",
  weightGsm: "克重"
};

function matchesColors(item: SkuCatalogItem, words: string[]) {
  if (words.length === 0) return true;
  return words.some((word) => {
    const canonical = COLOR_SYNONYMS[word] || word;
    const rule = COLOR_RULES.find((r) => r.label === canonical);
    return rule ? rule.match(item) : false;
  });
}

function matchesSlots(item: SkuCatalogItem, slots: PartnerSlots) {
  if (!matchesColors(item, slots.colors || [])) return false;
  if (slots.pattern && item.pattern_level && item.pattern_level !== slots.pattern) return false;
  if (slots.materials?.length && !slots.materials.includes(item.material_class || "")) return false;
  if (slots.fabricType) {
    const isSheer = item.material_type === "sheer";
    if (slots.fabricType === "sheer" && !isSheer) return false;
    if (slots.fabricType === "cloth" && isSheer) return false;
  }
  if (slots.weightGsm) {
    const gsm = item.weight_gsm ?? 0;
    if (gsm < slots.weightGsm[0] || gsm > slots.weightGsm[1]) return false;
  }
  return true;
}

/** 客户说了哪几条被这一款满足了。用客户自己的说法，不用内部枚举名 */
function matchedWords(item: SkuCatalogItem, slots: PartnerSlots) {
  const hit: string[] = [];
  for (const word of slots.colors || []) {
    const canonical = COLOR_SYNONYMS[word] || word;
    const rule = COLOR_RULES.find((r) => r.label === canonical);
    if (rule?.match(item)) hit.push(word);
  }
  if (slots.pattern && item.pattern_level === slots.pattern) {
    hit.push({ solid: "素净", texture: "细肌理", pattern: "花纹" }[slots.pattern] || slots.pattern);
  }
  if (slots.materials?.includes(item.material_class || "")) {
    hit.push(
      { cotton_linen: "棉麻", wool: "羊毛", viscose_soft: "柔垂", polyester_smooth: "顺滑", blend: "混纺" }[
        item.material_class || ""
      ] || ""
    );
  }
  if (slots.fabricType === "sheer" && item.material_type === "sheer") hit.push("纱帘");
  if (slots.fabricType === "cloth" && item.material_type !== "sheer") hit.push("布帘");
  return hit.filter(Boolean);
}

/**
 * 分层多样化：色彩词 × 明度 × 花纹分桶轮取 + 同系列去重。
 *
 * 与主链路同一套思路，但不含色域收口——没有房间照片就没有目标色域。
 * `order by 桶内序号` 排在前面是多样性的来源：先把每个桶的第一名都取一遍。
 */
function diversify(items: SkuCatalogItem[], limit: number) {
  const buckets = new Map<string, SkuCatalogItem[]>();
  for (const item of items) {
    const colorWord = colorLabelFromLab(item.color_family, item.value_level, item.color_chroma) || "其他";
    const key = `${colorWord}/${item.value_level}/${item.pattern_level}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }

  const queues = [...buckets.values()];
  const picked: SkuCatalogItem[] = [];
  const seenSeries = new Set<string>();
  let progressed = true;

  while (picked.length < limit && progressed) {
    progressed = false;
    for (const queue of queues) {
      if (picked.length >= limit) break;
      while (queue.length > 0) {
        const next = queue.shift()!;
        const series = next.sku_id.split("-")[0];
        if (seenSeries.has(series)) continue;
        seenSeries.add(series);
        picked.push(next);
        progressed = true;
        break;
      }
    }
  }

  // 同系列去重导致取不满时按原顺序补齐，绝不返回空
  if (picked.length < limit) {
    const chosen = new Set(picked.map((item) => item.sku_id));
    for (const item of items) {
      if (picked.length >= limit) break;
      if (!chosen.has(item.sku_id)) picked.push(item);
    }
  }
  return picked;
}

export type PartnerSearchResult = {
  items: {
    sku: string;
    name: string;
    imageUrl: string;
    facts: Record<string, unknown>;
    matched: string[];
  }[];
  total: number;
  relaxedFacets: string[];
  /** 词表外的颜色词，调用方据此提示客户换个说法 */
  unknownColors: string[];
  advisory: string;
  tookMs: number;
};

export async function searchForPartner(
  slots: PartnerSlots,
  limit: number,
  relax: boolean
): Promise<PartnerSearchResult> {
  const started = Date.now();
  const catalog = await getCachedSkuCatalog(4000);

  // 词表外的颜色要单独说。销售需要分清「没有这个颜色」和「系统不认识这个词」——
  // 前者该换需求，后者该换个说法再问一次。
  const unknownColors = (slots.colors || []).filter((word) => {
    const canonical = COLOR_SYNONYMS[word] || word;
    return !COLOR_RULES.some((rule) => rule.label === canonical);
  });

  let active: PartnerSlots = { ...slots };
  let hits = catalog.filter((item) => matchesSlots(item, active));
  const relaxed: string[] = [];

  // 渐进放宽内置在服务端：调用方多次往返要付好几个跨洋 RTT，这里只要不到 1ms
  if (relax) {
    for (const facet of RELAX_ORDER) {
      if (hits.length >= limit) break;
      if (active[facet] === undefined || active[facet] === null) continue;
      const value = active[facet];
      if (Array.isArray(value) && value.length === 0) continue;
      active = { ...active, [facet]: Array.isArray(value) ? [] : null };
      hits = catalog.filter((item) => matchesSlots(item, active));
      relaxed.push(FACET_LABELS[facet] || String(facet));
    }
  }

  const picked = diversify(hits, limit);
  return {
    items: picked.map((item) => ({
      sku: item.sku_id,
      name: item.name,
      imageUrl: item.image_url,
      facts: {
        colorWord: colorLabelFromLab(item.color_family, item.value_level, item.color_chroma),
        colorFamily: item.color_family,
        valueLevel: item.value_level,
        patternLevel: item.pattern_level,
        materialClass: item.material_class,
        // 纤维配比原文。语音顾问要据此说出「羊毛混纺」这类，供应商填的，不复算
        composition: item.composition,
        weightGsm: item.weight_gsm,
        naturalFiberPct: item.natural_fiber_pct,
        isSheer: item.material_type === "sheer",
        colorRgb: item.color_rgb
      },
      // 用原始 slots 算命中，而不是放宽后的：客户说的是那几条
      matched: matchedWords(item, slots)
    })),
    total: hits.length,
    relaxedFacets: relaxed,
    unknownColors,
    // 直接给可以念的话，而不是要求调用方记得自己说
    advisory: unknownColors.length
      ? `「${unknownColors.join("、")}」不在可选的颜色里，下面按其余条件挑了几款；想换个颜色说法可以再问我一次。`
      : relaxed.length
        ? `完全符合的款不多，下面几款放宽了${relaxed.join("、")}，其余条件都满足。`
        : "",
    tookMs: Date.now() - started
  };
}
