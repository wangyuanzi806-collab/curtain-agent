"use client";

import { useState } from "react";
import Icon from "@/components/royalzen/icon";

export default function ShareButton({ consultationId }: { consultationId: string }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const createShare = async () => {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(`/api/consultations/${consultationId}/share`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "创建分享链接失败。");
      await navigator.clipboard.writeText(payload.url);
      setMessage("客户链接已复制");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建分享链接失败。");
    } finally {
      setLoading(false);
    }
  };

  return <span className="rz-share-action"><button className="rz-button rz-button-primary" disabled={loading} onClick={createShare} type="button">{loading ? "正在创建..." : "分享方案"} <Icon name="arrow" size={17} /></button>{message ? <small role="status">{message}</small> : null}</span>;
}
