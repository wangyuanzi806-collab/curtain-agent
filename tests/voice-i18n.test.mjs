import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { translateVoiceText } from "../src/lib/voice-translations.ts";

const consoleSource = readFileSync(
  new URL("../src/components/royalzen/voice-console.tsx", import.meta.url),
  "utf8"
);
const interpreterSource = readFileSync(
  new URL("../src/components/royalzen/voice-interpreter.tsx", import.meta.url),
  "utf8"
);
const tableSource = readFileSync(new URL("../src/lib/voice-translations.ts", import.meta.url), "utf8");

const LOCALES = ["en", "nl", "fr"];
const CJK = /[一-龥]/;

/** 三张表的键，从源码里按段落切出来——不能靠 import，那样拿不到"哪张表少了哪条" */
function keysOf(name) {
  const body = tableSource.split(`const ${name}: Table = {`)[1]?.split("\n};")[0] ?? "";
  return new Set([...body.matchAll(/^\s*"([^"]+)":/gm)].map((m) => m[1]));
}

test("三张表的键完全一致——少一条就是那种语言静默漏一句", () => {
  const [en, nl, fr] = [keysOf("EN"), keysOf("NL"), keysOf("FR")];
  assert.ok(en.size > 50, `EN 词条只有 ${en.size} 条，像是没写完`);
  for (const [name, table] of [["NL", nl], ["FR", fr]]) {
    const missing = [...en].filter((k) => !table.has(k));
    const extra = [...table].filter((k) => !en.has(k));
    assert.deepEqual(missing, [], `${name} 少了这些键：${missing.join(" / ")}`);
    assert.deepEqual(extra, [], `${name} 多了这些键：${extra.join(" / ")}`);
  }
});

test("译文里不能有中文，也不能是空串", () => {
  const en = keysOf("EN");
  for (const locale of LOCALES) {
    for (const key of en) {
      const got = translateVoiceText(key, locale);
      assert.ok(got, `${locale} 缺「${key}」的译文`);
      assert.doesNotMatch(got, CJK, `${locale}「${key}」的译文里还留着中文：${got}`);
      assert.ok(got.trim().length > 0, `${locale}「${key}」译成了空串`);
    }
  }
});

/**
 * 覆盖率。**从源码真提取**，不手写清单——手写的清单只能证明我抄对了自己写的东西，
 * 而以后有人加一句界面文字忘了配词条，这条测试必须红。
 */
test("组件里会显示给人看的中文，每一句都有译文", () => {
  const strings = new Set();
  for (const source of [consoleSource, interpreterSource]) {
    for (const raw of source.split("\n")) {
      const line = raw.trim();
      if (line.startsWith("*") || line.startsWith("//") || line.startsWith("/*")) continue;
      for (const hit of line.match(/"[^"\n]*[一-龥][^"\n]*"/g) ?? []) {
        const text = hit.slice(1, -1);
        /*
         * 同一行里有模板串时，双引号会跨过反引号配对，切出
         * 「, `正在把${selected.color || 」这种碎片。
         * 这个坑之前让一整轮测试假绿过——判据是碎片里带着 ${ 或反引号。
         * 模板串本身由下面那个测试单独覆盖，不从这里漏掉。
         */
        if (text.includes("${") || text.includes("`")) continue;
        strings.add(text);
      }
    }
    /*
     * JSX 里的裸文本（<button>关闭</button>）不在任何引号里。
     * 漏了这一段，整条会话流——「问问这个房间」「近期接待」「＋ 下一位顾客」——
     * 全在扫描盲区里。实测过：把三张表里的「关闭」删干净，这个测试照样全绿。
     *
     * **按整份文件扫，不按行。** 一行一行地看，会漏掉 prettier 换行拆开的那种：
     *     <button onClick={...}>
     *       收起
     *     </button>
     * 这个盲区是加二维码那个「收起」按钮时撞上的——它当时确实没被扫到。
     */
    /*
     * 排除代码特征字符（分号、等号、括号、引号、方括号）是必须的：
     * TS 的泛型 `useState<Caption[]>([])` 里那对尖括号，在这条正则眼里
     * 和 JSX 标签长得一模一样，不排除就会把两个 useState 之间的所有代码
     * 当成一句界面文字扒出来。
     */
    const plain = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    for (const hit of plain.match(/>\s*[^<>{};=()"'`[\]]*[一-龥][^<>{};=()"'`[\]]*\s*</g) ?? []) {
      strings.add(hit.slice(1, -1).trim());
    }
  }
  assert.ok(strings.size > 30, `只提到 ${strings.size} 条，提取逻辑八成坏了`);

  const untranslated = [...strings].filter((s) => !NOT_UI.has(s) && !translateVoiceText(s, "nl"));
  assert.deepEqual(
    untranslated,
    [],
    `这些界面文字荷兰语界面上会露出中文：\n  ${untranslated.join("\n  ")}`
  );
});

/**
 * 豁免：这些中文不进 DOM，翻了反而坏事。
 * 每加一条都要说清为什么——豁免名单是这类测试唯一会烂掉的地方。
 */
const NOT_UI = new Set([
  // 连接阶段名。只作为变量拼进别的句子（「卡在取凭证」），由 RULES 里的 stage() 翻
  "取凭证",
  "等你允许麦克风",
  "交换 SDP",
  "交换 SDP（经服务端）",
  "建立音频通道",
  "接通",
  // 品牌名。荷兰语界面上也是 DRAPÉ，翻了就不是这家店了
  "DRAPÉ",
  "DRAPÉ TOLK"
]);

test("拼出来的句子也翻得掉——它们是店员出故障时唯一能读的字", () => {
  const cases = [
    "卡在取凭证",
    "接不通（卡在等你允许麦克风）— 点一下重试",
    "凭证被拒（取凭证 401）— 刷新页面再试",
    "麦克风打不开（NotAllowedError）",
    "已存下房间照片 · 墙面 米白",
    "正在把奶油白装进这个房间…",
    "正在合成奶油白… 约半分钟",
    "看奶油白装在您家什么样",
    "奶油白 · 装在这个房间",
    "已推 5 款"
  ];
  for (const locale of LOCALES) {
    for (const text of cases) {
      const got = translateVoiceText(text, locale);
      assert.ok(got, `${locale} 翻不掉「${text}」`);
      // 颜色名和错误码原样带过去是对的，但句子本身不能还是中文
      const leftover = got.replace(/奶油白|米白/g, "");
      assert.doesNotMatch(leftover, CJK, `${locale}「${text}」→「${got}」还留着中文`);
    }
  }
});

/**
 * 上面那个测试跳过了模板串（双引号在同一行里跨不过反引号）。
 * 这里把它们捡回来：源码里每一条含中文的模板串，骨架都得有规则接得住。
 * 少了这条，以后新加一句 `正在…${x}…` 忘了配规则，没有任何东西会红。
 */
test("模板串拼出来的句子，源码里有几条就得翻得掉几条", () => {
  const skeletons = new Set();
  for (const source of [consoleSource, interpreterSource]) {
    for (const raw of source.split("\n")) {
      const line = raw.trim();
      if (line.startsWith("*") || line.startsWith("//") || line.startsWith("/*")) continue;
      for (const hit of line.match(/`[^`\n]*[一-龥][^`\n]*`/g) ?? []) {
        // 变量位置塞个不含中文的值，只看句子骨架翻不翻得掉
        const skeleton = hit.slice(1, -1).replace(/\$\{[^}]*\}/g, "5").trim();
        if (skeleton && CJK.test(skeleton)) skeletons.add(skeleton);
      }
    }
  }
  assert.ok(skeletons.size >= 8, `只提到 ${skeletons.size} 条模板串，提取逻辑八成坏了`);

  const missed = [...skeletons].filter((s) => {
    const got = translateVoiceText(s, "nl");
    return !got || CJK.test(got);
  });
  assert.deepEqual(missed, [], `这些拼出来的句子在荷兰语界面上会露出中文：\n  ${missed.join("\n  ")}`);
});

test("阶段名嵌进句子时要跟着翻，不能还是中文", () => {
  const nl = translateVoiceText("卡在取凭证", "nl");
  assert.doesNotMatch(nl, CJK, `荷兰语里阶段名没翻：${nl}`);
  assert.match(nl, /toegang/i, `荷兰语该说 toegang ophalen，实际是：${nl}`);
});

test("中文界面不动它，不认识的句子交还主表", () => {
  assert.equal(translateVoiceText("待机", "zh"), null, "中文不该被改写");
  assert.equal(translateVoiceText("机构管理后台", "nl"), null, "主表管的词条不该被这里截胡");
});

/**
 * 上面那些测的都是语音端自己的函数。**它们全绿也不能说明界面真的会变**——
 * 界面走的是主表那个入口，语音端的表得先被它调到。
 *
 * 这里只能断言接线在，断不了接线通：主表内部用的是 bundler 风格的相对 import
 * （全项目都走 @/lib 别名，一处不带扩展名），node 原生 ESM 解析不了，
 * import 进来整个测试文件会直接挂。**接线通不通由 npm run build 保证**——
 * 加这行 import 之前先跑过一次，能编译就说明解析得到。
 */
test("接线还在：主表得真的把语音端这张表串进查表顺序", () => {
  const main = readFileSync(new URL("../src/lib/royalzen-translations.ts", import.meta.url), "utf8");
  assert.match(
    main,
    /import \{ translateVoiceText \} from "\.\/voice-translations"/,
    "主表不再 import 语音词条了，切荷兰语时语音那一面会整片退回中文"
  );
  assert.match(
    main,
    /TABLES\[locale\]\?\.\[content\] \?\? translateVoiceText\(content, locale\) \?\? ROYALZEN_EN\[content\]/,
    "查表顺序被改了。必须是「主表目标语言 → 语音表 → 英文兜底」：" +
      "语音表排到英文兜底后面，手上现成的荷兰语会被英文盖掉"
  );
});

test("转录那句必须挡在界面翻译之外", () => {
  /*
   * 界面翻译是运行时扫 DOM 文本节点替换，它不认识哪一句是转录。
   * 顾客答一声「好」而词典里恰好有「好」，屏幕上就会变成别的字——
   * 而屏幕是顾问核对「它听对了没有」的唯一凭据。
   */
  assert.match(
    consoleSource,
    /className=\{`rz-voice-cap is-\$\{item\.role\}`\} key=\{item\.id\} data-no-translate/,
    "转录那个 <p> 上的 data-no-translate 没了"
  );
});
