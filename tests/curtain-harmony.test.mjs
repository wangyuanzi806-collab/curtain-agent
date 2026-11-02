import assert from "node:assert/strict";
import test from "node:test";

const {
  harmonyTarget,
  assessRoomTrust,
  fallbackTarget,
  filterByHarmony,
  diversifyByHarmony,
  harmonyPenalty
} = await import("../src/lib/curtain-harmony.ts");

function sku(factorySku, colorLabL, colorLabB, colorChroma = Math.abs(colorLabB), textureType = "大肌理") {
  return { factorySku, colorLabL, colorLabB, colorChroma, textureType };
}

function room(overrides = {}) {
  return {
    colors: [{ rgb: [200, 190, 175], share: 1, y: 0.3, L: 76, a: 2, b: 8, C: 8.2, zone: "wall" }],
    roomB: 8,
    roomL: 74,
    wallL: 74,
    floorL: 60,
    maxC: 12,
    warmCoolSplit: 4,
    validRatio: 0.95,
    whiteBalance: "ref_white",
    whitePoint: [252, 250, 246],
    ...overrides
  };
}

test("暖底房间取暖调，冷底房间取冷调", () => {
  assert.ok(harmonyTarget(room({ roomB: 9 })).bLow >= 0, "暖房间的 b 下界不应为负");
  assert.ok(harmonyTarget(room({ roomB: -9 })).bHigh <= 2, "冷房间的 b 上界不应偏暖");

  const neutral = harmonyTarget(room({ roomB: 0 }));
  assert.ok(neutral.bLow < 0 && neutral.bHigh > 0, "中性房间应冷暖皆可");
});

test("浅墙房间必须允许浅色窗帘", () => {
  // 回归用例：曾用「最靠上的主簇」代表墙面，在全白厨房里选中了黑色窗框，
  // 算出墙面 L=8.2，色域变成 L[22,37]，给雪白厨房推深色窗帘。
  const target = harmonyTarget(room({ wallL: 74, roomL: 74 }));
  assert.ok(target.lHigh >= 70, `浅墙场景的明度上界应保持在浅色区，实际 ${target.lHigh}`);
  assert.ok(target.lLow <= 50, "浅墙场景不应把明度下界抬得过高");
});

test("明度区间同时容纳「略深求对比」与「同明度求统一」", () => {
  const target = harmonyTarget(room({ wallL: 80, roomL: 78, floorL: 70 }));
  assert.ok(target.lLow < 80, "应允许比墙面更深的窗帘");
  assert.ok(target.lHigh > 80, "也应允许与墙面同明度甚至略浅的窗帘");
});

test("地板偏深时抬高明度下界，避免空间下沉", () => {
  // 墙面为中等明度，此时墙面规则给出的下界较低，地板规则才可能成为约束；
  // 墙面很浅时下界本就更高，地板规则不产生额外影响，属预期行为。
  const shallow = harmonyTarget(room({ wallL: 55, roomL: 55, floorL: 70 }));
  const deep = harmonyTarget(room({ wallL: 55, roomL: 55, floorL: 20 }));
  assert.ok(deep.lLow > shallow.lLow, "深色地板应抬高窗帘明度下界");
  assert.ok(deep.reasons.floor, "应说明抬高下界的原因");
});

test("房间本身彩度高时窗帘让位，且彩度硬上限恒定", () => {
  const calm = harmonyTarget(room({ maxC: 10 }));
  const vivid = harmonyTarget(room({ maxC: 30 }));
  assert.ok(vivid.chromaSoft <= calm.chromaSoft, "房间彩度高时窗帘软上限应更严");
  assert.equal(vivid.chromaHard, 30, "彩度硬上限不随房间变化");
  assert.ok(vivid.chromaSoft <= vivid.chromaHard, "软上限不得超过硬上限");
});

test("彩度软上限不与冷暖区间自相矛盾", () => {
  // 彩度 C 恒 >= |b|，若要求 b>10 却又要求 C<9，条件永远无解，会直接筛出空集
  for (const roomB of [-20, -5, 0, 5, 20]) {
    const target = harmonyTarget(room({ roomB, maxC: 30 }));
    const minAbsB = Math.min(Math.abs(target.bLow), Math.abs(target.bHigh));
    assert.ok(
      target.chromaSoft >= minAbsB || target.chromaSoft === target.chromaHard,
      `roomB=${roomB} 时软上限 ${target.chromaSoft} 与 b 区间 [${target.bLow}, ${target.bHigh}] 矛盾`
    );
  }
});

test("冷暖分裂的房间取中间带做过渡", () => {
  const split = harmonyTarget(
    room({
      warmCoolSplit: 24,
      colors: [
        { rgb: [190, 160, 120], share: 0.4, y: 0.6, L: 70, a: 6, b: 22, C: 22.8, zone: "mid" },
        { rgb: [180, 185, 190], share: 0.4, y: 0.2, L: 74, a: -1, b: -2, C: 2.2, zone: "wall" }
      ]
    })
  );
  assert.ok(split.reasons.bridge, "应记录冷暖过渡的判断依据");
  assert.ok(split.bHigh - split.bLow <= 21, "过渡带应比默认区间更窄");
});

