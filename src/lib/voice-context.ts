/**
 * 每一轮告诉模型「现在是什么情况」。
 *
 * 这个文件是 SPEC v2 第 2 步的服务端那一半，替掉的是话术里一大段
 * 「如果……就……」的规则。理由在 SPEC §4.4：**情况判断分两种,只有第二种写成规则**。
 *
 *   服务端算得出的 —— 有没有照片、候选剩多少、已叫过谁、缺什么、卡住没有、要不要走
 *     → 算好注入,模型一个字都不用判断
 *   只有听懂对话才知道的 —— 他是不是在犹豫、这句「贵吗」是不是在问价
 *     → 写进工具描述
 *
 * 光这一条就省掉约 530 字规则,而且比写成规则更可靠:服务端不会忘、不会误判、
 * 不会因为对话变长而注意不到。
 *
 * **注入只追加,绝不改 system prompt,也绝不换工具集。** 官方原话:「在对话中途
 * 改变工具集,是人们打破 prompt 缓存最常见的方式之一。」按官方倍率算,20 轮对话
 * 前缀稳定约 $3.15,每轮换系统提示词约 $25——八倍,还没算延迟。
 */

import type { SurveyAnswers } from "@/lib/curtain-survey";

/** 顾客点过的选项。键是选择卡的类别,值是他点中的那些 id */
export type Taste = Record<string, string[]>;

export type ContextInput = {
  /** 顾客最近说的那一句(转录) */
  said: string;
  /** 顾客点过的 */
  taste: Taste;
  /** 顾客自己说的房间名,模型填的 */
  room?: string | null;
  hasPhoto: boolean;
  /** 已经叫过的那几类,免得重复轰炸店员 */
  handoffs: string[];
  /** 已经放过的情境卡,同一张不放第二次 */
  playbooksSeen: string[];
  /** 连续几轮清单没有任何新增 */
  stalledTurns: number;
};

export type ContextOut = {
  /** 每轮那一行。≤60 字,只追加 */
  line: string;
  /** 情境卡:命中新情境时才有,一场里同一张只发一次 */
  playbook?: { id: string; text: string };
  /** 候选池还剩多少款。null = 算不出(目录没加载出来) */
  candidates: number | null;
  /**
   * 清单的指纹。**「卡住」是这么判出来的**:两轮之间指纹没变,就是这一轮什么都没问出来。
   *
   * 判断放在前端(它记得上一轮),但指纹必须由服务端出——房间是模型通过工具参数
   * 填进咨询单的,前端根本看不见。前端自己攒的那份清单会漏掉它,
   * 于是顾客明明说了「主卧」,系统还当这一轮颗粒无收。
   *
   * 注意这里数的是**轮数**不是话多话少:慢慢聊十轮每轮都给新信息是好对话,
   * 三轮全是「嗯」「还行」才是卡住。
   */
  fingerprint: string;
};

/* ────────────────────────── 情境卡 ──────────────────────────
 *
 * 这些是**方法论**,既不是红线也不是工具规则,原先全堆在常驻话术里。
 * 现在改成命中才给:顾客没说「随便看看」,模型就不必带着那五级阶梯思考。
 *
 * 一张卡一场只发一次。发过的靠 playbooksSeen 挡住——
 * 重复注入既占上下文,又会让模型觉得这件事又发生了一遍。
 */

