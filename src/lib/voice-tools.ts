import "server-only";

import { getDb } from "@/lib/db";
import { searchForPartner, type PartnerSlots } from "@/lib/partner-api";
import { getConsultation, updateConsultation, type WorkspaceActor } from "@/lib/platform-db";
import {
  buildChoiceGroup,
  CHOICE_KINDS,
  tasteToRecommendationArgs,
  type ChoiceKind
} from "@/lib/voice-choices";

/**
 * 语音顾问的工具层。
 *
 * 从线下语音销售助手的 edge function 移植而来，**行为逐条对齐**——那些看起来
 * 可以简化的地方（拒答而不是猜、送不达时不谎称已通知、违禁词表故意漏掉"保温"）
 * 每一条背后都有它踩过的坑，见 docs/ARCHITECTURE.md。
 *
 * 唯一实质改动是检索：不再查它库里那份 985 拷贝，改走本产品的 searchForPartner，
 * 于是跨洋那一跳消失，颜色也从供应商色名换成 Lab 派生（那一列已被清空且本就不可信）。
 */

/** 价格工具默认关：库里那 985 条价格是老板造的测试价，说出口就是承诺 */
const PRICE_TOOLS_ENABLED = process.env.VOICE_PRICE_TOOLS_ENABLED === "1";

/**
 * 成本闸，默认**不**开——门店跑的就是正式版。
 *
 * 一直到 2026-08-04 默认都是 mini，理由是省钱。那天老板回放自己那场对话之后
 * 说「要不我们直接用最好的模型吧，现在总感觉有点人机的感觉」，而 08-03 的
 * 实测支持他：正式版该转人工的三次全转了（mini 三中二，漏的那次是安全问题），
 * 首句 11 个字（mini 31 个字，开场越长越像机器人）。
 *
 * 一天几十场门店对话，省下的那点钱远不如一次「他一直应承却不叫人」贵。
 * 要回退把 VOICE_FORCE_MINI 设成 1。
 */
const FORCE_MINI = process.env.VOICE_FORCE_MINI === "1";

export const VOICE_MODELS = ["gpt-realtime-2.1", "gpt-realtime-2.1-mini"] as const;
export const DEFAULT_VOICE_MODEL = "gpt-realtime-2.1";

/**
 * 正常流量默认正式版，平台管理员还可以显式选择正式版或 mini 做真机对照。
 * VOICE_FORCE_MINI 只保留作全域应急回退，平时不配。
 */
export function resolveModel(requested: unknown, allowFullModel = false): string {
  // 闸落下时谁都只能拿 mini，包括管理员——它是应急开关，不是权限
  if (FORCE_MINI) return "gpt-realtime-2.1-mini";
  if (!allowFullModel) return DEFAULT_VOICE_MODEL;
  return typeof requested === "string" && (VOICE_MODELS as readonly string[]).includes(requested)
    ? requested
    : DEFAULT_VOICE_MODEL;
}

/**
 * 助手说的颜色 → 本产品的中文色彩词。
 *
 * purple / red / yellow 故意映射到词表外的词：实测目录里 color_family 只有
 * warm 617 · gray 188 · black 48 · sage 36 · earth 30 · pure_white 21 ·
 * cool 19 · green 11 · blue 9 · pink 6，这三个色族一款都没有。
 * 给词表外的词，searchForPartner 会把它算进 unknownColors 并给出可以直接念的
 * 说法——好过放宽成「忽略颜色」，再拿一堆米色冒充紫色。
 */
const COLOR_ENUM_TO_WORDS: Record<string, string[]> = {
  beige: ["米色", "米白"],
  black: ["黑色"],
  blue: ["蓝色", "冷灰"],
  brown: ["深咖", "浅咖"],
  gray: ["浅灰", "中灰", "深灰"],
  green: ["绿色", "灰绿"],
  orange: ["大地色"],
  pink: ["粉色"],
  purple: ["紫色"],
  red: ["红色"],
  white: ["纯白", "米白"],
  yellow: ["黄色"]
};

/** 助手说的纤维 → 本产品的质感分类 */
const MATERIAL_TO_CLASS: Record<string, string> = {
  wool: "wool",
  linen: "cotton_linen",
  cotton: "cotton_linen",
  polyester: "polyester_smooth",
  poly: "polyester_smooth",
  viscose: "viscose_soft",
  rayon: "viscose_soft"
};

/** 克重档位，取自 985 款的真实分布（主帘 p25 294 · 中位 321 · p75 348） */
const WEIGHT_BANDS: Record<string, [number, number]> = {
  light: [0, 299],
  medium: [300, 360],
  heavy: [361, 9999]
};

/**
 * 表面观感三档。
 *
 * 对方原来只有两档，因为它库里的供应商 `texture_type` 只有「大肌理」「小肌理/纯色」。
 * 本产品用视觉重标过的 pattern_level，有三档：素 146 · 细肌理 493 · 花纹 346。
 * 沿用两档会让 346 款（35% 的目录）永远搜不到，所以这里扩成三档，
 * 并在铸凭证时给提示词追加一句说明——提示词原文一个字没动。
 */
const TEXTURE_TO_PATTERN: Record<string, string> = {
  plain: "solid",
  textured: "texture",
  patterned: "pattern"
};

const PATTERN_TO_TEXTURE: Record<string, string> = {
  solid: "plain",
  texture: "textured",
  pattern: "patterned"
};

