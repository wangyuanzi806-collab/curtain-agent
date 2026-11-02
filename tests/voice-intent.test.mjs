import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    // "server-only" 是 Next 的构建期哨兵（它的作用是让误在客户端 import 时
    // 构建失败），在 node 里没有这个包。拦成空模块，被测的规则逻辑本来就是纯函数。
    if (specifier === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
    return nextResolve(specifier, context);
  }
});

const { findHandoff, isLeaving } = await import("../src/lib/voice-intent.ts");

/**
 * 自动叫店员的判定。
 *
 * 这套东西的风险全在误报：店员对黄卡失去信任之后，连真正紧急的红卡也会
 * 一起被忽略。所以下面「不该叫」的用例比「该叫」的更重要。
 */

const FACTS = {
  customerTurns: 6,
  minutes: 8,
  taps: 3,
  hasPhoto: true,
  hasRecommendation: true,
  pickedSku: null,
  hasRender: false,
  saidByCustomer: ""
};

test("**顾客直接要人时必须叫**——这是 08-04 那场真实对话漏掉的", () => {
  /*
   * 老板的原话回放：「讓他給我看一下唄」「他给我看一下」「你倒是叫啊」——
   * 连着三轮在要人，助手只是反复应承，一条消息都没发。
   * 第一版规则只认「摸一下/样品/实物」，而人真要叫人时说的是「让他来」，
   * 最直接的那句话反而没覆盖。
   */
  for (const said of [
    "讓他給我看一下唄",
    "他给我看一下",
    "你倒是叫啊",
    "叫个人过来",
    "有没有人能过来",
    "找个店员来",
    "can someone come over",
    "kan iemand komen"
  ]) {
    assert.equal(findHandoff(FACTS, said)?.reason, "person", `没认出他在要人：${said}`);
  }
});

test("问价格必须叫人——助手被禁止说数字,不叫人这句话就是死的", () => {
  for (const said of [
    "这个大概多少钱",
    "价格怎么样",
    "能给个报价吗",
    "Hoeveel kost dit?",
    "C'est combien ?",
    "what's the price on this one"
  ]) {
    const call = findHandoff(FACTS, said);
    assert.equal(call?.reason, "price", `没认出问价：${said}`);
    assert.match(call.action, /报个价/);
  }
});

test("想摸样品要叫人——手感是助手唯一给不了的东西", () => {
  for (const said of ["能摸一下吗", "有没有样品", "我想看看实物", "kan ik dit voelen", "can I feel it"]) {
    assert.equal(findHandoff(FACTS, said)?.reason, "sample", `没认出要样品：${said}`);
  }
});

test("问工期与量尺要叫人", () => {
  for (const said of ["多久能装好", "什么时候能上门量尺", "wanneer kan het geplaatst worden"]) {
    assert.equal(findHandoff(FACTS, said)?.reason, "schedule", `没认出问工期：${said}`);
  }
});

test("要比一比,得先有东西可比", () => {
  // 还没出推荐时说「哪个好」多半在说别的，叫人过去他不知道比什么
  const noRec = { ...FACTS, hasRecommendation: false };
  assert.equal(findHandoff(noRec, "这两个哪个好"), null);
  assert.equal(findHandoff(FACTS, "这两个哪个好")?.reason, "compare");
});

test("**顾客要走了就不许叫人**——那是把礼貌的告别变成尴尬的围堵", () => {
  for (const said of [
    "我先回去想想，谢谢",
    "改天再来看看吧",
    "先这样吧谢谢",
    "je vais réfléchir",
    "I'll think about it"
  ]) {
    assert.ok(isLeaving(said), `没认出要走：${said}`);
    assert.equal(findHandoff(FACTS, said), null, `顾客要走了还叫人：${said}`);
  }
  /*
   * 最坏的那种误报：他一边说要走、一边顺口提了价格。
   * 只看关键词的话这是「问价格 → 叫人」，而店员走过去时他正准备出门——
   * 一次礼貌的告别被变成尴尬的围堵。第一版就漏了这条（正则里写的是
   * 「回去想想」，而他说的是「回去再想想」，中间多一个字就没认出来）。
   */
  for (const said of [
    "价格我回去再想想，谢谢",
    "多少钱我先回家想想",
    "样品的事我下次再说吧",
    "什么时候能装我得先跟家里商量一下",
    "je vais réfléchir au prix"
  ]) {
    assert.equal(findHandoff(FACTS, said), null, `他要走了还叫人：${said}`);
  }
});

