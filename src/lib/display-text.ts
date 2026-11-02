const CORRUPTED_PLACEHOLDER_PATTERN = /^[?？\uFFFD\s]+$/u;

export function normalizeStoredDisplayText(value: unknown, fallback: string) {
  const text = value == null ? "" : String(value).trim();
  if (!text || CORRUPTED_PLACEHOLDER_PATTERN.test(text)) return fallback;
  return text;
}
