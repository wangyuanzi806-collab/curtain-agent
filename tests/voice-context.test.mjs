import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildTurnContext, playbookIds } from "../src/lib/voice-context.ts";

const patchSource = readFileSync(
  new URL("../scripts/voice-instructions-v2.mjs", import.meta.url),
  "utf8"
);
const contextSource = readFileSync(new URL("../src/lib/voice-context.ts", import.meta.url), "utf8");

/** 新版常驻层的正文。脚本里那个模板字符串就是要写进库的东西 */
const RESIDENT = patchSource.split("const V2 = `")[1]?.split("`;")[0] ?? "";

/**
 * SPEC §9.3 C2：红线一条不丢。
 *
 * **这条不能靠人眼核。** 把 27000 字符砍到 3800 的过程里，我已经弄丢过一次
 * 「不追加免责声明」——它在原文里是独立一章，压缩人格段时整段没了，
 * 而丢一条红线的后果是当着顾客说错话。以后谁再动这份话术，这里必须红。
 */
const RED_LINES = [
  ["价格一个数字都不说", /No price\. Ever/i],
  ["连「几百块」也不行", /a few hundred/i],
  ["价格要同时叫人", /escalate_to_staff in the same breath/i],
  ["不给某款定遮光级", /Never put a fabric at a blackout level/i],
  ["不说遮光百分比", /never say a percentage/i],
  ["不承诺房间会暗", /never promise a room will go dark/i],
  ["克重可以说但不能换算成遮光", /never turn a weight into a darkness claim/i],
  ["目录没有的属性·涂层", /coating/i],
  ["目录没有的属性·防水", /waterproof/i],
  ["目录没有的属性·UV", /UV protection/i],
  ["目录没有的属性·抗菌", /antibacterial/i],
  ["目录没有的属性·阻燃", /flame retardant/i],
  ["目录没有的属性·隔音", /soundproofing/i],
  ["目录没有的属性·可水洗", /machine-wash/i],
  ["目录没有的属性·耐磨", /abrasion/i],
  ["荷法中三语一样算数", /waterdicht.*imperméable|imperméable.*涂层|防水/is],
  ["不下结论·承重", /load bearing/i],
  ["不下结论·认证", /certification/i],
  ["不下结论·儿童安全", /child safety/i],
  ["不说货号", /Never say a reference code out loud/i],
  ["不承诺折扣保修交期", /Never promise.*discount, warranty, delivery date/i],
  ["不从外表推断预算", /Never infer budget/i],
  ["不制造紧迫感", /manufacture urgency/i],
  ["语言跟随顾客", /Answer in whatever language they speak/i],
  ["荷兰语 u 法语 vous", /\*\*u\*\* in Dutch.*\*\*vous\*\* in French/is],
  ["承诺即行动·同一轮", /the tool call goes in the SAME turn/i],
  ["再问一次说明你没做", /that is you not having done it/i],
  ["送不达不许谎称", /reached nobody, say exactly that/i],
  ["不问第二遍", /Never ask twice/i],
  ["事实只从工具结果来", /come only from tool results in this call/i],
  ["不追加免责声明", /Never append a disclaimer/i],
  ["不重复句式", /Never reuse a sentence shape/i],
  /*
   * 这条原来写的是 "End every turn with what happens next"。**改了，别改回去。**
   *
   * 08-04 老板试完真机：「感觉有点啰嗦，像是套模板说的话」。跑对话测试台一看，
   * 七轮里六轮结尾都是「下一步是您……」单起一段——那正是这条规则被字面执行的样子。
   * 出发点没错（比利时的不确定性规避，顾客要知道接下来会发生什么），
   * 但「每一轮都说」把它变成了填表回执。
   *
   * 现在的口径：只在他真的要等或要选时说，而且要融进正在说的那句里。
   */
  ["只在该说时才说下一步", /Say what happens next ONLY when he has to wait or choose/i],
  ["不许转述他刚做了什么", /narrate what he just did/i],
  ["不许夸他答得好", /praise him for answering/i],
  ["不许引用他的原话", /quote him back/i],
  ["一轮只有一段", /a second paragraph/i],
  ["不许念内部分类名", /Never speak our internal category names/i],
  ["不许让顾客听到我们这边出了问题", /Never let him hear that something failed on our side/i],
  ["不赞美顾客品味", /Do not compliment their taste/i],
  ["不说高品质premium", /"high-quality", "premium"/i]
];