test("普通闲聊不许叫人——误报一次,店员对黄卡的信任就少一分", () => {
  for (const said of [
    "这个房间下午挺晒的",
    "我家小孩还小",
    "客厅朝西",
    "喜欢素一点的",
    "早上光会照进来",
    "冬天靠窗那边有点冷",
    "家里来客人比较多",
    "电视在那面墙"
  ]) {
    assert.equal(findHandoff(FACTS, said), null, `把闲聊当成了要叫人：${said}`);
  }
});

test("空话不触发", () => {
  assert.equal(findHandoff(FACTS, ""), null);
  assert.equal(findHandoff(FACTS, "   "), null);
});

test("判重必须在库里做,不能先读再写", () => {
  const source = readFileSync("src/lib/voice-sessions.ts", "utf8");
  const fn = source.slice(source.indexOf("export async function markHandoff"), source.indexOf("/** 会话开出来时"));
  // 两条转录几乎同时到达时，读改写会让两边都看到「还没叫过」，于是发两张卡
  assert.match(fn, /update voice_sessions/, "判重要用带条件的 update");
  assert.match(fn, /not \(handoffs \? \$4\)/, "update 必须带「还没叫过」的条件");
  assert.match(fn, /returning id/, "要靠 returning 判断是不是自己抢到的");
  assert.doesNotMatch(fn, /select[\s\S]{0,200}handoffs[\s\S]{0,200}update/i, "不能先读再写");
  // 失败时宁可漏发，不要重复轰炸
  assert.match(fn, /return false;\s*\n\s*\}/, "出错时必须当作已叫过");
});

test("自动卡要和顾客亲口要求的卡区分开", () => {
  const source = readFileSync("src/lib/voice-tools.ts", "utf8");
  assert.match(source, /auto: \{ title: "🟡/, "自动判定的卡必须是另一种颜色和措辞");
  // 说成一样紧急，店员两天之内会把所有卡一视同仁地忽略掉
  assert.doesNotMatch(source, /auto: \{ title: "🔴/, "自动卡不该用最高紧迫感");
  assert.match(source, /export async function postAutoHandoff/);
});

test("叫人失败不能弄断顾客的对话", () => {
  const route = readFileSync("src/app/api/voice/sessions/route.ts", "utf8");
  const block = route.slice(route.indexOf("if (saidNow.trim())"), route.indexOf("return NextResponse.json({ ok: true, appended"));
  /*
   * 这里原来断言的是 void (async ——「叫人要在响应之外跑，不能让顾客的对话等飞书」。
   * **那正是 bug 本身**：Vercel 在响应返回的那一刻冻结实例，fire-and-forget
   * 从来没跑完过一次（上线以来 handoffs 全 []、auto_handoff 事件 0 次）。
   * 这条 PATCH 是攒批的后台落库请求，不在对话的关键路径上，等几百毫秒没人感觉到；
   * 不等的代价是「自动叫人」这个功能整个不存在。别改回去。
   */
  assert.match(block, /await \(async/, "叫人必须 await——fire-and-forget 在 Vercel 上会被冻结");
  assert.doesNotMatch(block, /void \(async/, "又改回 fire-and-forget 了，它在 Vercel 上跑不完");
  assert.match(block, /catch/, "叫人失败必须吞掉，不能弄断顾客的对话");
});

test("叫了人九十秒没动静，必须改口而不是把同一句再说一遍", () => {
  /*
   * 老板 08-04 回放那场里最刺眼的一段：他说想看面料，助手答应了，他又问、又问，
   * 每次拿到的都是同一句热情的「好的，我让同事拿过来」。
   * **重复同一句承诺比不承诺更伤人**——它证明前一句是空的。
   *
   * 这里守的是降级版：到点提醒模型换句话说。真正的闭环要飞书卡上那颗「我去」
   * 按钮把认领写回来，那需要在飞书后台配回调地址。
   */
  const source = readFileSync("src/components/royalzen/voice-console.tsx", "utf8");
  const block = source.slice(
    source.indexOf('item.name === "escalate_to_staff"'),
    source.indexOf('item.name === "escalate_to_staff"') + 1800
  );
  assert.ok(block, "叫人之后没有任何后续动作");
  assert.match(block, /90_000|90000/, "没有九十秒的计时");
  assert.match(block, /Do not repeat that same promise/i, "没有告诉模型别重复同一句承诺");
  // 只在真的送达时才计时：没送达的那条路上，助手说的本来就不是「同事在路上」
  assert.match(block, /result\?\.status === "escalated"/, "送不达的也在计时，那会催一句不存在的承诺");
});