const PLAYBOOKS: Record<string, { when: RegExp | null; text: string }> = {
  /**
   * 十个人里九个先说这句。它不是拒绝,是一个让人喘口气的反射动作。
   * 原话术里这一段最长(约 500 字),但只有说了这句才用得上。
   */
  just_looking: {
    when: /(随便看看|先看看|just (having a )?a? ?look|just looking|kijk (even )?rond|ik kijk|je regarde|jete un ?œil|on regarde)/i,
    text:
      "He said he is just looking. Nine out of ten first contacts say this — it is a reflex, not a refusal. " +
      "Climb this ladder ONE rung per turn, and stop at whatever rung you are on the moment he pushes back:\n" +
      "1. Agree with no 'but'. 'Looking is how it starts.' Nothing after it.\n" +
      "2. GIVE, do not ask: one thing he could not have known and that does not point at a sale " +
      "(how the fabrics are grouped, that made-to-measure runs four to six weeks). **No question anywhere in this turn.** " +
      "This is the rung people skip and it is the one that works.\n" +
      "3. Say what you notice, then stop. If he says anything back — correcting you counts, and is better — you may go on.\n" +
      "4. Ask for permission before questions — handing them the right to say no is the whole point. " +
      "5. Only then the real question: 'what made you start thinking about new curtains?'\n" +
      "Going quiet and asking the same thing in other words both count as giving up.\n" +
      "**Stop immediately when**: two answers in a row get shorter and carry nothing new; they repeat the " +
      "same brush-off ('really, just looking') — **a repeat is a boundary, not a hesitation**; they comment " +
      "on the asking itself; any form of 'no thanks'; or a goodbye.\n" +
      "When you do stop, leave one concrete way back in — a customer left alone comes back, one who was chased does not."
  },

  /**
   * 挖需求的方法论。原话术里这一段最有价值,但**开场那几句用不上它**——
   * 顾客还没开口聊正事,带着这张表思考只会让第一句变长。
   * 触发条件是「他第一次说了句实质的话」,由 buildTurnContext 判(见下面的 said.length)。
   */
  discovery: {
    when: null,
    text:
      "Curtains are never about curtains. Nobody wants fabric — they want to sleep past six, to stop the sun " +
      "bleaching the sofa, to not be seen from the street, to have the room feel finished when family visits. " +
      "That thing behind the purchase is what you are looking for.\n" +
      "**Ask about their life in that room, not about curtain parameters.** Nobody can answer 'how much blackout do you need'.\n" +
      "· instead of how much blackout → who wakes up first in there, and whether the light gets them\n" +
      "· instead of what colour → what else is in there they want it to sit next to\n" +
      "· instead of what style → a room they relax in, or a room they receive people in\n" +
      "· instead of pattern or plain → do they want the window noticed, or gone\n" +
      "Always fair, because the curtain hangs in that room: what time of day they use it; whether the afternoon light " +
      "gets harsh; **which wall the TV is on** (nobody thinks of it, everybody recognises it); whether you can be seen " +
      "from the street once the lights are on. Only if they raise it: budget, renting, timing. " +
      "Never: income, job, what the place cost, who lives there.\n" +
      "When they name a problem, go one step INTO it instead of jumping to the product: 'can you give me an " +
      "example?' · 'how long has that been going on?' · 'what do you do about it at the moment?' · " +
      "**'has anyone else at home mentioned it?'** — that last one is worth the most: curtains are usually " +
      "decided by two people, and it turns one person's irritation into a household matter. " +
      "Never ask what a problem has cost them in money; a faded sofa has no invoice.\n" +
      "**Prefer a statement to a question.** 'You've been looking at the heavier ones' cannot be shut down with one word, " +
      "and if you have it slightly wrong they correct you — a correction tells you more than an answer would. " +
      "Never ask what you can work out: 'it gets hot in the afternoon' already told you it faces west. " +
      "The colours in their room are never a question — you can see them."
  },

  /**
   * 遮光是这家店唯一有独门方法的话题(手电筒),也是最容易说出违禁话的地方。
   * 只在他问起时才装进上下文。
   */
  blackout: {
    when: /(遮光|挡光|够暗|verduister|donker|lichtdicht|occultant|obscurcit|blackout|block.{0,6}light|dark enough)/i,
    text:
      "Light-blocking came up. This shop does not send fabric to a lab — it is judged on the spot, " +
      "a 500-lumen cold white torch held flat behind the cloth while the customer looks at the front. " +
      "That method IS the shop's standard, so explaining it is your job.\n" +
      "Explain the three levels by what they LOOK like under that torch: no pinpoints and no halo (bedrooms, night workers) · " +
      "a soft even glow with nothing glaring (living, dining, study) · light clearly coming through (sheers, never a bedroom alone). " +
      "In Belgium's cloudy climate most homes settle on the middle one.\n" +
      "A blackout lining costs them something real: it kills the drape, stiffens the curtain, complicates washing, " +
      "can trap radiator heat, and adds to the bill. Only argue for it when all three hold — east or west facing AND a bedroom " +
      "AND someone genuinely light-sensitive. Never raise lining yourself for someone who has not asked for a properly dark room.\n" +
      /*
       * 08-05 复盘:blackout 三场全崩,崩法只有一种——顾客逼问「哪款最遮光」时,
       * 它把「不能定级」背了十几遍,却没有一条**能做什么**的路。约束的正确形状
       * 是「不能说 X,但可以做 Y」:克重和织密是可以说的事实,按最厚实的方向
       * 直接展示不叫定级。规则只许自报一次;每次拒绝必须同口气给出替代动作。
       */
      "**You may not put a fabric in a level, say a percentage, or promise a room will be dark** — " +
      "say this ONCE in the whole conversation, in one short sentence, and never repeat it: " +
      "reciting your limits is how you lose him.\n" +
      "When he demands 'the most blackout one': **do something, do not explain**. Weight and weave " +
      "are facts you may use — go to the heaviest, densest direction and act on it: show it, hang it " +
      "in his photo, have the colleague bring exactly that with the torch. 'This is the heaviest we " +
      "carry — want it up in your photo? And the torch will settle how dark it really goes.' " +
      "That sentence wins the customer your rulebook loses.\n" +
      "Never speak from inside the machine: no 'the system', no 'the screen shows', no reading " +
      "on-screen captions aloud, never open a reply with what you cannot do. " +
      "A salesperson has hands, not policies."
  },

  /**
   * 「卡住」不是话少,是**连续三轮什么新东西都没有**。
   * 慢慢聊十轮每轮都给新信息是好对话,三轮全是「嗯」「还行」才是卡住。
   */
  stalled: {
    when: null, // 由 stalledTurns 触发,不看措辞
    text:
      "Three turns with nothing new. Do not ask the same thing in other words — that is what makes someone feel " +
      "cornered. In this order: (1) swap the abstract question for cards on screen; " +
      "(2) throw a probe — put 2 or 3 deliberately DIFFERENT fabrics up and say plainly 'let me show you two directions'. " +
      "In this trade people find out what they want by seeing it: 'too plain' from him is worth more than ten questions. " +
      "**Two or three, not five** — five is a recommendation and you have not earned one yet. " +
      "(3) If that does not move either, back off, leave one concrete way to restart, and stop."
  },

  /**
   * 要走的信号。这里最重要的动作是**别叫人**——
   * 派个店员过去,是把一句礼貌的告别变成尴尬的围堵。
   */
  leaving: {
    when: /(先这样|回去.{0,4}想|回家.{0,4}想|再想想|改天|下次再来|думать|think about it|have a think|come back|nog eens.{0,10}denken|erover nadenken|réfléchir|revenir plus tard)/i,
    text:
      "He is signalling that he is leaving. **Do not call a colleague** — sending someone over now turns a polite " +
      "exit into being cornered, and he will remember that, not the fabrics. Agree warmly and without a 'but'. " +
      "Offer once, lightly, to note down what he liked so he does not have to repeat himself next time " +
      "(that is save_consultation, and it is genuinely worth something to him). " +
      "Then leave one concrete way back in and let him go."
  }
};

