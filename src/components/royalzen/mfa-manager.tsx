"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/royalzen/icon";
import { prepareTotpEnrollment } from "@/lib/mfa-enrollment";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Mode = "loading" | "enroll" | "scan" | "challenge" | "verified" | "error";
type TotpFactor = { id: string; status: string };

export default function MfaManager({
  isDemo,
  nextPath,
  required,
}: {
  isDemo: boolean;
  nextPath: string;
  required: boolean;
}) {
  const [mode, setMode] = useState<Mode>(isDemo ? "verified" : "loading");
  const [factorId, setFactorId] = useState("");
  const [qrCode, setQrCode] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState(isDemo ? "本地演示模式已视为完成双重验证。" : "");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (isDemo) return;
    try {
      const supabase = createSupabaseBrowserClient();
      const [assurance, factors] = await Promise.all([
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        supabase.auth.mfa.listFactors(),
      ]);
      if (assurance.error) throw assurance.error;
      if (factors.error) throw factors.error;
      if (assurance.data.currentLevel === "aal2") {
        setMode("verified");
        setMessage("当前会话已完成双重验证，可以进入管理后台。");
        return;
      }

      const totpFactors = factors.data.totp as TotpFactor[];
      const verifiedFactor = totpFactors.find((factor) => factor.status === "verified");
      if (verifiedFactor) {
        setFactorId(verifiedFactor.id);
        setMode("challenge");
        setMessage("请输入验证器中的 6 位动态验证码。");
      } else {
        setMode("enroll");
        setMessage(required ? "管理员必须先绑定验证器才能进入后台。" : "绑定验证器可提高账号安全性。");
      }
    } catch (error) {
      setMode("error");
      setMessage(error instanceof Error ? error.message : "读取双重验证状态失败。");
    }
  }, [isDemo, required]);

  useEffect(() => {
    void load();
  }, [load]);

  const beginEnrollment = async () => {
    setBusy(true);
    setMessage("");
    try {
      const supabase = createSupabaseBrowserClient();
      const enrollment = await prepareTotpEnrollment({
        listFactors: () => supabase.auth.mfa.listFactors(),
        unenroll: (input) => supabase.auth.mfa.unenroll(input),
        enroll: () => supabase.auth.mfa.enroll({
          factorType: "totp",
          friendlyName: "RoyalZen Admin",
        }),
      });
      setFactorId(enrollment.id);
      setQrCode(enrollment.totp.qr_code);
      setSecret(enrollment.totp.secret);
      setMode("scan");
      setMessage("请使用 Google Authenticator、Microsoft Authenticator 或 1Password 扫描二维码。");
    } catch (error) {
      setMode("error");
      setMessage(error instanceof Error ? error.message : "开始绑定验证器失败。");
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!/^\d{6}$/.test(code)) {
      setMessage("请输入验证器中的 6 位数字。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const supabase = createSupabaseBrowserClient();
      const challenge = await supabase.auth.mfa.challenge({ factorId });
      if (challenge.error) throw challenge.error;
      const verification = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.data.id,
        code,
      });
      if (verification.error) throw verification.error;
      const refreshed = await supabase.auth.refreshSession();
      if (refreshed.error) throw refreshed.error;
      setMode("verified");
      setMessage("双重验证成功，正在进入安全区域。");
      window.location.assign(nextPath);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "验证码校验失败。");
    } finally {
      setBusy(false);
    }
  };

  return <section className="rz-mfa-card">
    <div className="rz-mfa-icon"><Icon name="admin" size={22} /></div>
    <div className="rz-mfa-copy">
      <span className="rz-eyebrow">ACCOUNT SECURITY</span>
      <h2>双重验证</h2>
      <p>管理员权限需要 Google 或邮箱登录，再加上验证器动态验证码。验证码和密钥由 Supabase Auth 安全验证。</p>
    </div>

    {mode === "loading" ? <div className="rz-mfa-state"><span className="rz-navigation-spinner" /><strong>正在检查安全状态...</strong></div> : null}
    {mode === "scan" ? <div className="rz-mfa-enrollment">
      <div className="rz-mfa-qr">{qrCode ? <img alt="双重验证二维码" src={qrCode} /> : null}</div>
      <div><strong>扫描后输入验证码</strong><p>无法扫描时，可在验证器中手动输入下面的密钥。</p><code>{secret}</code></div>
    </div> : null}

    {(mode === "scan" || mode === "challenge") ? <label className="rz-field rz-mfa-code">
      <span>6 位动态验证码</span>
      <input autoComplete="one-time-code" inputMode="numeric" maxLength={6} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} placeholder="000000" value={code} />
    </label> : null}

    {message ? <p className={`rz-mfa-message ${mode === "error" ? "is-error" : ""}`} role="status">{message}</p> : null}

    <div className="rz-mfa-actions">
      {mode === "enroll" || mode === "error" ? <button className="rz-button rz-button-primary" disabled={busy} onClick={beginEnrollment} type="button">{busy ? "正在准备..." : "绑定验证器"}</button> : null}
      {mode === "scan" || mode === "challenge" ? <button className="rz-button rz-button-primary" disabled={busy || code.length !== 6} onClick={verify} type="button">{busy ? "正在验证..." : "验证并继续"}</button> : null}
      {mode === "verified" ? <a className="rz-button rz-button-primary" href={nextPath}>进入管理后台 <Icon name="arrow" size={16} /></a> : null}
      <a className="rz-button rz-button-secondary" href="/app/settings">返回账号设置</a>
    </div>
  </section>;
}
