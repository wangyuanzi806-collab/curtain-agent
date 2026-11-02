/**
 * 推荐链路第四层：让模型在已经过硬约束的候选里挑最终 5 款，并写出理由。
 *
 * 分工的依据是实测：规则单独跑会选出 5 款雷同的（都挤在色域中心），
 * 模型单独跑会把 C=40 的芥末黄和 L=14.5 的纯黑排第一。
 * 所以规则划安全边界，模型只在边界内排序——它不能增删商品。
 */

const RERANK_TIMEOUT_MS = 45000;
const PICK_COUNT = 5;
// 留足余量：五款各三段，写长了会被截断，截断的 JSON 无法解析，整次重排就白跑
const MAX_TOKENS = 7000;

const RERANK_MODEL = "MiniMax-M3";

/**
 * 数据里没有的属性，出现即视为编造。当前 SKU 无衬里、涂层、实测遮光、耐磨度字段。
 *
 * 词根要写短：曾经只列「遮光率」「衬里」，模型写出「遮光效果一般」和
 * 「是否需要加衬」照样过关——遮光正是我们有意留空、绝不能猜的那一项。
 */
const FORBIDDEN_CLAIMS = [
  // 只拦「衬里/加衬」这类工艺声称。词根写成单字「衬」会误伤
  // 「衬托出木质的温暖」这种正常搭配用语——实测 5 款里误杀 2 款。
  "衬里",
  "加衬",
  "衬布",
  "做衬",
  "涂层",
  "遮光",
  "透光率",
  "耐磨",
  "防水",
  "防紫外",
  "抗菌",
  "阻燃",
  "隔音",
  "隔热",
  "保温",
  "免洗",
  "水洗"
];

/**
 * 「六款里最中庸的」这类说法要拦掉：模型看到的是候选池，客户只看到最终 5 款，
 * 数量对不上。光在提示词里禁止不管用，实测仍会写出来。
 *
 * 模糊量词也要拦——线上验收抓到的原句是「b值0是**几款里**最中性的一个」，
 * 只列具体数字漏得掉。
 */
const COUNT_MENTION =
  /(?:[几数两三四五六七八九十百千0-9]+|这些|那些|所有|全部)\s*款(里|中|之中|当中|里面)/;

/**
 * 拿别款做参照的说法，例如「跟第一款类似」「比第二款略挺」「这款最薄」。
 *
 * 每张卡片都可能被单独分享出去，那时没有"第一款"可参照，客户看到的就是没头没尾一句话。
 * 而且这是偷懒——该说的是这块布和这个房间的关系，不是它和隔壁那块的关系。
 */
const CROSS_REFERENCE = /第[一二三四五六七八九十0-9]+款|这款最[厚薄亮深浅]|另一款|上一款|前一款/;

export type RerankCandidate = {
  factorySku: string;
  colorFamily: string;
  colorRgb: string;
  colorLabL: number;
  colorLabB: number;
  colorChroma: number;
  textureType: string;
  /** 花纹强弱的量化值（素色约 53、细肌理约 62、明显花纹约 84），"素净"这类选择靠它作证 */
  patternContrast: number;
  weightGsm: number;
  composition: string;
  penalty: number;
};

export type RerankPick = {
  factorySku: string;
  rank: number;
  /** ① 你的空间 —— 客户看一眼照片就能验证真假。5 款共用同一段，不让模型重复生成 */
  space: string;
  /** ② 为什么这款合适 —— 只说人话结论，数值一律放 evidence */
  why: string;
  /**
   * ③ 实测依据，单独一行。
   *
   * 客户看 why 那句就够了，看 evidence 才会信。数值必须带房间的对照值——
   * 单说窗帘"亮度 94.5"没有意义，"（墙面 84）"才让人知道"亮一点点"是多少。
   * 独立字段而不是拼进 why：前端才能把它排成小字灰行，看着像检测数据而不像句子。
   */
  evidence: string;
  /** ④ 满足了你的哪些选择 */
  matched: string[];
  /** ⑤ 需要注意，规定不能为空 */
  caveat: string;
};

export type RerankOutcome = {
  picks: RerankPick[];
  /** model = 模型排序成功；rules = 已降级为规则序 */
  source: "model" | "rules";
  degradeReason?: string;
  latencyMs: number;
};

export type RerankInput = {
  candidates: RerankCandidate[];
  /** 场景理解结果，来自视觉模型 */
  sceneSummary: string;
  windowType: string;
  /** 和谐色域每条边界的由来 */
  harmonyReasons: Record<string, string>;
  /** 客户在问卷里选了什么 */
  preferences: Record<string, string>;
  /**
   * 客户界面的语言。
   *
   * 这里以前根本没有这个参数，提示词写死"都用中文"——于是无论顾问把界面切到哪一种，
   * 卡片上的推荐理由永远是中文。方案页、分享页拿到的也都是同一份中文。
   */
  locale?: string;
  /** 房间取色不可信时为 false，理由里不许再谈配色协调 */
  colorTrusted: boolean;
  /** 候选是否全部通过和谐硬筛。false 时只做过排序，不能说"都已筛过" */
  harmonyStrict: boolean;
};