test("SPEC C2：常驻层的红线一条都不能少", () => {
  assert.ok(RESIDENT.length > 2000, `没解析出常驻层正文，只拿到 ${RESIDENT.length} 字符`);
  const missing = RED_LINES.filter(([, pattern]) => !pattern.test(RESIDENT)).map(([name]) => name);
  assert.deepEqual(missing, [], `新版话术里少了这些红线：\n  ${missing.join("\n  ")}`);
});

test("SPEC C1：常驻层确实砍下来了", () => {
  const words = RESIDENT.split(/\s+/).length;
  /*
   * 原文 27332 字符 / 约 4500 词 / 约 6800 token。
   *
   * 上限从 900 放到 1100：08-04 那轮真机反馈之后，「怎么说话」那一节改成了
   * 正反例对照表。**例子比禁令贵，但也比禁令管用**——同一批规则用解释的方式写，
   * 模型输出平均 139 字；改成一行一个对照例子，降到 67 字。
   * 多出来的那两百词，换回来的是每轮少说一半的话。
   *
   * 但别把这个上限当成可以随便涨：话术本身的长度会被模仿。写得越啰嗦，
   * 它说得越啰嗦——这是那一轮迭代里最反直觉的发现。
   */
  assert.ok(words < 1100, `常驻层 ${words} 词，比目标胖太多——该下沉的没下沉干净`);
  assert.ok(words > 400, `常驻层只剩 ${words} 词，八成把红线也砍了`);
});

test("SPEC D1/D2/D3：第一句要自我介绍、说能帮什么、不带问号", () => {
  const opening = RESIDENT.split("# Your first sentence")[1] ?? "";
  assert.ok(opening, "话术里找不到「第一句」那一节");
  assert.match(opening, /who you are/i, "第一句没要求说「我是谁」");
  assert.match(opening, /what you can do for them/i, "第一句没要求说「能帮什么」");
  assert.match(opening, /No question mark/i, "第一句没禁问号");
  /*
   * 这一条是老板 08-04 亲自推翻我的：上一版写的是「不做自我介绍」。
   * 错在把「别问空问题」扩大成了「别开口说自己是谁」——
   * 「我能帮您吗」失败是因为它是个空问句，不是因为它介绍了自己。
   * 而顾客面对的是一颗会发光的球，不说他不知道这能干嘛。
   */
  assert.doesNotMatch(opening, /not an introduction|never with your name/i, "又改回「不自我介绍」了");
  assert.match(opening, /glowing orb|orb, not a person/i, "漏了「他面对的是一颗球」这个理由");
});

/**
 * 砍掉的方法论必须真的搬到了情境卡，不是丢了。
 * 逐条对着原话术那几章核。
 */
test("原话术里的方法论搬进了情境卡，没有丢", () => {
  const must = [
    ["随便看看·五级阶梯", /Climb this ladder ONE rung per turn/i],
    ["随便看看·先给不问", /GIVE, do not ask/i],
    ["随便看看·退开也要留路", /leave one concrete way back in/i],
    ["挖需求·问生活不问参数", /Ask about their life in that room, not about curtain parameters/i],
    ["挖需求·电视在哪面墙", /which wall the TV is on/i],
    ["挖需求·陈述优于提问", /Prefer a statement to a question/i],
    ["挖需求·不问能推出来的", /already told you it faces west/i],
    ["遮光·手电筒是店里的标准", /500-lumen cold white torch/i],
    ["遮光·三个等级", /no pinpoints and no halo/i],
    ["遮光·衬布的代价", /kills the drape/i],
    ["卡住·先换问法再扔探针", /throw a probe/i],
    ["卡住·探针只给两三款", /Two or three, not five/i],
    ["要走·一律不叫人", /\*\*Do not call a colleague\*\*/i]
  ];
  const missing = must.filter(([, p]) => !p.test(contextSource)).map(([name]) => name);
  assert.deepEqual(missing, [], `这些方法论砍掉之后没接住：\n  ${missing.join("\n  ")}`);
});

