import { colorBucket } from "@/lib/sku-facets";

import type { SkuCatalogItem } from "@/lib/sku-catalog";

/**
 * 六题问卷的筛选逻辑。
 *
 * 题量定在 6 题有两个依据：行业统计显示完成率在 6 题以内稳定、超过就明显下滑；
 * 以及每道题都得"挣得"自己的位置——实测厚薄这一项 85% 的商品落在中间档，
 * 客户选什么剩下的数量几乎不变，这种题占一个必答位就是纯损耗。
 * 厚薄、天然偏好、风格因此合并进最后一道开放题。
 */

export const COLOR_FAMILIES = [
  // warm 在展示层按彩度拆成了这两个（见 sku-facets 的 colorBucket）：
  // 原本 617 款挤在一族里，米白和芥末黄同格，点了等于没筛。
  // 保留 "warm" 是为了兼容已经落库的历史咨询答案。
  "warm_neutral",
  "warm_tint",
  "warm",
  "gray",
  "pure_white",
  "earth",
  "sage",
  "cool",
  "green",
  "blue",
  "pink",
  "black"
] as const;

export const VALUE_LEVELS = ["very_light", "light", "medium", "deep"] as const;

export const MATERIAL_CLASSES = [
  "cotton_linen",
  "wool",
  "viscose_soft",
  "polyester_smooth",
  "blend"
] as const;

export type ColorFamily = (typeof COLOR_FAMILIES)[number];
export type ValueLevel = (typeof VALUE_LEVELS)[number];
export type MaterialClass = (typeof MATERIAL_CLASSES)[number];

/** Q1 遮光诉求。当前批次全是布且克重集中，三档几乎等于全集，故只作软信号 */
export type OpacityNeed = "keep_light" | "day_privacy" | "dark_sleep" | "max_block";

/**
 * Q3 花纹三档，按客户看到的观感分。
 *
 * 不用供应商的 texture_type：它分的是有无花位循环（织造工艺），
 * 抽验发现与视觉观感只有约五成吻合，千鸟格和几何提花都被归进了「小肌理/纯色」。
 * 客户判断的是"这块布看起来有没有花"，两者不是一回事。
 */
export type TextureChoice = "solid" | "texture" | "pattern";

/** Q5 层次。纱帘当前仅 4 款，双层与纯纱选项在界面上灰显 */
export type FabricType = "cloth" | "layered" | "sheer";

/** Q6 快捷标签。只有「不要花的」是硬约束，其余进排序与理由 */
export const SURVEY_TAGS = [
  "thick",
  "light_weight",
  "prefer_natural",
  "mostly_natural",
  "easy_care",
  "no_pattern",
  "want_light_color",
  "want_deep_color"
] as const;

export type SurveyTag = (typeof SURVEY_TAGS)[number];

export type SurveyAnswers = {
  opacityNeed: OpacityNeed | null;
  colors: ColorFamily[];
  valueLevels: ValueLevel[];
  /**
   * 客户在色板上实际点中的那几格，形如 `warm_tint/light`。
   *
   * `colors` 和 `valueLevels` 是它的两条投影，筛选时各判各的、再 AND 起来——
   * 点「米白·浅」和「暖灰·中」，两条清单就是 {米白,暖灰} 和 {浅,中}，
   * 于是「米白·中」「暖灰·浅」也一并满足，等于选了四格。客户点两格却得到四格，
   * 界面上那两格也会跟着亮。所以真正的选择必须按格子存，投影只留给
   * 展示（describeSurvey）和推荐提示词用。
   *
   * 为空表示这是老答案或别处传来的，此时回落到两条投影各判各的旧口径。
   */
  colorCells: string[];
  texture: TextureChoice | null;
  materials: MaterialClass[];
  fabricType: FabricType | null;
  tags: SurveyTag[];
  note: string;
};

