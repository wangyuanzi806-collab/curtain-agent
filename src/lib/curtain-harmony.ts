import type { RoomColorAnalysis } from "./room-color";

/**
 * 和谐色域：把房间的色彩读数翻译成一段"放进去不会难看"的窗帘颜色区间。
 *
 * 这一层只负责划出安全边界，不负责挑出最好的那款——
 * 因为按和谐度排序会选出彼此最像的几款（都挤在色域中心，实测前 5 款明度跨度仅 1.1）。
 * 挑选交给分层多样化和模型重排。
 */

/** 彩度硬上限。不设的话模型会把 C=40 的芥末黄、L=14.5 的纯黑排到第一名 */
const CHROMA_HARD_LIMIT = 30;

/** 明度硬过滤在色域下界之外还能容忍多少个 L */
const VALUE_TOLERANCE = 12;

/**
 * 分桶前的贴合度闸门，从严到宽依次尝试，取第一个还能填满候选池的。
 *
 * penalty 1.0 约等于明度偏离色域 10 个 L。0.8 是"看得出偏离但还在一个屋子里"的界限，
 * 放宽到 1.8 是为了色域本身很窄的房间——宁可松一档，也不要让候选池填不满。
 */
const PENALTY_GATES = [0.8, 1.2, 1.8];

export type HarmonyTarget = {
  bLow: number;
  bHigh: number;
  lLow: number;
  lHigh: number;
  chromaSoft: number;
  chromaHard: number;
  /** 每条边界的由来，用于生成可审计的推荐理由 */
  reasons: Record<string, string>;
};

export type RoomTrust = {
  trusted: boolean;
  issues: string[];
};

/**
 * 取色可信度判断。任一条命中就说明这张房间图算出的颜色不能用来做硬过滤，
 * 宁可推荐得平庸，也不要基于错误的房间色推荐得离谱。
 */
export function assessRoomTrust(room: RoomColorAnalysis): RoomTrust {
  const issues: string[] = [];
  if (room.validRatio < 0.55) {
    issues.push(`有效区仅 ${Math.round(room.validRatio * 100)}%`);
  }
  if (room.colors.some((c) => c.share > 0.05 && Math.abs(c.b) > 40)) {
    issues.push("出现 |b|>40 的极端色簇，多半是光照污染");
  }
  const spread = Math.max(...room.whitePoint) - Math.min(...room.whitePoint);
  if (spread > 28) {
    issues.push(`参考白偏离 ${Math.round(spread)}，白平衡不可信`);
  }
  return { trusted: issues.length === 0, issues };
}

