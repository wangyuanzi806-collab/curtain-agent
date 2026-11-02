/**
 * 商品的分类标签，前台目录与后台管理共用一份。
 *
 * 这些值都不是新打的标：色族、明度、花纹、质感四项由白底图的 CIELAB 算出，
 * 布纱来自供应商字段。它们一直躺在库里，只是从没往界面上放——
 * 985 款商品此前只有「花纹」一个筛选器，还只在前台有。
 *
 * 各页曾各写各的文案，同一个 viscose_soft 目录里叫「柔垂」、问卷里叫「柔滑垂坠」。
 */

/**
 * 展示用的色族拆分：`warm` 一族原本占 985 款里的 617 款（63%）。
 *
 * 分族只看色相不看彩度，于是同一格「暖中性·浅」里同时装着 `#CBAD5A`（芥末黄，
 * 彩度 46）和 `#D7D4CB`（近乎灰白，彩度 5）。客户点一下两种都出来，
 * 而格子上只显示其中一种颜色——这就是「颜色不对」的来源。
 *
 * 按彩度 10 拆开（warm 的彩度中位数正是 9.0，两边各占一半）：
 * 彩度低的是真正的中性米色系，高的已经是看得出颜色的暖调。
 *
 * **只用于展示与筛选，不改库里的 `color_family`** ——语音助手那条链路仍按原色族走，
 * 不受影响。
 */
export function colorBucket(item: {
  color_family?: string | null;
  color_chroma?: number | null;
}) {
  const family = String(item.color_family || "");
  if (family !== "warm") return family;
  return (item.color_chroma ?? 0) < 10 ? "warm_neutral" : "warm_tint";
}

export const COLOR_LABELS: Record<string, string> = {
  warm_neutral: "米白米灰",
  warm_tint: "米黄暖调",
  warm: "暖中性",
  gray: "灰中性",
  pure_white: "纯白",
  earth: "大地色",
  sage: "灰绿",
  cool: "冷中性",
  green: "绿色",
  blue: "蓝色",
  pink: "粉色",
  black: "黑色"
};

export const VALUE_LABELS: Record<string, string> = {
  very_light: "很浅",
  light: "浅",
  medium: "中",
  deep: "深"
};

export const PATTERN_LABELS: Record<string, string> = {
  solid: "素净",
  texture: "细肌理",
  pattern: "花纹"
};

export const MATERIAL_LABELS: Record<string, string> = {
  cotton_linen: "棉麻",
  wool: "羊毛",
  viscose_soft: "柔垂",
  polyester_smooth: "顺滑",
  blend: "混纺"
};

export const TYPE_LABELS: Record<string, string> = {
  main: "布帘",
  sheer: "纱帘"
};

export type FacetKey =
  | "color_family"
  | "value_level"
  | "pattern_level"
  | "material_class"
  | "material_type";

/** 顺序即找东西的顺序：先想颜色，再想深浅，最后才是织法 */
export const FACET_GROUPS: {
  key: FacetKey;
  label: string;
  labels: Record<string, string>;
  /** 值的固定次序。缺席的值不出现，出现的按这个排，不按库里的字典序 */
  order: string[];
  /** 展示用的取值方式。颜色要按拆分后的色族筛，不能直接读 color_family */
  derive?: (item: FacetedItem) => string;
}[] = [
  { key: "color_family", label: "颜色", labels: COLOR_LABELS, order: Object.keys(COLOR_LABELS), derive: colorBucket },
  { key: "value_level", label: "深浅", labels: VALUE_LABELS, order: Object.keys(VALUE_LABELS) },
  { key: "pattern_level", label: "花纹", labels: PATTERN_LABELS, order: Object.keys(PATTERN_LABELS) },
  { key: "material_class", label: "质感", labels: MATERIAL_LABELS, order: Object.keys(MATERIAL_LABELS) },
  { key: "material_type", label: "布纱", labels: TYPE_LABELS, order: Object.keys(TYPE_LABELS) }
];

export type FacetSelection = Partial<Record<FacetKey, string[]>>;

type FacetedItem = Partial<Record<FacetKey, string | null | undefined>> & {
  color_chroma?: number | null;
};

/**
 * 组内是「或」，组间是「并」。
 *
 * 选「灰中性 + 大地色」是想同时看这两族，而选「灰中性 + 纱帘」是要同时满足——
 * 这是筛选器唯一符合直觉的读法，反过来任何一种都会给出让人莫名其妙的结果。
 */
export function facetValue(item: FacetedItem, key: FacetKey) {
  const group = FACET_GROUPS.find((entry) => entry.key === key);
  return group?.derive ? group.derive(item) : String(item[key] || "");
}

export function matchesFacets(item: FacetedItem, selection: FacetSelection) {
  for (const group of FACET_GROUPS) {
    const picked = selection[group.key];
    if (!picked || picked.length === 0) continue;
    if (!picked.includes(facetValue(item, group.key))) return false;
  }
  return true;
}

/** 每个标签后面要写还剩多少款。空标签不给点——点进去必然零结果是最没必要的挫败 */
export function countByFacet<T extends FacetedItem>(items: T[], key: FacetKey) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const value = facetValue(item, key);
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return counts;
}

export function toggleFacet(selection: FacetSelection, key: FacetKey, value: string): FacetSelection {
  const current = selection[key] || [];
  const next = current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value];
  return { ...selection, [key]: next };
}

export function countSelected(selection: FacetSelection) {
  return FACET_GROUPS.reduce((sum, group) => sum + (selection[group.key]?.length || 0), 0);
}
