import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  }
});

const {
  EMPTY_ANSWERS,
  filterBySurvey,
  countBySurvey,
  suggestRelaxation,
  evaluateSurvey,
  describeSurvey
} = await import("../src/lib/curtain-survey.ts");

function sku(overrides = {}) {
  return {
    sku_id: "T-01",
    name: "测试",
    brand: "RoyalZen",
    collection: "T",
    product_type: "standard",
    opacity: "unspecified",
    color: "beige",
    mounting: "unknown",
    layer_type: "single",
    price_band: "mid",
    style_tags: "",
    window_types: "标准窗",
    page_url: "",
    image_url: "https://images.royalzenliving.com/x.webp",
    local_image: "",
    source: "sku_material",
    usage_note: "",
    weight_gsm: 320,
    texture_type: "大肌理",
    material_type: "main",
    color_lab_l: 70,
    color_lab_b: 10,
    color_chroma: 10,
    color_family: "warm",
    material_class: "cotton_linen",
    value_level: "light",
    pattern_level: "pattern",
    natural_fiber_pct: 60,
    ...overrides
  };
}

const catalog = [
  sku({ sku_id: "A-01", color_family: "warm", value_level: "light", material_class: "cotton_linen", pattern_level: "pattern" }),
  sku({ sku_id: "B-01", color_family: "warm", value_level: "deep", material_class: "wool", pattern_level: "solid" }),
  sku({ sku_id: "C-01", color_family: "gray", value_level: "light", material_class: "polyester_smooth", pattern_level: "pattern" }),
  sku({ sku_id: "D-01", color_family: "gray", value_level: "medium", material_class: "blend", pattern_level: "texture" }),
  sku({ sku_id: "E-01", color_family: "sage", value_level: "medium", material_class: "viscose_soft", pattern_level: "pattern" }),
  sku({ sku_id: "F-01", color_family: "warm", value_level: "light", material_class: "wool", pattern_level: "solid", material_type: "sheer" })
];

test("不作答时不筛掉任何商品", () => {
  assert.equal(countBySurvey(catalog, EMPTY_ANSWERS), catalog.length);
});

test("颜色与深浅可多选，命中其一即可", () => {
  const byColor = filterBySurvey(catalog, { ...EMPTY_ANSWERS, colors: ["warm", "sage"] });
  assert.deepEqual(byColor.map((i) => i.sku_id).sort(), ["A-01", "B-01", "E-01", "F-01"]);

  const byValue = filterBySurvey(catalog, { ...EMPTY_ANSWERS, valueLevels: ["deep", "medium"] });
  assert.deepEqual(byValue.map((i) => i.sku_id).sort(), ["B-01", "D-01", "E-01"]);
});

test("花纹按视觉观感分三档", () => {
  const solid = filterBySurvey(catalog, { ...EMPTY_ANSWERS, texture: "solid" });
  assert.deepEqual(solid.map((i) => i.sku_id).sort(), ["B-01", "F-01"]);

  const texture = filterBySurvey(catalog, { ...EMPTY_ANSWERS, texture: "texture" });
  assert.deepEqual(texture.map((i) => i.sku_id).sort(), ["D-01"]);

  const pattern = filterBySurvey(catalog, { ...EMPTY_ANSWERS, texture: "pattern" });
  assert.deepEqual(pattern.map((i) => i.sku_id).sort(), ["A-01", "C-01", "E-01"]);
});

test("布纱选择只按材质类型分，双层不在商品侧收窄", () => {
  const cloth = filterBySurvey(catalog, { ...EMPTY_ANSWERS, fabricType: "cloth" });
  assert.equal(cloth.every((i) => i.material_type !== "sheer"), true);

  const sheer = filterBySurvey(catalog, { ...EMPTY_ANSWERS, fabricType: "sheer" });
  assert.deepEqual(sheer.map((i) => i.sku_id), ["F-01"]);

  // 双层需要布和纱各一件，单款无法满足，故不在此收窄
  assert.equal(countBySurvey(catalog, { ...EMPTY_ANSWERS, fabricType: "layered" }), catalog.length);
});

test("只有「不要花的」是硬约束，其余标签不筛商品", () => {
  const noPattern = filterBySurvey(catalog, { ...EMPTY_ANSWERS, tags: ["no_pattern"] });
  assert.deepEqual(noPattern.map((i) => i.sku_id).sort(), ["B-01", "D-01", "F-01"]);

  for (const tag of ["thick", "prefer_natural", "easy_care", "want_light_color"]) {
    assert.equal(
      countBySurvey(catalog, { ...EMPTY_ANSWERS, tags: [tag] }),
      catalog.length,
      `${tag} 是倾向不是要求，不该筛掉商品`
    );
  }
});

test("遮光诉求不参与硬过滤", () => {
  // 实测三档几乎等于全集，占一个硬筛位只会误伤
  for (const need of ["keep_light", "day_privacy", "dark_sleep", "max_block"]) {
    assert.equal(countBySurvey(catalog, { ...EMPTY_ANSWERS, opacityNeed: need }), catalog.length);
  }
});