export function buildTools() {
  const tools: unknown[] = [
    {
      type: "function",
      name: "wait_for_user",
      description:
        "Stay quiet ONLY while he is mid-action: reading the cards you just put up, comparing " +
        "pictures on screen, scanning the QR code. Interrupting someone's action is rude — " +
        "that is what this tool prevents, and nothing else. It is NOT for dead air: if he has " +
        "gone quiet and is not doing anything, that silence is your ball to pick up — say " +
        "something short about what he is looking at and hand him an easy opening. You will " +
        "hear the moment he speaks, taps, or something new lands on screen.",
      parameters: { type: "object", properties: {}, required: [] }
    },
    {
      type: "function",
      name: "search_products",
      description:
        "Look up whether the shop stocks something — 'do you have this in blue', 'is there anything " +
        "heavier'. It answers YOUR question so you can reply truthfully; **the customer does not " +
        "see these**, nothing appears on his screen. It is not a way to show him fabrics and it is " +
        "not a recommendation: use recommend_for_room for that, and offer_choices when he needs " +
        "to see something to choose from. Returns up to 4 verified fabrics with colour, weight, " +
        "composition and texture. These fabrics have no product names and " +
        "no measured blackout rating — never invent a name or a light-blocking claim.",
      parameters: {
        type: "object",
        properties: {
          color: {
            type: "string",
            enum: [...Object.keys(COLOR_ENUM_TO_WORDS), "any"],
            description: "Colour the customer asked for."
          },
          material: {
            type: "string",
            description:
              "Fibre keyword to match, e.g. wool, linen, cotton, polyester, viscose."
          },
          weight: {
            type: "string",
            enum: ["light", "medium", "heavy", "any"],
            description:
              "Fabric weight. Heavier hangs denser and insulates better; it is NOT a blackout rating."
          },
          texture: {
            type: "string",
            enum: ["plain", "textured", "patterned", "any"],
            description:
              "plain = smooth or solid colour; textured = visible weave structure; patterned = a printed or woven motif."
          },
          layer: {
            type: "string",
            enum: ["main", "sheer", "any"],
            description: "main = main curtain; sheer = voile. Only 4 sheers are in stock."
          }
        },
        required: []
      }
    },
    {
      type: "function",
      name: "get_orientation_figure",
      description:
        "Typical non-price figures the shop works with: curtain box depth, hem clearance, rail height, side overlap, pleat fullness, and what each opacity level actually does. Use this for 'roughly how deep / how high / how full / how dark' questions instead of saying it depends.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "The customer's question, in any language." }
        },
        required: ["question"]
      }
    },
    {
      type: "function",
      name: "search_knowledge",
      description:
        "Search published store knowledge (fabric, opacity, style, colour, care). Only facts returned here may be used.",
      parameters: {
        type: "object",
        properties: { question: { type: "string" } },
        required: ["question"]
      }
    },
    {
      type: "function",
      name: "offer_choices",
      description:
        "Put TAPPABLE cards on the screen — real fabric close-ups, or colour swatches from actual stock. " +
        "This is the shop's sample book. Most people cannot describe a fabric: they do not know " +
        "'jacquard', they cannot tell you whether they want texture or a print, and asking twice in " +
        "other words is how you make someone feel stupid. **They cannot say it, but they can point at it.**\n" +
        "WHEN: the moment they hesitate, say 'I don't know', 'hard to say', 'you tell me', or answer " +
        "something vague — and proactively for feel and pattern, which nobody describes in words in any language.\n" +
        "**NOT when he has just told you exactly what he wants.** Cards in the face of a clear demand " +
        "read as a form shoved at him ('I asked for blackout, you gave me style tabs') — act on the " +
        "demand instead.\n" +
        "**THREE AT A TIME, NEVER MORE.** This is the opposite of what it feels like it should be: the less " +
        "sure someone is, the FEWER pictures they can handle, because a glance cannot compare six fabrics " +
        "on texture, weight, drape and colour at once. Six does not read as 'I need more time' — it reads " +
        "as going quiet and asking for your opinion.\n" +
        "**Every set carries one extra card: 'I couldn't say — you pick'.** Tapping it is a real answer, " +
        "not a failure: it means 'you decide', it gets recorded, and **you never ask that question again**.\n" +
        "WHAT YOU SAY WHEN YOU CALL IT — three things, in one or two sentences: what tapping does, what " +
        "they get out of it, and how. 'Tap whichever one looks right and I'll know which direction to " +
        "pull from — it'll fit your place better. Tap the picture, or just tell me.' " +
        "**Never just 'have a look'.** Then STOP TALKING — do not read the options aloud, they are reading them.\n" +
        "A tap is an answer: acknowledge it in one short sentence, use it, never ask that question again. " +
        "Answering out loud instead is just as good — never insist on the screen. " +
        "Never put up two sets in a row without saying something in between; that is a form, not a conversation.\n" +
        "kinds: feel = how it feels in the hand; pattern = plain / weave / motif; layer = main vs sheer " +
        "(only 4 sheers exist, rarely worth asking); light = what they need from daylight (wordings, no " +
        "photos on purpose — 'dark enough' is a feeling, and any photo would be deciding it for them); " +
        "colour = swatches from stock.",
      parameters: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["feel", "pattern", "layer", "light", "colour"],
            description: "Which question to put on screen."
          },
          spoken_prompt: {
            type: "string",
            description:
              "The one short line you are about to say, in the customer's language. Shown above " +
              "the cards so the salesperson sees what was asked."
          },
          round: {
            type: "integer",
            description:
              "Leave empty. Pass 2 for `feel` ONLY when they looked at the first three and none " +
              "fit — it shows the two remaining ones. Never open with round 2."
          }
        },
        required: ["kind"]
      }
    },
    {
      type: "function",
      name: "request_photo_qr",
      description:
        "Put a QR code on the screen so the customer can send a photo **from his own phone**. " +
        "WHEN: he says the photo is on his phone, that he has one at home, that he took some " +
        "earlier — or when he does not want the salesperson pointing a camera around his room. " +
        "His own phone usually has the better photo anyway: taken in daylight, several angles, " +
        "furniture in place.\n" +
        "He scans it with his camera, picks a photo, and it appears on this screen — no login, " +
        "no app. Good for ten minutes.\n" +
        "SAY, in one sentence: what he gets ('then I can show you this fabric hanging in your own " +
        "room'), not what we get. Then stop talking and let him do it.\n" +
        "If he cannot scan it, has no signal, or hesitates — drop it at once and offer the normal " +
        "way, the salesperson can photograph the room here. **Never offer the code twice.**",
      parameters: { type: "object", properties: {}, required: [] }
    },
    {
      type: "function",
      name: "recommend_for_room",
      description:
        "The real recommendation for THIS room: it reads the room photo, keeps only what works " +
        "with those colours, spreads five across different characters, and writes a reason for each. " +
        "About 30 seconds — **say what you are doing first** ('let me look at your room properly, " +
        "give me half a minute') and keep talking while it runs; half a minute of silence feels broken.\n" +
        "WHEN: a room photo exists, or the candidates have been narrowed enough (the turn note tells " +
        "you which — 'ready to pick five' or 'not enough to pick five yet'). Never guess this yourself.\n" +
        "IF IT REFUSES: that is not an error, it means keep talking. **The customer must never hear " +
        "that a tool refused** — that is our plumbing, not their problem. Say nothing about it.\n" +
        "WHEN IT COMES BACK — the screen does the showing, you do ONE thing: in one or two short " +
        "sentences, say what you saw in his room and which ONE you would start with, tied to the " +
        "pain he named (sleep, glare, heat, privacy). Then invite him to tap whatever catches his " +
        "eye — and stop. The written notes on screen are his to read, not yours to recite: never " +
        "walk the list, never describe the five one by one, never say a reference code. When he " +
        "asks about one, answer from its character and what he told you — and an honest caveat " +
        "('this one is on the thin side') is worth more than praise.\n" +
        "NOT for getting something on screen faster — that is what offer_choices is for.",
      parameters: {
        type: "object",
        properties: {
          room_type: { type: "string", description: "living room, bedroom, study..." },
          style: { type: "string" },
          colour: { type: "string", description: "in the customer's own words" },
          opacity: { type: "string", description: "what they said about light and darkness" },
          extra: { type: "string", description: "anything else they told you that matters" },
          language: {
            type: "string",
            enum: ["nl", "fr", "en", "zh"],
            description:
              "The language THIS customer is speaking. The reasons come back written in it, so you " +
              "read them out instead of translating on the fly — that is where their own words get lost."
          }
        },
        required: []
      }
    },
    {
      type: "function",
      name: "save_consultation",
      description:
        "Save a consultation summary for the store team so the customer never has to repeat themselves.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
          language: { type: "string" },
          preferences: { type: "string" },
          recommended_sku_ids: { type: "array", items: { type: "string" } }
        },
        required: ["summary"]
      }
    },
    {
      type: "function",
      name: "escalate_to_staff",
      description:
        "Get a human colleague over to this customer, now, while they are still in the shop. " +
        "**The test is always the same: is the next step something only a person can do?**\n" +
        "CALL IT WHEN — and say the matching sentence in the SAME turn:\n" +
        "· they ask about price → you are not allowed to say a number. 'I'll have a colleague price " +
        "that for your window, he's coming over.' (kind: cannot_answer) You do not know prices AT ALL — " +
        "never claim one fabric is cheaper or dearer than another, not even 'the budget-friendly ones'.\n" +
        "· they want to touch a sample or see the real thing → you cannot hand them cloth. " +
        "'Let me get a colleague to bring you the actual fabric.' (wants_human)\n" +
        "· they want to see how dark it really goes → only a colleague can hold the torch behind it. " +
        "You still explain the three levels yourself. (needs_demo)\n" +
        "· they keep going back and forth between two → 'I'll have both brought over so you can put " +
        "them side by side.' (wants_human)\n" +
        "· they ask for a person, in any wording, however casual → 'Yes, getting someone now.' (wants_human)\n" +
        "· load bearing, mounting, certification, child safety → you may not conclude. (cannot_answer)\n" +
        "· they are visibly unhappy → call immediately, do not explain and do not defend. (unhappy)\n" +
        "DO NOT CALL IT WHEN:\n" +
        "· **they are signalling they will leave** ('I'll think about it', 'we'll come back'). Sending " +
        "someone over turns a polite exit into being cornered. Let them go, warmly.\n" +
        "· the turn note says this kind has already been called for. Repeat cards teach the staff to " +
        "ignore the cards, and then the urgent one is ignored too.\n" +
        "· they mentioned price in passing and the subject has moved on.\n" +
        "AFTER IT RETURNS: delivered → tell them a colleague is on the way. **Not delivered → never say " +
        "you notified anyone.** Say you will go and find someone yourself, and that someone will be here " +
        "before they leave. And if nobody has claimed it after a while, do not repeat the same promise — " +
        "say you are chasing it, or move them onto something else.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string" },
          question: { type: "string", description: "the customer's own words, in their language" },
          kind: {
            type: "string",
            enum: ["needs_demo", "wants_human", "unhappy", "cannot_answer"]
          }
        },
        required: ["reason"]
      }
    },
    {
      type: "function",
      name: "request_followup",
      description:
        "The customer wants the store team to take something forward — a quote for their window, " +
        "an in-home measurement, or a callback. **Call this the moment they say yes**, not at the " +
        "end of the call: this is the one signal the shop must not lose.",
      parameters: {
        type: "object",
        properties: {
          what: { type: "string", enum: ["quote", "measurement", "callback", "other"] },
          detail: { type: "string", description: "which window, which fabric, what they asked for" },
          contact: { type: "string", description: "only if the customer offered it unprompted" }
        },
        required: ["what"]
      }
    }
  ];

  if (PRICE_TOOLS_ENABLED) {
    tools.push(
      {
        type: "function",
        name: "get_product_price",
        description:
          "Get the verified store price for one SKU. If no verified price exists you must not state a price number.",
        parameters: {
          type: "object",
          properties: { sku_id: { type: "string" } },
          required: ["sku_id"]
        }
      },
      {
        type: "function",
        name: "get_price_range",
        description:
          "Typical price range across the store's own catalog, for answering 'roughly how much?' before any specific product is chosen. Speak it as an everyday range, never as a quote.",
        parameters: { type: "object", properties: {}, required: [] }
      }
    );
  }

  return tools;
}

