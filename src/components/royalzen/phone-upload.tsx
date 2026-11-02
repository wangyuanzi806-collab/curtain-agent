"use client";

import { useCallback, useRef, useState } from "react";

/**
 * 顾客自己手机上的上传页。
 *
 * 文案不走全站那套 i18n:那一套是运行时扫 DOM 替换,要先加载翻译表,
 * 而这一页的读者是一个站在店里、举着手机、等三秒就会放弃的人。
 * 四种语言直接写死在这儿,按手机自己的语言选一份。
 */
const COPY = {
  nl: {
    lead: "Stuur een foto van uw kamer",
    hint: "De adviseur ziet hem meteen op het scherm in de winkel.",
    pick: "Foto kiezen",
    sending: "Versturen…",
    done: "Gelukt — kijk op het scherm in de winkel.",
    expired: "Deze code is verlopen. Vraag de adviseur om een nieuwe.",
    failed: "Niet gelukt. Probeer het nog een keer."
  },
  fr: {
    lead: "Envoyez une photo de votre pièce",
    hint: "Le conseiller la verra aussitôt sur l'écran en boutique.",
    pick: "Choisir une photo",
    sending: "Envoi…",
    done: "C'est envoyé — regardez l'écran en boutique.",
    expired: "Ce code a expiré. Demandez-en un nouveau au conseiller.",
    failed: "Échec de l'envoi. Réessayez."
  },
  zh: {
    lead: "传一张您房间的照片",
    hint: "顾问那边的屏幕上马上就能看到。",
    pick: "选照片",
    sending: "正在传…",
    done: "传好了 — 看店里那台屏幕。",
    expired: "这个码过期了，请顾问再给一个。",
    failed: "没传上去，再试一次。"
  },
  en: {
    lead: "Send a photo of your room",
    hint: "The adviser sees it on the shop screen straight away.",
    pick: "Choose a photo",
    sending: "Sending…",
    done: "Sent — have a look at the screen in the shop.",
    expired: "This code has expired. Ask the adviser for a new one.",
    failed: "That did not go through. Try again."
  }
};

function copyFor(): (typeof COPY)["en"] {
  if (typeof navigator === "undefined") return COPY.en;
  const tag = (navigator.language || "en").slice(0, 2).toLowerCase();
  return COPY[tag as keyof typeof COPY] ?? COPY.en;
}

type Phase = "idle" | "sending" | "done" | "expired" | "failed";

export default function PhoneUpload({ token }: { token: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const fileRef = useRef<HTMLInputElement>(null);
  const t = copyFor();

  const send = useCallback(
    async (file: File) => {
      setPhase("sending");
      try {
        /**
         * 先在手机上缩到 1600px 再传。
         *
         * 手机直出的原图动辄七八 MB,而门店的 wifi 就是那样;
         * 缩过之后一般在 300KB 上下。取色只看大色块,缩图不影响读数。
         * 缩不动(浏览器不支持、HEIC 解不开)就原样传,别为了省流量把照片弄丢。
         */
        const blob = await shrink(file).catch(() => file);
        const response = await fetch(`/api/voice/upload/${encodeURIComponent(token)}`, {
          method: "POST",
          headers: { "content-type": blob.type || file.type || "image/jpeg" },
          body: blob
        });
        if (response.status === 403) return setPhase("expired");
        if (!response.ok) return setPhase("failed");
        setPhase("done");
      } catch {
        setPhase("failed");
      } finally {
        if (fileRef.current) fileRef.current.value = "";
      }
    },
    [token]
  );

  return (
    <main className="rz-phone-upload">
      <h1>{t.lead}</h1>
      <p>{t.hint}</p>

      {phase === "done" ? (
        <p className="rz-phone-upload-done">{t.done}</p>
      ) : phase === "expired" ? (
        <p className="rz-phone-upload-bad">{t.expired}</p>
      ) : (
        <>
          <button
            type="button"
            className="rz-phone-upload-button"
            disabled={phase === "sending"}
            onClick={() => fileRef.current?.click()}
          >
            {phase === "sending" ? t.sending : t.pick}
          </button>
          {phase === "failed" ? <p className="rz-phone-upload-bad">{t.failed}</p> : null}
        </>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void send(file);
        }}
      />
    </main>
  );
}

/** 缩到长边 1600,JPEG 0.82。和店里那台拍照走的是同一档 */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no_canvas");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("no_blob"))), "image/jpeg", 0.82)
  );
}
