import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

const { buildChoiceGroup, describeChoice, tasteToRecommendationArgs, CHOICE_KINDS } = await import(
  "../src/lib/voice-choices.ts"
);

/**
 * 需求挖掘链路的回归。
 *
 * 这一整套是为了修 2026-08-04 老板的两句话:「我图片才刚发,你的推荐产品就到了」
 * 和「用户不知道什么是纯色…你要把面料图呈现给用户让他选」。
 * 下面每一条都对着其中一句。
 */

test("选项卡的图必须真的存在,否则顾客看到的是一排破图", async () => {
  for (const kind of CHOICE_KINDS) {
    if (kind === "colour") continue; // 颜色是色块，且要连库，这里不测
    const group = await buildChoiceGroup(kind);
    assert.ok(group.choices.length >= 2, `${kind} 至少要有两个选项，一个不叫选择`);
    for (const choice of group.choices) {
      assert.ok(choice.label && choice.hint, `${kind}/${choice.id} 缺少文字说明`);
      if (!choice.image) continue;
      // 图必须落在 public/facets 下，那十张是人工挑的、居中裁成 480×480 的面料细节图
      const path = new URL(`../public/facets/${choice.image}.webp`, import.meta.url);
      assert.doesNotThrow(
        () => readFileSync(path),
        `${kind}/${choice.id} 指向的 public/facets/${choice.image}.webp 不存在`
      );
    }
  }
});

test("一屏最多三张图:越说不出想要什么的顾客,一次能看的图越少", async () => {
  // Townsend & Kahn 2014(JCR):视觉是「更快但更随意」的格式塔加工,选项集一大,
  // 图片反而比文字造成更严重的选择过载。第一版给了五张,正好把最多的图
  // 塞给最没把握的那个人——反直觉,所以要用测试钉住。
  for (const kind of ["feel", "pattern", "layer"]) {
    const group = await buildChoiceGroup(kind);
    const withImages = group.choices.filter((c) => c.image).length;
    assert.ok(withImages <= 3, `${kind} 一次给了 ${withImages} 张图,超过三张`);
    assert.ok(group.choices.length >= 2, `${kind} 只有一个选项,不叫选择`);
  }
  // 但剩下的不能丢:顾客说「都不太对」时要给得出第二轮
  const round1 = await buildChoiceGroup("feel", 1);
  const round2 = await buildChoiceGroup("feel", 2);
  assert.ok(round2.choices.length > 0, "第二轮必须给得出剩下的质感");
  // 「我也说不好」每轮都在,它不是面料——比对重复时要把它排除掉
  const ids1 = round1.choices.filter((c) => c.id !== "any").map((c) => c.id);
  assert.ok(
    round2.choices.filter((c) => c.id !== "any").every((c) => !ids1.includes(c.id)),
    "第二轮不该重复第一轮已经给过的"
  );
});

test("颜色不受三张封顶的限制:色块是单维度,面料才是多维", async () => {
  // Chernev 2015 的调节变量里「选项难比较」是关键:一块布同时有质感、垂感、
  // 厚度、颜色好几维;颜色一眼扫完就知道喜欢哪个。一刀切成三个会把颜色题砍残。
  const light = await buildChoiceGroup("light");
  const real = light.choices.filter((c) => c.id !== "any");
  assert.equal(real.length, 4, "光线是纯文字选项,不该被图片规则砍掉");
});

test("每一组都多一张「我也说不好」:不知道不能是死胡同", async () => {
  /*
   * 老板 08-04 要求的。顾客答不上来时,助手换个说法再问一遍,他更答不上来——
   * 而那正是让人觉得自己很蠢的问法。给它一张卡,「不知道」就从死胡同变成
   * **一个有明确后果的选项**:点了等于说「你帮我定」,而后果也要说出来。
   * 等价于网页问卷每题的「都可以」。
   */
  for (const kind of ["feel", "pattern", "layer", "light"]) {
    const group = await buildChoiceGroup(kind);
    const out = group.choices.find((c) => c.id === "any");
    assert.ok(out, `${kind} 少了「我也说不好」那一张,顾客答不上来时就只能卡住`);
    assert.ok(out.hint, `${kind} 的「我也说不好」没说清点了会怎样——那还是个死胡同`);
  }
});

