export type GenerationQualityTier = "fast" | "balanced" | "quality";

export type GenerationQualityProfile = {
  tier: GenerationQualityTier;
  label: string;
  description: string;
  maxDimension: number;
  jpegQuality: number;
};

/**
 * 档位只决定**喂给模型的输入图**有多大，不决定出图大小——出图尺寸由模型侧定，
 * 而它有下限（实测：低于 3,686,400 像素直接 400）。
 *
 * 2026-08-02 实测：输入 1536 与 1024 的模型耗时分别是 28.1s 与 27.6s，
 * 差别在噪声里。所以**这三档几乎不影响速度**，影响的是模型能看清多少细节。
 * 文案照这个事实改写过——原来写「速度优先」「速度会更慢」是误导，
 * 客户按它选，等的时间却一样。
 */
export const GENERATION_QUALITY_PROFILES: Record<GenerationQualityTier, GenerationQualityProfile> = {
  fast: {
    tier: "fast",
    label: "轻量参考",
    description: "输入图压得更小，窗框细节会松一些。出图时间与其他档位相当。",
    maxDimension: 1024,
    jpegQuality: 80
  },
  balanced: {
    tier: "balanced",
    label: "均衡推荐",
    description: "默认档，细节与稳定性兼顾。",
    maxDimension: 1536,
    jpegQuality: 86
  },
  quality: {
    tier: "quality",
    label: "高清效果",
    description: "保留最多窗框与面料细节，出图时间与其他档位相当。",
    maxDimension: 1800,
    jpegQuality: 90
  }
};

export const DEFAULT_GENERATION_QUALITY_TIER: GenerationQualityTier = "balanced";

export function resolveGenerationQualityTier(value: unknown): GenerationQualityTier {
  if (value === "fast" || value === "balanced" || value === "quality") {
    return value;
  }

  return DEFAULT_GENERATION_QUALITY_TIER;
}

export function getGenerationQualityProfile(value: unknown) {
  return GENERATION_QUALITY_PROFILES[resolveGenerationQualityTier(value)];
}
