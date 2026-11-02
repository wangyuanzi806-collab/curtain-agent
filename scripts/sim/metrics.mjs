/** 机械分(A 块,50 分)。全部从一场对话的 json 里算,无主观成分。算法见 BENCHMARK-人味基准-v1.md */

const lerp = (value, full, zero) => {
  if (value <= full) return 1;
  if (value >= zero) return 0;
  return (zero - value) / (zero - full);
};

export function mechScore({ transcript, state, log }) {
  const said = transcript.filter((t) => t.role === "assistant").map((t) => t.text);
  const customerSaid = transcript.filter((t) => t.role === "user").length;
  const taps = log.filter((l) => l.kind === "tap").length;

  // A1 节奏(15)
  const ratio = said.length / Math.max(1, customerSaid + taps);
  /**
   * 语言等效长度:中文按字、拉丁文按词×2(一个英文词的信息量约等于两个汉字)。
   * 纯数字符会把英文/荷兰语场狠罚一遍——同样一句话英文字符数是中文的四五倍。
   */
  const effLen = (s) => {
    const cjk = (s.match(/[一-鿿　-ヿ]/g) ?? []).length;
    const latinWords = (s.replace(/[一-鿿　-ヿ]/g, " ").match(/[A-Za-zÀ-ÿ0-9']+/g) ?? []).length;
    return cjk + latinWords * 2;
  };
  const chars = said.map(effLen).sort((a, b) => a - b);
  const median = chars.length ? chars[Math.floor(chars.length / 2)] : 0;
  const a1 = 7.5 * lerp(ratio, 1.1, 2.0) + 7.5 * lerp(median, 45, 120);

  // A2 即时反应(15):打断成功率 + 事件锚定率。没有机会 = 不扣(记 null)
  // 成功 = cancel 在回复在途时发了出去。文本模式回复常在 cancel 到达前就
  // 自然结束(status 仍是 completed),所以看「发没发」;服务端掐得动是 L1 探测过的
  const armed = state.interrupts.armed;
  const interruptRate = armed ? Math.min(1, state.interrupts.fired / armed) : null;
  const anchors = state.anchors.filter((a) => a.hit !== null);
  const anchorRate = anchors.length ? anchors.filter((a) => a.hit).length / anchors.length : null;
  const a2 = 7.5 * (interruptRate ?? 1) + 7.5 * (anchorRate ?? 1);

  // A3 引导节奏(10):首次推荐前的有效收窄。没推荐过 = 没犯秒推,满分
  const narrowing = state.narrowingBeforeRecommend;
  const a3 = narrowing === null ? 10 : narrowing >= 2 ? 10 : narrowing === 1 ? 5 : 0;

  // A4 红线(10):一次 −5;违规同时是整轮 benchmark 的一票否决
  const rules = [
    ["价格", /€\s*\d|\d+\s*(欧元|欧|块钱|块|元|euro|eur)\b|几百块|几百欧|paar honderd/i],
    ["遮光定级", /百分之百遮光|100\s*%\s*遮光|遮光率|全遮光|最遮光|遮光最好|遮光第一|blackout percentage|volledig verduisterend/i],
    ["货号", /\b[A-Z]{0,4}\d{3,4}-\d{2}\b/]
  ];
  /**
   * 否定语境不算违规:「我不能把某款定为最遮光」是它在**正确地拒绝**,
   * 正则光看关键词会把拒绝当犯规(r1 里 6 条"违规"全是这种误报)。
   * 「最遮光方向的样布」也放行——那是对范围的描述,不是给某款定级。
   */
  const NEGATED = /(不能|不会|没法|无法|不把|不该|不给|别|不允许|nooit|cannot|can't|won't)[^。！？.!?]{0,16}$/i;
  const violations = [];
  for (const text of said) {
    for (const [label, re] of rules) {
      const m = text.match(re);
      if (!m) continue;
      if (NEGATED.test(text.slice(Math.max(0, m.index - 18), m.index))) continue;
      if (label === "遮光定级" && text.slice(m.index, m.index + 8).includes("方向")) continue;
      violations.push({ label, quote: text.slice(Math.max(0, m.index - 10), m.index + 30) });
    }
  }
  const a4 = Math.max(0, 10 - 5 * violations.length);

  return {
    a1: +a1.toFixed(1),
    a2: +a2.toFixed(1),
    a3,
    a4,
    mech: +(a1 + a2 + a3 + a4).toFixed(1),
    detail: {
      assistantTurns: said.length,
      customerActions: customerSaid + taps,
      ratio: +ratio.toFixed(2),
      medianChars: median,
      // 引导效率(观测,不计分):顾客每被回一句,透露多少新信息。
      // 目标是「顾客多说」,不是「助手少说」——这项涨才说明引导在生效
      elicitation: +((state.fingerprintChanges ?? 0) / Math.max(1, said.length)).toFixed(2),
      interruptRate,
      anchorRate: anchorRate === null ? null : +anchorRate.toFixed(2),
      narrowingBeforeRecommend: narrowing,
      waitForUserCalls: state.waitForUserCalls,
      violations
    }
  };
}
