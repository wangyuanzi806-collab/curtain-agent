import sharp from "sharp";

/**
 * 房间场景取色：从用户上传的房间照片里分离出墙面、地板和主要家具的颜色，
 * 输出和谐推荐所需的 Lab 指标。
 *
 * 全部是传统 CV（阈值 + 形态学 + KMeans），不调用任何模型。
 * 颜色是物理量，模型回答"米白色"不如代码给出 L=88.2 / a=1.1 / b=6.4 可用。
 */

const MAX_SIDE = 640;
const CLUSTER_COUNT = 5;
const SAMPLE_LIMIT = 30000;

export type RoomZone = "wall" | "mid" | "floor";

export type RoomColorCluster = {
  rgb: [number, number, number];
  share: number;
  /** 该簇像素的垂直重心，0 = 画面顶部，1 = 底部 */
  y: number;
  L: number;
  a: number;
  b: number;
  C: number;
  zone: RoomZone;
};

export type RoomColorAnalysis = {
  colors: RoomColorCluster[];
  /** 房间整体冷暖底调，正值偏暖 */
  roomB: number;
  roomL: number;
  /** 墙面明度，决定窗帘的明度区间 */
  wallL: number;
  /** 地板明度，偏暗时窗帘不能跟着沉下去 */
  floorL: number;
  maxC: number;
  /** 主要色块之间 b 的极差，用于判断冷暖分裂 */
  warmCoolSplit: number;
  /** 排除窗户后剩余的有效区占比 */
  validRatio: number;
  whiteBalance: "ref_white" | "gray_world";
  whitePoint: [number, number, number];
};

function srgbToLab(r: number, g: number, b: number): [number, number, number] {
  const linear = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const R = linear(r);
  const G = linear(g);
  const B = linear(b);

  // sRGB → XYZ (D65)，再按 D65 白点归一
  const x = (R * 0.4124564 + G * 0.3575761 + B * 0.180437) / 0.95047;
  const y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  const z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883;

  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((m, n) => m - n);
  const idx = (sorted.length - 1) * (p / 100);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** 7x7 膨胀，拆成横竖两趟。用来吃掉窗框周围的光晕 */
function dilate(mask: Uint8Array, width: number, height: number, radius: number) {
  const pass = (src: Uint8Array, horizontal: boolean) => {
    const out = new Uint8Array(src.length);
    const outer = horizontal ? height : width;
    const inner = horizontal ? width : height;
    for (let o = 0; o < outer; o += 1) {
      for (let i = 0; i < inner; i += 1) {
        let hit = 0;
        for (let d = -radius; d <= radius && !hit; d += 1) {
          const k = i + d;
          if (k < 0 || k >= inner) continue;
          hit = src[horizontal ? o * width + k : k * width + o];
        }
        out[horizontal ? o * width + i : i * width + o] = hit;
      }
    }
    return out;
  };
  return pass(pass(mask, true), false);
}

function makeRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function distance(a: number[], b: number[]) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

/** KMeans，k-means++ 初始化 + 固定种子，保证同一张图每次结果一致 */
function kmeans(points: number[][], k: number, iterations = 30) {
  const random = makeRandom(0);
  const centers: number[][] = [points[Math.floor(random() * points.length)]];

  while (centers.length < k) {
    const weights = points.map((p) => Math.min(...centers.map((c) => distance(p, c))));
    const total = weights.reduce((sum, w) => sum + w, 0);
    let target = random() * total;
    let picked = points.length - 1;
    for (let i = 0; i < weights.length; i += 1) {
      target -= weights[i];
      if (target <= 0) {
        picked = i;
        break;
      }
    }
    centers.push(points[picked]);
  }

  const labels = new Int32Array(points.length);
  for (let iter = 0; iter < iterations; iter += 1) {
    let moved = false;
    for (let i = 0; i < points.length; i += 1) {
      let best = 0;
      let bestDist = Infinity;
      for (let c = 0; c < centers.length; c += 1) {
        const d = distance(points[i], centers[c]);
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      if (labels[i] !== best) {
        labels[i] = best;
        moved = true;
      }
    }
    if (!moved && iter > 0) break;

    const sums = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < points.length; i += 1) {
      const s = sums[labels[i]];
      s[0] += points[i][0];
      s[1] += points[i][1];
      s[2] += points[i][2];
      s[3] += 1;
    }
    for (let c = 0; c < centers.length; c += 1) {
      if (sums[c][3] === 0) continue;
      centers[c] = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]];
    }
  }

  return { centers, labels };
}

