/**
 * 端到端对话台:一场「模型顾客 × 真语音助手」的完整对话。
 *
 * 「真」到什么程度:话术=生产库那份;工具定义=buildTools() 原件;选项卡=
 * buildChoiceGroup() 原件;每轮情境注入=buildTurnContext() 原件;点击/出图/沉默
 * 的注入文本与打断策略=src/lib/voice-events.ts 原件(和前端同一份);
 * 打断机制(cancel→等 done→create)逐行镜像 voice-console 的 pushEvent。
 * 「假」的只有:工具的后端执行(只读 stub,绝不写生产库)和音频通道(文本代替)。
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";

registerHooks({
  resolve(specifier, context, nextResolve) {
    // Next 的 server-only 只是个「在客户端 import 就报错」的哨兵,Node 里垫成空模块
    if (specifier === "server-only") {
      return { url: "data:text/javascript,", shortCircuit: true };
    }
    // next/cache 只用到 unstable_cache(包一层缓存),Node 里直接透传原函数
    if (specifier === "next/cache") {
      const shim =
        "export const unstable_cache = (fn) => fn;" +
        "export const revalidateTag = () => {};" +
        "export const revalidatePath = () => {};";
      return { url: `data:text/javascript,${encodeURIComponent(shim)}`, shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  }
});

const ROOT = new URL("../../", import.meta.url);
// Use only the operator's local environment; no bundled database credentials.
try { process.loadEnvFile(new URL(".env.local", ROOT)); } catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY || !process.env.POSTGRES_URL) {
  throw new Error("Configure OPENAI_API_KEY and POSTGRES_URL before running the optional simulation.");
}

const { buildTurnContext } = await import("../../src/lib/voice-context.ts");
const { voiceEventPayload, waitForUserOutput } = await import("../../src/lib/voice-events.ts");
const { buildTools } = await import("../../src/lib/voice-tools.ts");
const { buildChoiceGroup } = await import("../../src/lib/voice-choices.ts");
const { customerAct } = await import("./customer.mjs");

// ---------- 固定资产:五款推荐 + 房间读数(只读自生产目录,跑一次取一次) ----------
export async function loadFixtures() {
  const pg = (await import("pg")).default;
  const pool = new pg.Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false },
    max: 1
  });
  const { rows: instr } = await pool.query(
    "select value from voice_config where key = 'sales_instructions'"
  );
  await pool.end();
  /**
   * 五款取自**应用真实在用的目录源**(getSkuCatalog:库空时回落打包目录,
   * 和生产同一条路),不是编的:颜色、图、成分都要经得起模型看图对照。
   */
  const { getSkuCatalog } = await import("../../src/lib/sku-catalog.ts");
  const catalog = await getSkuCatalog(400);
  // 供应商色名列在真数据里就是空的(生产由 Lab 派生),测试台给五个固定色标,
  // 图取真图:顾客点的目标、屏幕描述、模型看到的图要能对上号
  const palette = ["米白", "浅灰", "亚麻本色", "雾蓝", "酒红"];
  const skus = catalog
    .filter((s) => s.image_url || s.local_image)
    .filter((s, i, all) => all.findIndex((x) => x.sku_id.split("-")[0] === s.sku_id.split("-")[0]) === i)
    .slice(0, 5)
    .map((s, i) => ({ ...s, color: palette[i] }));
  const textures = ["textured", "plain", "textured", "patterned", "plain"];
  const weights = [320, 240, 410, 280, 190];
  const compositions = [
    "70% polyester 30% linen",
    "100% polyester",
    "55% cotton 45% viscose",
    "100% polyester",
    "voile 100% polyester"
  ];
  /*
   * why/caveat 是**给屏幕的书面文**——故意写得又长又漂亮。这是个诱饵:
   * 按新设计它们根本不该到模型手里;如果转写里出现了这些句子,
   * 就说明剥离(delete display)在哪里破了。
   */
  const whys = [
    "亚麻混纺的天然肌理会在侧光下呈现细腻的明暗层次,与暖色墙面形成柔和的呼应,整体氛围松弛而有质感。",
    "纯色平织最安全也最耐看,五年后墙面换色它依然成立,是不会出错的基底选择。",
    "较高的克重带来饱满垂坠的褶裥,冬季也有更好的隔音与保温体验,适合层高较高的空间。",
    "织入式的提花纹样在远观时是低调的素色,近看才显出图案的趣味,兼顾了耐看与个性。",
    "轻透的纱帘让白天的光线柔化而不封死,与主帘叠用可以在私密与采光之间自由切换。"
  ];
  const caveats = ["偏薄,西晒房间下午会透亮", "", "克重大,轨道要够结实", "", "单用没有遮蔽性"];
  return {
    instructions: String(instr[0]?.value ?? ""),
    products: skus.map((s, i) => ({
      ref: s.sku_id,
      color: s.color,
      weight_gsm: s.weight_gsm ?? weights[i],
      composition: s.composition ?? compositions[i],
      texture: s.texture_type ?? textures[i],
      image_url: s.image_url || s.local_image,
      why: whys[i] ?? "",
      caveat: caveats[i] ?? ""
    })),
    room: {
      wall: "warm off-white",
      floor: "light oak",
      undertone: "warm",
      guidance: "Lean warm and natural; avoid anything cold or blue-grey."
    },
    space: "米白的墙配浅橡木地板,底色是暖的——冷灰色系会打架,暖色和本白最顺。"
  };
}