test("「我也说不好」不能当成一个筛选条件传下去", () => {
  /*
   * 它对顾客是有效回答,对筛选器不是。原样传下去,推荐参数里会出现
   * 「我也说不好（这一题交给你定）」这句中文文案,下游拿它去匹配面料,
   * 等于凭空多了一个谁都不满足的条件。
   */
  const args = tasteToRecommendationArgs({ feel: ["any"], pattern: ["any"], colour: ["any"] });
  assert.equal(args.feel, "", "「说不好」漏进了质感参数");
  assert.equal(args.pattern, "", "「说不好」漏进了花纹参数");
  assert.equal(args.colour, "", "「说不好」漏进了颜色参数");
  // 但真答了的还要在
  assert.match(tasteToRecommendationArgs({ feel: ["wool", "any"] }).feel, /羊毛/);
});

test("光线一组故意不配图:遮光是体感,任何照片都在替顾客定义暗到什么程度", async () => {
  const group = await buildChoiceGroup("light");
  for (const choice of group.choices) {
    assert.equal(choice.image, undefined, `light/${choice.id} 不该有图`);
  }
});

test("点击要能翻译成人话,拿 id 回去说话等于没说", () => {
  assert.match(describeChoice("feel", "cotton_linen"), /棉麻/);
  assert.match(describeChoice("pattern", "solid"), /素净/);
  // 不认识的 id 至少原样返回，不能变成 undefined 塞进对话
  assert.equal(describeChoice("feel", "not_a_real_id"), "not_a_real_id");
});

test("顾客指的和嘴上说的进同一个漏斗", () => {
  const args = tasteToRecommendationArgs({
    feel: ["cotton_linen"],
    light: ["dark_sleep"],
    pattern: ["solid"]
  });
  assert.match(args.feel, /棉麻/, "点过的质感必须进推荐参数");
  assert.match(args.opacity, /睡觉要够暗/, "点过的光线需求必须进推荐参数");
  assert.match(args.pattern, /素净/);
  // 什么都没点时给空串而不是 undefined —— 拼进提示词会变成字面的 "undefined"
  assert.equal(tasteToRecommendationArgs({}).feel, "");
});

test("推荐闸门:拦的是候选池没收窄，不是「问到了几件事」", () => {
  const source = readFileSync("src/lib/voice-tools.ts", "utf8");
  const body = source.slice(
    source.indexOf("async function runRecommendForRoom"),
    source.indexOf("export async function runVoiceTool")
  );

  /*
   * ── 这条测试原本守的是一个已经被推翻的设计 ──
   *
   * 旧版闸门要求三件事:哪个房间、光线上要什么、一个口味信号。
   * 老板 08-04 打回:「你说的几个必要的东西,是不是真的必要,能不能筛出产品,
   * 我是打问号的,感觉你完全没有去了解我们的推荐逻辑。」
   *
   * 去读 filterBySurvey 的 FACET_MATCHERS 才发现他是对的:能筛掉货的只有六项,
   * 而「哪个房间」和「光线上要什么」**一款货都筛不掉**——网页问卷那道题下面
   * 原文就写着「会写进推荐说明,但不筛掉商品」。
   *
   * 所以旧闸门拦住了本来能跑通的链路,又没拦住真正的问题。别把它改回去。
   */
  assert.doesNotMatch(
    body,
    /missingForRecommendation/,
    "那三个必填项又回来了。先读 SPEC §2.3:「哪个房间」和「光线需求」一款货都筛不掉"
  );

  // 没照片仍然不出货——没有它,链路会退化成按目录顺序取前五款,
  // 那正是「我图片才刚发,你的推荐产品就到了」的来源
  assert.match(body, /status: "no_photo"/, "没照片时必须回一个明确的状态");
  assert.ok(
    body.indexOf('status: "no_photo"') < body.indexOf("runAgentRecommendation("),
    "没照片的判断必须挡在出货之前"
  );

  /*
   * **顾客点过的要真的去筛货。**
   * 这里以前传 survey: null,后果是顾客在屏幕上点的每一张卡最后只变成
   * 提示词里的一句话,一款货都筛不掉——「我要羊毛的」和什么都没说,
   * 候选池是同一个。这一条是这次改造的核心。
   */
  assert.match(body, /const survey = tasteToAnswers\(taste\)/, "点过的选项没有翻成问卷答案");
  assert.match(body, /^\s*survey,?\s*$/m, "survey 没有传给 runAgentRecommendation");
  // 剥掉注释再判断：注释里引用旧写法（"这里以前传 survey: null"）是在解释为什么改，要留着
  const code = body.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  assert.doesNotMatch(code, /survey:\s*null/, "又传回 null 了,点过的卡等于白点");

  // 拒绝这件事顾客永远不该听见
  // 这句在源码里跨了字符串拼接的换行，只能匹配不跨行的那半截
  assert.match(
    source,
    /that a tool refused/i,
    "工具描述里必须写明:顾客不能听到工具拒绝了"
  );
});