test("取色不可信时降级，且不再给出配色结论", () => {
  assert.equal(assessRoomTrust(room()).trusted, true);

  const lowValid = assessRoomTrust(room({ validRatio: 0.3 }));
  assert.equal(lowValid.trusted, false);
  assert.ok(lowValid.issues.length > 0);

  const polluted = assessRoomTrust(
    room({ colors: [{ rgb: [0, 0, 0], share: 0.4, y: 0.5, L: 40, a: 5, b: 55, C: 55, zone: "mid" }] })
  );
  assert.equal(polluted.trusted, false, "出现极端色簇应判为不可信");

  const skewed = assessRoomTrust(room({ whitePoint: [255, 220, 180] }));
  assert.equal(skewed.trusted, false, "参考白偏离过大应判为不可信");

  const fb = fallbackTarget();
  assert.equal(fb.chromaHard, 30, "降级后仍须拦截极端色");
  assert.ok(fb.reasons.fallback, "降级必须留下说明");
});

test("明度硬过滤要有真正的下界", () => {
  // 回归用例：容差曾是 25，叠加 lLow = wallL-32 后实际下界变成 wallL-57，
  // 墙面 L=91 的亮白卧室连 L=34 的深色都算"通过和谐筛查"。
  const target = harmonyTarget(room({ wallL: 91, roomL: 88, floorL: 79, roomB: 4 }));
  const kept = filterByHarmony(
    [sku("DEEP", 34, 6), sku("MID", 55, 6), sku("LIGHT", 82, 6)],
    target
  );
  const ids = kept.map((item) => item.factorySku);
  assert.ok(!ids.includes("DEEP"), `亮白房间不该放行 L=34 的深色，实际留下 ${ids.join("/")}`);
  assert.ok(ids.includes("LIGHT"), "浅色必须放行");
});

test("缺 Lab 数据的商品一律放行", () => {
  // 没有颜色读数不等于颜色不协调，不该因为数据没补齐就把商品判死
  const target = harmonyTarget(room());
  const kept = filterByHarmony(
    [{ factorySku: "NO-DATA", colorLabL: null, colorLabB: null, colorChroma: null, textureType: "" }],
    target
  );
  assert.equal(kept.length, 1);
});

test("分层前先按贴合度收口，不把明显偏离的桶带进候选池", () => {
  // 回归用例：分桶轮取只保证"每个桶都被取到"，不看这个桶偏离色域多远。
  // 亮白卧室的候选池曾因此混进 6 款 L≈37–43 的深色，
  // 而重排提示词又要求彼此不雷同，模型正好挑中它们。
  const target = harmonyTarget(room({ wallL: 91, roomL: 88, floorL: 79, roomB: 4 }));
  const pool = [];
  for (let i = 0; i < 40; i += 1) {
    pool.push(sku(`FIT-${i}`, 74 + (i % 12), 6 + (i % 5), 8, i % 2 ? "大肌理" : "小肌理/纯色"));
  }
  // 明度勉强够得着下界、但明显偏离的一批
  for (let i = 0; i < 10; i += 1) {
    pool.push(sku(`FAR-${i}`, 48 + (i % 3), 5, 6, i % 2 ? "大肌理" : "小肌理/纯色"));
  }

  const picked = diversifyByHarmony(filterByHarmony(pool, target), target, 40);
  assert.equal(picked.length, 40, "候选池必须被填满");
  const worst = Math.max(...picked.map((item) => harmonyPenalty(item, target)));
  assert.ok(worst <= 1, `候选池不该出现 penalty>1 的商品，最差 ${worst.toFixed(2)}`);
});

test("候选不足时宁可放宽也不能让池子空掉", () => {
  // 协调只做减法，且绝不导致推荐失败
  const target = harmonyTarget(room({ wallL: 91, roomL: 88, floorL: 79, roomB: 4 }));
  const tiny = [sku("A", 80, 6), sku("B", 76, 8, 8, "小肌理/纯色"), sku("C", 71, 4)];
  const picked = diversifyByHarmony(tiny, target, 40);
  assert.equal(picked.length, 3, "池子只有 3 款时应全部保留");
  assert.ok(
    harmonyPenalty(picked[0], target) <= harmonyPenalty(picked[2], target),
    "仍须按贴合度排序"
  );
});

test("同一系列不会占满候选池", () => {
  const target = harmonyTarget(room());
  const pool = [];
  for (let i = 1; i <= 20; i += 1) pool.push(sku(`AD91034-${String(i).padStart(2, "0")}`, 74, 8));
  for (let i = 1; i <= 5; i += 1) pool.push(sku(`W6650-0${i}`, 73, 7, 7, "小肌理/纯色"));
  const picked = diversifyByHarmony(pool, target, 6);
  const series = picked.slice(0, 2).map((item) => item.factorySku.split("-")[0]);
  assert.equal(new Set(series).size, 2, "前两款不该来自同一系列");
});