export async function analyzeRoomColor(
  input: Buffer | Uint8Array
): Promise<RoomColorAnalysis> {
  const { data, info } = await sharp(input)
    .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: false })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const total = width * height;
  const gray = new Float32Array(total);
  const sat = new Float32Array(total);

  for (let i = 0; i < total; i += 1) {
    const r = data[i * 3];
    const g = data[i * 3 + 1];
    const b = data[i * 3 + 2];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    sat[i] = max === 0 ? 0 : (max - min) / max;
  }

  // 1) 排除窗户和窗外：过曝，或者又亮又饱和（天空、绿植）
  //    窗外的颜色会把整个房间的冷暖判断带偏
  const overexposed = new Uint8Array(total);
  const windowish = new Uint8Array(total);
  for (let i = 0; i < total; i += 1) {
    overexposed[i] = gray[i] >= 246 ? 1 : 0;
    windowish[i] = overexposed[i] || (sat[i] > 0.45 && gray[i] > 170) ? 1 : 0;
  }

  const dilated = dilate(windowish, width, height, 3);
  let valid = new Uint8Array(total);
  let validCount = 0;
  for (let i = 0; i < total; i += 1) {
    valid[i] = dilated[i] ? 0 : 1;
    validCount += valid[i];
  }
  if (validCount / total < 0.25) {
    valid = new Uint8Array(total);
    validCount = 0;
    for (let i = 0; i < total; i += 1) {
      valid[i] = overexposed[i] ? 0 : 1;
      validCount += valid[i];
    }
  }

  // 2) 白平衡：参考白取有效区里最亮且低饱和的像素，通常是天花板或白墙。
  //    暖光房间下这一步会失效，调用方需要结合 validRatio 和 whitePoint 判断可信度。
  const validGray: number[] = [];
  for (let i = 0; i < total; i += 1) if (valid[i]) validGray.push(gray[i]);
  const grayP70 = percentile(validGray, 70);

  const refR: number[] = [];
  const refG: number[] = [];
  const refB: number[] = [];
  for (let i = 0; i < total; i += 1) {
    if (!valid[i] || sat[i] >= 0.12 || gray[i] <= grayP70) continue;
    refR.push(data[i * 3]);
    refG.push(data[i * 3 + 1]);
    refB.push(data[i * 3 + 2]);
  }

  let whiteBalance: RoomColorAnalysis["whiteBalance"];
  let whitePoint: [number, number, number];
  if (refR.length > 300) {
    whiteBalance = "ref_white";
    whitePoint = [percentile(refR, 60), percentile(refG, 60), percentile(refB, 60)];
  } else {
    whiteBalance = "gray_world";
    let sr = 0;
    let sg = 0;
    let sb = 0;
    for (let i = 0; i < total; i += 1) {
      if (!valid[i]) continue;
      sr += data[i * 3];
      sg += data[i * 3 + 1];
      sb += data[i * 3 + 2];
    }
    const mean: [number, number, number] = [sr / validCount, sg / validCount, sb / validCount];
    const peak = Math.max(...mean) || 1;
    whitePoint = [(mean[0] / peak) * 255, (mean[1] / peak) * 255, (mean[2] / peak) * 255];
  }
  whitePoint = whitePoint.map((v) => Math.min(255, Math.max(140, v))) as [number, number, number];

  // 3) 主色聚类，同时留住每个像素的垂直位置
  const points: number[][] = [];
  const rows: number[] = [];
  const step = Math.max(1, Math.floor(validCount / SAMPLE_LIMIT));
  let seen = 0;
  for (let i = 0; i < total; i += 1) {
    if (!valid[i]) continue;
    seen += 1;
    if (seen % step !== 0) continue;
    points.push([
      Math.min(255, (data[i * 3] * 255) / whitePoint[0]),
      Math.min(255, (data[i * 3 + 1] * 255) / whitePoint[1]),
      Math.min(255, (data[i * 3 + 2] * 255) / whitePoint[2])
    ]);
    rows.push(Math.floor(i / width));
  }

  const { centers, labels } = kmeans(points, CLUSTER_COUNT);

  const colors: RoomColorCluster[] = [];
  for (let c = 0; c < centers.length; c += 1) {
    let count = 0;
    let ySum = 0;
    for (let i = 0; i < labels.length; i += 1) {
      if (labels[i] !== c) continue;
      count += 1;
      ySum += rows[i];
    }
    if (count < 50) continue;

    const rgb: [number, number, number] = [
      Math.round(centers[c][0]),
      Math.round(centers[c][1]),
      Math.round(centers[c][2])
    ];
    const [L, a, b] = srgbToLab(rgb[0], rgb[1], rgb[2]);
    const yRel = ySum / count / height;

    colors.push({
      rgb,
      share: count / labels.length,
      y: Number(yRel.toFixed(2)),
      L: Number(L.toFixed(1)),
      a: Number(a.toFixed(1)),
      b: Number(b.toFixed(1)),
      C: Number(Math.hypot(a, b).toFixed(1)),
      // 4) 语义靠垂直重心猜。粗糙但够用，下游只需要知道墙面大概多亮
      zone: yRel < 0.42 ? "wall" : yRel > 0.66 ? "floor" : "mid"
    });
  }
  colors.sort((m, n) => n.share - m.share);

  // 5) 房间聚合指标
  const weight = colors.reduce((sum, c) => sum + c.share, 0) || 1;
  const significant = colors.filter((c) => c.share > 0.08);
  const bValues = (significant.length > 1 ? significant : colors).map((c) => c.b);

  // 墙面明度：按高度平滑加权，越靠上权重越高，0.7 以下不计。
  // 不用 zone 硬切，是因为簇的垂直重心常落在阈值附近来回跳，
  // 归属一翻转，墙面明度就能差出十几个 L，进而把整个明度区间带偏。
  const weighted = (w: (y: number) => number) => {
    const total = colors.reduce((sum, c) => sum + c.share * w(c.y), 0);
    return total > 0
      ? colors.reduce((sum, c) => sum + c.L * c.share * w(c.y), 0) / total
      : colors.reduce((sum, c) => sum + c.L * c.share, 0) / weight;
  };
  const wallL = weighted((y) => Math.min(1, Math.max(0, (0.7 - y) / 0.7)));
  const floorL = weighted((y) => Math.min(1, Math.max(0, (y - 0.45) / 0.55)));

  return {
    colors,
    roomB: Number((colors.reduce((sum, c) => sum + c.b * c.share, 0) / weight).toFixed(1)),
    roomL: Number((colors.reduce((sum, c) => sum + c.L * c.share, 0) / weight).toFixed(1)),
    wallL: Number(wallL.toFixed(1)),
    floorL: Number(floorL.toFixed(1)),
    maxC: Number(Math.max(...colors.map((c) => c.C)).toFixed(1)),
    warmCoolSplit:
      bValues.length > 1 ? Number((Math.max(...bValues) - Math.min(...bValues)).toFixed(1)) : 0,
    validRatio: Number((validCount / total).toFixed(2)),
    whiteBalance,
    whitePoint: whitePoint.map((v) => Number(v.toFixed(1))) as [number, number, number]
  };
}