export function harmonyTarget(room: RoomColorAnalysis): HarmonyTarget {
  const reasons: Record<string, string> = {};

  // 冷暖底调（硬约束）：房间偏暖就配暖调，偏冷就配冷调。
  // 底调撞了是"错了"，不是"不够好"，所以这条不能只扣分。
  let bLow: number;
  let bHigh: number;
  if (room.roomB >= 3) {
    [bLow, bHigh] = [2, 28];
    reasons.undertone = `房间暖底（b=${room.roomB > 0 ? "+" : ""}${room.roomB}），窗帘取暖调`;
  } else if (room.roomB <= -3) {
    [bLow, bHigh] = [-22, 2];
    reasons.undertone = `房间冷底（b=${room.roomB}），窗帘取冷调`;
  } else {
    [bLow, bHigh] = [-6, 12];
    reasons.undertone = `房间中性（b=${room.roomB}），冷暖皆可`;
  }

  // 冷暖分裂时（例如暖木家具配冷灰墙），窗帘取中间带做过渡
  const significant = room.colors.filter((c) => c.share > 0.08);
  const pool = significant.length > 1 ? significant : room.colors;
  if (room.warmCoolSplit >= 12 && pool.length > 1) {
    const warm = pool.reduce((m, c) => (c.b > m.b ? c : m));
    const cool = pool.reduce((m, c) => (c.b < m.b ? c : m));
    const mid = (warm.b + cool.b) / 2;
    const nextLow = Math.max(bLow, mid - 10);
    const nextHigh = Math.min(bHigh, mid + 10);
    if (nextLow < nextHigh) {
      bLow = nextLow;
      bHigh = nextHigh;
      reasons.bridge = `冷暖分裂（暖 b=${warm.b} / 冷 b=${cool.b}），窗帘取中间带过渡`;
    }
  }

  // 明度（软约束）：两个方向都成立——比墙略深求对比，或与墙同明度求统一。
  // 只认前者的话，浅墙浅帘这种酒店风、奶油风的标准做法会被整片排除。
  let lLow = Math.max(room.wallL - 32, 22);
  let lHigh = Math.min(room.wallL + 8, 95);
  reasons.value = `墙面 L=${Math.round(room.wallL)}，窗帘取 L[${Math.round(lLow)}, ${Math.round(lHigh)}]（含"略深求对比"与"同明度求统一"两种做法）`;

  if (room.floorL < 38) {
    lLow = Math.max(lLow, room.floorL + 18);
    reasons.floor = `地板偏深（L=${Math.round(room.floorL)}），窗帘不低于 L${Math.round(lLow)}，否则空间下沉`;
  }
  if (room.roomL < 45) {
    lLow = Math.max(lLow, room.roomL + 10);
    reasons.dark = `房间整体偏暗（L=${room.roomL}），窗帘需要更亮`;
  }
  if (lHigh <= lLow) {
    lHigh = lLow + 15;
  }

  // 彩度：房间本身已经有高彩度物件时，窗帘要让位，否则抢戏。
  // 下限那两项是为了避免自相矛盾——彩度恒 >= |b|，
  // 若要求 b>10 却又要求 C<9，条件永远无解，会直接筛出空集。
  let chromaSoft = room.maxC >= 25 ? 9 : 20;
  chromaSoft = Math.max(chromaSoft, Math.abs(bLow) + 5, Math.abs(bHigh) * 0.55);
  chromaSoft = Math.min(chromaSoft, CHROMA_HARD_LIMIT);
  reasons.chroma = `房间彩度 C=${Math.round(room.maxC)}，窗帘软上限 C<${Math.round(chromaSoft)}、硬上限 C<${CHROMA_HARD_LIMIT}`;

  return {
    bLow: Number(bLow.toFixed(1)),
    bHigh: Number(bHigh.toFixed(1)),
    lLow: Number(lLow.toFixed(1)),
    lHigh: Number(lHigh.toFixed(1)),
    chromaSoft: Number(chromaSoft.toFixed(1)),
    chromaHard: CHROMA_HARD_LIMIT,
    reasons
  };
}

export type HarmonyScorable = {
  factorySku: string;
  colorLabL: number | null;
  colorLabB: number | null;
  colorChroma: number | null;
  textureType: string;
};

function valueLevel(l: number) {
  if (l < 45) return "deep";
  if (l < 70) return "mid";
  if (l < 85) return "light";
  return "pale";
}

/** 偏离目标色域的程度，越小越贴合。只用于组内排序，不作为推荐依据展示 */
export function harmonyPenalty(item: HarmonyScorable, target: HarmonyTarget) {
  const l = item.colorLabL ?? 0;
  const b = item.colorLabB ?? 0;
  const chroma = item.colorChroma ?? 0;
  const center = (target.bLow + target.bHigh) / 2;
  return (
    Math.max(0, (target.lLow - l) / 10) +
    Math.max(0, (l - target.lHigh) / 10) +
    Math.max(0, (chroma - target.chromaSoft) / 8) +
    (Math.abs(b - center) / Math.max(4, target.bHigh - target.bLow)) * 0.5
  );
}

/**
 * 硬约束过滤。缺 Lab 数据的商品直接放行——
 * 没有颜色读数不等于颜色不协调，不该因为数据没补齐就把商品判死。
 */