/** 写给模型看的语言名。键与前端 Locale 一致 */
const LANGUAGE_NAMES: Record<string, string> = {
  zh: "简体中文",
  en: "English",
  nl: "Nederlands（荷兰语）",
  fr: "Français（法语）"
};

function buildPrompt(input: RerankInput) {
  const list = input.candidates
    .map(
      (c, i) =>
        // 这里用什么词，模型就会把什么词抄进理由里。原先写「明度L94.5 冷暖b4 彩度C5.1」，
        // 客户看到的就是一串不认识的字母。喂中文词，出来的也是中文词。
        `${i + 1}. ${c.factorySku} | 色系${c.colorFamily} ${c.colorRgb} | 亮度${c.colorLabL} 暖调${c.colorLabB} 鲜艳度${c.colorChroma} | ${c.textureType}（花纹强度${c.patternContrast}） | ${c.weightGsm}g/m² | ${c.composition}`
    )
    .join("\n");

  const harmony = Object.values(input.harmonyReasons).join("；");
  const prefs = Object.entries(input.preferences)
    .map(([k, v]) => `${k}=${v}`)
    .join("，");

  const screening = input.harmonyStrict
    ? "下面这些商品都已通过颜色协调的硬性筛查，并按贴合度从高到低排好序（序号越小越贴合）。"
    : "符合客户条件的款式不多，下面这些**没有经过颜色硬筛**，只按与房间的贴合度排了序（序号越小越贴合）。挑的时候请自己把关协调性。";

  return `你是资深窗帘搭配顾问。${screening}你的任务是从中挑出最终 ${PICK_COUNT} 款并排序。

【客户的空间】${input.sceneSummary}
【窗型】${input.windowType}
【客户的选择】${prefs || "未填写"}
【配色分析】${input.colorTrusted ? harmony : "这张照片的空间配色无法可靠分析。不要在理由中谈论与房间的配色协调，也不要从空间描述里推测墙面或地面的颜色"}

【候选商品】
${list}

【要求】
1. 只能从上面 ${input.candidates.length} 款里选，必须原样返回编号（factory_sku），不得返回列表以外的任何编号
2. 选 ${PICK_COUNT} 款，按推荐优先级排序。**首要标准是和这个房间协调**——明度与冷暖要对得上上面的配色分析；
   在都协调的前提下，再让这 ${PICK_COUNT} 款彼此有区分度，客户才有得挑。
   两者冲突时以协调为准：宁可 ${PICK_COUNT} 款都偏浅，也不要为了拉开差距塞一款明显不搭的
3. 每款写四段，**全部用${LANGUAGE_NAMES[input.locale || "zh"] || LANGUAGE_NAMES.zh}书写**，口语化，不要形容词堆砌。
   客户是普通消费者，不是色彩工程师。下面的字数按中文计，换成其他语言时按同等信息量处理：
   - why：**70～90 字，超过 90 字就是啰嗦，里面不许出现任何数字**。太短会显得敷衍，要写满这三层：
     ① 和房间的关系——比墙面亮还是沉、冷暖对不对得上
     ② 挂上去会是什么样——会不会在墙上切出一块、垂下来什么感觉、白天光透过来什么效果
     ③ 和房间里已有的东西怎么呼应——沙发、茶几、灯、地板，只能从【客户的空间】里找，不许编
     例如「比墙面亮一点点，冷暖也跟房间一致，挂上去不会在墙面上切出一块突兀的色块；
     布面素净不抢戏，和那张大理石茶几、金色吊灯摆在一起正好当个安静的底色，
     白天光透过来会有一层柔和的过渡。」
     严禁写成「明度L94.5落在墙面L84同明度区间」这种——客户不知道 L 是什么
   - evidence：**上面那句结论的实测依据，单独一行，30 字以内**。
     格式：用「·」隔开 2～3 项，每项都要带房间的对照值，没有对照值的项就不要写。
     照抄这个格式：「亮度 94.5（墙面 84）· 暖调 +4（房间 +5）· 鲜艳度 5.1（上限 20）」
     只用【候选商品】和【配色分析】里真实出现过的数，一个都不许编
   - matched：字符串数组，逐条写【客户的选择】里的哪一条被这款满足了。
     **【客户的选择】是中文原文，但这里必须翻成第 3 条要求的目标语言，不许原样照抄中文**
     ——哪怕目标语言就是中文本身，也要按那条要求的语言重新表达一遍，不是复制粘贴。
     **能对上具体实测值的，在后面用括号补一个短数值**（数值取整，单位跟原样），
     对不上的就用目标语言重述这条选择，不要硬凑，也不要重复 evidence 里已有的项。
     最多 3 条带数值。
     **不要在这里放商品编号**，也不要把客户没提过的诉求写进来。没有对应项就给空数组
   - caveat：需要注意什么、建议怎么确认。**35 字以内，要具体、能照着做**，
     例如「偏薄，卧室建议加一层内衬；到店抓一把样布最准」。不允许为空
4. 严禁提及数据中不存在的属性：衬里、涂层、遮光、透光率、耐磨度、防水、抗菌、阻燃、隔音、隔热等一律不许出现。
   遮光是本商品库有意留空的字段，任何关于遮光效果的判断都是编造
5. 不要在理由里提及候选数量或推荐数量（例如"六款里最厚的"），客户看到的款数与你看到的不同
6. **每一款都要能单独看懂**。严禁写"跟第一款类似""比第二款略挺""这款最薄"这类拿别款做参照的话——
   客户可能只看到其中一张卡片（分享出去时就是单张），失去上下文就成了没头没尾的一句。
   每款只谈它自己和这个房间的关系

只输出 JSON，不要任何其他文字：
{"picks":[{"factory_sku":"","rank":1,"why":"","evidence":"","matched":[],"caveat":""}]}`;
}

