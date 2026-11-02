import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureSchema, getDb } from "@/lib/db";
import { joinWindowTypes, WINDOW_TYPE_OPTIONS } from "@/lib/window-types";

export type SkuCatalogItem = {
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
  window_types: string;
  page_url: string;
  image_url: string;
  local_image: string;
  source: string;
  usage_note: string;
  /** 以下来自供应商面料库，旧的手工目录没有，故为可选 */
  weight_gsm?: number | null;
  /** 供应商填的纤维配比原文，如 "51%COTTON 17%RAYON…"。语音顾问要据此说出面料成分 */
  composition?: string | null;
  texture_type?: string | null;
  material_type?: string | null;
  /** 白底图提取的 CIELAB 数值，用于与房间配色比对 */
  color_lab_l?: number | null;
  color_lab_b?: number | null;
  color_chroma?: number | null;
  /** 花纹强弱的量化值。选示意图靠它——三档的 contrast 是 52.8 / 61.8 / 84.0 */
  pattern_contrast?: number | null;
  /** 面料细节图（看得见织纹）与场景图。面料库优先用细节图，商品目录用白底图 */
  detail_image_url?: string | null;
  scene_image_url?: string | null;
  /** 主色十六进制，界面用它显示真实色块 */
  color_rgb?: string | null;
  /** 问卷筛选用的派生属性 */
  color_family?: string | null;
  material_class?: string | null;
  value_level?: string | null;
  pattern_level?: string | null;
  natural_fiber_pct?: number | null;
};

type SearchSkuCatalogInput = {
  q?: string;
  color?: string;
  opacity?: string;
  productType?: string;
  windowType?: string;
  limit?: number;
};

const fallbackCatalogPath = join(
  process.cwd(),
  "testsets",
  "curtain_eval_seedream_window_balanced_v1",
  "mock_sku_catalog.json"
);

let fallbackCache: SkuCatalogItem[] | null = null;