export function filterByHarmony<T extends HarmonyScorable>(
  items: readonly T[],
  target: HarmonyTarget
): T[] {
  return items.filter((item) => {
    if (item.colorLabL === null || item.colorLabB === null || item.colorChroma === null) {
      return true;
    }
    if (item.colorLabB < target.bLow || item.colorLabB > target.bHigh) return false;
    if (item.colorChroma > target.chromaHard) return false;
    // 明度留一档余量，但不能留成没有下界：
    // lLow 本身已经是 wallL-32，再放 25 等于允许 wallL-57——
    // 墙面 L=85 的白房间连 L=28 的深色都算"通过和谐筛查"。
    return item.colorLabL >= target.lLow - VALUE_TOLERANCE && item.colorLabL <= target.lHigh + 10;
  });
}

/**
 * 分层多样化：按「色族档 × 明度档 × 肌理」分桶后轮流取。
 *
 * 直接按贴合度排序会选出彼此最像的几款——最协调的必然都挤在色域中心，
 * 所以也最像。实测前 5 款明度跨度只有 1.1，分层轮取后是 14.5。
 * 五款长得一样，信息量等于一款。
 */
export function diversifyByHarmony<T extends HarmonyScorable>(
  items: readonly T[],
  target: HarmonyTarget,
  limit: number
): T[] {
  const scored = items
    .map((item) => ({ item, penalty: harmonyPenalty(item, target) }))
    .sort((a, b) => a.penalty - b.penalty || a.item.factorySku.localeCompare(b.item.factorySku));

  // 分桶前先按贴合度收口。
  // 不收口的话，「每个桶取第一名」会把明显偏离色域的桶也一并带进候选池：
  // 实测 15 个房间共混进 62 款 penalty>1 的商品，墙面 L=91 的亮白卧室里
  // 甚至有 6 款 L≈37–43 的深色。而重排提示词又要求"彼此不雷同"，
  // 模型为了拉开明度自然就挑中了它们——客户看到的不和谐由此而来。
  const gated =
    PENALTY_GATES.map((gate) => scored.filter((row) => row.penalty <= gate)).find(
      (kept) => kept.length >= limit
    ) ?? scored;

  const buckets = new Map<string, typeof gated>();
  for (const row of gated) {
    const l = row.item.colorLabL;
    const b = row.item.colorLabB;
    const key = [
      l === null ? "unknown" : valueLevel(l),
      b === null ? "unknown" : b >= 8 ? "warm" : b <= -3 ? "cool" : "neutral",
      row.item.textureType
    ].join("/");
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }

  const queues = [...buckets.values()];
  const picked: T[] = [];
  const seenSeries = new Set<string>();
  let progressed = true;

  // 轮流从每个桶取一款；同系列只要一款，避免被同一花型的多个色号占满
  while (picked.length < limit && progressed) {
    progressed = false;
    for (const queue of queues) {
      if (picked.length >= limit) break;
      while (queue.length > 0) {
        const next = queue.shift()!;
        const series = next.item.factorySku.split("-")[0];
        if (seenSeries.has(series)) continue;
        seenSeries.add(series);
        picked.push(next.item);
        progressed = true;
        break;
      }
    }
  }

  // 轮取阶段因同系列去重而漏掉的，按贴合度补齐
  if (picked.length < limit) {
    const chosen = new Set(picked.map((item) => item.factorySku));
    for (const row of scored) {
      if (picked.length >= limit) break;
      if (chosen.has(row.item.factorySku)) continue;
      picked.push(row.item);
    }
  }

  return picked;
}

/** 取色不可信时的降级色域：放弃和谐过滤，只拦极端色 */
export function fallbackTarget(): HarmonyTarget {
  return {
    bLow: -30,
    bHigh: 30,
    lLow: 20,
    lHigh: 95,
    chromaSoft: CHROMA_HARD_LIMIT,
    chromaHard: CHROMA_HARD_LIMIT,
    reasons: { fallback: "房间取色不可信，已跳过和谐过滤，仅排除极端色" }
  };
}