test("放宽建议指向增量最大的那一项", () => {
  const answers = { ...EMPTY_ANSWERS, colors: ["sage"], materials: ["viscose_soft"], texture: "solid" };
  assert.equal(countBySurvey(catalog, answers), 0);

  const hint = suggestRelaxation(catalog, answers);
  assert.ok(hint, "无结果时必须给出可操作的下一步");
  assert.equal(hint.facet, "texture", `应指向花纹，实际指向 ${hint.facet}`);
  assert.equal(hint.countAfter, 1);
});

test("没设条件的维度不会被当成放宽对象", () => {
  const hint = suggestRelaxation(catalog, { ...EMPTY_ANSWERS, colors: ["pink"] });
  assert.equal(hint?.facet, "colors");
});

test("零结果必须拦截并说明放宽哪一项", () => {
  const blocked = evaluateSurvey(catalog, {
    ...EMPTY_ANSWERS,
    colors: ["sage"],
    materials: ["viscose_soft"],
    texture: "solid"
  });
  assert.equal(blocked.level, "blocked");
  assert.equal(blocked.count, 0);
  assert.match(blocked.message, /放宽/);
  assert.ok(blocked.relaxation);
});

test("剩余充足时不提示放宽", () => {
  const many = evaluateSurvey(Array.from({ length: 120 }, (_, i) => sku({ sku_id: `X-${i}` })), EMPTY_ANSWERS);
  assert.equal(many.level, "plenty");
  assert.equal(many.relaxation, null);
});

test("剩余偏少时给出数量与建议", () => {
  const few = evaluateSurvey(catalog, { ...EMPTY_ANSWERS, colors: ["gray"] });
  assert.equal(few.count, 2);
  assert.equal(few.level, "few");
  assert.match(few.message, /2 款/);
});

test("六题答案要能翻成模型读得懂的中文", () => {
  // 回归用例：这一步缺失时，重排只能看到前端写死的占位符，
  // 五张卡片的「满足了你的选择」就都成了同一句"兼顾采光与隐私"。
  const described = describeSurvey({
    ...EMPTY_ANSWERS,
    opacityNeed: "dark_sleep",
    colors: ["gray", "sage"],
    valueLevels: ["light"],
    texture: "solid",
    materials: ["cotton_linen"],
    tags: ["no_pattern", "easy_care"],
    note: "家里木色重"
  });

  assert.equal(described["颜色"], "灰中性、灰绿");
  assert.equal(described["深浅"], "浅");
  assert.equal(described["花纹"], "素净、看不出花纹");
  assert.equal(described["质感"], "棉麻自然感");
  assert.equal(described["采光与隐私"], "睡觉要够暗");
  assert.equal(described["附加要求"], "不要花的、好打理");
  assert.equal(described["补充说明"], "家里木色重");

  for (const value of Object.values(described)) {
    assert.doesNotMatch(value, /[a-z_]{4,}/, `不该把英文枚举漏给模型：${value}`);
  }
});

test("没答的题不进提示词", () => {
  assert.deepEqual(describeSurvey(EMPTY_ANSWERS), {});
  const onlyColor = describeSurvey({ ...EMPTY_ANSWERS, colors: ["warm"] });
  assert.deepEqual(Object.keys(onlyColor), ["颜色"]);
});

test("色板按格子筛，点两格不该命中四格", () => {
  // 老板点了「暖色·浅」和「灰色·中」两格，界面上却有四格亮起来。
  // 根因是色族和深浅存成两条独立清单、各判各的再 AND：
  // 色族∈{warm,gray} 且 深浅∈{light,medium} —— 于是 gray/light 也满足，等于笛卡尔积。
  const cells = filterBySurvey(catalog, {
    ...EMPTY_ANSWERS,
    colorCells: ["warm/light", "gray/medium"],
    // 两条投影仍然会一起传过来，不能让它们把范围又放回去
    colors: ["warm", "gray"],
    valueLevels: ["light", "medium"]
  });
  // C-01 是 gray/light：两条清单都对得上，但客户没点过这一格
  assert.deepEqual(cells.map((i) => i.sku_id).sort(), ["A-01", "D-01", "F-01"]);

  // 没有格子时（老答案、或别处只填了清单）仍走原来的两条清单口径
  const legacy = filterBySurvey(catalog, {
    ...EMPTY_ANSWERS,
    colors: ["warm", "gray"],
    valueLevels: ["light", "medium"]
  });
  assert.deepEqual(legacy.map((i) => i.sku_id).sort(), ["A-01", "C-01", "D-01", "F-01"]);
});

test("放宽颜色要连格子一起清，否则筛选照旧收窄", () => {
  const answers = { ...EMPTY_ANSWERS, colorCells: ["warm/light"], colors: ["warm"], valueLevels: ["light"] };
  assert.equal(countBySurvey(catalog, answers), 2);
  const relaxed = suggestRelaxation(catalog, answers);
  assert.ok(relaxed, "应当给得出放宽建议");
  assert.equal(relaxed.facet, "colors");
  // 只清 colors 而留着 colorCells 的话，这里还是 2，等于放宽了个寂寞
  assert.equal(relaxed.countAfter, catalog.length, "放宽颜色后应当回到全量");
});
