"use client";

import { FormEvent, useEffect, useState } from "react";
import { LOCALES, LOCALE_NAMES, LOCALE_TAGS, localeFromTag, useLocale } from "@/lib/i18n";

export default function SettingsForm({ displayName, email }: { displayName: string; email: string }) {
  const { locale: interfaceLocale, setLocale: setInterfaceLocale } = useLocale();
  const [name, setName] = useState(displayName);
  const [locale, setLocale] = useState(LOCALE_TAGS[interfaceLocale]);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLocale(LOCALE_TAGS[interfaceLocale]);
  }, [interfaceLocale]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: name, locale }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "保存失败。");
      setInterfaceLocale(localeFromTag(locale));
      setMessage("账号资料已保存。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败。");
    } finally {
      setSaving(false);
    }
  };

  return <form onSubmit={save}><h2>个人资料</h2><label className="rz-field"><span>姓名</span><input onChange={(event) => setName(event.target.value)} required value={name} /></label><label className="rz-field"><span>工作邮箱</span><input value={email} disabled /></label><label className="rz-field"><span>界面语言</span><select onChange={(event) => setLocale(event.target.value)} value={locale}>{LOCALES.map((code) => <option key={code} value={LOCALE_TAGS[code]}>{LOCALE_NAMES[code]}</option>)}</select></label><button className="rz-button rz-button-primary" disabled={saving} type="submit">{saving ? "正在保存..." : "保存修改"}</button>{message ? <p role="status">{message}</p> : null}</form>;
}