/**
 * 追加给提示词的说明。
 *
 * 价格那一段原来也在这里，现在已经写进提示词原文——覆盖不如改源，
 * 一份说明比「原文说 A、补充说明说非 A」好读，也好审。
 * 留在这里的只有一条：表面观感的档数取决于本产品的目录，
 * 而目录会变，写死进提示词就要人记得同步。
 */
export function instructionSupplement() {
  const parts = [
    "# Catalog note: fabric surface has three levels",
    "The `texture` parameter takes plain (smooth or solid colour), textured (visible weave " +
      "structure) or patterned (a printed or woven motif). The catalog holds 146 plain, " +
      "493 textured and 346 patterned fabrics, so `patterned` is a real option, not a rarity."
  ];
  if (PRICE_TOOLS_ENABLED) {
    // 开关打开时反过来：提示词原文写的是「没有价格工具」，这里把它接回去
    parts.push(
      "",
      "# Pricing is available in this session",
      "get_product_price returns the verified price for one fabric; get_price_range returns the " +
        "typical range across the catalog. Both override the standing instruction that you have " +
        "no pricing tool: call them, and speak the result as an everyday range with the " +
        "qualifier inside the sentence. Never quote a number that did not come from them."
    );
  }
  return parts.join("\n");
}

// ---- 中文可搜的分词 ----

/** 高频虚词。作为 bigram 几乎命中所有条目，会把真信号淹没 */
const STOPWORD_BIGRAMS = new Set([
  "什么", "可以", "应该", "能不", "不能", "直接", "够不", "不够", "怎么", "为什",
  "有什", "没有", "这个", "那个", "一下", "需要", "是不", "不是", "的话", "我们",
  "你们", "他们", "一个", "一些", "还是", "或者", "以及", "如果", "因为", "所以"
]);

/**
 * 中文没有空格，按空白切出来的是整句，永远匹配不上。
 * 拉丁文保留词，汉字切成二元组。用 \p{Script=Han} 而不是字符区间——
 * 属性转义还覆盖了区间会静默漏掉的 CJK 扩展区。
 */
export function searchTerms(question: string): string[] {
  const lower = question.toLowerCase();
  const out: string[] = [];
  for (const w of lower.split(/[^a-z0-9]+/u)) {
    if (w.length >= 3) out.push(w);
  }
  for (const seg of lower.replace(/[^\p{Script=Han}]+/gu, " ").split(/\s+/u)) {
    for (let i = 0; i + 1 < seg.length; i++) {
      const gram = seg.slice(i, i + 2);
      if (!STOPWORD_BIGRAMS.has(gram)) out.push(gram);
    }
  }
  return [...new Set(out)];
}

/**
 * 会伤人或误报价的问题，无论文本检索碰巧匹配到什么，都不能用自动清洗的知识来答。
 * 只针对「能不能行」类：安全、合规、商业承诺。
 * 「大概多少」类（尺寸、价格、工期）刻意不匹配——那类要给有依据的区间。
 */
const ESCALATE_LATIN =
  /(load.?bearing|hold the weight|take the weight|fall down|plasterboard|drywall|anchor|certif|formaldehyde|flame.?retard|allerg|child.?safe|cord|strangl|legal|complian|discount|warrant|refund)/i;

const ESCALATE_ZH = [
  "承重", "受力", "承得住", "撑得住", "掉下来", "石膏板", "空心墙", "加固",
  "膨胀螺丝", "基层", "能不能装", "能否安装", "装得了", "认证", "检测标准",
  "甲醛", "环保标准", "阻燃", "防火", "过敏", "儿童安全", "安全标准",
  "拉绳", "绳子", "缠到", "勒到", "法律", "合规", "折扣", "促销",
  "保修", "质保", "退换", "退货", "包退", "包换"
];

export function needsEscalation(question: string): boolean {
  if (ESCALATE_LATIN.test(question)) return true;
  return ESCALATE_ZH.some((k) => question.includes(k));
}

/**
 * 目录里根本没有的属性。提示词禁止说，这张表是用来发现它还是说了。
 *
 * **只报警，拦不住**：音频从 OpenAI 直接进顾客耳朵，转录到达服务端时话已出口。
 * 它买到的是「说过几次、说的哪个词」，于是提示词可以对着真实案例改，而不是猜。
 *
 * 用词根不用整词：「防水性」会漏掉「防水效果」。四种语言都要有——
 * 只写中文的话，一场法语对话会得到漂亮的零命中，看起来像成功。
 *
 * **故意不含「保温 / insulate」**：提示词明确允许说「更重的布垂感更密、更保温」。
 * 把自己批准的句子标成违规，最快的结果是所有人学会无视告警。
 *
 * **2026-08-02 移除了遮光/衬里那一族**（遮光·透光·blackout·lining·verduister·
 * voering·occultant·doublure…）。原因不是放松，是口径变了：门店的《遮光讲解与
 * 服务标准化执行手册 V2.0》规定遮光本来就靠现场手电实测来讲，助手讲分档常识
 * （高遮光进卧室、中遮光进客厅、纱帘只作装饰）是门店的标准服务，不是编造。
 * 真正不能说的那件事换成下面的 GRADE_CLAIM 精确捕捉：**把某个等级或百分比
 * 安在具体一款面料上**——那才是目录里没有、只能靠到店打光才知道的东西。
 */