export const EMPTY_ANSWERS: SurveyAnswers = {
  opacityNeed: null,
  colors: [],
  valueLevels: [],
  colorCells: [],
  texture: null,
  materials: [],
  fabricType: null,
  tags: [],
  note: ""
};

/** 参与硬过滤的维度。Q1 与风格不在其中——前者无区分度，后者标签不可靠 */
export type HardFacet = "colors" | "valueLevels" | "texture" | "materials" | "fabricType" | "tags";

export const FACET_LABELS: Record<HardFacet, string> = {
  colors: "颜色",
  valueLevels: "深浅",
  texture: "花纹",
  materials: "质感",
  fabricType: "布或纱",
  tags: "附加要求"
};

function matchesColors(item: SkuCatalogItem, answers: SurveyAnswers) {
  const cells = answers.colorCells || [];
  // 有格子就按格子判：色族与深浅必须同时对上**同一格**，而不是各自对上任意一格。
  // 客户点了「米白·浅」「暖灰·中」，命中的就只有这两种组合。
  if (cells.length) {
    const bucket = colorBucket(item);
    const legacy = item.color_family || "";
    const level = item.value_level || "";
    return cells.some((cell) => {
      const slash = cell.indexOf("/");
      if (slash < 0) return false;
      const family = cell.slice(0, slash);
      return (family === bucket || family === legacy) && cell.slice(slash + 1) === level;
    });
  }

  if (answers.colors.length === 0) return true;
  // 按拆分后的色族比，否则客户点「米白米灰」会一款都匹配不上
  if (answers.colors.includes(colorBucket(item) as ColorFamily)) return true;
  // 历史答案里存的是拆分前的 warm，仍要能命中
  return answers.colors.includes((item.color_family || "") as ColorFamily);
}

function matchesValueLevels(item: SkuCatalogItem, answers: SurveyAnswers) {
  // 有格子时深浅已经连着色族在上面一起判过了，这里再按清单判一次就又变回笛卡尔积
  if (answers.colorCells?.length) return true;
  if (answers.valueLevels.length === 0) return true;
  return answers.valueLevels.includes((item.value_level || "") as ValueLevel);
}

function matchesTexture(item: SkuCatalogItem, answers: SurveyAnswers) {
  if (!answers.texture) return true;
  // 没有视觉判定的老数据一律放行，不因为缺标注就把商品判死
  if (!item.pattern_level) return true;
  return item.pattern_level === answers.texture;
}

function matchesMaterials(item: SkuCatalogItem, answers: SurveyAnswers) {
  if (answers.materials.length === 0) return true;
  return answers.materials.includes((item.material_class || "") as MaterialClass);
}

function matchesFabricType(item: SkuCatalogItem, answers: SurveyAnswers) {
  if (!answers.fabricType) return true;
  const isSheer = item.material_type === "sheer";
  if (answers.fabricType === "cloth") return !isSheer;
  if (answers.fabricType === "sheer") return isSheer;
  // 双层需要布和纱各一，商品侧无法单款满足，不在此处收窄
  return true;
}

function matchesTags(item: SkuCatalogItem, answers: SurveyAnswers) {
  // 只有「不要花的」是硬约束：客户说了不要，推给她就是没在听。
  // 其余标签是倾向而非要求，交给排序和理由处理。
  if (!answers.tags.includes("no_pattern")) return true;
  if (!item.pattern_level) return true;
  return item.pattern_level !== "pattern";
}

const FACET_MATCHERS: Record<HardFacet, (item: SkuCatalogItem, answers: SurveyAnswers) => boolean> =
  {
    colors: matchesColors,
    valueLevels: matchesValueLevels,
    texture: matchesTexture,
    materials: matchesMaterials,
    fabricType: matchesFabricType,
    tags: matchesTags
  };

export function filterBySurvey(items: readonly SkuCatalogItem[], answers: SurveyAnswers) {
  return items.filter((item) =>
    (Object.keys(FACET_MATCHERS) as HardFacet[]).every((facet) =>
      FACET_MATCHERS[facet](item, answers)
    )
  );
}

