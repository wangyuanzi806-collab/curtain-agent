import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const i18nSource = readFileSync(new URL("../src/lib/i18n.tsx", import.meta.url), "utf8");
const cssSource = readFileSync(new URL("../src/app/royalzen.css", import.meta.url), "utf8");
const appShellSource = readFileSync(
  new URL("../src/components/royalzen/app-shell.tsx", import.meta.url),
  "utf8"
);

test("语言按钮写各自语言的名字，不是缩写代码", () => {
  // 「中 · EN · NL · FR」三个拉丁字母缩写挨在一起，客户分不清哪个是荷兰语哪个是法语。
  // 每个按钮必须写它自己语言里的名字。
  assert.match(i18nSource, /zh:\s*"中文"/);
  assert.match(i18nSource, /en:\s*"English"/);
  assert.match(i18nSource, /nl:\s*"Nederlands"/);
  assert.match(i18nSource, /fr:\s*"Français"/);
});

test("顶栏那句不接后端状态的静态文字已经删掉", () => {
  assert.doesNotMatch(appShellSource, /AI 服务正常/);
  assert.doesNotMatch(cssSource, /\.rz-topbar-meta/);
});

test("切语言一律从中文原文翻，不能拿屏幕上当前那句去查表", () => {
  /*
   * 线上真实故障：中英能切，切荷兰语/法语没反应。
   *
   * 翻译表的键全是中文。切过一次英文之后 DOM 里已经是 "Welcome back"，
   * 再切荷兰语时若拿这个英文去查荷兰语表，永远查不到，于是原地不动。
   * 原先只有"切回中文"那条分支会用 originalText 还原，外语→外语这条路径漏了。
   *
   * 修法是翻译前先取回记录的中文原文（recorded），没记录过才用当前值。
   * 这两个断言盯住的就是"source 来自 recorded 而不是 current"这件事。
   */
  assert.match(
    i18nSource,
    /const source = recorded !== undefined \? recorded : current;[\s\S]{0,200}translateRoyalZenText\(source, targetLocale\)/,
    "文本节点必须从记录的中文原文翻译"
  );
  // 属性（aria-label / placeholder / title / alt）走的是同一套逻辑，一起盯住
  const attributeBlock = i18nSource.slice(i18nSource.indexOf("for (const attribute of attributes)"));
  assert.match(
    attributeBlock,
    /const source = recorded !== undefined \? recorded : current;/,
    "属性也必须从记录的中文原文翻译，否则切过英文后同样卡住"
  );
  assert.doesNotMatch(
    i18nSource,
    /const translated = translateRoyalZenText\(current, targetLocale\)/,
    "不能再出现拿当前 DOM 文本直接查表的写法"
  );
});

test("四语言切换器变宽后，顶栏/分享页头/平台页头都留了换行余地", () => {
  // 四个按钮从两字母缩写换成各自语言全名后最长的是 "Nederlands"，
  // 实测 375px 视口下这几处原来两端对齐、不换行的一行会溢出或被压成竖排。
  // 不是给某个语言的长度调像素预算——是让容器允许换行，换哪种语言都不怕。
  assert.match(cssSource, /\.rz-topbar \{ flex-wrap: wrap;/, "顾问工作台顶栏要能换行");
  assert.match(cssSource, /\.rz-share-nav \{ flex-wrap: wrap;/, "分享页头要能换行");
  assert.match(cssSource, /\.rz-platform-page > header \{ flex-wrap: wrap;/, "平台控制页头要能换行");
});