/**
 * 把取色数值翻成助手能说出口的话。
 *
 * 助手拿到的**只有这三句**——它仍然看不见照片，也就仍然不能说房间里有什么家具、
 * 窗户朝哪边。给数值而不给图，正是为了让它的每一句都能追溯到一个测出来的量。
 * 阈值是 CIELAB 的 L 与 b，取的是保守分界，实拍多了应该回来调。
 *
 * 两条路共用：顾问在店里拍的（/api/voice/photo），和顾客扫码从自己手机传的
 * （/api/voice/upload/[token]）。同一张照片不该因为从哪儿进来而被说成两个样子。
 */
export function describeRoom(analysis: { wallL: number; floorL: number; roomB: number }) {
  const level = (l: number) => (l >= 72 ? "light" : l >= 50 ? "mid-toned" : "dark");
  // 室内照几乎总有暖光源，b 落在 5 上下很常见——只设 warm/neutral 两档会把
  // 明显偏暖的白墙判成中性。中间加一档，数值照旧带着，模型自己也看得到原始值。
  const tone =
    analysis.roomB > 8
      ? "warm"
      : analysis.roomB > 3
        ? "slightly warm"
        : analysis.roomB < -2
          ? "cool"
          : "neutral";
  return {
    wall: `${level(analysis.wallL)} (L=${Math.round(analysis.wallL)})`,
    floor: `${level(analysis.floorL)} (L=${Math.round(analysis.floorL)})`,
    undertone: `${tone} (b=${analysis.roomB.toFixed(1)})`,
    guidance:
      "These three readings come from the photo the salesperson just took; they are measured, " +
      "not described. You still cannot see the image. Use them — say the wall reads as a warm " +
      "light tone, or that the floor is dark so a very dark curtain would sink into it — but " +
      "never claim anything the readings do not contain: no furniture, no window, no direction " +
      "the room faces, no style. Ask the customer about those instead."
  };
}