test("search_products 的结果不许当推荐卡上屏", () => {
  const source = readFileSync("src/components/royalzen/voice-console.tsx", "utf8");
  // 秒推的真凶就是这一行：模型为了让屏幕上快点有东西，拿参数全 any 的查询当推荐用
  assert.doesNotMatch(
    source,
    /item\.name === "search_products"[\s\S]{0,200}setCaptions/,
    "search_products 的结果又被渲染成产品卡了——这正是「图片刚发推荐就到」的来源"
  );
  assert.match(source, /item\.name === "offer_choices"/, "选项卡必须能上屏");
});

test("绝不能对顾客说「我看不到图片」", () => {
  const console_ = readFileSync("src/components/royalzen/voice-console.tsx", "utf8");
  const note = console_.slice(
    console_.indexOf("const note = {"),
    console_.indexOf("// 顾客递过手机说")
  );
  /*
   * 剥掉注释再看（注释里引用旧文案是在解释「为什么改」，要留着），
   * 并且**逐句**判断：「你看不到这张图」是陈述，要禁；
   * 「绝不要说你看不到这张图」是禁令，正是我们要的。
   * 差别只在同一句里有没有 never/not/don't——所以必须按句切，
   * 整段一起匹配的话，后面那句禁令会把前面的陈述洗白。
   *
   * 前两版都因为写法不对而假绿：整段匹配被禁令洗白，改成提取字符串字面量后
   * 又被前面几个短字符串（"message"、"user"）打乱了引号配对。
   * **这条断言改动后必须故意改坏一次源码，确认它会红。**
   */
  const spoken = note.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  for (const sentence of spoken.split(/(?<=[.!?])\s+/)) {
    if (!/cannot see (the |this )?(image|photo)/i.test(sentence)) continue;
    assert.match(
      sentence,
      /\b(never|not|don't|do not)\b/i,
      `照片简报又在教模型说「我看不到图片」：${sentence.slice(0, 120)}`
    );
  }
  assert.match(note, /first person/i, "照片简报必须要求用第一人称说出观察");
  assert.match(note, /never say you cannot see|Never tell the customer you cannot/i);
});

test("会话与咨询单都要留,且新端点照样先认人", () => {
  for (const path of ["src/app/api/voice/sessions/route.ts", "src/app/api/voice/taste/route.ts"]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /getCurrentActor\(\)/, `${path} 缺少鉴权`);
    assert.match(source, /apiError\(/, `${path} 的 catch 必须走 apiError`);
  }
  const sessions = readFileSync("src/lib/voice-sessions.ts", "utf8");
  // 组织边界:每一条查询都必须带 organization_id，否则别家的会话会串过来
  const queries = sessions.match(/`[^`]*(select|update|insert)[^`]*`/gi) ?? [];
  for (const query of queries) {
    if (!/voice_sessions/i.test(query)) continue;
    assert.match(query, /organization_id/, `这条查询没有组织边界:\n${query.slice(0, 160)}`);
  }
});

test("转录落库不能是逐句发:门店 wifi 上会把数据通道挤住", () => {
  const source = readFileSync("src/components/royalzen/voice-console.tsx", "utf8");
  const queue = source.slice(source.indexOf("const queueTurn"), source.indexOf("// ---- 音量表"));
  assert.match(queue, /setTimeout/, "转录必须攒批再发");
  assert.match(queue, /pendingTurnsRef/, "攒批要有缓冲区");
});

test("改话术的脚本必须幂等且可回滚", () => {
  const v2 = readFileSync("scripts/voice-instructions-v2.mjs", "utf8");
  // 话术的真源在库里，改坏了必须能一条语句回滚——没有备份就等于没有回滚
  assert.match(v2, /sales_instructions_backup_/, "改话术前必须先备份旧版");
  /*
   * **备份必须是 do nothing，不能是 do update。**
   * 同一天跑第二次时库里已经是新版，若用 do update，那一次会把「备份」
   * 覆盖成新版本身——旧版就此消失，而这恰好发生在你想回滚的时候。
   */
  assert.match(v2, /on conflict \(key\) do nothing/, "同一天重跑会把备份覆盖成新版，旧版就找不回来了");
  assert.match(v2, /update voice_config set value = \(select value from voice_config/, "没有印出回滚语句");
});

test("砍话术时那十五条规则一条都没丢，只是换了地方", () => {
  /*
   * 常驻话术从 27332 字符砍到 3800，砍掉的不是删掉，是搬家（SPEC §4）：
   *   红线与人格   → scripts/voice-instructions-v2.mjs（常驻，每轮都在）
   *   方法论       → src/lib/voice-context.ts 的情境卡（命中才注入）
   *   何时调工具   → src/lib/voice-tools.ts 各工具的 description
   *   照片怎么说   → voice-console.tsx 的照片简报
   *
   * **这条测试是搬家的收据。** 写它的时候真抓出两条丢在半路上的：
   * 「重复挡回话 = 边界宣示」和「家里还有别人提过吗」——后者原话术标着
   * 「worth the most」，因为窗帘通常是两个人定的。红线测试查不到它们，
   * 因为它们不是红线，是方法论。
   */
  const all = [
    "scripts/voice-instructions-v2.mjs",
    "src/lib/voice-context.ts",
    "src/lib/voice-tools.ts",
    "src/components/royalzen/voice-console.tsx"
  ]
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");

  const rules = [
    ["「随便看看」的五级阶梯", /Climb this ladder ONE rung per turn/i],
    ["阶梯第 4 级:把提问权交给顾客", /Ask for permission before questions/i],
    ["重复挡回话 = 边界宣示,必须停", /a repeat is a boundary, not a hesitation/i],
    ["问生活不问参数", /Ask about their life in that room/i],
    ["把个人不便升级为家庭议题", /has anyone else at home mentioned it/i],
    ["陈述句代替问句", /Prefer a statement to a question/i],
    ["禁止连续两轮以问句结尾", /never two question-endings in a row/i],
    ["说不出就指", /they can point at it/i],
    ["一屏最多三张图", /THREE AT A TIME, NEVER MORE/i],
    ["句式不得重复", /Never reuse a sentence shape/i],
    ["每轮给流程预告", /what happens next/i],
    ["推荐闸门会拒绝,且那不是错误", /IF IT REFUSES: that is not an error/i],
    ["不许对顾客说「我看不到图」", /never say you cannot see the photo|never mention any\s*\n?\s*"?analysis/i],
    ["承诺了就必须在同一轮把工具调掉", /the tool call goes in the SAME turn/i],
    ["他再问一次 = 你没做,不是他不耐烦", /that is you not having done it/i]
  ];

  const lost = rules.filter(([, pattern]) => !pattern.test(all)).map(([name]) => name);
  assert.deepEqual(lost, [], `砍话术的时候把这几条弄丢了：\n  ${lost.join("\n  ")}`);
});

test("屏幕上每一张图都要可点,且点了助手必须知道", () => {
  const source = readFileSync("src/components/royalzen/voice-console.tsx", "utf8");
  /*
   * 老板的原话:「每一个发出去的图片最好都是可点击的,这样可以触发点击来
   * 筛选、判断用户的喜好」。
   *
   * 第一版漏了推荐卡:点了只是本地选中(效果图按钮亮起来),而助手完全不知道
   * 发生过这件事,还在讲第二款。顾客在屏幕上做的动作助手不知道,他就会觉得
   * 这台机器没在看他——这条比任何话术都致命。
   */
  /*
   * 08-05 起点击走 pushEvent(事件总线):除了告诉助手,还会掐断没说完的话
   * (response.cancel)并立刻接上。原先这里断言 nudgeIfSilent——那是 1.5 秒后
   * 才可能接话的旧机制,顾客点了图还要听它把上一段念完,老板的原话是
   * 「就好像跟一头水牛对话」。事件的注入与打断策略统一在 src/lib/voice-events.ts。
   */
  for (const [what, fn] of [
    ["选项卡", "tapChoice"],
    ["推荐卡", "tapProduct"],
    ["房间照片", "askAboutRoom"]
  ]) {
    assert.match(source, new RegExp(`const ${fn}`), `${what}缺少点击处理`);
    const body = source.slice(source.indexOf(`const ${fn}`), source.indexOf(`const ${fn}`) + 2500);
    assert.match(body, /pushEvent\(\{[\s\n]*type: "tap_/, `${what}点击后没走事件总线`);
  }
  // pushEvent 本体:打断要掐生成也要清音频缓冲,二者缺一嘴上就会继续念
  const push = source.slice(source.indexOf("const pushEvent"), source.indexOf("const pushEvent") + 2000);
  assert.match(push, /response\.cancel/, "事件总线丢了打断");
  assert.match(push, /output_audio_buffer\.clear/, "打断没清音频缓冲——嘴上还会念两三秒");
  assert.match(push, /conversation\.item\.create/, "事件没注入对话");
  // 卡片的 onClick 必须走这些回调，不能退回成纯本地 setState
  assert.match(source, /onClick=\{\(\) => tapProduct\(product\)\}/, "推荐卡的点击又变回本地选中了");
  assert.match(source, /onClick=\{\(\) => void tapChoice\(/, "选项卡的点击断了");
  assert.match(source, /onClick=\{\(\) => askAboutRoom\(\)\}/, "房间照片不可点了");
});
