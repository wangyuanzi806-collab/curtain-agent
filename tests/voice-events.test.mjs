import assert from "node:assert/strict";
import test from "node:test";

import { voiceEventPayload, waitForUserOutput } from "../src/lib/voice-events.ts";

/**
 * 打断策略是行为契约:哪类事件掐话、哪类不掐,错一个方向体验就反过来——
 * 点击不掐 = 水牛感;出图不掐 = 图都出来了它还在念上一段;
 * render_started 要是掐了 = 顾客一按生成键助手把话咽回去,像被人捂了嘴。
 */
test("打断策略:顾客动手的事件掐话,后台进度不掐", () => {
  const interrupts = (evt) => voiceEventPayload(evt).interrupt;
  assert.ok(interrupts({ type: "tap_product", facts: "", off: false, shotDone: false }), "点推荐卡必须打断");
  assert.ok(interrupts({ type: "tap_choice", spoken: "米白", isAny: false }), "点选项卡必须打断");
  assert.ok(interrupts({ type: "tap_room_photo" }), "点房间照片必须打断");
  assert.ok(interrupts({ type: "render_done", color: "米白" }), "图出来那一刻,真人会停下手里的话");
  assert.ok(!interrupts({ type: "render_started", color: "米白" }), "开始生成不打断——它正该继续讲布");
  assert.ok(!interrupts({ type: "render_failed" }), "生成失败不打断");
  assert.ok(!interrupts({ type: "idle", seconds: 12, screen: "x", nth: 1 }), "沉默时本来就没话在说");
});

test("回应策略:点击和出图立刻开口,进度类只在沉默时推一下", () => {
  const respond = (evt) => voiceEventPayload(evt).respond;
  assert.equal(respond({ type: "tap_choice", spoken: "米白", isAny: false }), "now");
  assert.equal(respond({ type: "render_done", color: "米白" }), "now");
  assert.equal(respond({ type: "photo_received", room: null }), "now");
  assert.equal(respond({ type: "render_started", color: "米白" }), "ifSilent");
  assert.equal(respond({ type: "render_failed" }), "ifSilent");
});

/**
 * 老板 08-05 纠偏:「安静不是好事,冷场了不是好事」。沉默事件的职责是**捡球**——
 * 递回一个低门槛话头让顾客开口,不是给模型一条通往安静的出口。
 * 所以这里反着断言:idle 文本里**不许**出现 wait_for_user。
 */
test("沉默事件是捡球递话头,不是通往安静的出口", () => {
  const p = voiceEventPayload({ type: "idle", seconds: 12, screen: "five fabrics · a QR code", nth: 1 });
  assert.match(p.text, /five fabrics · a QR code/, "开口必须锚定屏幕上的东西");
  assert.match(p.text, /hand it back|easy opening/i, "必须要求留一个顾客接得住的话头");
  assert.doesNotMatch(p.text, /wait_for_user/, "冷场不是用 wait_for_user 的时候——那是它失职");
  assert.match(p.text, /'are you still there'/i, "「您还在吗」是硬禁");

  const third = voiceEventPayload({ type: "idle", seconds: 36, screen: "cards", nth: 3 });
  assert.match(third.text, /concrete next step/i, "两次没接住,第三次要给一条具体的路");
  assert.match(third.text, /do not stack offers/i, "路只给一条,不许叠着推");
});

test("出图事件让它对着图说话,并递出量尺这一步", () => {
  const p = voiceEventPayload({ type: "render_done", color: "米白" });
  assert.match(p.text, /ONE short sentence/i, "看图说话只许一句");
  assert.match(p.text, /escalate_to_staff/, "顾客反应好时要能接到量尺");
  assert.match(p.text, /offer once, only act on a yes/i, "递一次,点头才叫人");
});

test("render_failed 不许把故障说给顾客", () => {
  const p = voiceEventPayload({ type: "render_failed" });
  assert.match(p.text, /Never mention a failure|anything technical/i);
});

test("wait_for_user 只护「动作中」,不鼓励安静本身", () => {
  const out = waitForUserOutput();
  assert.match(out.guidance, /mid-action/i, "适用场景必须钉死在「他正在动作中」");
  assert.doesNotMatch(out.guidance, /stay quiet and let him look/i, "不许把安静当成默认美德");
});