function extractJson(text: string) {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("模型未返回可解析的 JSON");
  }
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * 按「·」分隔的完整分句截断，不按字符数硬切。
 *
 * evidence 是 `X（房间对照）· Y（房间对照）` 这种结构，每个分句自带一个括号。
 * 硬切字符数在拉丁语系下会切出半截括号——同样的信息中文最省字，法语、荷兰语
 * 明显更长，某一款商品的实测值恰好落在第 80 个字符中间就会切断。
 * 找不到分隔符（只有一句、或第一句本身就超长）时才退回硬切。
 */
function truncateAtSeparator(text: string, limit: number) {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const lastSeparator = cut.lastIndexOf("·");
  if (lastSeparator > limit * 0.4) return cut.slice(0, lastSeparator).trim();
  return cut;
}

/**
 * 降级路径上的实测行：只列商品自身的值。
 * 房间的对照值来自模型那一路的配色分析，这里拿不到，就不写——宁可少一半，不编一半。
 */
function fallbackEvidence(c: RerankCandidate) {
  const sign = c.colorLabB > 0 ? "+" : "";
  return `亮度 ${round1(c.colorLabL)} · 暖调 ${sign}${round1(c.colorLabB)} · 鲜艳度 ${round1(c.colorChroma)}`;
}

/** 规则序兜底：模型不可用时按 penalty 取前 N 款，理由走模板并标明未经模型判断 */
function fallbackPicks(input: RerankInput, reason: string, latencyMs: number): RerankOutcome {
  const picks = input.candidates.slice(0, PICK_COUNT).map((c, i) => ({
    factorySku: c.factorySku,
    rank: i + 1,
    space: input.sceneSummary,
    why: `${c.colorFamily}色系、${c.textureType}，亮度与冷暖都落在这个空间的协调范围内。`,
    evidence: fallbackEvidence(c),
    matched: [] as string[],
    caveat: "这一条是按配色规则排出的顺序，未经模型二次判断，建议由顾问再核对一次。"
  }));
  return { picks, source: "rules", degradeReason: reason, latencyMs };
}