const UNVERIFIED_CLAIM_ROOTS = [
  "涂层", "耐磨", "防水", "防紫外", "抗菌", "阻燃", "防火",
  "隔音", "免洗", "水洗",
  "coating", "waterproof", "water-resistant", "antibacterial", "anti-bacterial",
  "flame retard", "fire retard", "fireproof", "soundproof", "machine wash", "machine-wash",
  "waterdicht", "antibacter", "brandvertrag", "geluiddemp", "wasmachine", "machinewas",
  "enduction", "imperméab", "antibactérien", "ignifug", "phonique", "lavable en machine"
];

/**
 * 遮光的**数值化断言**：百分比与遮光词凑在一起。
 *
 * 手册的三档本身带百分比（95-99 / 60-85 / <30），但入库的条目里我一个数字都没写——
 * 助手只该说视觉表现（无光点 / 柔和光晕 / 明显穿透）。所以一旦冒出百分比，
 * 它就不是来自知识库，而是模型自己补的，那正是要抓的。
 */
const GRADE_CLAIM =
  /(\d{1,3}\s*%[^。！？.!?]{0,14}(遮光|透光|blackout|verduister|occult))|((遮光|透光|blackout|verduister|occult)[^。！？.!?]{0,14}\d{1,3}\s*%)/i;

export function scanUnverified(text: string): string[] {
  const hay = text.toLowerCase();
  const hits = UNVERIFIED_CLAIM_ROOTS.filter((root) => hay.includes(root));
  if (GRADE_CLAIM.test(text)) hits.push("遮光百分比");
  return hits;
}

// ---- 运行期读写 ----

export async function readVoiceConfig(key: string): Promise<string> {
  const result = await getDb().query("select value from voice_config where key = $1", [key]);
  return result.rows[0]?.value ?? "";
}

export async function logVoice(kind: string, payload: unknown, sessionLabel?: string | null) {
  try {
    await getDb().query(
      "insert into voice_logs (kind, payload, session_label) values ($1, $2, $3)",
      [kind, JSON.stringify(payload ?? {}), sessionLabel ?? null]
    );
  } catch (error) {
    /**
     * 记日志本身绝不能弄断通话——但也不该完全无声。
     *
     * 2026-08-03：生产这条路径静默失败了一整天，于是老板连报三次「连不通」，
     * 而库里干干净净，三轮排查全是猜。本地写得进（同一个连接串），生产写不进，
     * 原因还没查明。至少让它出现在 Vercel 的函数日志里，下次有得看。
     */
    console.warn("[voice] logVoice failed", kind, error instanceof Error ? error.message : error);
  }
}

/**
 * 飞书群机器人按关键词「门店」过滤。少了这个词，它会返回 200 但正文 code 非零，
 * 消息一个人都收不到——整类告警静默消失而代码看起来健康。
 * **所以每张卡的标题都必须带「门店」**，见 buildStaffCard 与 buildQualityCard。
 *
 * 超时按「谁在等」分档：转人工是顾客当面等着（4s），事后告警没人等（8s）。
 * 实测投递 1.4–2.6s，原来那个没测就定的 2s 恰好压在分布中间，告警成了抛硬币。
 */
async function postToLark(
  payload: unknown,
  timeoutMs: number,
  configKey = "lark_webhook_url"
): Promise<boolean> {
  let url = (await readVoiceConfig(configKey)).trim();
  // 质量告警本该发另一个群（店员看「助手说了目录里没有的属性」没有任何可做的，
  // 还会把真正要他走过去的消息顶下去）。群没建好之前退回主群，但卡片长得不一样。
  if (!url && configKey !== "lark_webhook_url") url = (await readVoiceConfig("lark_webhook_url")).trim();
  if (!url) return false;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const body = await resp.text();
    const ok = resp.ok && !/"code"\s*:\s*[1-9]/.test(body);
    if (!ok) await logVoice("staff_notify_failed", { status: resp.status, body: body.slice(0, 300) });
    return ok;
  } catch (error) {
    await logVoice("staff_notify_failed", { error: String(error) });
    return false;
  }
}

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/+$/, "");

/** 比利时同事不该为了看一条消息去心算 UTC */
function shopTime() {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Europe/Brussels",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date());
}

/**
 * 给店员的跟进卡。
 *
 * 设计只有一条：**第一行是动作，不是信息。** 店员在手机上瞥一眼群消息，
 * 要先知道自己该干嘛，再看为什么。原来发的三行（原因/问题/UTC 时间戳）
 * 里没有一件事是可行动的——不知道哪家店、哪个顾问、顾客还在不在、
 * 刚才聊了什么、推了哪几款、怎么回电。
 *
 * 「顾客还在店里」是整张卡最要紧的一条，因为它决定走过去还是回电。
 * 这里可以直接写死：工具是在通话进行中被调用的，顾客就在旁边。
 */
type StaffCardKind = "followup" | "needs_demo" | "wants_human" | "unhappy" | "auto";

const STAFF_CARD: Record<StaffCardKind, { title: string; template: string }> = {
  // 标题必须带「门店」——群机器人按这个关键词过滤，少了它返回 200 但没人收到
  followup: { title: "🟢 门店 · 有人要报价 / 量尺", template: "green" },
  needs_demo: { title: "🟠 门店 · 请拿手电过来", template: "orange" },
  wants_human: { title: "🔵 门店 · 顾客想找人聊", template: "blue" },
  unhappy: { title: "🔴 门店 · 顾客不太满意", template: "red" },
  /**
   * 助手自己判断出来的。**标题必须和前四种区分开**——那四种是顾客亲口要求的，
   * 这一种是我们推断的，店员有权用不同的紧迫感对待它。
   * 说成一样紧急，两天之内他会把所有卡一视同仁地忽略掉。
   */
  auto: { title: "🟡 门店 · 这一位可能需要你", template: "yellow" }
};

type StaffCardInput = {
  kind: StaffCardKind;
  said?: string;
  why?: string;
  shop?: string;
  advisor?: string;
  soFar?: string;
  picks?: string;
  displayCode?: string;
  consultationId?: string;
};

