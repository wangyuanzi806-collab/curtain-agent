import type { SkuCatalogItem } from "@/lib/sku-catalog";

/**
 * 语音顾问的「可点选项卡」。
 *
 * 顾客说不出「提花」「亚麻肌理」，但他会指。网页问卷早就靠这个活着——
 * 十张面料细节图是人工挑的、居中裁成 480×480、同题内颜色接近（颜色一拉开，
 * 客户会以为在选颜色而不是选质地）。语音端一直只有嘴，于是遇到「我也说不好」
 * 就卡住。这里把同一批图接进语音：**同一个问题，两条路都通**——
 * 顾客能说就说，说不出就指。
 *
 * 三条底线沿用问卷那边踩出来的：
 * 1. 每组都带「都可以」的出口，不逼顾客对不懂的事做决定；
 * 2. 每个选项都带一句大白话，图旁边必须有话，否则顾客只是在看好看的图；
 * 3. 选项数 3–5。少了不像在选，多了就成了目录——选择架构上超过五个反而降低决策率。
 */

export type VoiceChoice = {
  /** 回传给模型的稳定标识，同时也是筛选参数 */
  id: string;
  /** 顾客看到的名字 */
  label: string;
  /** 一句大白话：它是什么、什么手感、配什么空间 */
  hint: string;
  /** public/facets 下的面料细节图；颜色组用色块所以没有 */
  image?: string;
  /** 颜色组的色块 */
  hex?: string;
  /** 库里有多少款，给顾客一个「这不是虚的」的量感 */
  count?: number;
};

export type VoiceChoiceGroup = {
  kind: ChoiceKind;
  /** 屏幕上那行提问。语音会用自己的话说一遍，不是照念 */
  prompt: string;
  choices: VoiceChoice[];
};

export const CHOICE_KINDS = ["feel", "pattern", "layer", "light", "colour"] as const;
export type ChoiceKind = (typeof CHOICE_KINDS)[number];

/**
 * 质感。图是面料细节，看得见经纬织纹——这是成品缩略图做不到的：
 * 62px 高的成品图上，「羊毛/顺滑/混纺」三张都是素净灰，顾客分不出差别来自哪里。
 *
 * **顺序即分轮：前三个是第一轮。**
 * Townsend & Kahn 2014（JCR）的反面发现：视觉是「更快但更随意」的格式塔加工，
 * 所以选项集一变大，图片反而比文字造成更严重的选择过载；叠加 Chernev 2015
 * 元分析的四个调节变量，一个说不出自己想要什么的顾客同时命中三个高危因子
 * （偏好不确定、选项难比较、目标不坚定）。
 * **结论是反直觉的：越是说不上来的顾客，一次能看的图越少，不是越多。**
 * 所以第一轮只给差异最大的三种（粗粝自然 / 柔软垂坠 / 厚实温暖）；
 * 「顺滑素面」和「混纺」留到第二轮——它们恰恰是最难用一张图分辨的两种。
 */
const FEEL: VoiceChoice[] = [
  {
    id: "cotton_linen",
    label: "棉麻自然感",
    hint: "看得见织纹，有点粗粝的天然感。适合想要放松、不那么正式的空间。",
    image: "cotton_linen"
  },
  {
    id: "viscose_soft",
    label: "柔软垂坠感",
    hint: "手感滑软，垂坠特别好，褶子是流下来的。显安静。",
    image: "viscose_soft"
  },
  {
    id: "wool",
    label: "羊毛温暖感",
    hint: "毛呢质地，厚实，冬天看着就暖。垂下来很有份量。",
    image: "wool"
  },
  {
    id: "polyester_smooth",
    label: "顺滑素面",
    hint: "表面干净利落，没有明显材质感。不抢戏，好打理。",
    image: "polyester_smooth"
  },
  {
    id: "blend",
    label: "混纺质感",
    hint: "各方面都兼顾一些，最不容易出错的选择。",
    image: "blend"
  }
];