export function countBySurvey(items: readonly SkuCatalogItem[], answers: SurveyAnswers) {
  return filterBySurvey(items, answers).length;
}

const COLOR_FAMILY_LABELS: Record<ColorFamily, string> = {
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

const VALUE_LEVEL_LABELS: Record<ValueLevel, string> = {
  very_light: "很浅",
  light: "浅",
  medium: "中等深浅",
  deep: "深"
};

const TEXTURE_LABELS: Record<TextureChoice, string> = {
  solid: "素净、看不出花纹",
  texture: "有细肌理，近看才见",
  pattern: "明显的花纹图案"
};

const MATERIAL_LABELS: Record<MaterialClass, string> = {
  cotton_linen: "棉麻自然感",
  wool: "羊毛温暖感",
  viscose_soft: "柔软垂坠感",
  polyester_smooth: "顺滑素面",
  blend: "混纺质感"
};

const FABRIC_TYPE_LABELS: Record<FabricType, string> = {
  cloth: "只要一层布帘",
  layered: "布纱双层",
  sheer: "只要一层纱帘"
};

const OPACITY_NEED_LABELS: Record<OpacityNeed, string> = {
  keep_light: "保留采光、通透明亮",
  day_privacy: "白天透光、晚上要隐私",
  dark_sleep: "睡觉要够暗",
  max_block: "尽量遮光遮热"
};

const TAG_TEXT: Record<SurveyTag, string> = {
  thick: "厚实有型",
  light_weight: "轻薄通透",
  prefer_natural: "偏天然材质",
  mostly_natural: "天然为主",
  easy_care: "好打理",
  no_pattern: "不要花的",
  want_light_color: "要浅色",
  want_deep_color: "要深色"
};

/**
 * 把六题答案翻成模型读得懂的中文。
 *
 * 少了这一步，重排能看到的就只有前端写死的那几个默认值，
 * 「满足了你的选择」于是只能反复写同一句话——五张卡片一模一样，
 * 而客户明明认真答了题。
 */
export function describeSurvey(answers: SurveyAnswers): Record<string, string> {
  const joined = <T extends string>(list: readonly T[], labels: Record<T, string>) =>
    list.map((item) => labels[item] ?? item).join("、");

  const described: Record<string, string> = {};
  if (answers.opacityNeed) described["采光与隐私"] = OPACITY_NEED_LABELS[answers.opacityNeed];
  if (answers.colors.length) described["颜色"] = joined(answers.colors, COLOR_FAMILY_LABELS);
  if (answers.valueLevels.length) described["深浅"] = joined(answers.valueLevels, VALUE_LEVEL_LABELS);
  if (answers.texture) described["花纹"] = TEXTURE_LABELS[answers.texture];
  if (answers.materials.length) described["质感"] = joined(answers.materials, MATERIAL_LABELS);
  if (answers.fabricType) described["层次"] = FABRIC_TYPE_LABELS[answers.fabricType];
  if (answers.tags.length) described["附加要求"] = joined(answers.tags, TAG_TEXT);
  if (answers.note.trim()) described["补充说明"] = answers.note.trim();
  return described;
}

/** 该维度当前是否真的在收窄范围。没设条件的维度不算，放宽它没有意义 */
function facetIsActive(facet: HardFacet, answers: SurveyAnswers) {
  const hasCells = (answers.colorCells?.length ?? 0) > 0;
  if (facet === "colors") return hasCells || answers.colors.length > 0;
  // 深浅没有自己的入口，它是色板那一道题的投影。有格子时把放宽建议统一归到「颜色」，
  // 否则会建议"放宽深浅"，而放宽完颜色那一维还卡着，客户点了等于没放
  if (facet === "valueLevels") return !hasCells && answers.valueLevels.length > 0;
  if (facet === "texture") return answers.texture !== null;
  if (facet === "materials") return answers.materials.length > 0;
  if (facet === "fabricType") return answers.fabricType !== null;
  return answers.tags.includes("no_pattern");
}

function withFacetCleared(answers: SurveyAnswers, facet: HardFacet): SurveyAnswers {
  // 色板是一道题，放宽它就得把格子和两条投影一起清干净。
  // 只清 colors 的话：格子还在，筛选原样收窄；就算格子也清了，valueLevels 还留着，
  // 深浅那一维继续卡人——客户点了"放宽颜色"却几乎没多出几款。
  if (facet === "colors") return { ...answers, colors: [], valueLevels: [], colorCells: [] };
  if (facet === "valueLevels") return { ...answers, colors: [], valueLevels: [], colorCells: [] };
  if (facet === "texture") return { ...answers, texture: null };
  if (facet === "materials") return { ...answers, materials: [] };
  if (facet === "fabricType") return { ...answers, fabricType: null };
  return { ...answers, tags: answers.tags.filter((tag) => tag !== "no_pattern") };
}

export type RelaxationHint = {
  facet: HardFacet;
  label: string;
  /** 放宽这一项后能多出多少款 */
  gain: number;
  countAfter: number;
};

/**
 * 找出最该放宽的那一项：逐个解除约束，看哪个带来的增量最大。
 *
 * 只说"没有结果"是把问题丢回给客户。她要的是下一步该动哪里。
 */
export function suggestRelaxation(
  items: readonly SkuCatalogItem[],
  answers: SurveyAnswers
): RelaxationHint | null {
  const current = countBySurvey(items, answers);
  let best: RelaxationHint | null = null;

  for (const facet of Object.keys(FACET_MATCHERS) as HardFacet[]) {
    if (!facetIsActive(facet, answers)) continue;
    const countAfter = countBySurvey(items, withFacetCleared(answers, facet));
    const gain = countAfter - current;
    if (gain > 0 && (!best || gain > best.gain)) {
      best = { facet, label: FACET_LABELS[facet], gain, countAfter };
    }
  }

  return best;
}

export type SurveyProgress = {
  count: number;
  /** blocked 时前端必须拦住，不允许进入下一步 */
  level: "plenty" | "focused" | "few" | "blocked";
  message: string;
  relaxation: RelaxationHint | null;
};

/**
 * 每屏底部常驻的剩余数量提示。
 *
 * 这是漏斗交互的命门：客户最怕认真填完却一款没有。
 * 提示必须在她还能修改时给出，而不是填完才说。
 */
export function evaluateSurvey(
  items: readonly SkuCatalogItem[],
  answers: SurveyAnswers
): SurveyProgress {
  const count = countBySurvey(items, answers);
  const relaxation = count > 50 ? null : suggestRelaxation(items, answers);

  if (count === 0) {
    return {
      count,
      level: "blocked",
      message: relaxation
        ? `没有符合全部条件的窗帘。放宽「${relaxation.label}」后可以看到 ${relaxation.countAfter} 款。`
        : "没有符合全部条件的窗帘，请调整一下选择。",
      relaxation
    };
  }
  if (count < 5) {
    return {
      count,
      level: "few",
      message: relaxation
        ? `只剩 ${count} 款。放宽「${relaxation.label}」可以多看到 ${relaxation.gain} 款。`
        : `只剩 ${count} 款，建议放宽一项条件。`,
      relaxation
    };
  }
  if (count <= 15) {
    return {
      count,
      level: "few",
      message: relaxation
        ? `符合条件的有 ${count} 款。想多看看的话，放宽「${relaxation.label}」最有效。`
        : `符合条件的有 ${count} 款。`,
      relaxation
    };
  }
  if (count <= 50) {
    return { count, level: "focused", message: `符合条件的有 ${count} 款，选择已经比较聚焦了。`, relaxation };
  }
  return { count, level: "plenty", message: `符合条件的有 ${count} 款。`, relaxation: null };
}