function buildStaffCard(input: StaffCardInput) {
  const style = STAFF_CARD[input.kind];
  const elements: unknown[] = [];

  elements.push({
    tag: "div",
    text: {
      tag: "lark_md",
      content: [
        input.shop ? `**${input.shop}**` : null,
        input.advisor ? `${input.advisor} 在接待` : null,
        "**顾客还在店里**"
      ]
        .filter(Boolean)
        .join(" · ")
    }
  });

  if (input.said || input.why) {
    elements.push({ tag: "hr" });
    if (input.said) {
      elements.push({
        tag: "div",
        text: { tag: "lark_md", content: `**顾客问的**\n「${input.said.slice(0, 300)}」` }
      });
    }
    if (input.why) {
      elements.push({
        tag: "div",
        text: { tag: "lark_md", content: `**为什么转过来**\n${input.why.slice(0, 300)}` }
      });
    }
  }

  // 这两样让店员走过去时手里有东西——他的第一句不该是「您好请问有什么需要」，
  // 顾客刚跟助手说过一遍了
  const facts: unknown[] = [];
  if (input.soFar) {
    facts.push({ is_short: false, text: { tag: "lark_md", content: `**聊到哪了**\n${input.soFar.slice(0, 200)}` } });
  }
  if (input.picks) {
    facts.push({ is_short: false, text: { tag: "lark_md", content: `**推了哪几款**\n${input.picks.slice(0, 200)}` } });
  }
  if (facts.length) {
    elements.push({ tag: "hr" });
    elements.push({ tag: "div", fields: facts });
  }

  if (input.consultationId) {
    elements.push({
      tag: "action",
      actions: [
        {
          tag: "button",
          type: "primary",
          text: { tag: "plain_text", content: `打开咨询单${input.displayCode ? ` ${input.displayCode}` : ""}` },
          url: `${SITE_URL}/app/consultations/${input.consultationId}`
        }
      ]
    });
  }

  elements.push({
    tag: "note",
    elements: [{ tag: "plain_text", content: `${shopTime()} 当地时间 · DRAPÉ 语音顾问` }]
  });

  return {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: { template: style.template, title: { tag: "plain_text", content: style.title } },
      elements
    }
  };
}

/**
 * 自动判定出来的交接。和 escalate_to_staff 走同一张卡的骨架，
 * 但标题是黄的、措辞是「可能需要你」——它没有顾客的明确要求撑腰。
 */
export async function postAutoHandoff(input: {
  action: string;
  why: string;
  said: string;
  advisor?: string;
  soFar?: string;
  picks?: string;
  displayCode?: string;
  consultationId?: string;
}) {
  return postToLark(
    buildStaffCard({
      kind: "auto",
      // 第一行是动作：店员瞥一眼要先知道自己该干嘛
      why: `**${input.action}** — ${input.why}`,
      said: input.said,
      advisor: input.advisor,
      soFar: input.soFar,
      picks: input.picks,
      displayCode: input.displayCode,
      consultationId: input.consultationId
    }),
    4000
  );
}

/**
 * 质量告警。**收件人是我们，不是店员**——店员看到「助手说了目录里没有的属性」
 * 完全不知道该干什么，而下一条真正要他走过去的消息就被顶下去了。
 * 所以另发一个 webhook，卡也长得不一样：灰头、没有按钮、标题不带「请」。
 */
function buildQualityCard(terms: string[], said: string) {
  return {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: {
        template: "grey",
        title: { tag: "plain_text", content: "⚪ 门店语音 · 助手说了目录里没有的属性" }
      },
      elements: [
        { tag: "div", text: { tag: "lark_md", content: `**命中**\n${terms.join("、")}` } },
        { tag: "div", text: { tag: "lark_md", content: `**原话**\n${said.slice(0, 400)}` } },
        {
          tag: "note",
          elements: [
            {
              tag: "plain_text",
              content: `${shopTime()} 当地时间 · 这是事后告警，话已经出口，不必去找顾客`
            }
          ]
        }
      ]
    }
  };
}

export async function reportUnverified(terms: string[], said: string, sessionLabel?: string | null) {
  await logVoice("spoke_unverified", { terms, said: said.slice(0, 500) }, sessionLabel);
  await postToLark(buildQualityCard(terms, said), 8000, "lark_quality_webhook_url");
}

// ---- 工具执行 ----

function pick(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" && value.trim() && value.trim() !== "any" ? value.trim() : "";
}

/**
 * 主纤维标签。算不出来就返回 null，**绝不猜**。
 *
 * 起因是一次真实会话：助手把 `42.6%C 30.6%R 26.8%VI` 那一款说成了「羊毛混纺」——
 * 羊毛来自同一批结果里的另一款。它读不懂缩写，就挑了个认得的词。
 * 目录里 985 款有 65 款是这种缩写记法（供应商填的，含义未经确认），
 * 把 C 认成 cotton 是我们在猜，猜错就是替顾客编造成分。
 *
 * 所以只认完整英文纤维名（三个字母以上）；只有缩写时给 null，
 * 并在结果里明确告诉模型这一款不要谈成分。
 */
function fibreLabel(composition?: string | null): string | null {
  if (!composition) return null;
  const parts = [...String(composition).matchAll(/([\d.]+)\s*%\s*([A-Za-z]{3,})/g)];
  if (parts.length === 0) return null;
  const fibres = parts
    .map((m) => ({ pct: parseFloat(m[1]), name: m[2].toLowerCase() }))
    .sort((a, b) => b.pct - a.pct);
  const top = fibres[0].name;
  const cap = top.charAt(0).toUpperCase() + top.slice(1);
  if (fibres[1] && fibres[1].pct >= 25) return `${cap}–${fibres[1].name}`;
  return fibres.length > 1 ? `${cap} blend` : cap;
}

async function runSearchProducts(args: Record<string, unknown>) {
  const color = pick(args, "color");
  const material = pick(args, "material").toLowerCase();
  const texture = pick(args, "texture");
  const layer = pick(args, "layer");
  const weight = pick(args, "weight");

  const materialClass = Object.entries(MATERIAL_TO_CLASS).find(([keyword]) =>
    material.includes(keyword)
  )?.[1];

  const slots: PartnerSlots = {
    colors: color ? COLOR_ENUM_TO_WORDS[color] ?? [color] : [],
    pattern: texture ? TEXTURE_TO_PATTERN[texture] ?? null : null,
    materials: materialClass ? [materialClass] : [],
    fabricType: layer === "sheer" ? "sheer" : layer === "main" ? "cloth" : null,
    weightGsm: weight ? WEIGHT_BANDS[weight] ?? null : null
  };

  const found = await searchForPartner(slots, 4, true);
  const products = found.items.map((item) => {
    const fibre = fibreLabel(item.facts.composition as string | null);
    return {
      ref: item.sku,
      color: item.facts.colorWord,
      weight_gsm: item.facts.weightGsm,
      // fibre 是可以说出口的那个；composition 是原文，留着备查但不该照念
      fibre,
      composition: item.facts.composition,
      texture: PATTERN_TO_TEXTURE[String(item.facts.patternLevel)] ?? item.facts.patternLevel,
      layer: item.facts.isSheer ? "sheer" : "main",
      image_url: item.imageUrl
    };
  });
  const unreadable = products.filter((p) => p.fibre === null).map((p) => p.ref);

  return {
    total_matches: found.total,
    relaxed_filters: found.relaxedFacets.length ? found.relaxedFacets.join(",") : null,
    products,
    // 每一款的成分只能取它自己那一行。曾经出过一次串台：读不懂缩写的那款
    // 被安上了同一批结果里另一款的羊毛。
    fibre_note:
      "Describe a fabric's material with its own `fibre` value and nothing else. Never carry a " +
      "fibre from one product to another, and never read `composition` out loud." +
      (unreadable.length
        ? ` For ${unreadable.join(", ")} the supplier wrote the composition in abbreviations we ` +
          "cannot resolve, so `fibre` is null: say nothing about what those are made of — " +
          "talk about their colour, weight and how they hang instead."
        : ""),
    // 每次都说一遍，模型才不会漂移到编造它们
    not_available: ["product name", "blackout rating", "room advice"],
    ...(found.unknownColors.length
      ? {
          colors_not_in_catalog: found.unknownColors,
          guidance:
            `The catalog has no ${found.unknownColors.join(", ")} fabric at all. Say so plainly ` +
            "and offer what is actually there — do not present the fabrics below as if they " +
            "were the colour asked for."
        }
      : {}),
    evidence: { source: "sku_material", queried_at: new Date().toISOString() }
  };
}