/** 花纹三档。这三张图差别肉眼可辨，是全部十张里最有效的一组 */
const PATTERN: VoiceChoice[] = [
  {
    id: "solid",
    label: "素净，看不出花纹",
    hint: "纯色。房间里已经有花色的东西时，窗帘素一点最稳。",
    image: "solid"
  },
  {
    id: "texture",
    label: "有点肌理，近看才见",
    hint: "细织纹。远看是素的，走近了才发现有质感。",
    image: "texture"
  },
  {
    id: "pattern",
    label: "明显的花纹图案",
    hint: "提花或大花型。想让窗帘成为这个房间的主角时选它。",
    image: "pattern"
  }
];

const LAYER: VoiceChoice[] = [
  {
    id: "main",
    label: "布帘",
    hint: "厚的那层，管遮光和保暖。",
    image: "main"
  },
  {
    id: "sheer",
    label: "纱帘",
    hint: "薄的那层，白天挡视线但不挡光。常和布帘一起装。",
    image: "sheer"
  }
];

/**
 * 光线需求。这一组**故意不配图**——「够暗」是一种体感，
 * 任何一张照片都在替顾客定义暗到什么程度，而遮光只能到店打手电才算数。
 * 所以这里全用生活场景的话，让顾客认领自己的处境。
 */
const LIGHT: VoiceChoice[] = [
  { id: "keep_light", label: "光进来就好", hint: "喜欢亮堂，不太在意外面看得见。" },
  { id: "day_privacy", label: "白天透光，晚上要隐私", hint: "最常见的那种。" },
  { id: "dark_sleep", label: "睡觉要够暗", hint: "早上不想被光叫醒。" },
  { id: "max_block", label: "尽量遮光遮热", hint: "西晒、临街，或者下午要午睡。" }
];

const STATIC_GROUPS: Record<Exclude<ChoiceKind, "colour">, Omit<VoiceChoiceGroup, "kind">> = {
  feel: { prompt: "摸起来想要哪一种？", choices: FEEL },
  pattern: { prompt: "要素净还是有花纹？", choices: PATTERN },
  layer: { prompt: "要哪一层？", choices: LAYER },
  light: { prompt: "光线上最在意什么？", choices: LIGHT }
};

/** 语音端说的颜色词 → 展示层的色族。助手用哪个词都能落到同一格 */
const COLOUR_LABELS: Record<string, string> = {
  warm_neutral: "米白暖调",
  warm_tint: "暖黄调",
  warm: "暖色",
  gray: "灰色",
  pure_white: "纯白",
  earth: "大地色",
  sage: "灰绿",
  cool: "冷调",
  green: "绿色",
  blue: "蓝色",
  pink: "粉色",
  black: "黑色"
};

/**
 * 颜色组是唯一从目录现算的：色块取自商品自己的 `color_rgb`，
 * 顾客点中的那块颜色，就是库里真有的布的颜色。
 *
 * 只取款数最多的六族——第七族往后加起来不到一成，
 * 在手机上多出的两行会把选项挤到要滚动，而滚动就等于看不见。
 */
async function buildColourGroup(): Promise<VoiceChoiceGroup> {
  /**
   * **动态 import。** 本模块被 voice-tools 静态引入，而 voice-tools 又被铸凭证的
   * 路由引入。目录缓存那条链（sku-catalog → db → 文件读取）挂到铸凭证的冷启动上，
   * 就是 2026-08-03 那个「未认证 401 从毫秒变 60 秒」的翻版。
   * 只有真的要出颜色卡时才付这个钱；其余四组是纯数据，零成本。
   */
  const [{ getCachedSkuCatalog }, { colorBucket }] = await Promise.all([
    import("@/lib/catalog-cache"),
    import("@/lib/sku-facets")
  ]);
  const catalog = await getCachedSkuCatalog(4000);
  const grouped = new Map<string, SkuCatalogItem[]>();
  for (const item of catalog) {
    if (!item.color_family || !item.color_rgb) continue;
    const key = colorBucket(item);
    const list = grouped.get(key) || [];
    list.push(item);
    grouped.set(key, list);
  }

  const choices = [...grouped.entries()]
    .map(([family, items]) => {
      // 中位色而不是平均：平均会把一撮米白和一撮芥末黄算成一个不存在的土黄
      const sorted = items
        .filter((item) => item.color_lab_l !== null && item.color_lab_l !== undefined)
        .sort((a, b) => (a.color_lab_l as number) - (b.color_lab_l as number));
      const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : items[0];
      return {
        id: family,
        label: COLOUR_LABELS[family] || family,
        hint: `库里有 ${items.length} 款`,
        hex: median.color_rgb || undefined,
        count: items.length
      };
    })
    .filter((choice) => choice.hex)
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
    .slice(0, 6);

  return { kind: "colour", prompt: "颜色上有偏好吗？", choices };
}

