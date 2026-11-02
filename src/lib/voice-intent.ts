import "server-only";

import { getConsultation, type WorkspaceActor } from "@/lib/platform-db";
import { getVoiceSession, type VoiceSessionRow } from "@/lib/voice-sessions";

/**
 * 这一场到目前为止发生了什么。
 *
 * 全部来自**已经发生的行为**，不来自模型对顾客的判断——助手会讨好，
 * 它说「客户很感兴趣」毫无信息量；而一个人花了十二分钟、点了五次、
 * 从五款里挑出一款，这些不会骗人。
 */
export type SessionFacts = {
  /** 说了几轮（顾客那边） */
  customerTurns: number;
  /** 从第一句到现在多少分钟 */
  minutes: number;
  /** 在屏幕上点过几次 */
  taps: number;
  /** 拍过房间照片 */
  hasPhoto: boolean;
  /** 跑过正式推荐（那是十几秒的事，是个明确的节点） */
  hasRecommendation: boolean;
  /** 从五款里挑中了一款 */
  pickedSku: string | null;
  /** 看过「装在他家」的效果图 */
  hasRender: boolean;
  /** 顾客说过的话，拼起来给规则匹配 */
  saidByCustomer: string;
};

/**
 * 什么时候该叫店员过来。
 *
 * **判据不是「他看起来想买」，是「接下来这一步只有人能做」。**
 *
 * 这个区别很要紧。按意向分派人，分数是不可解释的（店员看到「意向 78」不知道
 * 过去干嘛），而且分数会随着对话自然上涨——于是每一场聊得久一点的都会触发，
 * 店员两天之内就学会无视这类消息，那时连真正紧急的红卡也一起失效了。
 *
 * 按能力边界派人则天然稀疏：只有人能做的事本来就不常发生。而且它对店员是
 * 一句人话——「他想摸一下这块布」比任何分数都好用。
 *
 * 门店和线上的成本结构也是反的：线上误报只是浪费销售几分钟，线索还在库里；
 * 门店误判漏掉的那个人**当场就走了，不会回来**。所以宁可在边界清楚的地方
 * 多叫一次，也不要用一个模糊的分数把所有人都叫一遍。
 */
export type HandoffReason = "person" | "price" | "sample" | "compare" | "schedule";

export type HandoffCall = {
  reason: HandoffReason;
  /** 卡片第一行：店员过去要做的那件事 */
  action: string;
  /** 为什么是现在 */
  why: string;
  /** 顾客的原话（如果有） */
  said: string;
};

/**
 * 只有人能做的四件事。**每一条都对应 AI 的一个硬边界**，不是「顾客好像很有兴趣」。
 *
 * 价格排第一：这家店的价格数据未经核验，提示词里禁止助手说出任何数字，
 * 它只会说「同事会给您确认」——而在此之前，**没有任何机制去通知那个同事**。
 * 顾客问完价格，等来的是一句承诺和一片安静。这是整条链路上最贵的一个洞：
 * 问价格是购买信号里最强的那一类，而我们把它变成了死胡同。
 */