async function runOrientationFigure(args: Record<string, unknown>) {
  const result = await getDb().query(
    "select topic, question_hint, low, high, unit, spoken_note, review_status from voice_orientation_figures"
  );
  const terms = searchTerms(String(args.question ?? ""));
  const scored = result.rows
    .map((row) => {
      const hay = `${row.topic} ${row.question_hint}`.toLowerCase();
      let score = 0;
      for (const term of terms) if (hay.includes(term)) score += 1;
      return { row, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return {
      status: "no_figure",
      guidance:
        "No grounded figure for this. Do not invent one: name what it depends on and offer to have a colleague work it out."
    };
  }

  const top = scored[0].row;
  // 只有门店知道的那几条，low/high 是故意留空的。给个数字就是编。
  if (top.review_status === "awaiting_owner") {
    return {
      status: "only_the_shop_knows",
      topic: top.topic,
      guidance:
        "This one has no figure on purpose — only the shop can answer it. Do not guess and do not imply a value. Say a colleague has the exact answer, call escalate_to_staff, and keep moving on what you can progress."
    };
  }

  return {
    status: "figure",
    topic: top.topic,
    low: top.low === null ? null : Number(top.low),
    high: top.high === null ? null : Number(top.high),
    unit: top.unit,
    spoken_note: top.spoken_note,
    guidance:
      "Round it off and say it as an everyday range with the qualifier inside the sentence. These figures are provisional and not yet reviewed by the shop, so never present one as a specification or a commitment, and never append a disclaimer either.",
    review_status: top.review_status
  };
}

async function runSearchKnowledge(args: Record<string, unknown>) {
  const question = String(args.question ?? "").trim();
  if (needsEscalation(question)) {
    return {
      entries: [],
      note:
        "This is a 'will it work' question (load bearing, mounting, certification, safety, or a commercial commitment). There is no rough answer here and no range. Do not conclude and do not estimate: say plainly that a colleague settles this one, call escalate_to_staff, and in the same turn keep moving on what you CAN progress."
    };
  }

  const result = await getDb().query(
    "select knowledge_id, content_short, question_variants, locale_scope, verification from voice_kb_available limit 80"
  );
  const terms = searchTerms(question);
  const scored = result.rows
    .map((row) => {
      const hay = [row.content_short ?? "", (row.question_variants ?? []).join(" ")]
        .join(" ")
        .toLowerCase();
      let score = 0;
      for (const term of terms) if (hay.includes(term)) score += 1;
      return { row, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((entry) => entry.row);

  if (scored.length === 0) {
    return {
      entries: [],
      note:
        "Nothing in the store knowledge covers this. Say plainly that you don't know this one and a colleague will settle it, call escalate_to_staff, then continue on what you can progress — do not let the turn dead-end."
    };
  }

  return {
    entries: scored,
    usage_note:
      "Use these to explain and advise in your own words. They carry no figures by design, so never read one out as a specification. Do NOT append a disclaimer to the customer — carry the qualifier inside the sentence ('generally', 'depends on the fabric', 'we'd pin that down when we measure')."
  };
}

/**
 * 这一场的咨询单。它是「保存咨询」的落点，也是给店员那张卡片的全部素材来源：
 * 聊到哪了、推了哪几款、点进去看照片和效果图——没有它，卡片就只能退回
 * 原来那三行谁也用不上的字。
 */
type ToolContext = { actor: WorkspaceActor; consultationId: string | null };

async function loadConsultationBrief(context?: ToolContext) {
  if (!context?.consultationId) return null;
  try {
    const item = await getConsultation(context.actor, context.consultationId);
    if (!item) return null;
    const preferences = item.preferences as Record<string, unknown>;
    const skus = (item.recommendation as { skus?: { color?: string }[] })?.skus;
    return {
      id: item.id,
      displayCode: item.displayCode,
      advisor: item.advisorName,
      shop: item.roomType ? `${item.roomType}` : "",
      soFar: [preferences?.summary, preferences?.preferences].filter(Boolean).join(" · ") || "",
      picks: Array.isArray(skus)
        ? skus.map((sku) => sku?.color).filter(Boolean).slice(0, 5).join(" / ")
        : ""
    };
  } catch {
    // 读不到咨询单不该弄断通话，卡片少几行照样发得出去
    return null;
  }
}

/**
 * 为这个房间正式选五款——走主站那条完整链路，不是按槽位快搜。
 *
 * 两者的差别是老板一眼看出来的:"我图片才刚发，你的推荐产品就到了"。
 * `search_products` 是 3~6ms 的槽位检索，用来回答「有没有蓝色的」这类问题;
 * 正式选品要跑四层——房间取色 → 和谐色域过滤 → 分层多样化 → 模型重排写理由，
 * 约 22 秒。**慢是因为它真的看了那张照片。**
 *
 * 重排层给每款写四段:space（对这个空间的判断，五款共用，客户看一眼照片就能
 * 验真假）、why、matched、caveat（规定不能为空）。space 就是老板说的
 * 「视觉识别的理由」，以前语音这边完全没用上。
 */
/**
 * 出货前的闸门。
 *
 * 起点是老板 2026-08-03 的原话:「我图片才刚发,你的推荐产品就到了」——
 * 发照片后 5 秒屏幕上就是五款布,顾客一个字还没说。问题不在快,
 * 在于**那不是推荐,是随便抓的四款**:生产日志里 search_products 的参数全是 `any`。
 *
 * ── 这里曾经拦错了地方 ──
 *
 * 上一版按「一个顾问该知道三件事」设了三个必填项:哪个房间、光线上要什么、
 * 一个口味信号。老板 08-04 打回:「你说的几个必要的东西,是不是真的必要,
 * 能不能筛出产品,我是打问号的,感觉你完全没有去了解我们的推荐逻辑。」
 *
 * 去读 `filterBySurvey` 的 FACET_MATCHERS 才发现他是对的:**真正能筛掉货的只有
 * 六项**(颜色族/深浅/花纹档/质感/布纱/不要花的)。三个必填项里,「哪个房间」
 * 和「光线上要什么」**一款货都筛不掉**——网页问卷那道题下面原文就写着
 * 「会写进推荐说明,但不筛掉商品」。
 *
 * 所以那道闸门拦住了本来能跑通的链路(有照片就足以推荐),
 * 却没有拦住真正的问题(候选池没被收窄)。
 *
 * ── 现在拦在哪 ──
 *
 * **有照片就放行,因为照片自己就是筛选器**:取色 → 协调色域 → 分层多样化,
 * 而且「协调只做减法,绝不导致推荐失败」。
 *
 * 没照片则退回引导拍照(下面的 noPhoto)。不是不想放行,是**没照片时这条链路
 * 会退化成按目录顺序取前五款**(`selectCandidatesForModel` 里 `analyzeRoom`
 * 返回 null 就走 `byCatalogOrder`)——那恰好就是要修的那个 bug。
 * 收窄到 80 款以内再取「最前面的五款」,仍然不是「最合适的五款」。
 */
/**
 * 让顾客用自己手机传照片:屏幕上出一个二维码。
 *
 * 解决的是一件很具体的事——顾客的房间照片在**他自己手机里**,而店里那台在
 * 顾问手上。现在无解(只能加微信,太重)。而顾客手机里那张往往还更好:
 * 白天拍的、多角度、家具都在。
 */
async function runRequestPhotoQr(context?: ToolContext, sessionLabel?: string | null) {
  if (!context?.consultationId) {
    return {
      status: "not_ready",
      guidance:
        "This conversation has no consultation open yet, so there is nothing to attach a photo to. " +
        "Ask the salesperson to take one with the camera key first — say nothing about this to the customer."
    };
  }

  const [{ issueUploadToken }, QRCode] = await Promise.all([
    import("@/lib/voice-upload-token"),
    import("qrcode")
  ]);

  let issued: ReturnType<typeof issueUploadToken>;
  try {
    issued = issueUploadToken(context.consultationId, context.actor.organizationId);
  } catch {
    // 签不出来(缺密钥)不能把这条路演成成功——顾客会一直等一张永远不出现的照片
    await logVoice("qr_issue_failed", { reason: "missing_secret" }, sessionLabel);
    return {
      status: "unavailable",
      guidance:
        "The QR route is not available right now. Do not mention codes or phones. " +
        "Offer the normal way instead: the salesperson can photograph the room here."
    };
  }

  /**
   * nonce 落在咨询单上——**这一步是「一次性」的全部实现**。
   * 上传接口消掉它才算认领成功,所以同一枚码传不了第二次,
   * 而重新叫一次这个工具会盖掉旧的 nonce,于是上一张码当场作废。
   */
  await getDb().query(
    `update consultations set preferences = preferences || $3::jsonb
      where id = $1 and organization_id = $2`,
    [
      context.consultationId,
      context.actor.organizationId,
      JSON.stringify({ uploadNonce: issued.nonce })
    ]
  );

  const url = `${SITE_URL}/u/${issued.token}`;
  // SVG 而不是 PNG:门店灯光下矢量放大不糊,而且省掉一次图片编码
  const svg = await QRCode.toString(url, {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
    width: 320
  });

  await logVoice("qr_issued", { expires_at: issued.expiresAt }, sessionLabel);

  return {
    status: "on_screen",
    // 前端据此把码摆上屏幕；顾客传完会自己收起来
    qr: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
    expires_in_minutes: 10,
    guidance:
      "The code is on the screen now. Tell him to scan it with his phone camera and pick the " +
      "photo — one sentence, in his language, then stop. Say what he gets out of it " +
      "('then I can show you this fabric hanging in your own room'), not what we get out of it. " +
      "It is good for ten minutes. If he cannot scan it or has no signal, drop it immediately " +
      "and offer the normal way: the salesperson photographs the room here. Never push it twice."
  };
}

async function runRecommendForRoom(args: Record<string, unknown>, context?: ToolContext) {
  const noPhoto = {
    status: "no_photo",
    guidance:
      "There is no room photo on this consultation yet, so the proper selection cannot run — " +
      "it is the photo that makes it worth 30 seconds. Ask the salesperson to take one " +
      "(the camera key is next to the orb), and keep the conversation going meanwhile."
  };
  if (!context?.consultationId) return noPhoto;

  const item = await getConsultation(context.actor, context.consultationId);
  if (!item?.sceneR2Key) return noPhoto;

  const taste = ((item.preferences as { taste?: Record<string, string[]> })?.taste ?? {}) as Record<
    string,
    string[]
  >;

  // 顾客指过的和嘴上说的进同一个漏斗
  const tapped = tasteToRecommendationArgs(taste);

  /**
   * **动态 import，不要提到文件头。**
   *
   * 这个模块被 token 路由间接引入（铸凭证 → voice-tools → 这里）。静态 import
   * 会把整条推荐链路（推荐编排、重排、商品目录、R2 的 aws-sdk）拉进铸凭证的
   * 冷启动里——实测把一次未认证的 401 从毫秒级拖到 60 秒以上。
   * 铸凭证一慢，40 秒看门狗就先掐断，重连、再慢、再掐，屏幕上就是「一直连不通」。
   * 只有真的要选品时才付这个加载成本。
   */
  const [{ runAgentRecommendation }, { getFileFromR2 }] = await Promise.all([
    import("@/lib/agent-provider"),
    import("@/lib/r2")
  ]);

  const file = await getFileFromR2(item.sceneR2Key);
  if (!file) return noPhoto;

  const sceneImageDataUrl = `data:${file.contentType || "image/jpeg"};base64,${Buffer.from(file.body).toString("base64")}`;

  /**
   * **顾客点过的要真的去筛货。**
   *
   * 这里以前传 `survey: null`，理由是「语音场景没有六题问卷」。后果是:
   * 顾客在屏幕上点的每一张卡,最后只变成提示词里的一句话,一款货都筛不掉——
   * 而 agent-provider 拿不到 survey 时就只按房间配色挑。
   * 于是「我要羊毛的」和什么都没说,候选池是同一个。
   *
   * 点过的选项本来就是问卷的六个硬筛维度里的四个(颜色族/花纹档/材质/布纱),
   * 翻过去就能用。收窄过头也不必担心:agent-provider 里那句
   * `surveyed.length >= 5 ? surveyed : catalog` 会退回全量,
   * 「协调只做减法,且绝不导致推荐失败」。
   */
  const { tasteToAnswers } = await import("@/lib/voice-context");
  const survey = tasteToAnswers(taste);

  const result = await runAgentRecommendation({
    modelId: "qwen-qwen3-vl-flash",
    roomType: pick(args, "room_type"),
    style: pick(args, "style"),
    // 点过的合进说过的：顾客指着屏幕说「就这种」和他开口说「要米色」，
    // 是同一件事的两种表达，不该只有一种算数
    desiredColor: [pick(args, "colour"), tapped.colour].filter(Boolean).join("、"),
    opacityNeed: [pick(args, "opacity"), tapped.opacity].filter(Boolean).join("；"),
    extraInstruction: [pick(args, "extra"), tapped.feel, tapped.pattern, tapped.layer]
      .filter(Boolean)
      .join("；"),
    sceneImageDataUrl,
    survey,
    /**
     * **理由直接用顾客的语言写出来。**
     *
     * 这里以前不传,于是 agent-provider 按缺省的中文生成,助手拿到一段中文
     * 再当场翻成荷兰语念出去。多这一跳,最容易丢的恰好是最要紧的东西——
     * 「引用顾客自己说过的话」:他说的是 nl,理由里那句原话先被译成中文,
     * 再译回 nl,就不是他说的那句了。
     *
     * 语种由模型填:顾客在说什么语言,只有听得见的那一方知道(SPEC §4.4)。
     * 它没填就退回中文,和以前一样。
     */
    locale: (["nl", "fr", "en", "zh"] as const).includes(
      pick(args, "language") as "nl" | "fr" | "en" | "zh"
    )
      ? (pick(args, "language") as "nl" | "fr" | "en" | "zh")
      : undefined
  });

  const reasons = result.recommendation?.sku_reasons ?? [];
  const byId = new Map(reasons.map((reason) => [reason.sku_id, reason]));
  const display = result.skus.map((sku) => {
    const reason = byId.get(sku.sku_id);
    return {
      ref: sku.sku_id,
      color: sku.color || "",
      weight_gsm: sku.weight_gsm ?? null,
      composition: sku.composition ?? null,
      texture: sku.texture_type ?? null,
      image_url: sku.image_url ?? null,
      why: reason?.why ?? "",
      caveat: reason?.caveat ?? ""
    };
  });

  try {
    await updateConsultation(context.actor, item.id, {
      recommendation: {
        source: "voice",
        space: reasons[0]?.space ?? "",
        rerankSource: result.recommendation?.ranking_source ?? "",
        harmonyStrict: result.harmonyStrict,
        skus: display
      },
      status: "recommended"
    });
  } catch {
    /* 存档失败不该弄断通话——屏幕上已经有货了 */
  }

  /**
   * 给模型的 picks **故意不带书面理由**。
   *
   * 老板 08-05:「原有的推荐逻辑是给人看的,看的时候觉得很不错,但是说出来就
   * 很慢。」此前 why/caveat 五段书面文全在这里递给模型,它就照着念——禁令写
   * 多少条都拦不住,因为稿子就在它手里。现在书面理由只活在屏幕上(display,
   * 前端回传模型前会剥掉),模型手里只有颜色和几个字的性格,想念长文也没得念。
   */
  const character = (sku: (typeof display)[number]) => {
    const bits: string[] = [];
    if (sku.texture) bits.push(String(sku.texture));
    if (sku.weight_gsm) {
      bits.push(sku.weight_gsm >= 380 ? "heavy" : sku.weight_gsm <= 220 ? "light" : "medium");
    }
    const fibre = String(sku.composition ?? "").match(
      /linen|wool|cotton|velvet|silk|viscose|polyester/i
    )?.[0];
    if (fibre) bits.push(fibre.toLowerCase());
    return bits.join(", ");
  };

  return {
    status: "ready",
    // 五款共用的那段空间判断。开口第一句用它，顾客才知道你真的看了照片
    space: reasons[0]?.space ?? "",
    picks: display.map((sku) => ({
      colour: sku.color,
      character: character(sku),
      caveat: sku.caveat
    })),
    display,
    guidance:
      "The five are ON SCREEN with photos and written notes — he can read. Say ONE or TWO short " +
      "sentences total, in his language: your one-line reading of the room (`space`, in your own " +
      "words) plus which ONE you would start with and what it fixes for him — use the pain he " +
      "named (sleep, glare, heat, privacy). Then invite him to tap what catches his eye, and stop. " +
      "Never walk the list. If he asks about one, speak from its character and his needs; an " +
      "honest caveat is worth more than praise."
  };
}

export async function runVoiceTool(
  name: string,
  args: Record<string, unknown>,
  sessionLabel?: string | null,
  context?: ToolContext
): Promise<unknown> {
  switch (name) {
    case "search_products":
      return runSearchProducts(args);
    case "offer_choices": {
      const kind = String(args.kind ?? "feel");
      const round = Number(args.round) === 2 ? 2 : 1;
      const group = await buildChoiceGroup(
        (CHOICE_KINDS as readonly string[]).includes(kind) ? (kind as ChoiceKind) : "feel",
        round
      );
      await logVoice("choices_offered", { kind: group.kind, n: group.choices.length, round }, sessionLabel);
      return {
        status: "on_screen",
        kind: group.kind,
        // 前端据此渲染卡片
        group,
        /*
         * 08-05 测试台抓到的回声:模型开卡前已经说了那句话,这里再来一句
         * "say your line if you have not already",它就会把几乎同一句再说一遍。
         * 说过了 → wait_for_user 闭嘴;没说 → 才补一句。
         */
        guidance:
          "The cards are on his screen. If you already said your one line, do NOT add another — " +
          "call wait_for_user and let him read. Only if you said nothing yet: one short line, " +
          "then stop. Never read the options aloud — he is reading them. A tap will be announced; " +
          "an answer said out loud counts the same."
      };
    }
    case "request_photo_qr":
      return runRequestPhotoQr(context, sessionLabel);
    case "recommend_for_room":
      return runRecommendForRoom(args, context);
    case "get_orientation_figure":
      return runOrientationFigure(args);
    case "search_knowledge":
      return runSearchKnowledge(args);
    case "save_consultation": {
      await logVoice("consultation", args, sessionLabel);
      // 这个工具原来只写一行日志就完了，而它对助手的说法是
      // 「把咨询摘要保存给店里团队，顾客就不必重复自己」——没有任何人看得到。
      // 现在真的写进咨询单，业务人员在同一个列表里能跟这条线索。
      if (context?.consultationId) {
        try {
          const current = await getConsultation(context.actor, context.consultationId);
          if (current) {
            await updateConsultation(context.actor, current.id, {
              preferences: {
                ...(current.preferences as Record<string, unknown>),
                summary: String(args.summary ?? "").slice(0, 2000),
                language: String(args.language ?? ""),
                preferences: String(args.preferences ?? "").slice(0, 1000),
                recommendedSkuIds: Array.isArray(args.recommended_sku_ids)
                  ? args.recommended_sku_ids.slice(0, 10)
                  : [],
                savedAt: new Date().toISOString()
              }
            });
          }
        } catch {
          /* 存档失败不该弄断通话 */
        }
      }
      return { status: "saved" };
    }
    case "request_followup": {
      await logVoice("followup_requested", args, sessionLabel);
      const brief = await loadConsultationBrief(context);
      const what = String(args.what ?? "other");
      const label =
        what === "quote" ? "要报价" : what === "measurement" ? "要上门量尺" : what === "callback" ? "要回电" : "要跟进";
      // 这是整条链路上唯一的成交信号。提示词里写着 gentle close 要 offer
      // 「让同事按您的窗户尺寸出个报价」，顾客说好之后**以前什么都不会发生**。
      const notified = await postToLark(
        buildStaffCard({
          kind: "followup",
          said: String(args.detail ?? ""),
          why: `顾客${label}${args.contact ? `，留了联系方式：${String(args.contact).slice(0, 80)}` : ""}`,
          advisor: brief?.advisor,
          soFar: brief?.soFar,
          picks: brief?.picks,
          displayCode: brief?.displayCode,
          consultationId: brief?.id
        }),
        4000
      );
      return notified
        ? { status: "requested", note: "The shop has it. Tell the customer a colleague will pick it up." }
        : {
            status: "logged_only",
            note:
              "The shop was not reachable just now. Do NOT promise a colleague has been notified — say you will make sure someone picks it up, and tell the salesperson holding this phone before the customer leaves."
          };
    }
    case "escalate_to_staff": {
      await logVoice("escalation", args, sessionLabel);
      const brief = await loadConsultationBrief(context);
      const kind = String(args.kind ?? "");
      const cardKind: StaffCardKind =
        kind === "needs_demo" || kind === "unhappy" || kind === "wants_human" ? kind : "wants_human";
      const notified = await postToLark(
        buildStaffCard({
          kind: cardKind,
          said: String(args.question ?? ""),
          why: String(args.reason ?? ""),
          advisor: brief?.advisor,
          soFar: brief?.soFar,
          picks: brief?.picks,
          displayCode: brief?.displayCode,
          consultationId: brief?.id
        }),
        4000
      );
      // 送不达时绝不能回「已通知」——助手是当着顾客的面把这句说出口的，没有撤回机会
      return notified
        ? { status: "escalated", note: "A colleague has been notified." }
        : {
            status: "logged_only",
            note:
              "No colleague could be reached just now, so do NOT tell the customer one has been notified. Say you will carry the question to a colleague yourself, and make sure someone in the shop hears it before she leaves."
          };
    }
    case "get_product_price":
    case "get_price_range":
      // 工具没下发就不该被调到；真被调到说明模型在凭记忆猜，明确告诉它别说数字
      return {
        status: "disabled",
        guidance:
          "Price tools are switched off. Do not state, estimate or bracket any price. Say a colleague will confirm the exact price for their window, and continue on what you can answer."
      };
    default:
      return { error: "unknown_tool" };
  }
}
