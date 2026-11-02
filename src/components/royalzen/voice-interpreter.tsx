"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 现场传译：店员说法语 ⇄ 顾客说荷兰语。
 *
 * 与语音顾问是同一台平板上的两个页面，但会话形态完全不同——这里只转录、不出声，
 * 所以没有 ontrack、没有 audio 元素，成本也低一个数量级。
 * 合并前它是独立部署的 edge function，理由是「改销售那个是生产风险，
 * 翻译不该跟着一起冒险」；并进同一个应用后这个理由消失，做成兄弟路由。
 */

const MIC_TIMEOUT_MS = 8000;
const CONNECT_TIMEOUT_MS = 20000;

type Pair = { id: number; original: string; src: string | null; text: string | null; failed?: boolean };

export default function VoiceInterpreter() {
  const [status, setStatus] = useState("待机");
  const [statusKind, setStatusKind] = useState<"" | "live" | "err">("");
  const [live, setLive] = useState(false);
  const [pairs, setPairs] = useState<Pair[]>([]);

  const feedRef = useRef<HTMLDivElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const connectingRef = useRef(false);
  const watchdogRef = useRef<number | null>(null);
  const seqRef = useRef(0);

  const translate = useCallback((original: string) => {
    const id = ++seqRef.current;
    // 卡片在转录到达的那一刻就出现，房间里先看到「听见了」，再等译文
    setPairs((prev) => [...prev, { id, original, src: null, text: null }]);
    fetch("/api/voice/translate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: original })
    })
      .then((r) => r.json())
      .then((result) => {
        setPairs((prev) =>
          prev.map((pair) =>
            pair.id === id
              ? { ...pair, src: String(result?.src ?? "other"), text: String(result?.text ?? "") }
              : pair
          )
        );
      })
      .catch(() => {
        setPairs((prev) => prev.map((pair) => (pair.id === id ? { ...pair, failed: true } : pair)));
      });
  }, []);

  const teardown = useCallback(() => {
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
    watchdogRef.current = null;
    try {
      dcRef.current?.close();
    } catch {
      /* 已经关了 */
    }
    dcRef.current = null;
    try {
      pcRef.current?.close();
    } catch {
      /* 已经关了 */
    }
    pcRef.current = null;
    micRef.current?.getTracks().forEach((track) => track.stop());
    micRef.current = null;
    connectingRef.current = false;
    setLive(false);
  }, []);

  const start = useCallback(() => {
    if (connectingRef.current || pcRef.current) {
      teardown();
      setStatus("待机");
      setStatusKind("");
      return;
    }
    connectingRef.current = true;
    setStatus("正在接通…");
    setStatusKind("");

    // 在 click 的调用栈里就要麦克风：iOS 把权限框绑在用户手势上
    const micPromise = Promise.race([
      navigator.mediaDevices.getUserMedia({ audio: true }),
      new Promise<MediaStream>((_, reject) =>
        setTimeout(() => reject(new Error("mic_timeout")), MIC_TIMEOUT_MS)
      )
    ]);
    micPromise.catch(() => undefined);

    watchdogRef.current = window.setTimeout(() => {
      watchdogRef.current = null;
      if (!connectingRef.current) return;
      teardown();
      setStatus("接不通，点一下再试");
      setStatusKind("err");
    }, CONNECT_TIMEOUT_MS);

    const tokenPromise = fetch("/api/voice/translate/token", { method: "POST" }).then((r) => r.json());

    const pc = new RTCPeerConnection({ iceServers: [] });
    pcRef.current = pc;
    // 转录会话不回传音频，所以只 sendonly，也不需要 <audio>
    const sender = pc.addTransceiver("audio", { direction: "sendonly" }).sender;
    const dc = pc.createDataChannel("oai-events");
    dcRef.current = dc;
    dc.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data);
        if (
          event?.type === "conversation.item.input_audio_transcription.completed" &&
          event.transcript?.trim()
        ) {
          translate(event.transcript.trim());
        }
      } catch {
        /* 非 JSON 的帧忽略 */
      }
    };
    dc.onopen = () => {
      micPromise
        .then((stream) => {
          if (pcRef.current !== pc) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }
          micRef.current = stream;
          return sender.replaceTrack(stream.getAudioTracks()[0]);
        })
        .then(() => {
          if (pcRef.current !== pc) return;
          if (watchdogRef.current) clearTimeout(watchdogRef.current);
          watchdogRef.current = null;
          connectingRef.current = false;
          setLive(true);
          setStatus("正在听");
          setStatusKind("live");
        })
        .catch((error) => {
          if (watchdogRef.current) clearTimeout(watchdogRef.current);
          watchdogRef.current = null;
          teardown();
          setStatus(
            String(error?.message) === "mic_timeout"
              ? "麦克风没有回应 — 请允许访问"
              : "麦克风被挡住了 — 请允许访问"
          );
          setStatusKind("err");
        });
    };

    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer).then(() => offer))
      .then((offer) =>
        tokenPromise.then((token) => {
          if (!token?.value) throw new Error("没拿到凭证");
          if (pcRef.current !== pc) return;
          return fetch("https://api.openai.com/v1/realtime/calls", {
            method: "POST",
            headers: { Authorization: `Bearer ${token.value}`, "Content-Type": "application/sdp" },
            body: offer.sdp
          })
            .then((response) => {
              if (!response.ok) throw new Error(`sdp http ${response.status}`);
              return response.text();
            })
            .then((answer) => {
              if (pcRef.current !== pc) return;
              return pc.setRemoteDescription({ type: "answer", sdp: answer });
            });
        })
      )
      .catch((error) => {
        if (watchdogRef.current) clearTimeout(watchdogRef.current);
        watchdogRef.current = null;
        teardown();
        setStatus(`接不通：${error instanceof Error ? error.message : String(error)}`);
        setStatusKind("err");
      });
  }, [teardown, translate]);

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [pairs]);

  useEffect(() => () => teardown(), [teardown]);

  return (
    <div className="rz-voice rz-tolk">
      <header className="rz-voice-head">
        <span className={`rz-voice-dot ${statusKind}`} />
        <h1>DRAPÉ TOLK</h1>
        <span className="rz-voice-status" style={{ marginLeft: "auto" }}>
          {status}
        </span>
      </header>

      <div className="rz-voice-stream" ref={feedRef} aria-live="polite">
        {pairs.length === 0 ? (
          <p className="rz-voice-empty">
            点下面的按钮开始说话。
            <br />
            法语会变成荷兰语，荷兰语会变成法语。
          </p>
        ) : null}
        {pairs.map((pair) => {
          const direction = pair.src === "fr" ? "nl" : "fr";
          return (
            <article
              className={`rz-tolk-pair ${pair.src ? `is-${direction}` : "is-pending"}`}
              key={pair.id}
            >
              <span className="rz-tolk-tag">
                {pair.src
                  ? `${pair.src === "fr" ? "FR" : pair.src === "nl" ? "NL" : "??"} → ${direction.toUpperCase()}`
                  : "…"}
              </span>
              <p className="rz-tolk-src">{pair.original}</p>
              <p className="rz-tolk-out">
                {pair.failed ? "⚠ 没能翻译" : pair.text === null ? "翻译中…" : pair.text || "—"}
              </p>
            </article>
          );
        })}
      </div>

      <footer className="rz-voice-foot">
        <button
          type="button"
          className={`rz-tolk-mic ${live ? "is-on" : ""}`}
          aria-label={live ? "停止" : "开始"}
          onClick={start}
        >
          {live ? "■" : "🎙"}
        </button>
      </footer>
    </div>
  );
}