const HUMAN_ONLY: {
  reason: HandoffReason;
  action: string;
  why: string;
  latin: RegExp;
  zh: string[];
}[] = [
  {
    /**
     * 顾客直接在要人。
     *
     * 这条是 2026-08-04 回放老板那场加的，而它本该是第一条：他连着说
     * 「讓他給我看一下唄」「他给我看一下」「你倒是叫啊」，助手只是反复应承，
     * 一条消息都没发出去。原因是这套规则只认「摸一下/样品/实物」那种说法，
     * 而人真要叫人的时候说的是「让他来」「叫个人」——**最直接的那句话反而没覆盖**。
     *
     * 助手手里有 escalate_to_staff，但它没调；服务端这条是兜底：
     * 顾客都把话说到这份上了，不该再依赖模型记不记得调工具。
     */
    reason: "person",
    action: "过去一趟，他在叫人",
    why: "顾客直接要人过去了。助手已经应承过，现在得有人真的出现。",
    latin:
      /\b(get someone|call someone|can someone|ask a colleague|speak to (someone|a person|a human)|iemand|een collega|roep|quelqu'un|un collègue|appelez)\b/i,
    zh: [
      "叫人", "叫个人", "叫他", "叫她", "你叫", "倒是叫", "让他来", "讓他來", "让他给我", "讓他給我",
      "他给我看", "他給我看", "找个人", "找人", "有没有人", "有沒有人", "店员", "店員", "同事过来", "同事來"
    ]
  },
  {
    reason: "price",
    action: "去报个价",
    why: "顾客问了价格。助手不许说任何数字，只能答「同事会确认」——现在得有人真的去确认。",
    latin: /\b(price|prijs|prix|hoeveel kost|combien|cost|budget|how much (is|does|would)|quote|offerte|devis)\b/i,
    zh: ["多少钱", "价格", "价位", "报价", "贵不贵", "什么价", "预算", "几多钱"]
  },
  {
    reason: "sample",
    action: "拿这块布过去给他摸",
    why: "顾客想上手感受面料。手感是助手唯一给不了的东西。",
    latin: /\b(feel it|touch|sample|staal|stalen|voelen|échantillon|toucher|see it in person|real thing)\b/i,
    zh: ["摸一下", "摸摸", "手感", "样品", "实物", "看看实物", "拿来看看", "布样"]
  },
  {
    reason: "compare",
    action: "把这两块并排拿给他比",
    why: "顾客在两款之间来回。两块布并排放在他眼前，比屏幕上看十遍都管用。",
    latin: /\b(compare|side by side|between (these|the two)|vergelijken|naast elkaar|comparer|côte à côte)\b/i,
    zh: ["比一下", "对比", "哪个好", "两个之间", "拿不定", "选哪个", "犹豫"]
  },
  {
    reason: "schedule",
    action: "去谈上门量尺的时间",
    why: "顾客在问什么时候能装好或者上门。助手给不了确切日期。",
    latin: /\b(when can|how soon|lead time|install|meten|opmeten|levertijd|wanneer|délai|poser|rendez-vous)\b/i,
    zh: ["多久能", "什么时候能", "工期", "量尺", "上门", "安装", "几天", "多长时间"]
  }
];

/**
 * 顾客要走了。命中就别再谈下一步，也别叫人——
 * 这时候派个店员过去，是把一次礼貌的告别变成一次尴尬的围堵。
 */
const LEAVING =
  /(先这样|回去.{0,3}想|回家.{0,3}想|再想想|想一想|再看看|再逛逛|改天|下次|下回|考虑.{0,2}下|考虑考虑|商量.{0,2}下|问.{0,2}(我|一下).{0,3}(太太|先生|老公|老婆|家里)|我先走|得走了|不用了|ik denk erover|later terug|nog even nadenken|kom ik terug|je vais réfléchir|je repasse|merci.{0,12}au revoir|think about it|come back later|have a think)/i;

export function isLeaving(said: string) {
  return LEAVING.test(said);
}

/**
 * 从这一场已经发生的事里，找出「接下来只有人能做」的那件事。
 *
 * 只看**最近一段**顾客说的话：他十分钟前问过价格、后来聊别的去了，
 * 那不该在此刻把人叫过来。
 */
export function findHandoff(facts: SessionFacts, recentlySaid: string): HandoffCall | null {
  if (!recentlySaid.trim()) return null;
  if (isLeaving(recentlySaid)) return null;

  for (const rule of HUMAN_ONLY) {
    const hit = rule.latin.test(recentlySaid) || rule.zh.some((word) => recentlySaid.includes(word));
    if (!hit) continue;
    // 「比一比」得先有东西可比。没出过推荐时这多半是在说别的
    if (rule.reason === "compare" && !facts.hasRecommendation) continue;
    return {
      reason: rule.reason,
      action: rule.action,
      why: rule.why,
      said: recentlySaid.slice(-300)
    };
  }
  return null;
}

export async function collectFacts(
  actor: WorkspaceActor,
  input: { consultationId?: string | null; voiceSessionId?: string | null }
): Promise<SessionFacts | null> {
  let session: VoiceSessionRow | null = null;
  if (input.voiceSessionId) session = await getVoiceSession(actor, input.voiceSessionId);
  const consultation = input.consultationId
    ? await getConsultation(actor, input.consultationId)
    : null;
  if (!session && !consultation) return null;

  const turns = session?.transcript ?? [];
  const fromCustomer = turns.filter((turn) => turn.role === "user");
  const startedAt = session ? new Date(session.startedAt).getTime() : Date.now();
  const lastAt = session ? new Date(session.lastActiveAt).getTime() : Date.now();

  return {
    customerTurns: fromCustomer.length,
    minutes: Math.max(0, Math.round((lastAt - startedAt) / 60000)),
    taps: session?.taps.length ?? 0,
    hasPhoto: Boolean(consultation?.sceneR2Key),
    hasRecommendation: Array.isArray(
      (consultation?.recommendation as { skus?: unknown[] })?.skus
    )
      ? ((consultation?.recommendation as { skus: unknown[] }).skus).length > 0
      : false,
    pickedSku: consultation?.selectedSkuId ?? null,
    hasRender: Boolean(consultation?.resultImageUrl),
    saidByCustomer: fromCustomer.map((turn) => turn.text).join(" ").slice(0, 4000)
  };
}
