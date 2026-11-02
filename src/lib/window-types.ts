export const WINDOW_TYPE_OPTIONS = [
  "标准窗",
  "落地窗",
  "大宽窗",
  "阳台门",
  "滑门/移门",
  "法式门窗",
  "飘窗",
  "小窗",
  "拱形窗"
] as const;

const WINDOW_TYPE_ALIASES: Record<string, string> = {
  凸窗: "飘窗",
  "bay window": "飘窗",
  "bay-window": "飘窗",
  推拉门: "滑门/移门",
  滑动门: "滑门/移门",
  移门: "滑门/移门",
  "sliding door": "滑门/移门",
  "sliding doors": "滑门/移门",
  "glass sliding door": "滑门/移门",
  法式门: "法式门窗",
  "french door": "法式门窗",
  "french doors": "法式门窗",
  落地玻璃窗: "落地窗",
  全景窗: "大宽窗",
  景观窗: "大宽窗",
  弓形窗: "拱形窗",
  "arched window": "拱形窗",
  "arched windows": "拱形窗"
};

function normalizeKey(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeWindowType(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const directMatch = WINDOW_TYPE_OPTIONS.find((item) => item === trimmed);
  if (directMatch) return directMatch;

  const aliasKey = normalizeKey(trimmed);
  if (WINDOW_TYPE_ALIASES[aliasKey]) {
    return WINDOW_TYPE_ALIASES[aliasKey];
  }

  return trimmed;
}

export function splitWindowTypes(value: string) {
  return value
    .split(/[,\uFF0C\u3001+]/)
    .map((item) => normalizeWindowType(item))
    .filter(Boolean)
    .filter((item, index, array) => array.indexOf(item) === index);
}

export function joinWindowTypes(values: string[] | string) {
  const normalizedValues = Array.isArray(values)
    ? values.map((item) => normalizeWindowType(item))
    : splitWindowTypes(values);

  return normalizedValues
    .filter(Boolean)
    .filter((item, index, array) => array.indexOf(item) === index)
    .join(", ");
}

export function windowTypesMatch(windowTypes: string, targetWindowType: string) {
  const target = normalizeWindowType(targetWindowType);
  if (!target) return false;
  return splitWindowTypes(windowTypes).some((item) => item === target);
}
