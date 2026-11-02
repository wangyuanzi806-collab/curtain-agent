import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

// 签名密钥从这个值派生。测试里给个假的，真值永远不进仓库
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-service-role-key";

const { issueUploadToken, readUploadToken } = await import("../src/lib/voice-upload-token.ts");

const routeSource = readFileSync(
  new URL("../src/app/api/voice/upload/[token]/route.ts", import.meta.url),
  "utf8"
);
const toolsSource = readFileSync(new URL("../src/lib/voice-tools.ts", import.meta.url), "utf8");
const pageSource = readFileSync(
  new URL("../src/components/royalzen/phone-upload.tsx", import.meta.url),
  "utf8"
);

const CONSULTATION = "11111111-1111-1111-1111-111111111111";
const ORG = "22222222-2222-2222-2222-222222222222";

test("签出来的 token 能读回同一条咨询单", () => {
  const { token, nonce } = issueUploadToken(CONSULTATION, ORG);
  const claims = readUploadToken(token);
  assert.equal(claims?.consultationId, CONSULTATION);
  assert.equal(claims?.organizationId, ORG);
  assert.equal(claims?.nonce, nonce);
});

test("改一个字符就作废——payload 是攻击者能写的部分", () => {
  const { token } = issueUploadToken(CONSULTATION, ORG);
  const [payload, mac] = token.split(".");

  // 把 consultationId 换成别人的，再拿原签名去用
  const stolen = Buffer.from(
    JSON.stringify({
      consultationId: "99999999-9999-9999-9999-999999999999",
      organizationId: ORG,
      nonce: "x",
      exp: Date.now() + 60_000
    })
  ).toString("base64url");
  assert.equal(readUploadToken(`${stolen}.${mac}`), null, "换了咨询单还能验过——签名等于没签");

  // 签名本身被改
  assert.equal(readUploadToken(`${payload}.${"A".repeat(mac.length)}`), null);
  // 缺一半
  assert.equal(readUploadToken(payload), null);
  assert.equal(readUploadToken(""), null);
  assert.equal(readUploadToken("....."), null);
});

test("SPEC I5：过期的 token 一律不认", () => {
  const expired = Buffer.from(
    JSON.stringify({
      consultationId: CONSULTATION,
      organizationId: ORG,
      nonce: "n",
      exp: Date.now() - 1000
    })
  ).toString("base64url");
  /*
   * 这一枚是**签名正确**的（下面手工用同一把钥匙签），过期是唯一的问题。
   * 拿签名对的去测才有意义——签名错的那条路上面已经测过了。
   */
  const key = createHash("sha256")
    .update("test-only-service-role-key:voice-photo-upload")
    .digest();
  const mac = createHmac("sha256", key).update(expired).digest("base64url");
  assert.equal(readUploadToken(`${expired}.${mac}`), null, "过期的还能用，那十分钟的限制等于没有");
});

test("有效期就是十分钟，不能悄悄放长", () => {
  const { expiresAt } = issueUploadToken(CONSULTATION, ORG);
  const minutes = (expiresAt - Date.now()) / 60000;
  assert.ok(minutes > 9 && minutes <= 10, `有效期成了 ${minutes.toFixed(1)} 分钟`);
});

test("每一枚的 nonce 都不一样，否则「一次性」无从谈起", () => {
  const seen = new Set();
  for (let i = 0; i < 50; i++) seen.add(issueUploadToken(CONSULTATION, ORG).nonce);
  assert.equal(seen.size, 50);
});

test("SPEC I6：这条路只能写，不能读", () => {
  /*
   * 免登录端点最容易出的事不是被写坏，是被当成读接口:
   * 拿一枚十分钟的码，换回顾客姓名、电话、聊过什么。
   * 所以这里的返回值只许是 ok / 粗粒度的错误码。
   */
  const returns = routeSource.match(/NextResponse\.json\(([^)]*)\)/g) ?? [];
  assert.ok(returns.length >= 4, "端点的返回语句解析不出来，这条断言等于没跑");
  for (const line of returns) {
    assert.doesNotMatch(
      line,
      /clientName|client_name|preferences|transcript|scene_image_url|sceneImageUrl|recommendation/i,
      `上传端点把咨询单的内容回给了顾客手机：${line}`
    );
  }
  // 上传页也不许显示任何一条咨询单的信息——它连读都不该读
  assert.doesNotMatch(pageSource, /clientName|consultation/i, "上传页在读咨询单");
});

test("没有 actor 兜底，所以每条 SQL 都必须自己带组织边界", () => {
  /*
   * 这是全项目唯一一条不登录就能打到的写接口。别处有 getCurrentActor 兜着，
   * 这里没有——where 里漏掉 organization_id，就是拿一枚码去写别家的单子。
   */
  const queries = routeSource.match(/`[^`]*(update|insert|select)[^`]*`/gi) ?? [];
  assert.ok(queries.length >= 2, "解析不出 SQL，这条断言等于没跑");
  for (const query of queries) {
    assert.match(query, /organization_id/, `这条 SQL 没有组织边界：\n${query.slice(0, 200)}`);
  }
});

test("一次性是靠「消 nonce」实现的，而且必须和认领是同一条语句", () => {
  /*
   * 先读后写的话，两台手机同时扫同一个码，两边都会看到「nonce 还在」。
   * 必须让 update ... where nonce = ? returning 自己去竞争，谁改到行谁算数。
   */
  assert.match(
    routeSource,
    /update consultations[\s\S]{0,200}preferences - 'uploadNonce'[\s\S]{0,200}uploadNonce'\s*=\s*\$3[\s\S]{0,120}returning/,
    "nonce 不是在一条语句里消掉并认领的——两台手机同时扫会双双通过"
  );
  assert.match(routeSource, /nonce_spent/, "nonce 用过之后没有明确拒绝");
});

test("签不出 token 时不能假装成功", () => {
  /*
   * 缺密钥时若还回一个 on_screen，助手会告诉顾客「扫一下」，
   * 而屏幕上什么都没有——顾客盯着一台没反应的机器，那比直接说不行更糟。
   */
  const fn = toolsSource.slice(
    toolsSource.indexOf("async function runRequestPhotoQr"),
    toolsSource.indexOf("async function runRecommendForRoom")
  );
  assert.match(fn, /status: "unavailable"/, "签不出来时没有一条明确的失败路径");
  assert.match(fn, /Do not mention codes or phones/i, "失败时没告诉模型别提二维码");
});

test("二维码那张图不许进对话", () => {
  /*
   * 它是几 KB 的 base64。模型拿它没有任何用处——它只需要知道码已经在屏幕上，
   * 而 realtime 的工作记忆总共才 16k。
   */
  const console_ = readFileSync(
    new URL("../src/components/royalzen/voice-console.tsx", import.meta.url),
    "utf8"
  );
  assert.match(
    console_,
    /delete \(forModel as Record<string, unknown>\)\.qr/,
    "工具结果原样 stringify 会把二维码的 base64 塞进上下文"
  );
});

test("工具描述要说清什么时候用、以及不许追着问第二次", () => {
  assert.match(toolsSource, /name: "request_photo_qr"/);
  assert.match(toolsSource, /from his own phone/i, "没说清这是「从顾客自己手机传」");
  assert.match(toolsSource, /Never offer the code twice/i, "没写「不许追着问第二次」");
  // 动机方向必须是反的：说顾客得到什么，不是我们要什么
  assert.match(toolsSource, /what he gets[\s\S]{0,120}not what we get/i, "动机方向写反了");
});
