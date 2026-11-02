import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const consoleSource = readFileSync(
  new URL("../src/components/royalzen/voice-console.tsx", import.meta.url),
  "utf8"
);
const pageSource = readFileSync(new URL("../src/app/app/voice/page.tsx", import.meta.url), "utf8");
const cssSource = readFileSync(new URL("../src/app/royalzen.css", import.meta.url), "utf8");
const voiceToolsSource = readFileSync(new URL("../src/lib/voice-tools.ts", import.meta.url), "utf8");
const appShellSource = readFileSync(
  new URL("../src/components/royalzen/app-shell.tsx", import.meta.url),
  "utf8"
);

test("网站和桌面快捷方式走同一套麦克风恢复流程", () => {
  /*
   * 不再猜用户是不是从桌面图标打开。Chrome 151+ 用浏览器原生的
   * <usermedia> 控件恢复已经拒绝过的权限；旧浏览器仍由同一个按钮走
   * getUserMedia fallback。
   */
  assert.doesNotMatch(consoleSource, /display-mode: standalone|standaloneApp|CHROME_INTENT_URL/);
  assert.doesNotMatch(consoleSource, /改用 Chrome 浏览器|RoyalZen AI Curtain Advisor/);
  assert.doesNotMatch(cssSource, /\.rz-voice-permission-card/);
  assert.match(consoleSource, /"HTMLUserMediaElement" in window/);
  assert.match(consoleSource, /createElement\(\s*"usermedia"/);
  assert.match(consoleSource, /control\.setConstraints\(\{ audio: true \}\)/);
  assert.match(consoleSource, /control\.addEventListener\("stream", onStream\)/);
  assert.match(consoleSource, /网站和桌面快捷方式使用同一份权限/);
});

test("旧版浏览器拿到流后直接开始通话，不再停掉后要求二次点击", () => {
  assert.match(consoleSource, /开启麦克风并开始通话/);
  assert.match(consoleSource, /navigator\.mediaDevices\.getUserMedia\(\{ audio: true \}\)/);
  assert.match(consoleSource, /micRef\.current = stream;[\s\S]*startRef\.current\?\.\(\)/);
});

test("麦克风拒绝要在建 WebRTC 之前立刻收口，并区分网站与系统权限", () => {
  const micAwait = consoleSource.indexOf("const stream = await micPromise;");
  const tokenStart = consoleSource.indexOf("const tokenPromise = takeToken()");
  const pcStart = consoleSource.indexOf("const pc = new RTCPeerConnection");
  assert.ok(micAwait > 0, "没有在主点击链上等待麦克风结果");
  assert.ok(micAwait < tokenStart, "麦克风拒绝后仍然先铸了凭证");
  assert.ok(micAwait < pcStart, "麦克风拒绝后仍然先建了 WebRTC");
  assert.match(consoleSource, /mic_permission:\$\{permissionState\}/);
  assert.match(consoleSource, /permissionState === "granted" \? "system"/);
  assert.match(consoleSource, /手机系统没有把麦克风交给浏览器/);
  assert.match(consoleSource, /网站麦克风权限已关闭/);
});

test("待机时顶栏不摆状态字，构建哈希不进页面", () => {
  // 「待机」两个字对顾客没有意义，而顾客能看到这块屏
  assert.match(consoleSource, /status !== "待机"/);
  // 构建哈希是排查用的，不该常驻在顾客面前
  assert.doesNotMatch(pageSource, /VERCEL_GIT_COMMIT_SHA|build=/);
  assert.doesNotMatch(cssSource, /\.rz-voice-build/);
});

test("模型标签要留着：门店是只读徽章，管理员才点得动", () => {
  /*
   * 这一条原本被写成「语音页不再显示模型名」，把 7fb0039 那次顺手删除
   * 固化成了规则——那次 commit 信只说修麦克风，一个字没提删掉模型选择。
   * 老板 08-04 问「你怎么把模型选择去掉了」，所以它是要留的：
   * 08-03 实测两个模型确实不一样（正式版该转人工三次全转、首句 11 字
   * 对 mini 的 31 字），而这个标签是唯一能在真机上比出差别的地方。
   */
  assert.match(consoleSource, /rz-voice-engine/, "模型标签又被删了");
  assert.match(cssSource, /\.rz-voice-engine/, "模型标签的样式没了，标签会变成一坨裸文字");
  // 门店账号请求正式版会被服务端回落成 mini，所以那边只该看到只读徽章
  assert.match(consoleSource, /canChooseModel \? \(/, "必须按身份决定它能不能点");
});

test("手机顾客屏不显示服务探针，但管理员模型切换不能再被当成调试字隐藏", () => {
  // 「AI 服务正常」这句静态文字（不接任何健康检查）已经整个删掉，不再是"手机上隐藏"。
  // 四语言切换器变宽后两者会挤在一起，删掉比继续为它挪地方更值。
  assert.doesNotMatch(
    appShellSource,
    /AI 服务正常/,
    "顶栏不该再显示这句不接后端状态的静态文字"
  );
  assert.doesNotMatch(
    cssSource,
    /\.rz-topbar-meta/,
    "元素已经删了，样式规则不该还留着"
  );
  assert.doesNotMatch(
    cssSource,
    /@media \(max-width: 700px\)[\s\S]*?\.rz-voice-engine \{ display: none; \}/,
    "手机端又把管理员唯一的模型切换入口隐藏了"
  );
});

test("前后端默认模型都必须是正式版，不能让管理员预取 mini 抵消服务端设计", () => {
  assert.match(
    consoleSource,
    /const MODELS = \["gpt-realtime-2\.1", "gpt-realtime-2\.1-mini"\] as const;\s*const DEFAULT_MODEL = MODELS\[0\]/
  );
  assert.match(voiceToolsSource, /DEFAULT_VOICE_MODEL = "gpt-realtime-2\.1"/);
  assert.match(consoleSource, /JSON\.stringify\(\{ model: modelPrefRef\.current \}\)/);
});