/**
 * 一屏最多三张图。
 *
 * 只对**图片**组封顶，不对色块和纯文字组封顶——Chernev 2015 的调节变量里
 * 「选项难比较」是关键：面料同时有质感、垂感、厚度、颜色好几维，六张图要两两
 * 比较十五次；颜色是单维度的，一眼扫完就知道自己喜欢哪个。
 * 一刀切成三个，会把颜色题也砍成残废。
 */
const VISUAL_ROUND_SIZE = 3;

/**
 * 每组都多这一张。
 *
 * 「不知道」本来是个死胡同：顾客答不上来，助手换个说法再问一遍,他更答不上来。
 * 给它一张卡，就把它变成**一个有明确后果的选项**——点了等于说「你帮我定」,
 * 而后果也要说出来（"那我按您房间的配色来配"）。等价于网页问卷每题的「都可以」。
 *
 * 落库记成 any，**并且绝不能再问第二遍**：他已经回答了。
 */
const DONT_KNOW: VoiceChoice = {
  id: "any",
  label: "我也说不好",
  hint: "那我按您房间来配。"
};

export async function buildChoiceGroup(kind: ChoiceKind, round = 1): Promise<VoiceChoiceGroup> {
  if (kind === "colour") {
    const group = await buildColourGroup();
    return { ...group, choices: [...group.choices, DONT_KNOW] };
  }
  const group = STATIC_GROUPS[kind];
  const hasImages = group.choices.some((choice) => choice.image);
  if (!hasImages || group.choices.length <= VISUAL_ROUND_SIZE) {
    return { kind, prompt: group.prompt, choices: [...group.choices, DONT_KNOW] };
  }
  // 第二轮给剩下的。顾客说「都不太对」时才走到这里——
  // 一上来就摊开五张，等于把选择过载直接送给最没把握的那个人
  const start = round > 1 ? VISUAL_ROUND_SIZE : 0;
  const choices = group.choices.slice(start, start + VISUAL_ROUND_SIZE);
  return {
    kind,
    prompt: round > 1 ? "那这两种呢？" : group.prompt,
    choices: [...(choices.length ? choices : group.choices.slice(0, VISUAL_ROUND_SIZE)), DONT_KNOW]
  };
}

/** 顾客点了某一项之后，用来告诉模型他点的是什么 */
export function describeChoice(kind: ChoiceKind, id: string): string {
  // 「我也说不好」每组都有，落库是同一个 any，但读出来要说清他放弃的是哪一题
  if (id === DONT_KNOW.id) return `${DONT_KNOW.label}（这一题交给你定）`;
  if (kind === "colour") return COLOUR_LABELS[id] || id;
  const found = STATIC_GROUPS[kind as Exclude<ChoiceKind, "colour">].choices.find((c) => c.id === id);
  return found ? `${found.label}（${found.hint}）` : id;
}

/**
 * 点过的选项 → recommend_for_room 的参数。
 * 顾客指的和嘴上说的进的是同一个漏斗，不能分成两套。
 */
export function tasteToRecommendationArgs(taste: Record<string, string[]>) {
  /*
   * **「我也说不好」在这里要当成没答。**
   * 它对顾客是个有效回答（「你帮我定」），但对筛选器不是一个可筛的值——
   * 原样传下去，推荐参数里会出现「我也说不好（这一题交给你定）」这句中文文案，
   * 下游拿它去匹配面料，等于凭空多了一个谁都不满足的条件。
   */
  const real = (kind: string) => (taste[kind] ?? []).filter((id) => id !== "any");
  const first = (kind: string) => real(kind)[0] ?? "";
  return {
    colour: real("colour").map((id) => COLOUR_LABELS[id] || id).join("、"),
    opacity: first("light") ? describeChoice("light", first("light")) : "",
    feel: real("feel").map((id) => describeChoice("feel", id)).join("、"),
    pattern: first("pattern") ? describeChoice("pattern", first("pattern")) : "",
    layer: first("layer") ? describeChoice("layer", first("layer")) : ""
  };
}