// ---------- 一场对话 ----------
export async function runSession({ persona, variantIndex, model, outDir, fixtures, maxActions = 14 }) {
  const fx = fixtures ?? (await loadFixtures());
  const runId = `${persona.id}-v${variantIndex + 1}`;
  const log = [];
  const transcript = []; // {role: assistant|user|note, text}
  const state = {
    screen: { choices: null, products: null, qr: false, photo: false, render: false, selected: null },
    taste: {},
    room: null,
    hasPhoto: false,
    handoffs: [],
    playbooksSeen: [],
    stalled: 0,
    fingerprint: "",
    contextInjections: 0,
    fingerprintChanges: 0,
    firstRecommendAt: null, // 第一次 recommend 前的收窄次数,量「秒推」
    narrowingBeforeRecommend: null,
    waitForUserCalls: 0,
    interrupts: { armed: 0, fired: 0, cancelled: 0 },
    anchors: [] // {target, hit} 点击/出图后第一句是否接住
  };
  const note = (kind, data) => {
    log.push({ t: Date.now(), kind, ...data });
    if (process.env.SIM_DEBUG) console.log(`  · ${kind} ${JSON.stringify(data).slice(0, 180)}`);
  };

  // ---- WS ----
  const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${model}`, [
    "realtime",
    `openai-insecure-api-key.${API_KEY}`
  ]);
  const send = (o) => ws.send(JSON.stringify(o));

  let active = false;
  let pendingCreate = false;
  let nudgeTimer = null;
  let buffer = "";
  let armedTap = null; // {kind, target} 顾客说了「它再啰嗦我就伸手点」
  let settleResolve = null;
  let settleTimer = null;
  let retriesLeft = 6; // 整场的 failed 重试预算
  ws.addEventListener("close", () => note("ws_closed", {}));

  const nudgeIfSilent = () => {
    if (nudgeTimer) clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(() => {
      nudgeTimer = null;
      if (!active) send({ type: "response.create" });
    }, 1500);
  };

  /** 镜像 voice-console 的 pushEvent:同一份 payload、同一套打断与接续 */
  const pushEvent = (evt) => {
    const payload = voiceEventPayload(evt);
    note("event", { evt: evt.type, interrupt: payload.interrupt, active });
    if (payload.interrupt && active) {
      state.interrupts.fired += 1;
      send({ type: "response.cancel" });
      // 文本模式没有音频缓冲;真前端这里还有 output_audio_buffer.clear
      if (payload.respond === "now") pendingCreate = true;
    }
    send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          ...(evt.image ? [{ type: "input_image", image_url: evt.image }] : []),
          { type: "input_text", text: payload.text }
        ]
      }
    });
    if (payload.respond === "now" && !pendingCreate) {
      if (active) pendingCreate = true;
      else send({ type: "response.create" });
    } else if (payload.respond === "ifSilent") {
      nudgeIfSilent();
    }
  };

  // ---- 工具执行(只读 stub;形状照抄 voice-tools 的真实返回) ----
  async function execTool(name, args) {
    if (name === "wait_for_user") {
      state.waitForUserCalls += 1;
      note("wait_for_user", {});
      return waitForUserOutput();
    }
    if (name === "offer_choices") {
      const group = await buildChoiceGroup(String(args.kind ?? "feel"), Number(args.round) === 2 ? 2 : 1);
      state.screen.choices = group;
      state.screen.products = null;
      return {
        status: "on_screen",
        kind: group.kind,
        guidance:
          "The cards are on his screen. If you already said your one line, do NOT add another — " +
          "call wait_for_user and let him read. Only if you said nothing yet: one short line, " +
          "then stop. Never read the options aloud — he is reading them. A tap will be announced; " +
          "an answer said out loud counts the same."
      };
    }
    if (name === "recommend_for_room") {
      if (!state.hasPhoto) {
        return {
          status: "no_photo",
          guidance:
            "There is no room photo on this consultation yet, so the proper selection cannot run — " +
            "it is the photo that makes it worth 30 seconds. Ask the salesperson to take one " +
            "(the camera key is next to the orb), and keep the conversation going meanwhile."
        };
      }
      if (state.firstRecommendAt === null) {
        state.firstRecommendAt = Date.now();
        state.narrowingBeforeRecommend = state.fingerprintChanges;
      }
      state.screen.products = fx.products;
      state.screen.choices = null;
      const character = (sku) => {
        const bits = [];
        if (sku.texture) bits.push(sku.texture);
        if (sku.weight_gsm) bits.push(sku.weight_gsm >= 380 ? "heavy" : sku.weight_gsm <= 220 ? "light" : "medium");
        const fibre = sku.composition?.match(/linen|wool|cotton|velvet|silk|viscose|polyester|voile/i)?.[0];
        if (fibre) bits.push(fibre.toLowerCase());
        return bits.join(", ");
      };
      // display 在真前端会被剥掉再回给模型——这里直接不带,效果一致
      return {
        status: "ready",
        space: fx.space,
        picks: fx.products.map((sku) => ({ colour: sku.color, character: character(sku), caveat: sku.caveat })),
        guidance:
          "The five are ON SCREEN with photos and written notes — he can read. Say ONE or TWO short " +
          "sentences total, in his language: your one-line reading of the room (`space`, in your own " +
          "words) plus which ONE you would start with and what it fixes for him — use the pain he " +
          "named (sleep, glare, heat, privacy). Then invite him to tap what catches his eye, and stop. " +
          "Never walk the list. If he asks about one, speak from its character and his needs; an " +
          "honest caveat is worth more than praise."
      };
    }
    if (name === "request_photo_qr") {
      state.screen.qr = true;
      return {
        status: "qr_on_screen",
        expires_in_minutes: 10,
        guidance:
          "The code is on the screen now. Tell him to scan it with his phone camera and pick the " +
          "photo — one sentence, in his language, then stop. Say what he gets out of it " +
          "('then I can show you this fabric hanging in your own room'), not what we get out of it."
      };
    }
    if (name === "escalate_to_staff") {
      state.handoffs.push(String(args.kind ?? "wants_human"));
      note("escalate", { kind: args.kind, reason: args.reason });
      return { status: "escalated", note: "A colleague has been notified and is on the way." };
    }
    if (name === "search_products") {
      return {
        status: "ok",
        found: [
          { color: String(args.color ?? "beige"), weight_gsm: 320, composition: "70% polyester 30% linen", texture: "textured" },
          { color: String(args.color ?? "beige"), weight_gsm: 240, composition: "100% polyester", texture: "plain" }
        ],
        guidance: "Answer his question from these; nothing appeared on his screen."
      };
    }
    if (name === "get_orientation_figure") {
      return { status: "ok", figure: "Curtain box depth: 15 cm is the usual working figure here.", guidance: "One number, one sentence." };
    }
    if (name === "search_knowledge") {
      return { status: "ok", facts: ["Linen-mix curtains soften with washing; hang them slightly long and let them settle for two weeks."] };
    }
    return { status: "saved" };
  }

  ws.addEventListener("message", (event) => {
    const e = JSON.parse(event.data);
    if (e.type === "response.created") {
      active = true;
    } else if (e.type === "response.output_text.delta") {
      buffer += e.delta || "";
      // 顾客上一句声明过:它再啰嗦就伸手点。到 60 字还没停 → 点下去(打断链路)
      if (armedTap && buffer.replace(/\s/g, "").length > 60) {
        const tap = armedTap;
        armedTap = null;
        state.interrupts.armed += 1;
        applyTap(tap.kind, tap.target, true);
      }
    } else if (e.type === "response.output_item.done" && e.item?.type === "function_call") {
      note("tool_call", { name: e.item.name, args: e.item.arguments });
      execTool(e.item.name, JSON.parse(e.item.arguments || "{}")).then((result) => {
        send({
          type: "conversation.item.create",
          item: { type: "function_call_output", call_id: e.item.call_id, output: JSON.stringify(result) }
        });
        // wait_for_user 绝不催(它选了闭嘴);其余镜像前端的 nudgeIfSilent
        if (e.item.name !== "wait_for_user") nudgeIfSilent();
      });
    } else if (e.type === "response.done") {
      active = false;
      if (e.response?.status === "cancelled") state.interrupts.cancelled += 1;
      const said = buffer.trim();
      buffer = "";
      // 空回复要留痕:是模型选择沉默,还是文本丢了,事后要分得开
      if (!said) {
        note("response_empty", {
          status: e.response?.status,
          details: JSON.stringify(e.response?.status_details ?? null).slice(0, 300),
          output: (e.response?.output ?? []).map((o) => `${o.type}:${o.content?.map((c) => c.type).join("+") ?? ""}`)
        });
      }
      /**
       * 失败的回复要重试:多路并发容易撞 rate limit,一次 failed 不重试,
       * 后面整场就是顾客对着一堵墙说话——那测出来的是基建噪音,不是对话质量。
       */
      if (e.response?.status === "failed" && retriesLeft > 0) {
        retriesLeft -= 1;
        // 1.2 秒:要落在 settle 的 2.5 秒静默窗之内,否则顾客回合会先被放行
        setTimeout(() => {
          if (!active) send({ type: "response.create" });
        }, 1200);
      }
      if (said) {
        transcript.push({ role: "assistant", text: said });
        note("assistant", { text: said, cancelled: e.response?.status === "cancelled" });
        // 点击/出图后的第一句是否接住了目标。按两字滑窗匹配:
        // 「棉麻自然感」被说成「棉麻的自然感」也算接住——考的是有没有在谈它,不是复读
        const anchor = state.anchors.find((a) => a.hit === null);
        if (anchor) {
          const target = String(anchor.target);
          const lower = said.toLowerCase();
          let hit = lower.includes(target.toLowerCase());
          for (let i = 0; !hit && i + 2 <= target.length; i++) {
            hit = lower.includes(target.slice(i, i + 2).toLowerCase());
          }
          anchor.hit = hit;
        }
      }
      if (pendingCreate) {
        pendingCreate = false;
        send({ type: "response.create" });
      }
      bumpSettle();
    } else if (e.type === "error") {
      if (e.error?.code === "response_cancel_not_active") return; // 打断竞态,和前端同样容忍
      note("error", { error: JSON.stringify(e.error).slice(0, 200) });
      bumpSettle();
    }
  });

  /** 「这一轮说完了」= 2.5 秒内没有在途回复、没有待发的接续 */
  function bumpSettle() {
    if (!settleResolve) return;
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      if (active || pendingCreate || nudgeTimer) return bumpSettle();
      const r = settleResolve;
      settleResolve = null;
      r();
    }, 2500);
  }
  const settle = () =>
    new Promise((resolve) => {
      settleResolve = resolve;
      bumpSettle();
      setTimeout(() => {
        if (settleResolve === resolve) {
          settleResolve = null;
          resolve(); // 25 秒兜底:模型不说话也得让顾客动
        }
      }, 25000);
    });

  // ---- 顾客动作 ----
  function applyTap(kind, target, duringSpeech) {
    if (kind === "tap_choice") {
      const choices = state.screen.choices?.choices ?? [];
      const choice =
        choices.find((c) => String(c.label ?? "").includes(target) || target.includes(String(c.label ?? ""))) ??
        choices[0];
      const id = String(choice?.id ?? "any");
      const choiceKind = state.screen.choices?.kind ?? "feel";
      // 「我也说不好」的正确接法是替他拿主意,不是复读这五个字——锚定不适用
      if (id !== "any") state.anchors.push({ target: String(choice?.label ?? target), hit: null });
      if (id !== "any") {
        state.taste[choiceKind] = [...(state.taste[choiceKind] ?? []), id];
        state.fingerprintChanges += 1; // 指纹会变,预记一笔(真值由下轮 buildTurnContext 校准)
      }
      transcript.push({ role: "note", text: `你点了选项「${choice?.label ?? target}」${duringSpeech ? "(它话没说完你就点了)" : ""}` });
      note("tap", { what: "choice", target, duringSpeech: Boolean(duringSpeech) });
      pushEvent({ type: "tap_choice", spoken: String(choice?.label ?? target), isAny: id === "any" });
    } else {
      const product =
        (state.screen.products ?? []).find((p) => String(p.color ?? "").includes(target)) ??
        (state.screen.products ?? [])[0];
      state.anchors.push({ target: String(product?.color ?? target), hit: null });
      state.screen.selected = product?.color ?? target;
      transcript.push({ role: "note", text: `你点了推荐里的「${product?.color ?? target}」${duringSpeech ? "(它话没说完你就点了)" : ""}` });
      note("tap", { what: "product", target, duringSpeech: Boolean(duringSpeech) });
      const facts = [product?.color, product?.composition, product?.texture].filter(Boolean).join(" · ");
      pushEvent({ type: "tap_product", facts, off: false, shotDone: state.hasPhoto });
    }
  }

  function screenDesc() {
    const bits = [];
    const s = state.screen;
    if (s.choices) bits.push(`一排可点的选项卡(${s.choices.choices.map((c) => c.label).join(" / ")})`);
    if (s.products) bits.push(`五款推荐(颜色: ${s.products.map((p) => p.color).join(" / ")}),每款有图和一段书面介绍${s.selected ? `;你点中了「${s.selected}」` : ""}`);
    if (s.qr) bits.push("一个二维码(扫了可以把你家房间照片传上去)");
    if (s.photo) bits.push("你传的房间照片");
    if (s.render) bits.push("你点中那款装进你房间的效果图");
    return bits.join(";") || "";
  }

  async function injectContext(said) {
    state.contextInjections += 1;
    const ctx = await buildTurnContext({
      said,
      taste: state.taste,
      room: state.room,
      hasPhoto: state.hasPhoto,
      handoffs: state.handoffs,
      playbooksSeen: state.playbooksSeen,
      stalledTurns: state.stalled
    });
    if (ctx.fingerprint === state.fingerprint) state.stalled += 1;
    else {
      state.stalled = 0;
      if (state.fingerprint) state.fingerprintChanges += 1;
    }
    state.fingerprint = ctx.fingerprint ?? "";
    const parts = [ctx.line];
    if (ctx.playbook && !state.playbooksSeen.includes(ctx.playbook.id)) {
      state.playbooksSeen.push(ctx.playbook.id);
      parts.push(ctx.playbook.text);
      note("playbook", { id: ctx.playbook.id });
    }
    send({
      type: "conversation.item.create",
      item: { type: "message", role: "user", content: [{ type: "input_text", text: `[${parts.join("\n\n")}]` }] }
    });
  }

  // ---- 开场 ----
  // 握手 20 秒不成就报错:无声挂死会拖死整批,报错至少能让下一段重试
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ws_open_timeout")), 20_000);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve(undefined);
    });
    ws.addEventListener("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`ws_error:${String(e?.message ?? e)}`.slice(0, 120)));
    });
  });
  send({
    type: "session.update",
    session: {
      type: "realtime",
      instructions: fx.instructions,
      tools: buildTools(),
      tool_choice: "auto",
      output_modalities: ["text"]
    }
  });
  send({ type: "response.create" });
  await settle();

  // ---- 顾客回合 ----
  let left = false;
  // 整场死线:任何一个环节挂住,这一场到点就收,别拖死整批
  const deadline = Date.now() + 6.5 * 60_000;
  for (let turnNo = 1; turnNo <= maxActions && !left; turnNo++) {
    if (Date.now() > deadline) {
      note("run_deadline", { turnNo });
      break;
    }
    const act = await customerAct({
      apiKey: API_KEY,
      persona,
      variantIndex,
      transcript,
      screenDesc: screenDesc(),
      turnNo
    });
    note("customer_action", act);
    switch (act.action) {
      case "say": {
        state.idleN = 0;
        transcript.push({ role: "user", text: String(act.text ?? "") });
        if (act.tap_if_it_rambles) {
          armedTap = {
            kind: state.screen.products ? "tap_product" : "tap_choice",
            target: String(act.tap_if_it_rambles)
          };
        }
        send({
          type: "conversation.item.create",
          item: { type: "message", role: "user", content: [{ type: "input_text", text: String(act.text ?? "") }] }
        });
        await injectContext(String(act.text ?? ""));
        send({ type: "response.create" });
        await settle();
        armedTap = null;
        break;
      }
      case "tap_choice":
      case "tap_product": {
        state.idleN = 0;
        applyTap(act.action, String(act.target ?? ""), false);
        await settle();
        break;
      }
      case "scan_qr": {
        if (!state.screen.qr) break;
        state.screen.qr = false;
        state.screen.photo = true;
        state.hasPhoto = true;
        state.room = state.room ?? "bedroom";
        transcript.push({ role: "note", text: "你扫了码,把房间照片传了上去(屏幕上出现了你的房间)" });
        pushEvent({ type: "photo_received", room: fx.room });
        await settle();
        break;
      }
      case "request_preview": {
        if (!state.screen.selected || !state.hasPhoto) break;
        transcript.push({ role: "note", text: `你让它把「${state.screen.selected}」装进你房间看看` });
        pushEvent({ type: "render_started", color: state.screen.selected });
        await settle();
        state.screen.render = true;
        const img = (state.screen.products ?? []).find((p) => p.color === state.screen.selected)?.image_url;
        state.anchors.push({ target: state.screen.selected, hit: null });
        transcript.push({ role: "note", text: "效果图出来了,摆在屏幕上" });
        pushEvent({ type: "render_done", color: state.screen.selected, image: img || undefined });
        await settle();
        break;
      }
      case "silence": {
        transcript.push({ role: "note", text: "(你沉默了 12 秒,看着屏幕)" });
        // 镜像前端 bumpIdle:屏幕上有东西才开口;两次递话头,第三次给路,之后不缠
        state.idleN = (state.idleN ?? 0) + 1;
        if (state.idleN > 3) break;
        const s = state.screen;
        const parts = [];
        if (s.products) parts.push(`${s.products.length} fabrics with photos${s.selected ? ` (${s.selected} selected)` : ""}`);
        else if (s.choices) parts.push(`tappable ${s.choices.kind} cards`);
        if (s.render) parts.push("the preview of the fabric in his room");
        if (s.photo) parts.push("the photo of his room");
        if (s.qr) parts.push("a QR code waiting for his room photo");
        if (parts.length) {
          note("idle_fired", { nth: state.idleN });
          pushEvent({ type: "idle", seconds: 12 * state.idleN, screen: parts.join(" · "), nth: state.idleN });
          await settle();
        }
        break;
      }
      case "leave":
      default: {
        left = true;
        if (act.text) {
          transcript.push({ role: "user", text: String(act.text) });
          send({
            type: "conversation.item.create",
            item: { type: "message", role: "user", content: [{ type: "input_text", text: String(act.text) }] }
          });
          await injectContext(String(act.text));
          send({ type: "response.create" });
          await settle();
        }
        break;
      }
    }
  }
  ws.close();

  // ---- 落盘 ----
  mkdirSync(outDir, { recursive: true });
  const md = [
    `# ${persona.name} · 变体${variantIndex + 1} · ${model}`,
    "",
    ...transcript.map((t) =>
      t.role === "assistant" ? `**助手**: ${t.text}` : t.role === "user" ? `**顾客**: ${t.text}` : `_${t.text}_`
    )
  ].join("\n\n");
  writeFileSync(path.join(outDir, `${runId}.md`), md, "utf8");
  writeFileSync(
    path.join(outDir, `${runId}.json`),
    JSON.stringify({ runId, persona: persona.id, variantIndex, model, transcript, state: { ...state, screen: undefined }, log }, null, 2),
    "utf8"
  );
  appendFileSync(path.join(outDir, "runs.txt"), runId + "\n", "utf8");
  return { runId, transcript, state, log };
}
