import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  }
});

const { COLOR_RULES, COLOR_SYNONYMS } = await import("../src/lib/color-words.ts");

/**
 * 合作方接口的契约测试。
 *
 * 这些用例同时是工具描述里的示例来源——文档写的和实际返回的不会不一致。
 * 语音助手的真实调用参数（脱敏后）会从服务端日志回流补进这里，
 * 这样它的场景自动进入本方回归，不必两边各维护一套冒烟。
 */

const catalog = JSON.parse(
  readFileSync(new URL("./fixtures/partner-catalog.json", import.meta.url), "utf8")
);

function findRule(word) {
  const canonical = COLOR_SYNONYMS[word] || word;
  return COLOR_RULES.find((rule) => rule.label === canonical);
}

test("客户说的每个颜色词都能落到一条规则上", () => {
  const spoken = [
    "米白", "奶白", "象牙", "米色", "米黄", "杏色", "浅咖", "驼色", "燕麦", "卡其",
    "深咖", "棕色", "纯白", "浅灰", "银灰", "中灰", "深灰", "炭灰", "黑色",
    "灰绿", "雾绿", "鼠尾草", "大地色", "姜黄", "冷灰", "灰蓝", "绿色", "蓝色", "粉色", "藕色"
  ];
  for (const word of spoken) {
    assert.ok(findRule(word), `客户会说「${word}」，但没有对应规则`);
  }
});

test("色彩词表覆盖全部商品，且每个词都筛得出东西", () => {
  const covered = new Set();
  for (const rule of COLOR_RULES) {
    const hit = catalog.filter((item) => rule.match(item));
    assert.ok(hit.length > 0, `「${rule.label}」一款都筛不出，这个词不该出现在工具描述里`);
    for (const item of hit) covered.add(item.sku_id);
  }
  assert.equal(
    covered.size,
    catalog.length,
    `有 ${catalog.length - covered.size} 款商品不属于任何色彩词，客户问起来无法检索`
  );
});

test("颜色词之间不会把同一款判成互斥的两个色系", () => {
  // 允许重叠（米白与纯白确实相近），但不允许出现「既是黑色又是纯白」这种
  const exclusive = [["黑色", "纯白"], ["黑色", "米白"], ["深灰", "浅灰"], ["深咖", "米白"]];
  for (const [a, b] of exclusive) {
    const ra = findRule(a);
    const rb = findRule(b);
    const both = catalog.filter((item) => ra.match(item) && rb.match(item));
    assert.equal(both.length, 0, `${both.length} 款同时被判为「${a}」和「${b}」`);
  }
});

test("同义词都指向存在的标准词", () => {
  for (const [alias, target] of Object.entries(COLOR_SYNONYMS)) {
    assert.ok(
      COLOR_RULES.some((rule) => rule.label === target),
      `同义词「${alias}」指向的「${target}」不在词表里`
    );
  }
});

/**
 * 下面三条原来验的是合作方 HTTP 端点。语音助手并入后那两个端点没有调用方，
 * 已删；但它们保护的东西一条没变，只是换了落点——检索现在是同进程调用，
 * 工具描述在 buildTools()，鉴权在每个 /api/voice/* route 里。
 */

test("工具描述必须挡住目录里没有的属性", () => {
  const source = readFileSync("src/lib/voice-tools.ts", "utf8");
  // 说错属性是当着顾客面的事故，这几条比示例重要，写不下也要留着
  for (const word of ["遮光", "衬里", "涂层", "阻燃"]) {
    assert.match(source, new RegExp(word), `违禁属性表里缺少「${word}」`);
  }
  assert.match(
    source,
    /no measured blackout rating/,
    "search_products 的描述必须说明目录没有遮光值"
  );
  assert.match(
    source,
    /never invent a name/,
    "search_products 的描述必须禁止编造商品名"
  );
  // 保温是提示词明确允许说的，标记它等于训练所有人无视告警
  const roots = source.slice(
    source.indexOf("const UNVERIFIED_CLAIM_ROOTS"),
    source.indexOf("export function scanUnverified")
  );
  assert.doesNotMatch(roots, /保温|insulat/, "违禁词表不得包含提示词允许的「保温」");
});

test("语音每个端点都必须先认人", () => {
  const routes = [
    "src/app/api/voice/token/route.ts",
    "src/app/api/voice/tools/route.ts",
    "src/app/api/voice/photo/route.ts",
    "src/app/api/voice/audit/route.ts",
    "src/app/api/voice/translate/route.ts",
    "src/app/api/voice/translate/token/route.ts"
  ];
  for (const path of routes) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /getCurrentActor\(\)/, `${path} 缺少鉴权`);
    // 光有 getCurrentActor 不够：认证失败必须回 401，不能落进 catch 变成 500。
    // 线上实测过——未登录调 /api/voice/token 回的是 500「请先登录」，
    // 语义上等于「我们坏了」，正常的未授权访问会被算进错误率。
    assert.match(source, /apiError\(/, `${path} 的 catch 必须走 apiError，否则认证失败会变成 500`);
  }
  // 照片端点必须先认人再读 body，否则未登录请求也能让服务端吞下 8MB
  const photo = readFileSync("src/app/api/voice/photo/route.ts", "utf8");
  assert.ok(
    photo.indexOf("getCurrentActor()") < photo.indexOf("arrayBuffer()"),
    "照片端点必须在读取请求体之前完成鉴权"
  );
  // 铸凭证要限流：一枚凭证开一场会话，而实时音频按分钟计费
  const token = readFileSync("src/app/api/voice/token/route.ts", "utf8");
  assert.match(token, /consumeRateLimit/);
});

test("密钥不出现在日志与返回里", () => {
  const token = readFileSync("src/app/api/voice/token/route.ts", "utf8");
  const minted = token.slice(token.indexOf('logVoice("token_minted"'), token.indexOf("return new NextResponse"));
  assert.match(minted, /session_id/, "要记会话 id 才能和 OpenAI 的用量对上");
  assert.doesNotMatch(minted, /apiKey|value/, "日志里不得出现密钥或临时凭证");
  // 服务端密钥只能来自环境变量，不能有硬编码兜底
  assert.doesNotMatch(token, /OPENAI_API_KEY\s*\|\|\s*["'][^"']+["']/);
});