/* ────────────────────── 候选池还剩多少 ────────────────────── */

/**
 * 把顾客点过的选项翻成问卷答案,再走正式的筛选器算还剩几款。
 *
 * **为什么要算这个数**:SPEC §2.3 —— 驱动推荐的不该是「我们知道了几件事」,
 * 而是「候选池收窄到什么程度」。目录 985 款里 warm 占 617,
 * 「我要暖色」几乎等于没筛;而真正能筛掉货的只有六项。
 * 不算这个数,就会像上一版那样:拦住了本来能跑通的链路,又没拦住真正的问题。
 */
export function tasteToAnswers(taste: Taste): SurveyAnswers {
  const pick = <T,>(list: string[] | undefined, allow: readonly string[]): T[] =>
    (list ?? []).filter((id) => allow.includes(id)) as T[];

  const layer = taste.layer?.[0];
  return {
    opacityNeed: null, // 遮光进推荐说明,不筛货——网页问卷那一题下面原文就这么写
    colors: pick(taste.colour, COLOR_FAMILY_IDS),
    valueLevels: [],
    colorCells: [],
    texture: (TEXTURE_IDS.includes(taste.pattern?.[0] ?? "") ? taste.pattern![0] : null) as never,
    materials: pick(taste.feel, MATERIAL_IDS),
    fabricType: (layer === "sheer" ? "sheer" : layer === "main" ? "cloth" : null) as never,
    tags: [],
    note: ""
  } as SurveyAnswers;
}

const COLOR_FAMILY_IDS = [
  "warm_neutral", "warm_saturated", "warm", "gray", "earth", "sage", "cool", "green", "blue", "pink", "black", "pure_white"
];
const TEXTURE_IDS = ["solid", "texture", "pattern"];
const MATERIAL_IDS = ["cotton_linen", "wool", "viscose_soft", "polyester_smooth", "blend"];

/** 顾客一个选项都没点时,候选就是全目录——这一步不必去加载目录 */
function hasAnyTaste(taste: Taste): boolean {
  return Object.values(taste).some((list) => (list?.length ?? 0) > 0);
}

async function countCandidates(taste: Taste): Promise<number | null> {
  if (!hasAnyTaste(taste)) return null;
  try {
    /**
     * **动态 import。** 这条链(目录缓存 → 数据库 → 文件读取)挂到铸凭证的冷启动上
     * 会把一次 401 从毫秒级拖到 60 秒以上,而 40 秒看门狗会先掐断,
     * 屏幕上就是「一直连不通」。只有真的要算候选时才付这个成本。
     */
    const [{ getCachedSkuCatalog }, { filterBySurvey }] = await Promise.all([
      import("@/lib/catalog-cache"),
      import("@/lib/curtain-survey")
    ]);
    const catalog = await getCachedSkuCatalog(4000);
    return filterBySurvey(catalog, tasteToAnswers(taste)).length;
  } catch {
    // 算不出就说算不出。**宁可不注入,也不要注入一个编出来的数**
    return null;
  }
}

