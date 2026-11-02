"use client";

import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { voiceEventPayload, waitForUserOutput, type VoiceEvent } from "@/lib/voice-events";

/**
 * 语音顾问控制台。
 *
 * 从线下语音销售助手的单文件页面移植。视觉换成本产品的设计语言，**交互行为一条没改**——
 * 预热 WebRTC、预取凭证、断线交回上下文、连接中忽略点击这些看起来可以省掉的东西，
 * 每一条都是它在门店里踩出来的，理由见 docs/ARCHITECTURE.md。
 *
 * 与合并前的两处不同：
 * ① 后端从跨洋的 edge function 变成同源 /api/voice/*，门店码换成本产品的登录；
 * ② 商品卡片的颜色来自 Lab 派生而不是供应商色名（那一列已被清空且本就不可信）。
 */

const API = "/api/voice";
/**
 * 权限提示框没被回答时 getUserMedia 既不 resolve 也不 reject。
 *
 * 但它不能算失败：数据通道要 15 秒才开，麦克风到那时才被取用，
 * 8 秒就判死等于「顾问必须在 8 秒内看清并点允许」，慢一步就白连一场。
 * 到点只换一句提示，麦克风照旧等着——第几秒允许，第几秒接上。
 */
const MIC_PROMPT_HINT_MS = 8000;
/**
 * ICE 可以永远停在 checking 而不报 failed，成功路径就永远不跑。
 *
 * 40 秒不是拍的：实测一次建连是「铸凭证 7s + 交换 SDP 7s + ICE 3s」，
 * 而这三段全在浏览器与 OpenAI 之间，门店 wifi 上只会更久。
 * 原先写 20 秒是按「健康建连约 9 秒」定的，于是真实网络下
 * 每一次都在快连上时被掐断，再重来、再被掐断——就是那个一直重连。
 */
const START_WATCHDOG_MS = 40000;
/** 一次健康的建连约 9 秒，这之前的点击是不耐烦而不是想挂断 */
const IGNORE_TAP_MS = 12000;
/** 一次尝试最长 40 秒，三次就是两分钟。再多不是抖动，是真接不通 */
const GIVE_UP_AFTER = 3;
/**
 * 两个模型。服务端才是决定权；正常默认正式版，平台管理员可以在真机上
 * 切到 mini 做对照，VOICE_FORCE_MINI 才是全域应急回退。
 *
 * 2026-08-03 实测两者确实不一样：正式版该转人工的三次全转了（mini 三中二），
 * 首句 11 字（mini 31 字），荷兰语跟随两次全中。所以这个开关有意义，
 * 不该无声消失——它是唯一能在真机上比出差别的地方。
 */
const MODELS = ["gpt-realtime-2.1", "gpt-realtime-2.1-mini"] as const;
const DEFAULT_MODEL = MODELS[0];
const modelLabel = (model: string) => `OpenAI ${model.replace(/^gpt-realtime-?/, "")}`;

/**
 * 把图缩到模型能吃的大小再注入对话。效果图原图动辄一两 MB，原样塞进去会
 * 吃光 realtime 那点工作记忆；768px 的 jpeg 足够它看清布挂在哪、光落在哪。
 */
async function shrinkForModel(url: string): Promise<string | undefined> {
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });
    const scale = Math.min(1, 768 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    return undefined; // 缩不成就不带图——事件文本写了没图时怎么说
  }
}
type Caption = { id: number; role: "user" | "assistant" | "tool"; text: string };
type Product = {
  ref: string;
  color?: string | null;
  weight_gsm?: number | null;
  composition?: string | null;
  texture?: string | null;
  layer?: string | null;
  image_url?: string | null;
};
type Card = { id: number; products: Product[] };
/** 传上去的房间照片。顾客看着自己刚拍的那张说话，比对着一行「已存下」说话踏实 */
type Shot = { id: number; photo: string };
/** 装上去之后的样子。这是顾客真正想看的东西，所以它比别的都大 */
type Render = { id: number; render: string; color: string };
/**
 * 可点的选项卡。门店里的面料册搬到屏幕上——顾客不会说「提花」，但他会指。
 * 图是网页问卷那批人工挑的面料细节图（public/facets），同一批图两边共用。
 */
type Choice = {
  id: string;
  label: string;
  hint: string;
  image?: string;
  hex?: string;
  count?: number;
};
type ChoiceCard = {
  id: number;
  kind: string;
  prompt: string;
  choices: Choice[];
};
type OrbState = "off" | "thinking" | "listening" | "speaking";
type UserMediaControlElement = HTMLElement & {
  error?: DOMException | null;
  setConstraints(constraints: MediaStreamConstraints): void;
  stream?: MediaStream | null;
};
type MicBlockReason = "site" | "system" | "unknown";

async function readMicrophonePermissionState(): Promise<PermissionState | "unknown"> {
  try {
    const result = await navigator.permissions?.query({ name: "microphone" as PermissionName });
    return result?.state ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** 工具枚举是给模型读的，屏幕上要给人话 */
const TEXTURE_LABEL: Record<string, string> = {
  plain: "素净",
  textured: "细肌理",
  patterned: "有花纹"
};

/**
 * "51%COTTON 17%RAYON 12%ACRYLIC 3%LINEN 17%POLY" 是规格表，不是顾客在手机上会读的东西。
 * 留主纤维，第二种只在确实影响手感时才提。
 */
function fibreLabel(composition?: string | null) {
  if (!composition) return "";
  const parts = String(composition).match(/(\d+)\s*%\s*([A-Za-z]+)/g) || [];
  const fibres = parts
    .map((part) => {
      const m = part.match(/(\d+)\s*%\s*([A-Za-z]+)/);
      return { pct: parseInt(m![1], 10), name: m![2].toLowerCase() };
    })
    .sort((a, b) => b.pct - a.pct);
  if (!fibres.length) return String(composition);
  const cap = fibres[0].name.charAt(0).toUpperCase() + fibres[0].name.slice(1);
  if (fibres[1] && fibres[1].pct >= 25) return `${cap}–${fibres[1].name}`;
  return fibres.length > 1 ? `${cap} blend` : cap;
}

/** 原来是一个 ▣ 字符。顾问不会去点一个自己都不知道是什么的符号 */
function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.2a1 1 0 0 0 .84-.46l.92-1.42A1 1 0 0 1 9.3 4.7h5.4a1 1 0 0 1 .84.42l.92 1.42a1 1 0 0 0 .84.46h2.2A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />
      <circle cx="12" cy="12.6" r="3.4" />
    </svg>
  );
}

function KeyboardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.8" y="6.4" width="18.4" height="11.2" rx="2" />
      <path d="M6.6 10h.01M9.8 10h.01M13 10h.01M16.2 10h.01M6.6 13.2h.01M9.8 13.2h.01M13 13.2h.01M16.2 13.2h.01M8.6 16h6.8" />
    </svg>
  );
}