test("情境卡命中之后不再发第二次", async () => {
  const base = {
    taste: {},
    room: null,
    hasPhoto: false,
    handoffs: [],
    stalledTurns: 0
  };
  const first = await buildTurnContext({ ...base, said: "我就随便看看", playbooksSeen: [] });
  assert.equal(first.playbook?.id, "just_looking", "「随便看看」没触发对应的卡");

  const again = await buildTurnContext({
    ...base,
    said: "我就随便看看",
    playbooksSeen: ["just_looking"]
  });
  assert.equal(again.playbook, undefined, "同一张卡发了第二次——重复注入既占上下文，也像这事又发生了一遍");
});

test("要走的话触发的是「别叫人」那张，不是挖需求那张", async () => {
  const out = await buildTurnContext({
    said: "价格我回去再想想",
    taste: {},
    room: null,
    hasPhoto: false,
    handoffs: [],
    playbooksSeen: [],
    stalledTurns: 0
  });
  assert.equal(out.playbook?.id, "leaving");
});

test("卡住三轮才给那张卡，话少不算", async () => {
  const base = {
    said: "嗯",
    taste: {},
    room: null,
    hasPhoto: false,
    handoffs: [],
    playbooksSeen: ["discovery"]
  };
  assert.notEqual((await buildTurnContext({ ...base, stalledTurns: 2 })).playbook?.id, "stalled");
  assert.equal((await buildTurnContext({ ...base, stalledTurns: 3 })).playbook?.id, "stalled");
});

test("每轮那一行：服务端把结论算好，模型不用自己判断", async () => {
  const withPhoto = await buildTurnContext({
    said: "主卧",
    taste: {},
    room: "主卧",
    hasPhoto: true,
    handoffs: ["price"],
    playbooksSeen: [],
    stalledTurns: 0
  });
  assert.match(withPhoto.line, /photo: yes/);
  assert.match(withPhoto.line, /room: 主卧/);
  assert.match(withPhoto.line, /already called for: price/, "已经叫过谁必须写进去，否则会重复轰炸店员");
  /*
   * SPEC §2.3：有照片就能推。照片自己就是筛选器（取色 → 协调色域 → 分层多样化），
   * 而上一版要求的「房间」和「光线需求」一款货都筛不掉。
   */
  assert.match(withPhoto.line, /ready to pick five/);

  const noPhoto = await buildTurnContext({
    said: "看看",
    taste: {},
    room: null,
    hasPhoto: false,
    handoffs: [],
    playbooksSeen: [],
    stalledTurns: 0
  });
  assert.match(noPhoto.line, /photo: no/);
  assert.match(noPhoto.line, /not enough to pick five yet/, "没照片又没收窄，还说能推就是当初那个 bug");
});

test("指纹变了才算这一轮有进展", async () => {
  const make = (taste, room) =>
    buildTurnContext({
      said: "x",
      taste,
      room,
      hasPhoto: false,
      handoffs: [],
      playbooksSeen: [],
      stalledTurns: 0
    });
  const a = await make({}, null);
  const b = await make({}, null);
  assert.equal(a.fingerprint, b.fingerprint, "什么都没变，指纹不该动");

  const c = await make({}, "客厅");
  assert.notEqual(a.fingerprint, c.fingerprint, "顾客说了房间，指纹必须变——否则会被当成卡住");

  const d = await make({ feel: ["wool"] }, null);
  assert.notEqual(a.fingerprint, d.fingerprint, "点了一张卡，指纹必须变");
});

test("五张情境卡都在", () => {
  assert.deepEqual(playbookIds().sort(), ["blackout", "discovery", "just_looking", "leaving", "stalled"]);
});
