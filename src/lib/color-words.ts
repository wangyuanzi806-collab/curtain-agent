import type { SkuCatalogItem } from "@/lib/sku-catalog";

/**
 * 客户会说的中文色彩词 → Lab 谓词。
 *
 * 不用供应商色名：那一列已被清空，且本来就不可信（8626-11 标 yellow，
 * 实测 b=+65 落在 green 族）。口径与 colorLabelFromLab 同源。
 */
type ColorRule = { label: string; match: (item: SkuCatalogItem) => boolean };

const light = (item: SkuCatalogItem) =>
  item.value_level === "very_light" || item.value_level === "light";

export const COLOR_RULES: ColorRule[] = [
  { label: "米白", match: (i) => i.color_family === "warm" && light(i) && (i.color_chroma ?? 0) < 10 },
  { label: "米色", match: (i) => i.color_family === "warm" && light(i) && (i.color_chroma ?? 0) >= 10 },
  { label: "浅咖", match: (i) => i.color_family === "warm" && i.value_level === "medium" },
  { label: "深咖", match: (i) => (i.color_family === "warm" || i.color_family === "earth") && i.value_level === "deep" },
  { label: "纯白", match: (i) => i.color_family === "pure_white" },
  { label: "浅灰", match: (i) => i.color_family === "gray" && light(i) },
  { label: "中灰", match: (i) => i.color_family === "gray" && i.value_level === "medium" },
  { label: "深灰", match: (i) => i.color_family === "gray" && i.value_level === "deep" },
  { label: "黑色", match: (i) => i.color_family === "black" },
  { label: "灰绿", match: (i) => i.color_family === "sage" },
  { label: "大地色", match: (i) => i.color_family === "earth" && i.value_level !== "deep" },
  { label: "冷灰", match: (i) => i.color_family === "cool" },
  { label: "绿色", match: (i) => i.color_family === "green" },
  { label: "蓝色", match: (i) => i.color_family === "blue" },
  { label: "粉色", match: (i) => i.color_family === "pink" }
];

/** 同义词 → 标准词。客户不会只说标准词 */
export const COLOR_SYNONYMS: Record<string, string> = {
  奶白: "米白", 象牙: "米白", 白色: "米白",
  米黄: "米色", 浅杏: "米色", 杏色: "米色",
  驼色: "浅咖", 燕麦: "浅咖", 卡其: "浅咖",
  棕色: "深咖", 咖啡色: "深咖",
  银灰: "浅灰", 浅银: "浅灰",
  炭灰: "深灰", 深炭: "深灰",
  雾绿: "灰绿", 鼠尾草: "灰绿", 橄榄绿: "灰绿",
  姜黄: "大地色", 赭石: "大地色", 焦糖: "大地色",
  灰蓝: "冷灰",
  雾霾蓝: "蓝色",
  藕色: "粉色", 藕粉: "粉色"
};