export default function VoiceConsole({ localPreview = false }: { localPreview?: boolean }) {
  const [status, setStatus] = useState("待机");
  const [statusKind, setStatusKind] = useState<"" | "live" | "err">("");
  const [orb, setOrb] = useState<OrbState>("off");
  const [engine, setEngine] = useState({ text: "–", confirmed: false });
  /** 服务端说了才算：门店账号拿不到这个权限，标签就是个只读徽章 */
  const [canChooseModel, setCanChooseModel] = useState(false);
  const [captions, setCaptions] = useState<(Caption | Card | Shot | Render | ChoiceCard)[]>([]);
  /** 顾客点过的选项。`kind:id` 的集合，用来给卡片打勾 */
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [shotBusy, setShotBusy] = useState(false);
  const [shotDone, setShotDone] = useState(false);
  /** 顾客手机传照片用的二维码。摆着的时候才轮询，传完就收起来 */
  const [qr, setQr] = useState<string>("");
  const qrShownAtRef = useRef(0);
  const [tapped, setTapped] = useState(false);
  const [draft, setDraft] = useState("");
  /** 麦克风这条路走不通了。打字是它唯一的替补，平时不该占位子，这时候才拿出来 */
  const [micBlocked, setMicBlocked] = useState(false);
  const [micBlockReason, setMicBlockReason] = useState<MicBlockReason>("unknown");
  /** Chrome 151+ 的浏览器原生授权控件能把已经拒绝过的权限直接在页面里恢复。 */
  const [nativeMicControl, setNativeMicControl] = useState(false);
  const [typing, setTyping] = useState(false);
  const modelPrefRef = useRef<string>(DEFAULT_MODEL);
  /** 这一场的咨询单。点球不建，第一次真有产出（拍照/出推荐/转人工）才落库 */
  const consultationIdRef = useRef<string>("");
  /** 顾客指着屏幕说「就这个」的那一款。选了才谈得上看装在他家什么样 */
  const [selected, setSelected] = useState<Product | null>(null);
  /** 给 tapProduct 读当前选中用。放进依赖会让回调随每次选中重建，
   *  而它是挂在卡片上的 onClick——重建等于每张卡都重新渲染一次 */
  const selectedRef = useRef<Product | null>(null);
  const [renderBusy, setRenderBusy] = useState(false);
  const [resumable, setResumable] = useState<{
    id: string;
    displayCode: string;
    clientName: string;
    hasScene: boolean;
    sceneImageUrl: string | null;
    pickCount: number;
  } | null>(null);
  /** 历史抽屉。null = 没打开；[] = 打开但还在取/空 */
  const [history, setHistory] = useState<
    | {
        id: string;
        clientName: string;
        sceneImageUrl: string | null;
        pickCount: number;
        lastActiveAt: string;
        transcript: { role: string; text: string }[];
      }[]
    | null
  >(null);

  const streamRef = useRef<HTMLDivElement | null>(null);
  const speakerRef = useRef<HTMLAudioElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const orbRef = useRef<HTMLButtonElement | null>(null);
  const userMediaControlRef = useRef<UserMediaControlElement | null>(null);
  const shotUrlsRef = useRef<string[]>([]);
  /**
   * 还没接通就拍的照片。顾客递过手机说「就是这个房间」不会先等你点球，
   * 所以照片照收、照存、照显示，那句给助手的话攒着，接通的那一刻补上。
   */
  const pendingPhotoRef = useRef<unknown | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const micSenderRef = useRef<RTCRtpSender | null>(null);
  const releaseLateMicRef = useRef<(() => void) | null>(null);
  const orbStateRef = useRef<OrbState>("off");
  const activeResponseRef = useRef(false);
  /** 打断(response.cancel)之后要接的那一次 response.create。
   *  不能立刻发——cancel 是异步的,撞上在途回复会报 already_has_active_response,
   *  所以攒在这儿,等 response.done(status=cancelled)到了再发 */
  const pendingCreateRef = useRef(false);
  /** 屏幕上现在摆着什么。给 idle 事件描述「他正在看的东西」用 */
  const screenBitsRef = useRef<{
    choices?: string;
    products?: number;
    selected?: string;
    qr?: boolean;
    render?: boolean;
    photo?: boolean;
  }>({});
  const idleTimerRef = useRef<number | null>(null);
  /** 同段沉默的开口计数:两次递话头,第三次给条具体的路,之后不缠 */
  const idleShotsRef = useRef(0);
  /** 每一轮回复的气泡 id 与已到的文本。审计要按轮取，不能取「最后一条」——
      一轮里模型可能先说话、调工具、再说话，或者顾客中途插话把最后一条变成 user */
  const assistantBufRef = useRef<Record<string, { id: number; text: string }>>({});
  /** 已经派出去的工具调用。response.done 的兜底扫描据此去重 */
  const handledCallsRef = useRef<Set<string>>(new Set());
  const captionSeq = useRef(0);
  const transcriptRef = useRef<{ role: string; text: string }[]>([]);
  const sessionLabelRef = useRef<string>("");
  /** 这一场在库里的 id。转录逐批写进它，关页面也留得下 */
  const voiceSessionIdRef = useRef<string>("");
  /** 从历史接着聊时，上一场的交底。接通后随开场一起交给模型 */
  const resumeBriefRef = useRef<string>("");
  const stopRef = useRef<(() => void) | null>(null);
  const pendingTurnsRef = useRef<{ role: string; text: string; at: string }[]>([]);
  const turnFlushRef = useRef<number | null>(null);
  /** 已经放过的情境卡。同一张一场只发一次——重复发既占上下文，也像这事又发生了一遍 */
  const playbooksSeenRef = useRef<string[]>([]);
  /** 上一轮的清单指纹，和连续几轮没变。三轮没有任何新增才算卡住 */
  const fingerprintRef = useRef<string>("");
  const stalledRef = useRef(0);

  const connectingRef = useRef(false);
  const manualStopRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);
  const startWatchdogRef = useRef<number | null>(null);
  const nudgeTimerRef = useRef<number | null>(null);
  const connectStartedAtRef = useRef(0);
  const connectsRef = useRef(0);
  const reconnectsRef = useRef<{ reason: string; at: number }[]>([]);
  const backoffBaseRef = useRef(0);
  /** 上一次接通以来连着失败了几次。够多就别再空转了 */
  const failStreakRef = useRef(0);
  /** 建连走到哪一步了。卡住时要能说出卡在哪，"接不通"三个字查不出任何东西 */
  const stageRef = useRef("");
  const tokenCacheRef = useRef<{ promise: Promise<any>; issuedAt: number } | null>(null);
  const meterCtxRef = useRef<AudioContext | null>(null);
  const meterRafRef = useRef<number | null>(null);
  const diagRef = useRef<Record<string, unknown[]>>({ ice: [], conn: [], dc: [], errors: [], timing: [] });

  /**
   * 屏幕是一条会话流：顾客说的、助手说的、传的照片、推的款，按发生顺序摆。
   *
   * 曾经改成「主屏只留最后一组推荐」，老板试完的判断是要回会话形式、
   * 而且**所有字不用滚动就能看到**。所以约束换成了两条：新内容自动滚到底，
   * 布样横着排——它不占纵向空间，一屏能留给更多句子。
   */
  const picks = useMemo(() => {
    for (let i = captions.length - 1; i >= 0; i -= 1) {
      const item = captions[i];
      if ("products" in item && item.products.length) return item;
    }
    return null;
  }, [captions]);

  const shot = useMemo(() => {
    for (let i = captions.length - 1; i >= 0; i -= 1) {
      const item = captions[i];
      if ("photo" in item) return item.photo;
    }
    return "";
  }, [captions]);

  const setOrbState = useCallback((next: OrbState) => {
    orbStateRef.current = next;
    setOrb(next);
    if (next !== "listening" && next !== "speaking") {
      orbRef.current?.style.setProperty("--level", "0");
    }
  }, []);

  const pushCaption = useCallback((role: Caption["role"], text: string) => {
    const id = ++captionSeq.current;
    setCaptions((prev) => [...prev, { id, role, text }]);
    if (role !== "tool") transcriptRef.current.push({ role, text });
    return id;
  }, []);

  /**
   * 把说完的几轮攒着写进库。
   *
   * 为什么要落库:今天的转录只活在这个页面的内存里,顾问一关页面就没了——
   * 「刚才那位客人说要给儿童房换厚一点的」是这条链路上最值钱的信息,
   * 而第二天没有任何人找得回来,业务人员看到的只有五张布的图。
   *
   * 攒批不逐句发:一轮对话十几个 delta,每个都发一次请求会在门店 wifi 上
   * 把数据通道挤住。3 秒一批,页面关掉时补最后一批(见 pagehide)。
   */
  const queueTurn = useCallback((role: "user" | "assistant" | "tool", text: string) => {
    const said = text.trim();
    if (!said) return;
    pendingTurnsRef.current.push({ role, text: said, at: new Date().toISOString() });
    if (turnFlushRef.current) return;
    turnFlushRef.current = window.setTimeout(() => {
      turnFlushRef.current = null;
      const id = voiceSessionIdRef.current;
      const batch = pendingTurnsRef.current.splice(0, pendingTurnsRef.current.length);
      if (!id || !batch.length) return;
      fetch(`${API}/sessions`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, turns: batch })
      }).catch(() => undefined);
    }, 3000);
  }, []);

  const appendAssistant = useCallback((id: number, delta: string) => {
    setCaptions((prev) =>
      prev.map((item) =>
        "role" in item && item.id === id ? { ...item, text: item.text + delta } : item
      )
    );
    const last = transcriptRef.current[transcriptRef.current.length - 1];
    if (last && last.role === "assistant") last.text += delta;
  }, []);

  // ---- 音量表。球体鼓起来是因为房间真的有声音，这是顾客唯一能确认"它在听"的方式 ----
  const stopMeter = useCallback(() => {
    if (meterRafRef.current) cancelAnimationFrame(meterRafRef.current);
    meterRafRef.current = null;
    if (meterCtxRef.current) {
      meterCtxRef.current.close().catch(() => undefined);
      meterCtxRef.current = null;
    }
    orbRef.current?.style.setProperty("--level", "0");
  }, []);

  const startMeter = useCallback((stream: MediaStream) => {
    stopMeter();
    try {
      const ctx = new AudioContext();
      meterCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.75;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      let current = 0;
      const tick = () => {
        analyser.getByteFrequencyData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i];
        // 说话声落在这个区间偏低，抬一下，正常音量才看得见
        const target = Math.min(1, (sum / buf.length / 255) * 3.2);
        current += (target - current) * 0.25;
        if (orbStateRef.current === "listening" || orbStateRef.current === "speaking") {
          orbRef.current?.style.setProperty("--level", current.toFixed(3));
        }
        meterRafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      /* 没有 AudioContext 不能弄断通话 */
    }
  }, [stopMeter]);

  // ---- 数据通道 ----
  const send = useCallback((payload: unknown) => {
    const dc = dcRef.current;
    if (dc && dc.readyState === "open") dc.send(JSON.stringify(payload));
  }, []);

  /**
   * gpt-realtime 拿到工具结果后会自己接着说，立刻再要一次回复会和在途的那次撞车
   * （conversation_already_has_active_response）。只在它真的沉默了才推一下。
   */
  const nudgeIfSilent = useCallback(() => {
    if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
    nudgeTimerRef.current = window.setTimeout(() => {
      nudgeTimerRef.current = null;
      if (!activeResponseRef.current) send({ type: "response.create" });
    }, 1500);
  }, [send]);

  /**
   * 屏幕/系统事件进对话的唯一入口。策略(打断?立刻开口?)在 voice-events 里,
   * 这里只是执行:该掐就掐、该接就接。
   *
   * 打断是「像个人」的最强信号:顾客手一抬,没说完的话就停——他已经在看
   * 别的了,把上一句念完是在跟空气说话。cancel 掐的是生成,WebRTC 的音频
   * 缓冲里还压着两三秒没播完的话,不 clear 嘴上就会继续念。
   */
  const pushEvent = useCallback(
    (evt: VoiceEvent & { image?: string }) => {
      const payload = voiceEventPayload(evt);
      idleShotsRef.current = evt.type === "idle" ? idleShotsRef.current + 1 : 0;
      if (payload.interrupt && activeResponseRef.current) {
        send({ type: "response.cancel" });
        send({ type: "output_audio_buffer.clear" });
        if (payload.respond === "now") pendingCreateRef.current = true;
      }
      send({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [
            ...(evt.image ? [{ type: "input_image" as const, image_url: evt.image }] : []),
            { type: "input_text" as const, text: payload.text }
          ]
        }
      });
      if (payload.respond === "now" && !pendingCreateRef.current) {
        // 没打断但恰好有在途回复:等它说完立刻接上,别撞车
        if (activeResponseRef.current) pendingCreateRef.current = true;
        else send({ type: "response.create" });
      } else if (payload.respond === "ifSilent") {
        nudgeIfSilent();
      }
    },
    [nudgeIfSilent, send]
  );

  /**
   * 沉默计时。顾客和助手都没动静 12 秒 → 给模型一句「他在看什么」,
   * 让它决定说一句有用的还是 wait_for_user。真人店员不会在顾客看布的时候
   * 站成一根柱子,也不会追着问「您还在吗」。
   */
  const bumpIdle = useCallback(() => {
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => {
      idleTimerRef.current = null;
      if (orbStateRef.current !== "listening") return;
      if (dcRef.current?.readyState !== "open") return;
      if (activeResponseRef.current) return;
      // 三次:两次递话头,第三次给一条具体的路。再多就是缠人
      if (idleShotsRef.current >= 3) return;
      const bits = screenBitsRef.current;
      const parts: string[] = [];
      if (bits.products) {
        parts.push(
          `${bits.products} fabrics with photos` + (bits.selected ? ` (${bits.selected} selected)` : "")
        );
      } else if (bits.choices) {
        parts.push(`tappable ${bits.choices} cards`);
      }
      if (bits.render) parts.push("the preview of the fabric in his room");
      if (bits.photo) parts.push("the photo of his room");
      if (bits.qr) parts.push("a QR code waiting for his room photo");
      // 屏幕上还什么都没有的沉默是刚进门的沉默,别追着开口
      if (!parts.length) return;
      const shots = idleShotsRef.current;
      pushEvent({ type: "idle", seconds: 12 * (shots + 1), screen: parts.join(" · "), nth: shots + 1 });
    }, 12_000);
  }, [pushEvent]);

  /**
   * 拿到这一场的咨询单，没有就开一条。**幂等**，重复调用不会多建。
   *
   * 只在真有产出时调（拍了照片、出了推荐、转了人工）——顾问点了球没说话
   * 就走的空场次不该占列表的一行。
   */
  const ensureConsultation = useCallback(async () => {
    if (consultationIdRef.current) return consultationIdRef.current;
    try {
      const response = await fetch(`${API}/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionLabel: sessionLabelRef.current,
          // 会话先开、咨询单后开：单子建出来的这一刻补挂到会话上，
          // 于是后台从任一头都点得到另一头
          voiceSessionId: voiceSessionIdRef.current || undefined
        })
      });
      if (!response.ok) return "";
      const data = await response.json();
      const id = String(data?.item?.id ?? "");
      if (id) consultationIdRef.current = id;
      return id;
    } catch {
      // 开不出咨询单不该弄断通话：照片照存、对话照走，只是这一场没被归档
      return "";
    }
  }, []);

  /**
   * 开一场会话记录。**点球就开**——和咨询单相反。
   *
   * 咨询单是给业务人员看的线索，空场次会把列表塞满垃圾，所以要等真有产出；
   * 会话是过程记录，它的价值恰恰包括「这一场什么都没聊出来」。空会话不会
   * 出现在列表里（服务端按 transcript 非空过滤），所以开着也不脏。
   */
  const ensureVoiceSession = useCallback(async (opts?: { consultationId?: string }) => {
    if (voiceSessionIdRef.current) return voiceSessionIdRef.current;
    try {
      const response = await fetch(`${API}/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionLabel: sessionLabelRef.current,
          source: "store",
          consultationId: opts?.consultationId || consultationIdRef.current || undefined
        })
      });
      if (!response.ok) return "";
      const data = await response.json();
      const id = String(data?.item?.id ?? "");
      if (id) voiceSessionIdRef.current = id;
      return id;
    } catch {
      return "";
    }
  }, []);

  /**
   * 顾客在屏幕上点了一张卡。
   *
   * **点击必须和说话一样算数。** 他指着那张亚麻的细节图，已经同时回答了
   * 质感、风格、正式程度三件事——比他努力形容「就是那种…有点粗的」精确得多。
   * 以前语音端只有嘴，顾客说不出就卡住，助手于是换个说法再问一遍，
   * 那正是「机械」的来源。
   *
   * 顺序是先落库再进会话：这一刻断网也不必让顾客重指一次，
   * 而且推荐闸门读的就是落库的那份 taste。
   */
  const tapChoice = useCallback(
    async (kind: string, choice: Choice) => {
      const key = `${kind}:${choice.id}`;
      setPicked((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      const consultationId = await ensureConsultation();
      let spoken = choice.label;
      try {
        const response = await fetch(`${API}/taste`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind,
            id: choice.id,
            consultationId: consultationId || undefined,
            voiceSessionId: voiceSessionIdRef.current || undefined,
            sessionLabel: sessionLabelRef.current
          })
        });
        const data = await response.json();
        if (typeof data?.spoken === "string" && data.spoken) spoken = data.spoken;
      } catch {
        /* 记不上不该弄断：助手还是要知道他点了什么 */
      }
      // 告诉助手他指了什么。用第三人称转述而不是伪装成顾客说的话——
      // 模型据此可以说「您选的这种…」，但不会误以为他说出了这些词。
      // 文本与打断策略在 voice-events 里,测试台跑的是同一份
      pushEvent({ type: "tap_choice", spoken, isAny: choice.id === "any" });
    },
    [ensureConsultation, pushEvent]
  );

  /**
   * 顾客指着推荐里的某一款说「就这个」。
   *
   * 以前点了只是本地选中——效果图按钮亮起来，而助手完全不知道发生过这件事，
   * 于是它还在讲第二款。**顾客在屏幕上做的每一个动作都必须让助手知道**，
   * 否则他会觉得这台机器没在看他。
   *
   * 这一下同时是三件事：他选了这一款、他的口味往这个方向偏、下一步可以看效果图。
   * 取消选择也要说——「他把刚才那个取消了」和「他什么都没做」不是一回事。
   */
  const tapProduct = useCallback(
    (product: Product) => {
      const off = selectedRef.current?.ref === product.ref;
      setSelected(off ? null : product);
      const facts = [
        product.color,
        fibreLabel(product.composition),
        TEXTURE_LABEL[String(product.texture)] ?? product.texture
      ]
        .filter(Boolean)
        .join(" · ");
      // 点中一款是整场里最热的那一刻:打断没说完的话,立刻谈他指着的这款。
      // 有照片/没照片两条路的文案在 voice-events 里,测试台跑的是同一份
      screenBitsRef.current.selected = off ? undefined : product.color || product.ref;
      pushEvent({ type: "tap_product", facts, off, shotDone });
      // 落库：以前这一下只活在内存里，顾客走了就什么都没留下——
      // 而「他从五款里挑中了哪一款」是后台跟线索时最想知道的一件事
      void ensureConsultation().then((consultationId) =>
        fetch(`${API}/pick`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ref: product.ref,
            color: product.color ?? "",
            composition: product.composition ?? "",
            texture: product.texture ?? "",
            imageUrl: product.image_url ?? "",
            off,
            consultationId: consultationId || undefined,
            voiceSessionId: voiceSessionIdRef.current || undefined,
            sessionLabel: sessionLabelRef.current
          })
        }).catch(() => undefined)
      );
    },
    // shotDone 进依赖：点中一款时走哪条路，取决于这一场到底拍没拍照片
    [ensureConsultation, pushEvent, shotDone]
  );

  /**
   * 每一轮之后，把「现在是什么情况」追加进对话。
   *
   * 替掉的是话术里一大段「如果没照片就提醒他拍」「如果已经叫过就别重复」
   * 「如果他要走了就别叫人」——**这些服务端全都算得出**，算好了直接给结论，
   * 比写成规则可靠：服务端不会忘、不会误判、不会因为对话变长而注意不到。
   *
   * **不等它。** 这一跳要一两百毫秒，插在顾客说完和模型开口之间就是硬延迟，
   * 而那正是「人机感」的来源之一。发完就往下走，注入在下一轮生效——
   * 模型永远看得到最近一次的状态，只是晚一轮，而状态本来就是慢变量。
   *
   * 追加用 role: "user" 包方括号，和这个文件里其他几处旁白一个写法：
   * realtime 的对话里没有「系统旁白」这一档，方括号是让模型认出这不是顾客在说话。
   */
  const injectContext = useCallback(
    (said: string) => {
      const sessionId = voiceSessionIdRef.current;
      const consultationId = consultationIdRef.current;
      if (!sessionId && !consultationId) return;
      fetch(`${API}/context`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          consultationId: consultationId || undefined,
          sessionId: sessionId || undefined,
          said,
          playbooksSeen: playbooksSeenRef.current,
          stalledTurns: stalledRef.current
        })
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data?.line) return;

          // 指纹没变 = 这一轮什么都没问出来。三轮才算卡住，不是话少就算
          if (data.fingerprint === fingerprintRef.current) stalledRef.current += 1;
          else stalledRef.current = 0;
          fingerprintRef.current = data.fingerprint ?? "";

          const parts = [data.line];
          if (data.playbook?.id && !playbooksSeenRef.current.includes(data.playbook.id)) {
            playbooksSeenRef.current.push(data.playbook.id);
            parts.push(data.playbook.text);
          }
          send({
            type: "conversation.item.create",
            item: {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: `[${parts.join("\n\n")}]` }]
            }
          });
          // **不要 response.create。** 这是背景信息，不是要它现在开口——
          // 顾客说完那句已经触发了一次回复，这里再推一次就是两个回复撞车
        })
        .catch(() => undefined);
    },
    [send]
  );

  /** 顾客点了自己那张房间照片：他想听的是「你看我这儿怎么样」 */
  const askAboutRoom = useCallback(() => {
    pushEvent({ type: "tap_room_photo" });
  }, [pushEvent]);

  const reportDiag = useCallback((reason: string) => {
    fetch(`${API}/tools`, {
      method: "POST",
      // 手机上失败往往紧跟着切走页面，普通请求会随页面一起被取消——
      // 于是最该看的那一次诊断恰好是查不到的那一次
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "client_diag",
        session_label: sessionLabelRef.current,
        arguments: {
          reason,
          ...diagRef.current,
          connects: connectsRef.current,
          reconnects: reconnectsRef.current,
          iceState: pcRef.current?.iceConnectionState ?? null,
          connState: pcRef.current?.connectionState ?? null,
          dcState: dcRef.current?.readyState ?? null,
          online: navigator.onLine,
          ua: navigator.userAgent.slice(0, 120)
        }
      })
    }).catch(() => undefined);
  }, []);

  /**
   * 把说完的一轮送回去检查。它拦不住任何东西——话在字还没到齐时就播出去了——
   * 所以发了就忘：不 await、不重试、失败吞掉。会弄断通话的告警比没有告警更糟。
   */
  const auditTurn = useCallback((text: string) => {
    const said = text.trim();
    if (!said) return;
    fetch(`${API}/audit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: said, session_label: sessionLabelRef.current })
    }).catch(() => undefined);
  }, []);

  const handleToolCall = useCallback(
    (item: { name: string; arguments?: string; call_id: string }) => {
      if (handledCallsRef.current.has(item.call_id)) return;
      handledCallsRef.current.add(item.call_id);
      /**
       * wait_for_user 是纯本地的:它的全部意义是让「不说话」成为模型能选的
       * 动作。回结果、**不催**——催一下它就又开口了,等于这工具不存在。
       */
      if (item.name === "wait_for_user") {
        send({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: item.call_id,
            output: JSON.stringify(waitForUserOutput())
          }
        });
        return;
      }
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(item.arguments || "{}");
      } catch {
        /* 参数坏了也要让模型拿到结果，不能卡住 */
      }
      // 正式选品要跑完整链路（取色 → 和谐色域 → 分层多样化 → 重排写理由），约 30 秒。
      // 屏幕上得说清楚它在做什么，否则半分钟的沉默看起来就是坏了。
      // 选项卡自己会摆到屏幕上，再报一行「查询 offer_choices」是噪音
      if (item.name !== "offer_choices") {
        pushCaption(
          "tool",
          item.name === "recommend_for_room" ? "正在为这个房间选五款…" : `查询 ${item.name}`
        );
      }
      fetch(`${API}/tools`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: item.name,
          arguments: args,
          session_label: sessionLabelRef.current,
          consultation_id: consultationIdRef.current || undefined
        })
      })
        .then((r) => r.json())
        .then((result) => {
          /**
           * search_products 的结果**不再上屏**。
           *
           * 2026-08-03 老板：「我图片才刚发，你的推荐产品就到了。」秒推的真凶就在
           * 这一行：模型为了让屏幕上快点有东西，拿参数全是 any 的查询当推荐用，
           * 顾客看到的四款和他说过的话毫无关系。这个工具的本职是让助手能诚实地
           * 回答「有没有蓝色的」，它答的是助手的问题，不是顾客的。
           * 顾客要看东西，走 offer_choices（选项卡）或 recommend_for_room（正式推荐）。
           */
          if (item.name === "offer_choices" && result?.group) {
            const group = result.group as { kind: string; prompt: string; choices: Choice[] };
            if (Array.isArray(group.choices) && group.choices.length) {
              screenBitsRef.current.choices = group.kind;
              const id = ++captionSeq.current;
              setCaptions((prev) => [
                ...prev,
                {
                  id,
                  kind: group.kind,
                  // 助手自己那句话优先：它已经用顾客的语言说过了，屏幕上重复一遍别的说法反而乱
                  prompt: String(args.spoken_prompt || group.prompt || ""),
                  choices: group.choices
                }
              ]);
            }
          }
          if (item.name === "recommend_for_room" && Array.isArray(result?.display) && result.display.length) {
            // space 是重排层对这个空间的判断，五款共用一段——顾客看一眼照片就能验真假。
            // 先把它摆出来，再摆货：顺序反了就成了「先给结果后讲理由」。
            if (typeof result.space === "string" && result.space.trim()) {
              pushCaption("assistant", result.space.trim());
            }
            const id = ++captionSeq.current;
            setCaptions((prev) => [...prev, { id, products: result.display as Product[] }]);
            screenBitsRef.current.products = (result.display as Product[]).length;
            screenBitsRef.current.choices = undefined;
          }
          if (item.name === "request_photo_qr" && typeof result?.qr === "string") {
            qrShownAtRef.current = Date.now();
            setQr(result.qr);
            screenBitsRef.current.qr = true;
          }
          /**
           * 叫了人，九十秒还没动静。
           *
           * 老板 08-04 回放那场里最刺眼的一段：他说想看面料，助手答应了，
           * 他又问、又问，每次拿到的都是同一句热情的「好的，我让同事拿过来」。
           * **重复同一句承诺比不承诺更伤人**——它证明前一句是空的。
           *
           * 这里只做到「提醒它换句话说」。真正的闭环要飞书卡上那颗「我去」按钮
           * 把认领写回来，那需要在飞书后台配回调地址，不是代码这边能自己完成的。
           * 在那之前，宁可让它主动改口，也不要让它把同一句再说第三遍。
           */
          if (item.name === "escalate_to_staff" && result?.status === "escalated") {
            window.setTimeout(() => {
              if (dcRef.current?.readyState !== "open") return;
              send({
                type: "conversation.item.create",
                item: {
                  type: "message",
                  role: "user",
                  content: [
                    {
                      type: "input_text",
                      text:
                        "[It has been a minute and a half since you said a colleague was coming, " +
                        "and nobody has arrived. **Do not repeat that same promise** — saying it " +
                        "again is what proves the first one was empty. Either say you are chasing " +
                        "it yourself, or move him onto something you can actually do right now. " +
                        "Say it once, briefly, and only if the subject is still open.]"
                    }
                  ]
                }
              });
            }, 90_000);
          }
          /**
           * **二维码那张图不能进对话。**
           * 它是几 KB 的 base64，模型拿它一点用没有——它只需要知道码已经在屏幕上。
           * 原样 stringify 会把这几 KB 塞进上下文，而 realtime 的工作记忆总共才 16k。
           */
          const forModel = result && typeof result === "object" ? { ...result } : result;
          if (forModel && typeof forModel === "object" && "qr" in forModel) {
            delete (forModel as Record<string, unknown>).qr;
          }
          /**
           * display 是屏幕要的完整货卡(图、克重、书面理由)——**不给模型**。
           * 老板 08-05:推荐话术「框框一段段输出」,根因是我们把五段书面理由
           * 递到了它嘴边,它就照着念。屏幕上有的字不必进它的嘴;它拿到的
           * picks 只有颜色和几个字的性格,物理上没有可念的稿子。
           */
          if (forModel && typeof forModel === "object" && "display" in forModel) {
            delete (forModel as Record<string, unknown>).display;
          }
          send({
            type: "conversation.item.create",
            item: { type: "function_call_output", call_id: item.call_id, output: JSON.stringify(forModel) }
          });
          nudgeIfSilent();
        })
        .catch((error) => {
          diagRef.current.errors.push(`tool:${String(error)}`);
          send({
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id: item.call_id,
              output: JSON.stringify({ error: "tool_unavailable" })
            }
          });
          nudgeIfSilent();
        });
    },
    [nudgeIfSilent, pushCaption, send]
  );

  const onEvent = useCallback(
    (event: any) => {
      const type = event?.type;
      if (type === "conversation.item.input_audio_transcription.completed") {
        if (event.transcript?.trim()) {
          pushCaption("user", event.transcript.trim());
          queueTurn("user", event.transcript.trim());
          // 顾客说完了，算一次「现在是什么情况」追加进去。不等它，见 injectContext
          injectContext(event.transcript.trim());
          // 他开口了:沉默计数清零,重新计时
          idleShotsRef.current = 0;
          bumpIdle();
        }
      } else if (type === "response.created") {
        activeResponseRef.current = true;
        // 只在通话中：重连期间产生的回复不能让一个死掉的球看起来还活着
        if (orbStateRef.current === "listening") setOrbState("speaking");
      } else if (type === "response.output_audio_transcript.delta") {
        const key = event.response_id || "r";
        if (!assistantBufRef.current[key]) {
          assistantBufRef.current[key] = { id: pushCaption("assistant", ""), text: "" };
        }
        const buffered = assistantBufRef.current[key];
        buffered.text += event.delta || "";
        appendAssistant(buffered.id, event.delta || "");
      } else if (type === "response.output_item.done") {
        if (event.item?.type === "function_call") handleToolCall(event.item);
      } else if (type === "response.done") {
        activeResponseRef.current = false;
        /**
         * 打断(cancel)后攒着的那一次开口在这里发。等 done 再发是因为 cancel
         * 是异步的:立刻 create 会撞上还没死透的在途回复。
         */
        if (pendingCreateRef.current) {
          pendingCreateRef.current = false;
          send({ type: "response.create" });
        }
        // 它说完了,顾客接下来的沉默从现在起算
        bumpIdle();
        /**
         * **response.done 把 id 放在 event.response.id，不是顶层的 response_id。**
         * delta 事件有顶层的，done 没有——于是这里一直拿到 undefined，
         * key 退化成 "r"，缓冲区里那条永远取不到。后果有两个，都很贵：
         * 助手说的话一句都没进转录（2026-08-04 回放老板那场，21 轮全是顾客的），
         * 而违禁词审计扫的也一直是空字符串——那道防线从上线起就没生效过。
         */
        const key = event.response_id || event.response?.id || "r";
        const saidByAssistant = assistantBufRef.current[key]?.text ?? "";
        auditTurn(saidByAssistant);
        queueTurn("assistant", saidByAssistant);
        // 兜底：output_item.done 没到时（丢帧、事件乱序），这里再扫一遍。
        // 少了它，模型会一直等一个永远不来的 function_call_output，整轮对话卡死。
        for (const item of event.response?.output ?? []) {
          if (item?.type === "function_call" && !handledCallsRef.current.has(item.call_id)) {
            handleToolCall(item);
          }
        }
        if (orbStateRef.current === "speaking") setOrbState("listening");
      } else if (type === "input_audio_buffer.speech_started") {
        // 顾客插话了。球跟房间走，不跟模型走
        if (orbStateRef.current === "speaking") setOrbState("listening");
      } else if (type === "error") {
        /**
         * cancel 撞上刚好自己说完的回复会报 response_cancel_not_active——
         * 这是打断机制的正常竞态,不是故障,别让屏幕闪一下「出错了」。
         */
        if (event.error?.code === "response_cancel_not_active") return;
        diagRef.current.errors.push(JSON.stringify(event.error || event));
        setStatus("出错了");
        setStatusKind("err");
        setOrbState("off");
        stopMeter();
      }
    },
    [
      appendAssistant,
      auditTurn,
      bumpIdle,
      handleToolCall,
      injectContext,
      pushCaption,
      queueTurn,
      send,
      setOrbState,
      stopMeter
    ]
  );

  // ---- 凭证。有效期 600 秒，提前取好就把最慢的一段从"点击到对话"里拿掉了 ----
  const prefetchToken = useCallback(() => {
    const issuedAt = Date.now();
    const promise = fetch(`${API}/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: modelPrefRef.current })
    }).then((r) => {
      if (!r.ok) {
        // 状态码要带着走：401 和 503 是完全不同的两件事，而屏幕上
        // 只写「接不通」的话，两者看起来一模一样
        const failure = new Error(`token http ${r.status}`) as Error & { status?: number };
        failure.status = r.status;
        throw failure;
      }
      // 从响应头读，body 原样是 OpenAI 铸的凭证，不解析、不重组
      setCanChooseModel(r.headers.get("x-can-choose-model") === "1");
      return r.json();
    });
    tokenCacheRef.current = { promise, issuedAt };
    promise.catch(() => {
      if (tokenCacheRef.current?.issuedAt === issuedAt) tokenCacheRef.current = null;
    });
    return promise;
  }, []);

  const takeToken = useCallback(() => {
    const cached = tokenCacheRef.current;
    if (cached && Date.now() - cached.issuedAt < 420_000) {
      tokenCacheRef.current = null;
      return cached.promise;
    }
    const fresh = prefetchToken();
    tokenCacheRef.current = null;
    return fresh;
  }, [prefetchToken]);

  const teardown = useCallback((opts?: { keepMic?: boolean }) => {
    if (startWatchdogRef.current) clearTimeout(startWatchdogRef.current);
    startWatchdogRef.current = null;
    if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
    nudgeTimerRef.current = null;
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = null;
    pendingCreateRef.current = false;
    // 重连是全新的模型会话，response_id 会从头开始。留着旧映射，
    // 新会话的第一段文字会被追加到上一场对话的气泡里。
    assistantBufRef.current = {};
    handledCallsRef.current = new Set();
    // 自动重连时留住已授权的流：重连的 start() 不在用户手势里，这时再走一遍
    // getUserMedia，不记住授权的浏览器（Firefox 系是默认）会连弹框的机会都不给、
    // 直接拒——于是弱网手机每次重连都撞一堵「麦克风被拒」的墙。
    // 代价是重连那几秒录音标记还亮着——这本来就是同一场没挂断的通话。
    if (!opts?.keepMic) {
      micRef.current?.getTracks().forEach((track) => track.stop());
      micRef.current = null;
    }
    // 这一场若还停在等许可，那条迟到的流也要收掉，否则录音标记一直亮着
    releaseLateMicRef.current?.();
    releaseLateMicRef.current = null;
    if (dcRef.current) {
      dcRef.current.onclose = null;
      try {
        dcRef.current.close();
      } catch {
        /* 已经关了 */
      }
      dcRef.current = null;
    }
    if (pcRef.current) {
      try {
        pcRef.current.close();
      } catch {
        /* 已经关了 */
      }
      pcRef.current = null;
    }
    activeResponseRef.current = false;
    connectingRef.current = false;
  }, []);

  const startRef = useRef<() => void>(() => undefined);

  const scheduleReconnect = useCallback(
    (reason: string) => {
      if (manualStopRef.current || reconnectTimerRef.current) return;
      reconnectsRef.current.push({ reason, at: Date.now() });
      failStreakRef.current += 1;
      // 接不通的原因多半不会自己好。一直退避重试的结果是顾问盯着「正在重连…」
      // 站在客户面前干等，还不知道卡在哪一步。试够就停下，把原因摆出来。
      if (failStreakRef.current > GIVE_UP_AFTER) {
        manualStopRef.current = true;
        teardown();
        stopMeter();
        setStatus(`接不通（${reason}）— 点一下重试`);
        setStatusKind("err");
        setOrbState("off");
        reportDiag("gave_up");
        return;
      }
      setStatus("正在重连…");
      setStatusKind("");
      teardown({ keepMic: true });
      // 退避的这几秒别闲着，先把凭证铸好。重连时现铸要 7 秒，
      // 而看门狗是从重连那一刻起算的——这 7 秒白白吃掉它一大截余量
      prefetchToken().catch(() => undefined);
      // 退避从上一次连通开始数，一段坏网不该让之后每次重试都卡在 8 秒上限
      const attempt = Math.max(1, reconnectsRef.current.length - backoffBaseRef.current);
      const delay = Math.min(1000 * 2 ** (attempt - 1), 8000);
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        if (!manualStopRef.current) startRef.current();
      }, delay);
    },
    [prefetchToken, reportDiag, setOrbState, stopMeter, teardown]
  );

  /** 掉线就是一个全新的模型会话，得把对话交回去，否则顾客要把话重说一遍 */
  const restoreContext = useCallback(() => {
    /**
     * 从历史接着聊。和掉线重连是两件事：这是同一位顾客隔了一段时间回来，
     * 上一场的话不在内存里，得从库里那份交底接。
     * 只交底不回放全文——顾问要的是「接上」，不是让模型重播一遍。
     */
    if (resumeBriefRef.current) {
      const brief = resumeBriefRef.current;
      resumeBriefRef.current = "";
      send({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "[This customer was here before and is continuing that conversation. Here is " +
                `where you left off:\n${brief}\n` +
                "Pick it up from there: greet them as someone you already know, do not " +
                "introduce yourself, and never ask again anything they already told you.]"
            }
          ]
        }
      });
    }
    if (connectsRef.current <= 1) return;
    const history = transcriptRef.current
      .map((turn) => `${turn.role === "user" ? "Customer: " : "You: "}${turn.text}`)
      .join("\n");
    if (!history) return;
    send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              "The call dropped and reconnected. This is the conversation so far — continue " +
              "naturally from it, do not greet again and do not ask anything the customer " +
              `already answered:\n${history}`
          }
        ]
      }
    });
  }, [send]);

  const start = useCallback(async () => {
    if (connectingRef.current || pcRef.current) return;
    connectingRef.current = true;
    connectStartedAtRef.current = Date.now();
    manualStopRef.current = false;
    setMicBlocked(false);
    setMicBlockReason("unknown");
    if (!sessionLabelRef.current) sessionLabelRef.current = crypto.randomUUID();
    // 会话记录点球就开，不等产出：这一场哪怕什么都没聊出来，
    // 「什么都没聊出来」本身也是店里该看到的东西
    void ensureVoiceSession();
    const t0 = Date.now();
    const mark = (step: string) => diagRef.current.timing.push({ step, ms: Date.now() - t0 });
    stageRef.current = "取凭证";
    setStatus("正在取凭证…");
    setStatusKind("");
    setOrbState("thinking");

    // 在 click 的调用栈里就要麦克风：iOS Safari 把权限框绑在用户手势上，
    // 等数据通道开了再要，那个手势早就过期了。
    // 自动重连时手里往往还留着上一场授权到的流（teardown 的 keepMic）——
    // 直接复用，别再走 getUserMedia：重连不在手势里，不记授权的浏览器会直接拒。
    const heldTrack = micRef.current?.getAudioTracks()[0];
    const micPromise =
      micRef.current && heldTrack?.readyState === "live"
        ? Promise.resolve(micRef.current)
        : navigator.mediaDevices.getUserMedia({ audio: true });
    let micPending = true;
    micPromise.then(
      () => (micPending = false),
      () => (micPending = false)
    );
    const micHint = window.setTimeout(() => {
      if (!micPending || !connectingRef.current) return;
      stageRef.current = "等你允许麦克风";
      setStatus("等你允许麦克风…");
    }, MIC_PROMPT_HINT_MS);
    const releaseLateMic = () => {
      clearTimeout(micHint);
      micPromise.then(
        (stream) => {
          if (micRef.current !== stream) stream.getTracks().forEach((track) => track.stop());
        },
        () => undefined
      );
    };
    releaseLateMicRef.current = releaseLateMic;

    // 权限拒绝必须在这里立刻收口，不能等数据通道打开后才处理。之前 Promise 虽然
    // 在点击时创建，但 rejection 只挂在 dc.onopen 里面；手机于是白连 5–7 秒，
    // 顾问再点一次又重建一套连接，看起来像网络一直重试。
    try {
      const stream = await micPromise;
      if (!connectingRef.current) {
        if (micRef.current !== stream) stream.getTracks().forEach((track) => track.stop());
        return;
      }
      micRef.current = stream;
      clearTimeout(micHint);
      mark("mic");
      stageRef.current = "取凭证";
      setStatus("正在取凭证…");
    } catch (error) {
      const failure = (error as { name?: string })?.name ?? "";
      const permissionState = await readMicrophonePermissionState();
      const reason: MicBlockReason =
        permissionState === "granted" ? "system" : permissionState === "denied" ? "site" : "unknown";
      diagRef.current.errors.push(`mic:${String(error)}`);
      diagRef.current.errors.push(`mic_permission:${permissionState}`);
      releaseLateMic();
      manualStopRef.current = true;
      teardown();
      const denied = failure === "NotAllowedError" || failure === "SecurityError" || !failure;
      setMicBlocked(denied);
      setMicBlockReason(reason);
      setStatus(
        denied
          ? reason === "system"
            ? "手机系统没有把麦克风交给浏览器"
            : reason === "site"
              ? "网站麦克风权限已关闭"
              : "浏览器没有交出麦克风"
          : failure === "NotFoundError" || failure === "OverconstrainedError"
            ? "这台设备上找不到麦克风"
            : failure === "NotReadableError" || failure === "AbortError"
              ? "麦克风被别的程序占着 — 关掉它再试"
              : `麦克风打不开（${failure || "原因不明"}）`
      );
      setStatusKind("err");
      setOrbState("off");
      stopMeter();
      reportDiag(`mic_failed:${failure || "unknown"}`);
      return;
    }

    if (startWatchdogRef.current) clearTimeout(startWatchdogRef.current);
    startWatchdogRef.current = window.setTimeout(() => {
      startWatchdogRef.current = null;
      if (!connectingRef.current) return;
      diagRef.current.errors.push(`start:watchdog_timeout@${stageRef.current}`);
      reportDiag("start_watchdog");
      releaseLateMic();
      // 接下来要自动重连的话，别把好不容易授权到的流扔了
      teardown(manualStopRef.current ? undefined : { keepMic: true });
      if (!manualStopRef.current) scheduleReconnect(`卡在${stageRef.current}`);
      else {
        setStatus("接不通，点一下再试");
        setStatusKind("err");
      }
    }, START_WATCHDOG_MS);

    const tokenPromise = takeToken().then((token) => {
      mark("token");
      stageRef.current = "交换 SDP";
      if (connectingRef.current) setStatus("正在接通音频…");
      // 铸出来的会话才是"谁会回答"的唯一可信说法
      const model = token?.session?.model;
      if (model) setEngine({ text: modelLabel(String(model)), confirmed: true });
      return token;
    });

    // 不配 STUN/TURN：对端是公网服务器，主机候选就够，省掉候选收集的几秒
    const pc = new RTCPeerConnection({ iceServers: [] });
    pcRef.current = pc;
    mark("pcCreated");

    pc.ontrack = (event) => {
      if (!speakerRef.current) return;
      speakerRef.current.srcObject = event.streams[0];
      // Safari 不总是认这么晚挂上来的流的 autoplay，被挡住就表现为开场白凭空消失
      speakerRef.current.play().catch((error) => diagRef.current.errors.push(`play:${String(error)}`));
    };
    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      diagRef.current.ice.push({ ice: state, at: Date.now() });
      if (pcRef.current !== pc) return;
      if (state === "failed" || state === "disconnected") scheduleReconnect(`ice_${state}`);
    };
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      diagRef.current.conn.push({ conn: state, at: Date.now() });
      if (pcRef.current !== pc) return;
      if (state === "failed" || state === "closed") scheduleReconnect(`conn_${state}`);
    };

    // 先开一个音频位，麦克风等连接建好再挂上去：否则 SDP 还在路上时说的第一句会丢
    micSenderRef.current = pc.addTransceiver("audio", { direction: "sendrecv" }).sender;
    const dc = pc.createDataChannel("oai-events");
    dcRef.current = dc;
    dc.onmessage = (message) => {
      try {
        onEvent(JSON.parse(message.data));
      } catch {
        /* 非 JSON 的帧忽略 */
      }
    };
    dc.onclose = () => {
      diagRef.current.dc.push({ dc: "close", at: Date.now() });
      if (pcRef.current === pc) scheduleReconnect("dc_close");
    };
    dc.onopen = () => {
      mark("dcOpen");
      // 音频通道已经通了，唯一没到位的就是麦克风许可。
      // 不说清楚的话，看门狗最后会报「卡在建立音频通道」，指向错的地方。
      if (micPending) {
        stageRef.current = "等你允许麦克风";
        setStatus("等你允许麦克风…");
      }
      micPromise
        .then((stream) => {
          if (pcRef.current !== pc) {
            // 复用的流归下一次重连管，别在这里掐死它
            if (micRef.current !== stream) stream.getTracks().forEach((track) => track.stop());
            return;
          }
          micRef.current = stream;
          return micSenderRef.current?.replaceTrack(stream.getAudioTracks()[0]);
        })
        .then(() => {
          if (pcRef.current !== pc) return;
          mark("live");
          clearTimeout(micHint);
          if (startWatchdogRef.current) clearTimeout(startWatchdogRef.current);
          startWatchdogRef.current = null;
          connectingRef.current = false;
          connectsRef.current += 1;
          backoffBaseRef.current = reconnectsRef.current.length;
          failStreakRef.current = 0;
          setStatus("通话中");
          setStatusKind("live");
          setOrbState("listening");
          if (micRef.current) startMeter(micRef.current);
          restoreContext();
          // 接通之前拍的那张，这时候才轮到它说话
          if (pendingPhotoRef.current) {
            send(pendingPhotoRef.current);
            pendingPhotoRef.current = null;
            nudgeIfSilent();
          }
          prefetchToken();
        })
        .catch((error) => {
          // 拆连接（重连、看门狗、手动停）会让在途的 replaceTrack 一起 reject——
          // 那不是麦克风的病。上面两个 .then 都按 pc 换代放行了，唯独这里没有：
          // 于是手机上一次网络抖动，就被写成「麦克风被挡住了」终局，
          // 还把 manualStop 置真，误杀了 scheduleReconnect 排好的重连。
          if (pcRef.current !== pc) {
            diagRef.current.errors.push(`mic_stale:${String(error).slice(0, 120)}`);
            return;
          }
          diagRef.current.errors.push(`mic:${String(error)}`);
          releaseLateMic();
          if (startWatchdogRef.current) clearTimeout(startWatchdogRef.current);
          startWatchdogRef.current = null;
          // 麦克风被拒或不可用不会自己好，重试只会静默打转，停下来把话说清楚。
          // **要说清是哪一种**：被拒绝、没设备、被别的程序占着，处理方式完全不同，
          // 而以前统统显示「麦克风被挡住了」，顾问照着提示去点权限也没用。
          manualStopRef.current = true;
          teardown();
          const failure = (error as { name?: string })?.name ?? "";
          const denied = failure === "NotAllowedError" || failure === "SecurityError" || !failure;
          setMicBlocked(denied);
          setStatus(
            denied
              ? "麦克风被拒绝了 — 点下面按钮重新请求"
              : failure === "NotFoundError" || failure === "OverconstrainedError"
                ? "这台设备上找不到麦克风"
                : failure === "NotReadableError" || failure === "AbortError"
                  ? "麦克风被别的程序占着 — 关掉它再试"
                  : `麦克风打不开（${failure || "原因不明"}）`
          );
          setStatusKind("err");
          setOrbState("off");
          stopMeter();
          reportDiag(`mic_failed:${failure || "unknown"}`);
        });
    };

    const offerPromise = pc.createOffer().then((offer) => pc.setLocalDescription(offer).then(() => offer));

    Promise.all([tokenPromise, offerPromise])
      .then(([token, offer]) => {
        const ephemeral = token?.value;
        if (!ephemeral) throw new Error("no ephemeral key");
        if (pcRef.current !== pc) return;
        const model = token?.session?.model || "gpt-realtime-2.1-mini";
        /**
         * 先直连，连不上再让服务端转发一次。
         *
         * 直连是快路径：比利时门店就该走它，少一跳。但在中国大陆的手机网络上
         * 浏览器根本到不了 api.openai.com——服务端在 Vercel 连得上（凭证铸得
         * 出来），手机连不上（SDP 换不了），屏幕就停在「交换 SDP」。
         * 老板 2026-08-03 在 5G 上撞的就是这个。
         *
         * 只有这一次握手绕道，音频仍旧直连媒体服务器。
         */
        const direct = fetch(`https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(model)}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${ephemeral}`, "Content-Type": "application/sdp" },
          body: offer.sdp,
          signal: AbortSignal.timeout(12000)
        });
        return direct
          .then((response) => {
            if (!response.ok) {
              // 状态码要带着走。以前这里只抛一句 `sdp http 401`，而屏幕上
              // 统统显示「接不通（交换 SDP）」——凭证被拒和网络不通长得一模一样，
              // 我为此白追了一整轮网络。
              const failure = new Error(`sdp http ${response.status}`) as Error & { status?: number };
              failure.status = response.status;
              throw failure;
            }
            return response;
          })
          .catch((error) => {
            diagRef.current.errors.push(`sdp_direct:${String(error).slice(0, 80)}`);
            stageRef.current = "交换 SDP（经服务端）";
            return fetch(`${API}/sdp?model=${encodeURIComponent(model)}`, {
              method: "POST",
              headers: { "content-type": "application/sdp", "x-ephemeral-key": ephemeral },
              body: offer.sdp
            }).then((response) => {
              if (!response.ok) throw new Error(`sdp relay http ${response.status}`);
              return response;
            });
          })
          .then((response) => response.text())
          .then((answer) => {
            mark("sdp");
            if (pcRef.current !== pc) return;
            stageRef.current = "建立音频通道";
            return pc.setRemoteDescription({ type: "answer", sdp: answer });
          });
      })
      .catch((error) => {
        diagRef.current.errors.push(`start:${String(error)}`);
        releaseLateMic();
        if (startWatchdogRef.current) clearTimeout(startWatchdogRef.current);
        startWatchdogRef.current = null;
        connectingRef.current = false;

        const status = (error as { status?: number })?.status;
        const stage = stageRef.current || "接通";
        // 401/403 重试多少次都是同一个结果。顾客站在旁边，每一次「正在重连」
        // 都是白等，而顾问看不出该去做什么。停下来，把该做的事说出来。
        if (status === 401 || status === 403) {
          manualStopRef.current = true;
          reportDiag("auth_denied");
          teardown();
          stopMeter();
          setStatus(
            stage.startsWith("取凭证")
              ? "登录过期了 — 刷新页面重新登录"
              : `凭证被拒（${stage} ${status}）— 刷新页面再试`
          );
          setStatusKind("err");
          setOrbState("off");
          return;
        }
        reportDiag("start_failed");
        // 哪一步 + 什么错。以前只写一句「接不通（交换 SDP）」，
        // 而「凭证无效」和「网络不通」在那句话里完全一样。
        if (!manualStopRef.current) scheduleReconnect(status ? `${stage} ${status}` : stage);
        else {
          setStatus(`接不通：${error instanceof Error ? error.message : String(error)}`);
          setStatusKind("err");
        }
      });
  }, [
    ensureVoiceSession,
    nudgeIfSilent,
    onEvent,
    prefetchToken,
    reportDiag,
    restoreContext,
    scheduleReconnect,
    send,
    setOrbState,
    startMeter,
    stopMeter,
    takeToken,
    teardown
  ]);

  startRef.current = start;

  const stop = useCallback(() => {
    manualStopRef.current = true;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
    teardown();
    setOrbState("off");
    stopMeter();
    setStatus("待机");
    setStatusKind("");
  }, [setOrbState, stopMeter, teardown]);

  stopRef.current = stop;

  /**
   * 换模型。凭证在铸的时候模型就定死了，所以通话中换必须重新接通一次——
   * 与其让人自己琢磨「是不是要再点一下球」，不如直接替他接上。
   */
  const switchModel = useCallback(() => {
    const next = modelPrefRef.current === MODELS[0] ? MODELS[1] : MODELS[0];
    modelPrefRef.current = next;
    // 缓存里那枚是旧模型铸的，留着就白换了
    tokenCacheRef.current = null;
    setEngine({ text: modelLabel(next), confirmed: false });
    if (pcRef.current || connectingRef.current) {
      stop();
      window.setTimeout(() => startRef.current?.(), 300);
    } else {
      prefetchToken();
    }
  }, [prefetchToken, stop]);

  const onOrbClick = useCallback(() => {
    setTapped(false);
    // 读一次布局，让快速的第二次点击也能重新触发涟漪
    void orbRef.current?.offsetWidth;
    setTapped(true);

    if (connectingRef.current) {
      // 连接中的点击是不耐烦，不是想挂断——但也不能让按钮变死：
      // 明显卡住之后，一次点击必须能取消，而不是叫顾客刷新页面
      if (Date.now() - connectStartedAtRef.current < IGNORE_TAP_MS) return;
      diagRef.current.errors.push("start:cancelled_by_user");
      reportDiag("cancelled_by_user");
      stop();
      return;
    }
    if (reconnectTimerRef.current) return;
    if (pcRef.current) stop();
    else start();
  }, [reportDiag, start, stop]);

  /**
   * 直接向浏览器要一次麦克风。
   *
   * 浏览器不允许网页在被拒之后自己再弹框——那是安全设计，绕不过。但「被拒」
   * 和「还没问过」在屏幕上长得一样，而后者点一下就能弹出来。之前那个 8 秒
   * 封顶的 bug 会把「权限框弹了但没来得及点」也算成失败，那种情况浏览器
   * 并没有记住拒绝。所以给一个按钮当场分辨：弹框了就是没问过，立刻失败
   * 才是真被拒——那时才值得让人去翻设置。
   *
   * 必须在点击的调用栈里调用：权限框绑在用户手势上。
   */
  const askForMic = useCallback(async () => {
    setStatus("正在向浏览器要麦克风…");
    setStatusKind("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // 把用户刚授权的这条流直接交给通话。以前拿到后立刻 stop，再让用户点一次球、
      // 再请求一次权限；移动浏览器会把第二次请求当成没有用户手势，反而重新拒绝。
      if (micRef.current && micRef.current !== stream) {
        micRef.current.getTracks().forEach((track) => track.stop());
      }
      micRef.current = stream;
      setMicBlocked(false);
      setMicBlockReason("unknown");
      setStatus("麦克风已开启");
      setStatusKind("");
      startRef.current?.();
    } catch (error) {
      const failure = (error as { name?: string })?.name ?? "";
      const permissionState = await readMicrophonePermissionState();
      const reason: MicBlockReason =
        permissionState === "granted" ? "system" : permissionState === "denied" ? "site" : "unknown";
      diagRef.current.errors.push(`ask_mic:${failure || String(error)}`);
      diagRef.current.errors.push(`ask_mic_permission:${permissionState}`);
      setMicBlocked(true);
      setMicBlockReason(reason);
      setStatus(
        failure === "NotFoundError"
          ? "这台设备上找不到麦克风"
          : failure === "NotReadableError"
            ? "麦克风被别的程序占着 — 关掉它再试"
            : reason === "system"
              ? "手机系统没有把麦克风交给浏览器"
              : reason === "site"
                ? "网站麦克风权限已关闭"
                : "浏览器没有交出麦克风"
      );
      setStatusKind("err");
    }
  }, []);

  /**
   * Chrome 151 起，浏览器自己渲染 `<usermedia>` 权限控件。它与普通脚本按钮最大的
   * 区别是：即使用户过去点过拒绝，也能在当前页面直接进入可信的恢复流程。
   * 不支持它的浏览器会把标签当普通容器，里面的按钮继续走 getUserMedia fallback。
   */
  useEffect(() => {
    if (!nativeMicControl || !micBlocked) return;
    const control = userMediaControlRef.current;
    if (!control) return;

    control.setConstraints({ audio: true });
    const onStream = () => {
      const stream = control.stream;
      if (!stream) return;
      if (micRef.current && micRef.current !== stream) {
        micRef.current.getTracks().forEach((track) => track.stop());
      }
      micRef.current = stream;
      setMicBlocked(false);
      setMicBlockReason("unknown");
      setStatus("麦克风已开启");
      setStatusKind("");
      startRef.current?.();
    };
    const onError = () => {
      const failure = control.error?.name || "NotAllowedError";
      diagRef.current.errors.push(`usermedia:${failure}`);
      setStatus(
        failure === "NotFoundError"
          ? "这台设备上找不到麦克风"
          : failure === "NotReadableError"
            ? "麦克风正被别的程序使用"
            : "请在浏览器提示中开启麦克风"
      );
      setStatusKind("err");
    };
    const onCancel = () => {
      setStatus("尚未开启麦克风 — 点按钮重试");
      setStatusKind("err");
    };

    control.addEventListener("stream", onStream);
    control.addEventListener("error", onError);
    control.addEventListener("cancel", onCancel);
    return () => {
      control.removeEventListener("stream", onStream);
      control.removeEventListener("error", onError);
      control.removeEventListener("cancel", onCancel);
    };
  }, [micBlocked, nativeMicControl]);

  /**
   * 接上刚才那场。对话本身接不回来（转录只在内存里），能接回的是**这一场的归档**：
   * 后面拍的照片、出的推荐、转的人工都写进同一条咨询单，不会散成两条。
   * 顺带把上次的房间照片摆回屏幕上——顾客还是那个房间，顾问不必重拍。
   */
  const resumeSession = useCallback(() => {
    if (!resumable) return;
    consultationIdRef.current = resumable.id;
    if (resumable.sceneImageUrl) {
      const photo = resumable.sceneImageUrl;
      setCaptions((prev) => [...prev, { id: ++captionSeq.current, photo }]);
    }
    setShotDone(resumable.hasScene);
    setResumable(null);
  }, [resumable]);

  /**
   * 下一位顾客。
   *
   * 门店里两位客人之间只隔五分钟，而这台手机上还留着上一位的照片、推荐、
   * 点过的偏好。不给一个明确的「换人」动作，第二位的对话就会挂在第一位的
   * 单子上——业务人员事后看到的是一条自相矛盾的线索。
   *
   * 「结束」按钮不做（顾客走了顾问不会记得点），但「开始下一位」会做：
   * 它是顾问真的要做那件事时才按的，不靠记性。
   */
  const startFresh = useCallback(() => {
    stopRef.current?.();
    consultationIdRef.current = "";
    voiceSessionIdRef.current = "";
    sessionLabelRef.current = crypto.randomUUID();
    setEngine({ text: modelLabel(modelPrefRef.current), confirmed: false });
    pendingTurnsRef.current = [];
    transcriptRef.current = [];
    // 情境卡和卡住计数跟着这一位顾客走。不清掉，下一位一进门就是「已经放过随便看看那张」
    playbooksSeenRef.current = [];
    fingerprintRef.current = "";
    stalledRef.current = 0;
    setCaptions([]);
    setPicked(new Set());
    setSelected(null);
    setShotDone(false);
    setResumable(null);
    setHistory(null);
  }, []);

  /** 翻历史。列表是懒加载的：待机屏不该为一个多数时候不点的抽屉付网络 */
  const openHistory = useCallback(async () => {
    setHistory([]);
    try {
      const response = await fetch(`${API}/sessions`);
      const data = await response.json();
      setHistory(Array.isArray(data?.items) ? data.items : []);
    } catch {
      setHistory([]);
    }
  }, []);

  /**
   * 接着聊某一场旧的。
   *
   * 接回来的是**上一场的交底**（顾客说过什么、点过什么、助手最后说到哪），
   * 不是原样回放全部转录——顾问要的是「接上」，不是「重播」。
   * 交底作为一条 user 消息注入，模型据此继续，不会重新问一遍已经问过的。
   */
  const continueSession = useCallback(
    async (id: string) => {
      try {
        const response = await fetch(`${API}/sessions?id=${encodeURIComponent(id)}`);
        const data = await response.json();
        const item = data?.item as { consultationId?: string | null } | null;
        const brief = String(data?.brief ?? "");
        if (item?.consultationId) consultationIdRef.current = item.consultationId;
        setHistory(null);
        // 新的一场会话记录，但挂在同一条咨询单上
        voiceSessionIdRef.current = "";
        sessionLabelRef.current = crypto.randomUUID();
        await ensureVoiceSession({ consultationId: item?.consultationId || undefined });
        if (brief) resumeBriefRef.current = brief;
        startRef.current?.();
      } catch {
        setHistory(null);
      }
    },
    [ensureVoiceSession]
  );

  /**
   * 顾问打字。门店里总有说不出口的时候——客户在旁边、店里太吵、
   * 或者要纠正助手刚听岔的一个词。语音是主路，这是那条必须留着的旁路。
   *
   * 语音靠 semantic_vad 自己判断说完了没有，打字没有那个信号，
   * 所以要自己补一句 response.create，否则消息进了对话却没人接话。
   */
  const sendText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      send({
        type: "conversation.item.create",
        item: { type: "message", role: "user", content: [{ type: "input_text", text: trimmed }] }
      });
      send({ type: "response.create" });
      pushCaption("user", trimmed);
      queueTurn("user", trimmed);
    },
    [pushCaption, queueTurn, send]
  );

  // ---- 房间照片 ----
  const sendPhoto = useCallback(
    async (file: File) => {
      setShotBusy(true);
      try {
        // 手机直出 3–8MB，还是在门店 wifi 上、通话进行中。缩到 1600px 在这里只花几毫秒，
        // 在网络上省下的是秒。后面没有任何东西需要传感器分辨率。
        const blob = await new Promise<Blob>((resolve, reject) => {
          const image = new Image();
          const url = URL.createObjectURL(file);
          image.onload = () => {
            URL.revokeObjectURL(url);
            const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
            const canvas = document.createElement("canvas");
            canvas.width = Math.round(image.naturalWidth * scale);
            canvas.height = Math.round(image.naturalHeight * scale);
            canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((out) => (out ? resolve(out) : reject(new Error("encode failed"))), "image/jpeg", 0.85);
          };
          image.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("decode failed"));
          };
          image.src = url;
        });

        if (localPreview) {
          const preview = URL.createObjectURL(blob);
          shotUrlsRef.current.push(preview);
          setCaptions((prev) => [...prev, { id: ++captionSeq.current, photo: preview }]);
          pushCaption("tool", "照片仅在当前页面预览，未上传、保存或交给 AI 分析；刷新后清除。");
          return;
        }

        // 先把咨询单开出来：照片挂上去才做得出效果图，也才在后台看得见
        const consultationId = await ensureConsultation();
        const response = await fetch(`${API}/photo`, {
          method: "POST",
          headers: {
            "content-type": "image/jpeg",
            "x-session-label": sessionLabelRef.current,
            ...(consultationId ? { "x-consultation-id": consultationId } : {})
          },
          body: blob
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result?.error || "upload failed");

        setShotDone(true);
        // 屏幕上把这张图摆出来。传完只留一行字的话，顾客不知道传的是哪张、传对没有
        const preview = URL.createObjectURL(blob);
        shotUrlsRef.current.push(preview);
        setCaptions((prev) => [...prev, { id: ++captionSeq.current, photo: preview }]);
        // 服务端对照片做了取色。助手仍然看不见图，但拿到三个测出来的量——
        // 于是它不必再问「您墙是什么颜色」，而墙以外的一切照旧只能问。
        const room = result?.room as
          | { wall: string; floor: string; undertone: string; guidance: string }
          | null;
        pushCaption(
          "tool",
          room ? `已存下房间照片 · 墙面 ${room.wall.split(" ")[0]}` : "已存下房间照片"
        );
        const note = {
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                /**
                 * **第一人称,不是简报。**
                 *
                 * 原文写的是 "You cannot see the image, but it was analysed for colour",
                 * 于是顾客一问「你看我这个房间怎么样」,mini 模型就把这句话原样漏出去:
                 * 「我看不到图片」。顾客递过手机、屏幕上明明摆着他刚拍的那张,
                 * 却被告知助手看不见——那一刻他就不信这个东西了。
                 *
                 * 分析是真的:墙面、地面、冷暖底调是从他这张照片上量出来的。
                 * 所以就让助手用自己的眼睛说出来。它确实"知道"这些,
                 * 只是知道的方式不是像素。**它不知道的东西照旧要问,不许编。**
                 */
                text: room
                  ? "[The salesperson just showed you this room. Here is what you can see in it — " +
                    `walls ${room.wall}, floor ${room.floor}, overall undertone ${room.undertone}. ` +
                    `${room.guidance} Speak about it in the first person, as what you see ` +
                    "('your walls are a warm off-white, the floor is quite light') — this is your " +
                    "own reading of their room, never say you cannot see the photo or mention any " +
                    "analysis. Give that one-line reading first, then ask ONE thing the colours " +
                    "cannot tell you: what happens in this room, when they are in it, what the " +
                    "light does to them there. Do not ask about wall or floor colour — you can see it.]"
                  : "[The salesperson just photographed this room and it is saved with the " +
                    "consultation. You do not have a reading of the colours for this one, so do " +
                    "not describe them and do not guess. Say something honest and small ('nice " +
                    "big window there' only if they told you so) or simply move on, and ask one " +
                    "question about how they use this room. Never tell the customer you cannot " +
                    "see the photo.]"
              }
            ]
          }
        };
        // 顾客递过手机说「就是这个房间」不会先等你点球。照片照存、屏幕上照显示，
        // 这句话攒着——接通的那一刻补上，助手才知道有这张图。
        if (dcRef.current?.readyState === "open") {
          send(note);
          nudgeIfSilent();
        } else {
          pendingPhotoRef.current = note;
        }
      } catch (error) {
        diagRef.current.errors.push(`photo:${String(error)}`);
        pushCaption("tool", "照片没传上去 — 再试一次");
      } finally {
        setShotBusy(false);
        if (fileRef.current) fileRef.current.value = "";
      }
    },
    [ensureConsultation, localPreview, nudgeIfSilent, pushCaption, send]
  );

  /**
   * 把选中的这款装进顾客自己的房间。
   *
   * 这才是照片真正的动机。原来拍照的理由是「让推荐更准」——顾客无感，顾问懒得拍；
   * 现在是「拍一张，看装在您家什么样」，顾客自己想要。
   *
   * 约 30 秒。语音产品在这半分钟里不该干等：告诉助手它在合成，让它接着讲这块布。
   * 这是语音相对于网页唯一的优势，不用白不用。
   */
  const renderSelected = useCallback(async () => {
    if (!selected || renderBusy) return;
    const consultationId = await ensureConsultation();
    if (!consultationId) {
      pushCaption("tool", "还没有这一场的咨询单 — 先拍一张房间照片");
      return;
    }
    setRenderBusy(true);
    pushCaption("tool", `正在把${selected.color || "这一款"}装进这个房间…`);
    pushEvent({ type: "render_started", color: selected.color || "" });
    try {
      const response = await fetch(`/api/consultations/${consultationId}/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          qualityTier: "balanced",
          selectedSkuId: selected.ref,
          selectedSkuSnapshot: {
            image_url: selected.image_url,
            color: selected.color,
            ref: selected.ref
          }
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(String(result?.error || "render_failed"));
      const url = String(result?.displayImageUrl || result?.item?.resultImageUrl || "");
      if (!url) throw new Error("no_image");
      setCaptions((prev) => [
        ...prev,
        { id: ++captionSeq.current, render: url, color: selected.color || "" }
      ]);
      /**
       * 生成完不是结束——**它得看见自己端出来的东西**。图缩小后随事件注入,
       * 它看着图说一句真的在图里的话,并在顾客反应好的时候把量尺这一步递出去。
       * 打断策略也在事件里:图出现的那一刻,真人会停下手里的话。
       */
      screenBitsRef.current.render = true;
      pushEvent({
        type: "render_done",
        color: selected.color || "",
        image: await shrinkForModel(url)
      });
    } catch (error) {
      diagRef.current.errors.push(`render:${String(error)}`);
      pushCaption("tool", "效果图没出来 — 再点一次试试");
      pushEvent({ type: "render_failed" });
    } finally {
      setRenderBusy(false);
    }
  }, [ensureConsultation, pushCaption, pushEvent, renderBusy, selected]);

  /**
   * 二维码摆在屏幕上的时候，等顾客那边把照片传过来。
   *
   * 只在有码的时候轮询，码一收起就停——所以这不是一条常驻的心跳。
   * 拿到照片要做四件事，缺一件顾客都会觉得没反应：屏幕上出图、码收起来、
   * 助手立刻说出他看到的、以及这一场从此算「有照片」（效果图那条路要用）。
   */
  useEffect(() => {
    if (!qr) return;
    const startedAt = qrShownAtRef.current;
    let stopped = false;

    const timer = window.setInterval(async () => {
      const consultationId = consultationIdRef.current;
      if (!consultationId || stopped) return;
      try {
        const response = await fetch(
          `${API}/photo?consultationId=${encodeURIComponent(consultationId)}`
        );
        if (!response.ok) return;
        const data = await response.json();
        if (!data?.url) return;
        // 只认这枚码摆上去之后传的那张。旧照片会让码在顾客还没扫之前就消失
        if (data.at && new Date(data.at).getTime() < startedAt) return;

        stopped = true;
        setQr("");
        setShotDone(true);
        setCaptions((prev) => [...prev, { id: ++captionSeq.current, photo: String(data.url) }]);

        const room = data.room as { wall: string; floor: string; undertone: string; guidance: string } | null;
        // 照片本身也注入——它从此谈的是看见的房间,不是一段别人转述的色号
        screenBitsRef.current.photo = true;
        screenBitsRef.current.qr = false;
        pushEvent({
          type: "photo_received",
          room,
          image: await shrinkForModel(String(data.url))
        });
      } catch {
        /* 轮询失败不该弄断通话，下一次再试 */
      }
    }, 2000);

    // 码只活十分钟。到点自己收起来，别在屏幕上留一个扫了没反应的东西
    const expiry = window.setTimeout(() => setQr(""), 10 * 60 * 1000);
    return () => {
      stopped = true;
      clearInterval(timer);
      clearTimeout(expiry);
    };
  }, [pushEvent, qr]);

  // ---- 页面加载时先把慢的都付掉 ----
  useEffect(() => {
    sessionLabelRef.current = crypto.randomUUID();
    setNativeMicControl("HTMLUserMediaElement" in window);
    prefetchToken();

    /**
     * 进页面就问一次麦克风权限的状态。
     *
     * 浏览器一旦记住「拒绝」，后面的 getUserMedia 会**立刻失败、不再弹框**——
     * 而顾问看到的是点了球转半天然后报错，还以为是网络。既然点球之前就能知道，
     * 就别让他白点那一次。Permissions API 在部分浏览器上没有 microphone 这一项，
     * 查不到就当没问过。
     */
    navigator.permissions
      ?.query({ name: "microphone" as PermissionName })
      .then((result) => {
        if (result.state === "denied") {
          setMicBlocked(true);
          setMicBlockReason("site");
        }
        result.onchange = () => {
          setMicBlocked(result.state === "denied");
          setMicBlockReason(result.state === "denied" ? "site" : "unknown");
        };
      })
      .catch(() => undefined);

    // 顾问真正需要的只有一件事：刚才那场别丢了。
    // 往前翻历史是业务人员在后台干的活，单手拿着手机、顾客站在旁边的人不会去浏览列表。
    fetch(`${API}/session`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data?.item) setResumable(data.item);
      })
      .catch(() => undefined);

    // 浏览器的第一个 RTCPeerConnection 要同步跑约 5 秒把 WebRTC 栈拉起来，
    // 那 5 秒会连带卡住所有微任务（包括已经 resolve 的凭证 promise）。
    // 在加载时付掉，不要在顾客点下去的那一刻付。
    try {
      const warm = new RTCPeerConnection({ iceServers: [] });
      warm.createDataChannel("warm");
      warm.createOffer().then(
        () => warm.close(),
        () => warm.close()
      );
    } catch {
      /* 预热是尽力而为 */
    }

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (manualStopRef.current || connectingRef.current || reconnectTimerRef.current) return;
      const pc = pcRef.current;
      // 手机会在后台挂起 WebRTC，回到前台立刻验一次
      if (
        pc &&
        (pc.connectionState === "failed" ||
          pc.connectionState === "disconnected" ||
          pc.iceConnectionState === "disconnected" ||
          pc.iceConnectionState === "failed")
      ) {
        scheduleReconnect("visibility");
      }
    };
    const onOnline = () => {
      if (
        !manualStopRef.current &&
        !pcRef.current &&
        !connectingRef.current &&
        !reconnectTimerRef.current &&
        connectsRef.current > 0
      ) {
        scheduleReconnect("online");
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);

    // 让布样条不用麦克风也能试。对方原版为同一个目的暴露过 renderProducts——
    // 没有它，卡片的样式与真实数据只能在一场真通话里才看得到。
    (window as unknown as { __voice?: unknown }).__voice = {
      showProducts: (products: Product[]) =>
        setCaptions((prev) => [...prev, { id: ++captionSeq.current, products }])
    };

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      manualStopRef.current = true;
      teardown();
      stopMeter();
      for (const url of shotUrlsRef.current) URL.revokeObjectURL(url);
      shotUrlsRef.current = [];
    };
    // 只在挂载时跑一次：预热和预取都是一次性的
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 「所有字不用滚动就能看到」靠这一条：新内容一到就贴到底
  useEffect(() => {
    if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, [captions]);

  /**
   * 布局跟着球走，**不跟着「接通了没有」走**。
   *
   * 点下去到数据通道真开有十几秒。若用 statusKind === "live" 决定布局，
   * 那十几秒里屏幕一动不动——球还是大的、还在中间、还写着「点一下」。
   * 顾问会以为没点上,于是再点,而连接中 12 秒内的点击是被故意忽略的（防误触）,
   * 于是再点也没反应。看起来就是「连接坏了」。
   */
  selectedRef.current = selected;

  const live = orb !== "off";
  /** 真正接通了才算。打字要走数据通道,没开之前给了入口也发不出去 */
  const connected = statusKind === "live";

  return (
    <div className={`rz-voice ${live ? "is-live" : "is-idle"}`}>
      <header className="rz-voice-head">
        <span className={`rz-voice-dot ${statusKind}`} />
        <h1>DRAPÉ</h1>
        {/* 只有平台管理员能做模型对照；其他账号看到服务端实际铸出的只读徽章 */}
        {canChooseModel ? (
          <button
            type="button"
            className={`rz-voice-engine is-switch ${engine.confirmed ? "is-confirmed" : ""}`}
            onClick={switchModel}
            title="换一个模型试试（会重新接通一次）"
          >
            {engine.text}
          </button>
        ) : (
          <span className={`rz-voice-engine ${engine.confirmed ? "is-confirmed" : ""}`}>{engine.text}</span>
        )}
        {status !== "待机" ? <span className="rz-voice-status">{status}</span> : null}
      </header>

      <div className="rz-voice-body" ref={streamRef} aria-live="polite">
        {/* 接通前这里报走到哪一步了（取凭证 / 接通音频 / 等你允许麦克风）。
            建连要十几秒，这十几秒里屏幕上必须有个东西在变。 */}
        {live && !connected ? <p className="rz-voice-stage">{status}</p> : null}
        {captions.map((item) =>
          "photo" in item ? (
            /* 点一下问它这个房间。顾客递过手机时想说的往往就是「你看我这儿怎么样」，
               而屏幕上那张照片本来只是个静止的确认图——现在它自己就是入口。 */
            <button
              type="button"
              className="rz-voice-photo-tap"
              disabled={localPreview}
              key={item.id}
              onClick={() => askAboutRoom()}
              aria-label={localPreview ? "房间照片本地预览，未上传" : "问问这个房间适合什么"}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="rz-voice-photo" src={item.photo} alt="这个房间的照片" />
              <span>{localPreview ? "仅本地预览 · 尚未上传" : "问问这个房间"}</span>
            </button>
          ) : "render" in item ? (
            <figure className="rz-voice-render" key={item.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.render} alt={`${item.color || "这一款"}装在这个房间的样子`} />
              <figcaption>{item.color ? `${item.color} · 装在这个房间` : "装在这个房间"}</figcaption>
            </figure>
          ) : "choices" in item ? (
            /* 面料册。顾客说不出「提花」，但他会指——指一下同时答了三个问题 */
            <div className="rz-voice-choices" key={item.id}>
              {item.prompt ? <p className="rz-voice-choice-ask">{item.prompt}</p> : null}
              <div className={`rz-voice-choice-grid ${item.kind === "colour" ? "is-colour" : ""}`}>
                {item.choices.map((choice) => {
                  const on = picked.has(`${item.kind}:${choice.id}`);
                  return (
                    <button
                      type="button"
                      key={`${item.id}-${choice.id}`}
                      className={`rz-voice-choice ${on ? "is-picked" : ""}`}
                      aria-pressed={on}
                      onClick={() => void tapChoice(item.kind, choice)}
                    >
                      {choice.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`/facets/${choice.image}.webp`}
                          alt={choice.label}
                          loading="lazy"
                          decoding="async"
                          width={96}
                          height={96}
                        />
                      ) : choice.hex ? (
                        <span className="rz-voice-choice-chip" style={{ background: choice.hex }} />
                      ) : null}
                      <span className="rz-voice-choice-text">
                        <strong>{choice.label}</strong>
                        <small>{choice.hint}</small>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : "products" in item ? (
            <div className="rz-voice-cards" key={item.id}>
              {item.products.map((product, index) => (
                <button
                  type="button"
                  className={`rz-voice-card ${selected?.ref === product.ref ? "is-picked" : ""}`}
                  key={`${item.id}-${product.ref}`}
                  aria-pressed={selected?.ref === product.ref}
                  onClick={() => tapProduct(product)}
                >
                  {product.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={product.image_url}
                      alt={[product.color, product.composition].filter(Boolean).join(" — ") || product.ref}
                      loading={index < 2 ? "eager" : "lazy"}
                      decoding="async"
                      width={150}
                      height={112}
                    />
                  ) : null}
                  <div className="rz-voice-card-meta">
                    <strong>{product.color || ""}</strong>
                    <small title={product.composition || ""}>
                      {[
                        fibreLabel(product.composition),
                        product.weight_gsm ? `${product.weight_gsm} g/m²` : "",
                        TEXTURE_LABEL[String(product.texture)] ?? product.texture
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            /* 顾客那句保持原话：顾客说荷兰语屏幕上就是荷兰语，
               这是顾问核对「它听对了没有」的唯一凭据，翻成中文反而没用了。

               **data-no-translate 是这条注释的执行方**：界面翻译走的是运行时扫
               DOM 文本节点替换，谁都不认识这里是转录。顾客答一声「好」，
               而词典里恰好有「好」，屏幕上就会变成别的字——核对的凭据被改写了，
               还看不出是被谁改的。这一句必须是他说的原话。 */
            <p className={`rz-voice-cap is-${item.role}`} key={item.id} data-no-translate>
              {item.text}
            </p>
          )
        )}

        {/* 顾客的房间照片在他自己手机里，而店里这台在顾问手上。
            扫一下就传过来——传到了会自己收起来（见上面那个轮询） */}
        {qr ? (
          <div className="rz-voice-qr">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="" width={220} height={220} />
            <p>扫一下，从您手机传张照片</p>
            <button type="button" onClick={() => setQr("")}>
              收起
            </button>
          </div>
        ) : null}
      </div>

      <footer className="rz-voice-foot">
        {/* 选了一款才谈得上「装在您家什么样」。没照片时这颗按钮就是去拍照的入口——
            拍照的动机从「让推荐更准」（顾客无感）换成了顾客自己想看的东西 */}
        {selected ? (
          <button
            type="button"
            className="rz-voice-render-cta"
            disabled={renderBusy}
            onClick={() => (shot ? void renderSelected() : fileRef.current?.click())}
          >
            {renderBusy
              ? `正在合成${selected.color || ""}… 约半分钟`
              : shot
                ? `看${selected.color || "这一款"}装在您家什么样`
                : "拍一张，看装在您家什么样"}
          </button>
        ) : null}

        {typing && connected ? (
          <form
            className="rz-voice-compose"
            onSubmit={(event) => {
              event.preventDefault();
              sendText(draft);
              setDraft("");
            }}
          >
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="打字告诉它…"
              aria-label="打字发给助手"
              autoFocus
            />
            <button type="submit" disabled={!draft.trim()}>
              发送
            </button>
          </form>
        ) : null}

        <div className="rz-voice-controls">
          {live ? (
            <button
              type="button"
              className={`rz-voice-shot ${shotDone ? "is-done" : ""}`}
              aria-label="加一张房间照片"
              disabled={shotBusy}
              onClick={() => fileRef.current?.click()}
            >
              <CameraIcon />
            </button>
          ) : null}
          <button
            type="button"
            ref={orbRef}
            className={`rz-voice-orb is-${orb} ${tapped ? "is-tapped" : ""}`}
            aria-label={orb === "off" ? "点一下开始说话" : "点一下结束"}
            onClick={onOrbClick}
            onAnimationEnd={(event) => {
              if (event.animationName.includes("ping")) setTapped(false);
            }}
          >
            <span className="halo" />
            <span className="sphere" />
            <span className="veil" />
            <span className="veil b" />
            <span className="rim" />
            <span className="gloss" />
            <span className="ping" />
          </button>
          {connected ? (
            <button
              type="button"
              className={`rz-voice-key ${typing ? "is-on" : ""}`}
              aria-label={typing ? "收起打字" : "打字告诉它"}
              aria-pressed={typing}
              onClick={() => setTyping((prev) => !prev)}
            >
              <KeyboardIcon />
            </button>
          ) : live ? (
            /* 键盘还没到位时得有人占着这个位子，否则球会被相机键推得偏向一边 */
            <span className="rz-voice-spacer" aria-hidden="true" />
          ) : null}
        </div>

        {/* 待机屏要引导：顾问第一次拿到这页，不知道该让顾客说什么、能说多细 */}
        {live ? null : (
          <div className="rz-voice-invite">
            {/* 两个动作就够了：接上刚才那场，或者点球开新的一场 */}
            {resumable ? (
              <button type="button" className="rz-voice-resume" onClick={resumeSession}>
                <span className="rz-voice-resume-lead">↩ 继续刚才</span>
                <span className="rz-voice-resume-meta">
                  {[
                    resumable.clientName,
                    resumable.pickCount ? `已推 ${resumable.pickCount} 款` : resumable.hasScene ? "有房间照片" : ""
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </button>
            ) : null}
            {/* 换人和翻旧账。门店里两位客人之间只隔五分钟，而这台手机上还留着
                上一位的照片和偏好——不给一个明确的「换人」动作，第二位的对话
                就会挂在第一位的单子上，事后看到的是一条自相矛盾的线索 */}
            <div className="rz-voice-sessionbar">
              <button type="button" onClick={startFresh}>＋ 下一位顾客</button>
              <button type="button" onClick={() => void openHistory()}>近期接待</button>
            </div>
            <p className="rz-voice-invite-line">
              {picks ? "点一下，接着和顾客说" : "点一下，让它听顾客说"}
            </p>
            {micBlocked ? (
              <>
                {createElement(
                  "usermedia",
                  {
                    className: "rz-voice-usermedia",
                    ref: (node: HTMLElement | null) => {
                      userMediaControlRef.current = node as UserMediaControlElement | null;
                    }
                  },
                  <button
                    type="button"
                    className="rz-voice-mic-cta"
                    onClick={nativeMicControl ? undefined : () => void askForMic()}
                  >
                    开启麦克风并开始通话
                  </button>
                )}
                <p className="rz-voice-invite-eg is-warn">
                  {micBlockReason === "system"
                    ? "网站权限已经允许，但手机系统仍拦着。请开启手机的“麦克风访问”，并在应用权限里允许 Chrome；回来后再点上面按钮。"
                    : micBlockReason === "site"
                      ? "请在地址栏旁的网站设置里把麦克风改为允许；回来后再点上面按钮。"
                      : "网站和桌面快捷方式使用同一份权限；点一下，由浏览器完成授权。"}
                </p>
              </>
            ) : (
              <p className="rz-voice-invite-eg">
                顾客说什么语言，它就用什么语言答。
                <br />
                比如「客厅朝南，想要遮光一点的」
              </p>
            )}
            <button
              type="button"
              className={`rz-voice-shot-cta ${shotDone ? "is-done" : ""}`}
              disabled={shotBusy}
              onClick={() => fileRef.current?.click()}
            >
              <CameraIcon />
              <span>{shot ? "换一张房间照片" : "加一张房间照片"}</span>
              <small>{localPreview ? (shotBusy ? "正在读取…" : "仅本页预览 · 不上传、不保存") : shotBusy ? "正在存…" : shot ? "已存下" : "选了会更准"}</small>
            </button>
          </div>
        )}
      </footer>

      {/* 不写 capture：手机上一旦声明它就直接开相机，相册里已有的房间照片反而选不了。
          去掉之后系统自己弹「拍照 / 从相册选」，两条路都在。 */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void sendPhoto(file);
        }}
      />
      {/* 近期接待。顾问单手拿着手机、顾客站在旁边，所以是一层薄抽屉不是一个页面：
          扫一眼认出是哪位（照片 + 他说过的第一句），点一下接着聊。 */}
      {history ? (
        <div className="rz-voice-sheet" role="dialog" aria-label="近期接待">
          <div className="rz-voice-sheet-head">
            <strong>近期接待</strong>
            <button type="button" onClick={() => setHistory(null)}>关闭</button>
          </div>
          <div className="rz-voice-sheet-list">
            {history.length === 0 ? (
              <p className="rz-voice-sheet-empty">还没有记录。这台手机上聊过的每一场都会出现在这里。</p>
            ) : (
              history.map((session) => {
                const firstSaid = session.transcript.find((turn) => turn.role === "user")?.text ?? "";
                return (
                  <button
                    type="button"
                    key={session.id}
                    className="rz-voice-sheet-row"
                    onClick={() => void continueSession(session.id)}
                  >
                    {session.sceneImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={session.sceneImageUrl} alt="" loading="lazy" width={48} height={48} />
                    ) : (
                      <span className="rz-voice-sheet-blank" />
                    )}
                    <span className="rz-voice-sheet-meta">
                      <strong>{session.clientName}</strong>
                      {/* 顾客自己的第一句话是最好的辨认凭据，比任何生成的摘要都准 */}
                      <small>{firstSaid || "（没说话）"}</small>
                      <i>
                        {new Date(session.lastActiveAt).toLocaleString("zh-CN", {
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit"
                        })}
                        {session.pickCount ? ` · 已推 ${session.pickCount} 款` : ""}
                      </i>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
      <audio ref={speakerRef} autoPlay playsInline />
    </div>
  );
}