/* ─────────────────────── 下一个问什么最能收窄 ─────────────────────── */

/**
 * 目录实际分布(985 款)决定了问的顺序,不是凭直觉:
 *   质感 顺滑 362 / 混纺 214 / 柔垂 149 / 棉麻 145 / 羊毛 115  ← 最能切开
 *   花纹 texture 493 / pattern 346 / solid 146
 *   颜色 warm 617(63%) / gray 188 / ...                      ← 几乎切不开
 *   布纱 布帘 981 / 纱帘 4                                     ← 基本白问
 * 所以「布帘还是纱帘」不该出现在这个清单里——纱帘统共 4 款。
 */
function nextBestFacet(taste: Taste): string | null {
  if (!taste.feel?.length) return "feel";
  if (!taste.pattern?.length) return "pattern";
  if (!taste.colour?.length) return "colour";
  return null;
}

const FACET_WORDS: Record<string, string> = {
  feel: "how it should feel in the hand",
  pattern: "plain or with something in the weave",
  colour: "which colour direction"
};

/* ────────────────────────── 主函数 ────────────────────────── */

export async function buildTurnContext(input: ContextInput): Promise<ContextOut> {
  const candidates = await countCandidates(input.taste);

  /* 情境卡:先看沉默类(卡住),再看措辞类。一轮最多给一张——
     两张一起塞进去,等于又回到了「一次喂太多」。 */
  let playbook: ContextOut["playbook"];
  const seen = new Set(input.playbooksSeen);
  if (input.stalledTurns >= 3 && !seen.has("stalled")) {
    playbook = { id: "stalled", text: PLAYBOOKS.stalled.text };
  } else {
    for (const [id, card] of Object.entries(PLAYBOOKS)) {
      if (!card.when || seen.has(id)) continue;
      if (card.when.test(input.said)) {
        playbook = { id, text: card.text };
        break;
      }
    }
    /*
     * 挖需求那张没有触发词,判据是「他第一次说了句实质的话」。
     * 六个字是拍的:「嗯」「好的」「随便看看」都到不了,
     * 而一旦他开口说正事(哪个房间、为什么想换),这张表立刻就用得上。
     * 排在有触发词的那些后面——他说的是「随便看看」时,该给的是那一张。
     */
    if (!playbook && !seen.has("discovery") && input.said.trim().length > 6) {
      playbook = { id: "discovery", text: PLAYBOOKS.discovery.text };
    }
  }

  /* 每轮那一行。**每一项都是算出来的,模型不判断。**
     写成一行是有意的:多行会让模型当成一段要回应的话。 */
  const bits: string[] = [];
  bits.push(input.hasPhoto ? "photo: yes" : "photo: no");
  if (candidates !== null) bits.push(`candidates: ${candidates}`);
  if (input.room) bits.push(`room: ${input.room}`);

  const tasted = Object.entries(input.taste)
    .filter(([, list]) => list?.length)
    .map(([kind, list]) => `${kind}=${list.join("/")}`);
  if (tasted.length) bits.push(`tapped: ${tasted.join(" ")}`);

  const next = nextBestFacet(input.taste);
  if (next) bits.push(`missing: ${FACET_WORDS[next]}`);

  if (input.handoffs.length) bits.push(`already called for: ${input.handoffs.join(", ")}`);
  if (input.stalledTurns >= 3) bits.push(`${input.stalledTurns} turns with nothing new`);

  /**
   * 能不能推,服务端直接给结论,别让模型自己推。
   * 判据是 SPEC §2.3 定的:**照片本身就是筛选器**(取色 → 协调色域 → 分层多样化),
   * 所以有照片就能推;没照片时看候选收窄到什么程度,而不是看「问到了几件事」。
   */
  const canRecommend = input.hasPhoto || (candidates !== null && candidates < 80);
  bits.push(canRecommend ? "ready to pick five" : "not enough to pick five yet");

  const fingerprint = [
    input.room ?? "",
    input.hasPhoto ? "p" : "",
    ...Object.entries(input.taste)
      .filter(([, list]) => list?.length)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([kind, list]) => `${kind}:${[...list].sort().join(",")}`)
  ].join("|");

  return { line: `[${bits.join(" · ")}]`, playbook, candidates, fingerprint };
}

/** 给测试和调用方用:一张卡是不是存在 */
export function playbookIds(): string[] {
  return Object.keys(PLAYBOOKS);
}
