"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import Icon from "@/components/royalzen/icon";
import { getEmailLoginFailure, getLoginErrorContent } from "@/lib/login-access";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type LoginFeedback = {
  kind: "pending" | "success" | "error";
  message: string;
};

export default function LoginActions({ initialError }: { initialError?: string }) {
  const [email, setEmail] = useState("");
  const [feedback, setFeedback] = useState<LoginFeedback | null>(null);
  const [loading, setLoading] = useState<"google" | "email" | null>(null);
  const [accessError, setAccessError] = useState(() => getLoginErrorContent(initialError));
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!accessError || !dialog || dialog.open) return;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [accessError]);

  const dismissAccessError = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("error");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    setAccessError(null);
  };

  const getRedirectUrl = () => {
    const searchParams = new URLSearchParams(window.location.search);
    const next = searchParams.get("next") || "/app";
    return `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
  };

  const signInWithGoogle = async () => {
    setLoading("google");
    setFeedback(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: getRedirectUrl(),
          queryParams: { prompt: "select_account" },
        }
      });
      if (error) throw error;
    } catch (error) {
      setFeedback({ kind: "error", message: "Google 登录启动失败，请稍后重试。" });
      setLoading(null);
    }
  };

  const sendEmailCode = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim()) return;
    const normalizedEmail = email.trim().toLowerCase();
    setLoading("email");
    setFeedback({ kind: "pending", message: "正在向该邮箱发送安全登录链接…" });
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: { emailRedirectTo: getRedirectUrl(), shouldCreateUser: true }
      });
      if (error) throw error;
      setFeedback({
        kind: "success",
        message: "登录链接已发送，请检查收件箱和垃圾邮件。链接只能使用一次。",
      });
    } catch (error) {
      const failure = getEmailLoginFailure(error);
      setFeedback({ kind: "error", message: failure.message });
      if (failure.kind === "access_denied") {
        setAccessError(getLoginErrorContent("access_denied"));
      }
    } finally {
      setLoading(null);
    }
  };

  return (
    <>
      <button className="rz-auth-button" disabled={Boolean(loading)} onClick={signInWithGoogle} type="button">
        <svg aria-hidden="true" className="rz-google-logo" viewBox="0 0 24 24">
          <path d="M21.6 12.227c0-.709-.064-1.391-.182-2.045H12v3.873h5.382a4.6 4.6 0 0 1-1.996 3.018v2.509h3.232c1.891-1.741 2.982-4.309 2.982-7.355Z" fill="#4285F4" />
          <path d="M12 22c2.7 0 4.964-.895 6.618-2.418l-3.232-2.509c-.895.6-2.041.955-3.386.955-2.605 0-4.81-1.759-5.6-4.123H3.059v2.591A9.998 9.998 0 0 0 12 22Z" fill="#34A853" />
          <path d="M6.4 13.905A6.013 6.013 0 0 1 6.086 12c0-.661.114-1.305.314-1.905V7.504H3.059A9.998 9.998 0 0 0 2 12c0 1.614.386 3.141 1.059 4.496L6.4 13.905Z" fill="#FBBC05" />
          <path d="M12 5.973c1.468 0 2.786.504 3.823 1.491l2.868-2.868C16.959 2.982 14.7 2 12 2a9.998 9.998 0 0 0-8.941 5.504L6.4 10.095c.79-2.364 2.995-4.122 5.6-4.122Z" fill="#EA4335" />
        </svg>
        {loading === "google" ? "正在连接 Google..." : "使用 Google 账号登录"}
      </button>

      <div className="rz-auth-divider"><span>或使用工作邮箱</span></div>

      <form onSubmit={sendEmailCode}>
        <label className="rz-field">
          <span>工作邮箱</span>
          <input autoComplete="email" onChange={(event) => setEmail(event.target.value)} placeholder="name@royalzen.com" required type="email" value={email} />
        </label>
        <button className="rz-button rz-button-primary rz-button-full" disabled={Boolean(loading)} type="submit">
          {loading === "email" ? "正在发送登录链接..." : "获取登录链接"} <Icon name="arrow" size={17} />
        </button>
      </form>
      <div aria-live="polite" className="rz-login-feedback-region">
        {feedback ? (
          <p className={`rz-login-feedback rz-login-feedback-${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"}>
            <span aria-hidden="true" className="rz-login-feedback-mark" />
            {feedback.message}
          </p>
        ) : null}
      </div>
      {accessError ? (
        <dialog
          aria-describedby="rz-login-access-description"
          aria-labelledby="rz-login-access-title"
          className="rz-login-alert"
          onCancel={(event) => {
            event.preventDefault();
            dismissAccessError();
          }}
          ref={dialogRef}
          role="alertdialog"
        >
          <div className="rz-login-alert-mark" aria-hidden="true">!</div>
          <span className="rz-eyebrow">账号权限提示</span>
          <h3 id="rz-login-access-title">{accessError.title}</h3>
          <p id="rz-login-access-description">{accessError.description}</p>
          <div className="rz-login-alert-actions">
            {accessError.canOpenWorkspace ? (
              <Link className="rz-button rz-button-secondary" href="/app">进入员工工作台</Link>
            ) : null}
            <button autoFocus className="rz-button rz-button-primary" onClick={dismissAccessError} type="button">
              {accessError.canOpenWorkspace ? "使用其他账号" : "我知道了"}
            </button>
          </div>
        </dialog>
      ) : null}
    </>
  );
}