export async function rerankCandidates(input: RerankInput): Promise<RerankOutcome> {
  const started = Date.now();
  const apiKey = process.env.MINIMAX_API_KEY;

  if (!apiKey) {
    return fallbackPicks(input, "未配置 MINIMAX_API_KEY", Date.now() - started);
  }
  if (input.candidates.length <= PICK_COUNT) {
    return fallbackPicks(input, "候选不足，无需重排", Date.now() - started);
  }

  let raw: string;
  try {
    const response = await fetch("https://api.minimaxi.com/v1/text/chatcompletion_v2", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: RERANK_MODEL,
        messages: [{ role: "user", content: buildPrompt(input) }],
        // 必须显式关闭思考。开着的话 M3 会在这个任务上思考一万两千字，
        // 把 token 预算吃光导致正文为空，耗时从 11 秒涨到 53 秒。
        // 注意 reasoning_effort / enable_thinking 这两个参数对它无效，只有这个写法生效。
        thinking: { type: "disabled" },
        max_tokens: MAX_TOKENS,
        temperature: 0.6
      }),
      signal: AbortSignal.timeout(RERANK_TIMEOUT_MS)
    });

    if (!response.ok) {
      return fallbackPicks(input, `模型返回 HTTP ${response.status}`, Date.now() - started);
    }
    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    raw = payload.choices?.[0]?.message?.content ?? "";
    if (!raw.trim()) {
      return fallbackPicks(input, "模型返回空正文", Date.now() - started);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return fallbackPicks(input, `请求失败：${message}`, Date.now() - started);
  }

  let parsed: { picks?: unknown };
  try {
    parsed = extractJson(raw);
  } catch {
    return fallbackPicks(input, "模型输出无法解析", Date.now() - started);
  }

  const allowed = new Set(input.candidates.map((c) => c.factorySku));
  const seen = new Set<string>();
  const picks: RerankPick[] = [];
  // 拦掉了什么必须留痕：校验一旦收得过严，线上表现是"理由悄悄变成模板"，
  // 不记原因就只能靠肉眼发现。
  const rejected: string[] = [];

  for (const item of Array.isArray(parsed.picks) ? parsed.picks : []) {
    const row = item as Record<string, unknown>;
    const sku = String(row.factory_sku ?? "").trim();
    // 约束一：只能重排，不能增删。候选池外的编号直接丢弃
    if (!allowed.has(sku) || seen.has(sku)) {
      if (sku) rejected.push(`${sku}=池外或重复`);
      continue;
    }

    const caveat = String(row.caveat ?? "").trim();
    const why = String(row.why ?? "").trim();
    // 约束二：每款必须有理由，第四段不许为空
    if (!why || !caveat) {
      rejected.push(`${sku}=理由为空`);
      continue;
    }

    const text = `${why}${caveat}`;
    const forbidden = FORBIDDEN_CLAIMS.find((word) => text.includes(word));
    if (forbidden) {
      rejected.push(`${sku}=编造属性「${forbidden}」`);
      continue;
    }
    // 约束三：不许提候选池的数量，客户看到的款数和模型看到的不一样
    const counted = text.match(COUNT_MENTION);
    if (counted) {
      rejected.push(`${sku}=数量表述「${counted[0]}」`);
      continue;
    }
    // 约束四：不许拿别款做参照，每张卡片都要能单独看懂
    const crossRef = text.match(CROSS_REFERENCE);
    if (crossRef) {
      rejected.push(`${sku}=跨款参照「${crossRef[0]}」`);
      continue;
    }

    // why 里混进数字不至于拒掉整条（一拒就掉进规则序，代价比一句话不完美大得多），
    // 但要留痕：这说明提示词的约束在这个模型上不牢，回头得盯着调。
    if (/\d/.test(why)) {
      console.warn(`[rerank] ${sku} 的 why 仍带数字，应当只留结论：${why.slice(0, 60)}`);
    }

    seen.add(sku);
    picks.push({
      factorySku: sku,
      rank: picks.length + 1,
      space: input.sceneSummary,
      why,
      // 没给就空着，前端少渲染一行即可，不为这个把整条判死。
      // 截断是防模型写飞：这一行的排版预算只有两行小字，长了会把卡片撑变形。
      // 开头偶尔带一个多余的分隔符（法语输出实测出现过 "· Luminosité …"），清掉
      evidence: truncateAtSeparator(String(row.evidence ?? "").trim().replace(/^·\s*/, ""), 80),
      matched: Array.isArray(row.matched) ? row.matched.map((m) => String(m)) : [],
      caveat
    });
    if (picks.length >= PICK_COUNT) break;
  }

  if (picks.length === 0) {
    const returned = (Array.isArray(parsed.picks) ? parsed.picks : [])
      .map((item) => String((item as Record<string, unknown>).factory_sku ?? ""))
      .slice(0, 3);
    return fallbackPicks(
      input,
      `模型返回内容全部未通过校验（返回了 ${returned.join("/") || "空"}，候选池形如 ${input.candidates[0]?.factorySku}）`,
      Date.now() - started
    );
  }

  if (rejected.length > 0) {
    console.warn(
      `[rerank] ${rejected.length} 条未通过校验，已用规则序补齐：${rejected.join("；")}`
    );
  }

  // 校验后不足 5 款时用规则序补齐，不让模型重来——它已经看过一次同样的池子
  for (const c of input.candidates) {
    if (picks.length >= PICK_COUNT) break;
    if (seen.has(c.factorySku)) continue;
    seen.add(c.factorySku);
    picks.push({
      factorySku: c.factorySku,
      rank: picks.length + 1,
      space: input.sceneSummary,
      why: `${c.colorFamily}色系、${c.textureType}，亮度与冷暖都落在这个空间的协调范围内。`,
      evidence: fallbackEvidence(c),
      matched: [],
      caveat: "这一条由配色规则补入，未经模型判断，建议由顾问再核对一次。"
    });
  }

  return { picks, source: "model", latencyMs: Date.now() - started };
}