function normalizeSkuItem(raw: Partial<SkuCatalogItem>): SkuCatalogItem {
  return {
    sku_id: String(raw.sku_id || "").trim(),
    name: String(raw.name || "").trim(),
    brand: String(raw.brand || "Custom").trim(),
    collection: String(raw.collection || "Imported").trim(),
    product_type: String(raw.product_type || "standard").trim(),
    opacity: String(raw.opacity || "medium").trim(),
    // 不给颜色兜底成 "white"：color_name 被清空后，这个默认值会让 985 款
    // 全部显示成白色，比留空更误导
    color: String(raw.color || "").trim(),
    mounting: String(raw.mounting || "unknown").trim(),
    layer_type: String(raw.layer_type || "single").trim(),
    price_band: String(raw.price_band || "mid").trim(),
    style_tags: String(raw.style_tags || "").trim(),
    window_types: joinWindowTypes(String(raw.window_types || "标准窗")),
    page_url: String(raw.page_url || "").trim(),
    image_url: String(raw.image_url || "").trim(),
    local_image: String(raw.local_image || "").trim(),
    source: String(raw.source || "Imported").trim(),
    usage_note: String(raw.usage_note || "Imported manually").trim(),
    weight_gsm:
      raw.weight_gsm === null || raw.weight_gsm === undefined
        ? null
        : Number(raw.weight_gsm) || null,
    composition: raw.composition ? String(raw.composition).trim() : null,
    texture_type: raw.texture_type ? String(raw.texture_type).trim() : null,
    material_type: raw.material_type ? String(raw.material_type).trim() : null,
    color_lab_l: numberOrNull(raw.color_lab_l),
    color_lab_b: numberOrNull(raw.color_lab_b),
    color_chroma: numberOrNull(raw.color_chroma),
    pattern_contrast: numberOrNull(raw.pattern_contrast),
    detail_image_url: raw.detail_image_url ? String(raw.detail_image_url).trim() : null,
    scene_image_url: raw.scene_image_url ? String(raw.scene_image_url).trim() : null,
    color_rgb: raw.color_rgb ? String(raw.color_rgb).trim() : null,
    color_family: raw.color_family ? String(raw.color_family).trim() : null,
    material_class: raw.material_class ? String(raw.material_class).trim() : null,
    value_level: raw.value_level ? String(raw.value_level).trim() : null,
    pattern_level: raw.pattern_level ? String(raw.pattern_level).trim() : null,
    natural_fiber_pct: numberOrNull(raw.natural_fiber_pct)
  };
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isSkuCatalogItem(item: SkuCatalogItem) {
  return Boolean(item.sku_id && item.name);
}

/**
 * 兜底目录是 25 款 IKEA 演示数据，只应在本地空库时出现。
 *
 * 它此前是静默生效的：线上商品表读不到数据就自动顶上，界面无任何提示，
 * 结果是网站长期在向客户推荐别家的商品而没人发现。所以这里必须留下日志，
 * 并由 getSkuCatalogSource 把来源如实报给调用方。
 */
async function loadFallbackCatalog(): Promise<SkuCatalogItem[]> {
  if (!fallbackCache) {
    console.warn(
      "[sku-catalog] 商品库为空，已回落到演示目录（IKEA 样例数据）。生产环境出现此日志说明推荐结果不可用。"
    );
    const raw = await readFile(fallbackCatalogPath, "utf8");
    fallbackCache = JSON.parse(raw).map((item: Partial<SkuCatalogItem>) =>
      normalizeSkuItem(item)
    );
  }

  return fallbackCache || [];
}

const COLOR_LABELS: Record<string, string> = {
  white: "白色",
  beige: "米色",
  brown: "棕色",
  gray: "灰色",
  black: "黑色",
  blue: "蓝色",
  green: "绿色",
  yellow: "黄色",
  orange: "橙色",
  pink: "粉色",
  purple: "紫色",
  red: "红色"
};

/**
 * 面料适用于所有窗型——窗型决定的是成品尺寸和款式，不是面料本身。
 * 若只标"标准窗"，客户选落地窗时会一款都匹配不上。
 */
const ALL_WINDOW_TYPES = joinWindowTypes([...WINDOW_TYPE_OPTIONS]);

/** 客户看到的观感。供应商的 texture_type 分的是织造工艺，与观感只有约五成吻合 */
export const PATTERN_LABELS: Record<string, string> = {
  solid: "素净",
  texture: "细肌理",
  pattern: "花纹"
};

/**
 * 中文色名。口径与给语音助手的色彩词表完全一致，是同一份事实源。
 *
 * 不用供应商色名：那一列 2026-08-01 被改名为 color_name 且清空，
 * 而它本来也不可信——8626-11 标 yellow，实测 b=+65 落在 green 族。
 * 颜色是物理量，从 Lab 派生比抄供应商的字段准。
 */
export function colorLabelFromLab(
  family: string | null | undefined,
  valueLevel: string | null | undefined,
  chroma: number | null | undefined
) {
  const light = valueLevel === "very_light" || valueLevel === "light";
  const c = chroma ?? 0;
  switch (family) {
    case "warm":
      if (valueLevel === "deep") return "深咖";
      if (valueLevel === "medium") return "浅咖";
      return light && c < 10 ? "米白" : "米色";
    case "gray":
      if (valueLevel === "deep") return "深灰";
      if (valueLevel === "medium") return "中灰";
      return "浅灰";
    case "pure_white":
      return "纯白";
    case "black":
      return "黑色";
    case "sage":
      return "灰绿";
    case "earth":
      return valueLevel === "deep" ? "棕色" : "大地色";
    case "cool":
      return "冷灰";
    case "green":
      return "绿色";
    case "blue":
      return "蓝色";
    case "pink":
      return "粉色";
    default:
      return "";
  }
}

function toCatalogItem(row: Record<string, unknown>): SkuCatalogItem {
  const factorySku = String(row.factory_sku || "").trim();
  // color 列已在 2026-08-01 更名为 color_name 并清空；两者都读，谁有值用谁
  const color = String(row.color_name || row.color || "").trim();
  const texture = String(row.texture_type || "").trim();
  const gsm = row.weight_gsm === null || row.weight_gsm === undefined ? null : Number(row.weight_gsm);
  const isSheer = String(row.material_type || "main").trim() === "sheer";
  const label =
    colorLabelFromLab(
      row.color_family as string,
      row.value_level as string,
      numberOrNull(row.color_chroma)
    ) ||
    COLOR_LABELS[color] ||
    color ||
    "未标注颜色";
  // 命名用视觉判定的观感，不用供应商的织造分类：
  // 8623-02 图上是清清楚楚的千鸟格，却被标成「小肌理/纯色」。
  const patternLabel = PATTERN_LABELS[String(row.pattern_level || "").trim()] || texture.replace("/", "·");

  return normalizeSkuItem({
    sku_id: factorySku,
    // 供应商数据没有商品名，用可读属性拼一个，便于顾问和模型辨认
    name: [label, patternLabel, gsm ? `${Math.round(gsm)}g/m²` : ""].filter(Boolean).join(" · "),
    brand: "RoyalZen",
    collection: factorySku.split("-")[0] || "未分组",
    product_type: isSheer ? "sheer" : "standard",
    // 遮光等级需要实测数据，当前没有，不按克重臆测
    opacity: isSheer ? "sheer" : "unspecified",
    color,
    layer_type: isSheer ? "sheer" : "single",
    style_tags: texture,
    window_types: ALL_WINDOW_TYPES,
    image_url: String(row.white_background_image_url || "").trim(),
    source: "sku_material",
    usage_note: "供应商面料库",
    weight_gsm: gsm,
    composition: row.composition ? String(row.composition).trim() : null,
    texture_type: texture || null,
    material_type: String(row.material_type || "main").trim(),
    color_lab_l: numberOrNull(row.color_lab_l),
    color_lab_b: numberOrNull(row.color_lab_b),
    color_chroma: numberOrNull(row.color_chroma),
    pattern_contrast: numberOrNull(row.pattern_contrast),
    detail_image_url: row.detail_image_url ? String(row.detail_image_url).trim() : null,
    scene_image_url: row.scene_image_url ? String(row.scene_image_url).trim() : null,
    color_rgb: row.color_rgb ? String(row.color_rgb).trim() : null,
    color_family: row.color_family ? String(row.color_family).trim() : null,
    material_class: row.material_class ? String(row.material_class).trim() : null,
    value_level: row.value_level ? String(row.value_level).trim() : null,
    pattern_level: row.pattern_level ? String(row.pattern_level).trim() : null,
    natural_fiber_pct: numberOrNull(row.natural_fiber_pct)
  });
}

async function listDbSkus(limit = 2000) {
  const db = getDb();
  const result = await db.query(
    `select
       m.factory_sku,
       m.color_name,
       m.material_type,
       m.texture_type,
       m.composition,
       m.weight_gsm,
       m.color_lab_l,
       m.color_lab_b,
       m.color_chroma,
       m.color_rgb,
       m.pattern_contrast,
       m.color_family,
       m.material_class,
       m.value_level,
       m.pattern_level,
       m.natural_fiber_pct,
       image.white_background_image_url,
       image.detail_image_url,
       image.scene_image_url
     from sku_material m
     join sku_product_image image on image.factory_sku = m.factory_sku
     where m.status = 'active'
       and image.white_background_image_url is not null
       and btrim(image.white_background_image_url) <> ''
     order by m.factory_sku asc
     limit $1`,
    [limit]
  );
  return result.rows.map((row) => toCatalogItem(row as Record<string, unknown>));
}

export type AdminSkuItem = SkuCatalogItem & { status: string; hasImage: boolean };

/**
 * 管理后台用的商品列表。
 *
 * 与前台的区别只有两条：**不过滤 status**（下架的也要能看见才能重新上架），
 * 以及**不走缓存**（管理员改完要立刻看到结果）。
 *
 * 此前管理后台读写的是 curtain_skus——那张表 0 条，而推荐用的是 sku_material 的
 * 985 条。顾问打开商品管理看到的是空列表，改什么都不影响前台。
 */
export async function listSkusForAdmin(limit = 50, offset = 0): Promise<AdminSkuItem[]> {
  const db = getDb();
  const result = await db.query(
    `select
       m.factory_sku, m.color_name, m.material_type, m.texture_type, m.composition,
       m.weight_gsm, m.color_lab_l, m.color_lab_b, m.color_chroma, m.color_rgb, m.pattern_contrast,
       m.color_family, m.material_class, m.value_level, m.pattern_level,
       m.natural_fiber_pct, m.status,
       image.white_background_image_url, image.detail_image_url, image.scene_image_url
     from sku_material m
     left join sku_product_image image on image.factory_sku = m.factory_sku
     order by m.factory_sku asc
     limit $1 offset $2`,
    [limit, offset]
  );
  return result.rows.map((row) => {
    const record = row as Record<string, unknown>;
    return {
      ...toCatalogItem(record),
      status: String(record.status || "active"),
      hasImage: Boolean(String(record.white_background_image_url || "").trim())
    };
  });
}

export async function countSkusForAdmin() {
  const db = getDb();
  const result = await db.query(`select count(*)::int as count from sku_material`);
  return Number(result.rows[0]?.count || 0);
}

/**
 * 上下架。这是管理后台唯一被允许的写操作。
 *
 * 不开放编辑颜色、花纹、质感等字段——那些是 CV 与视觉模型算出来的，
 * 人工改了会和下一次重标打架，制造无人察觉的不一致。
 * 供应商填报字段（成分、克重）要改，走供应商数据重导。
 */
export async function setSkuStatus(factorySku: string, status: "active" | "inactive") {
  const db = getDb();
  const result = await db.query(
    `update sku_material set status = $2, updated_at = now()
     where factory_sku = $1
     returning factory_sku`,
    [factorySku, status]
  );
  return result.rowCount === 1;
}

async function hasDbSkus() {
  const db = getDb();
  const result = await db.query(
    `select count(*)::int as count
     from sku_material m
     join sku_product_image image on image.factory_sku = m.factory_sku
     where m.status = 'active'
       and image.white_background_image_url is not null`
  );
  return Number(result.rows[0]?.count || 0) > 0;
}

function filterSkuItems(items: SkuCatalogItem[], query: SearchSkuCatalogInput) {
  const normalizedQ = query.q?.trim().toLowerCase();
  const normalizedWindowType = query.windowType?.trim().toLowerCase();
  const limit = Math.max(1, Math.min(200, query.limit ?? 50));

  return items
    .filter((item) => {
      if (normalizedQ) {
        const haystack = [
          item.sku_id,
          item.name,
          item.color,
          item.opacity,
          item.product_type,
          item.style_tags,
          item.collection,
          item.brand,
          item.window_types,
          item.usage_note
        ]
          .join(" ")
          .toLowerCase();

        if (!haystack.includes(normalizedQ)) {
          return false;
        }
      }

      if (query.color && item.color !== query.color) return false;
      if (query.opacity && item.opacity !== query.opacity) return false;
      if (query.productType && item.product_type !== query.productType) return false;
      if (normalizedWindowType && !item.window_types.toLowerCase().includes(normalizedWindowType)) {
        return false;
      }

      return true;
    })
    .slice(0, limit);
}

export async function searchSkuCatalog(query: SearchSkuCatalogInput) {
  return filterSkuItems(await getSkuCatalog(4000), query);
}

/**
 * 直接查，空了再回落。
 *
 * 原先每次都先跑一遍 hasDbSkus() 的全表 count 再查数据，等于每个页面
 * 都白付一次跨区往返——而 count 的结果只用来判断要不要回落。
 */
export async function getSkuCatalog(limit = 4000): Promise<SkuCatalogItem[]> {
  const rows = await listDbSkus(limit);
  if (rows.length > 0) return rows;
  return loadFallbackCatalog();
}

export async function getSkuCatalogSource() {
  return (await hasDbSkus()) ? "database" : "mock";
}

