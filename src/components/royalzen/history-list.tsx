"use client";

import Link from "next/link";
import { useState } from "react";
import Icon from "@/components/royalzen/icon";
import { requestJson } from "@/lib/client-api";

export type HistoryItem = {
  id: string;
  displayCode: string;
  clientName: string;
  roomType: string;
  windowType: string;
  skuName: string;
  status: string;
  statusLabel: string;
  updatedAt: string;
  coverUrl: string;
};

/**
 * 历史咨询列表。
 *
 * 加了整理模式：反复试的草稿会一直堆在这里，而每一条都占着资产与生成记录。
 * 删除是一条一条发的——批量端点省下的那点往返，换不来「删到一半失败了
 * 到底删掉哪几条」这个问题。
 */
export default function HistoryList({
  items: initial,
  canDelete
}: {
  items: HistoryItem[];
  canDelete: boolean;
}) {
  const [items, setItems] = useState(initial);
  const [managing, setManaging] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const toggle = (code: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  const removePicked = async () => {
    if (picked.size === 0) return;
    setBusy(true);
    setNote("");
    const done: string[] = [];
    const failed: string[] = [];
    let firstError = "";
    for (const code of picked) {
      try {
        await requestJson(`/api/consultations/${encodeURIComponent(code)}`, { method: "DELETE" });
        done.push(code);
      } catch (error) {
        failed.push(code);
        // 只写「N 条没删成」等于把排查甩给用户。把服务端说的原因带出来——
        // 删除会被外键挡住，而那条消息里写着是哪张表挡的
        if (!firstError) firstError = error instanceof Error ? error.message : "未知原因";
      }
    }
    setItems((current) => current.filter((item) => !done.includes(item.displayCode)));
    setPicked(new Set(failed));
    setBusy(false);
    setNote(
      failed.length
        ? `删掉 ${done.length} 条，${failed.length} 条没删成：${firstError}`
        : `已删掉 ${done.length} 条。`
    );
  };

  return (
    <>
      <div className="rz-history-bar">
        <span>{managing ? `已选 ${picked.size} / ${items.length} 条` : `共 ${items.length} 条`}</span>
        {note ? <em>{note}</em> : null}
        {managing ? (
          <>
            <button
              onClick={() =>
                setPicked(
                  picked.size === items.length
                    ? new Set()
                    : new Set(items.map((item) => item.displayCode))
                )
              }
              type="button"
            >
              {picked.size === items.length ? "取消全选" : "全选"}
            </button>
            <button
              className="is-danger"
              disabled={busy || picked.size === 0}
              onClick={removePicked}
              type="button"
            >
              {busy ? "删除中…" : `删除选中的 ${picked.size} 条`}
            </button>
            <button
              onClick={() => {
                setManaging(false);
                setPicked(new Set());
              }}
              type="button"
            >
              完成
            </button>
          </>
        ) : canDelete ? (
          <button onClick={() => setManaging(true)} type="button">
            整理
          </button>
        ) : null}
      </div>

      <div className={`rz-history-list ${managing ? "is-managing" : ""}`}>
        {items.map((item) => {
          const body = (
            <>
              <span className="rz-history-image">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt={item.roomType || "客户空间"}
                  loading="lazy"
                  onError={(event) => {
                    // 老资产的对象已经不在存储里了。broken 图标比一块底色更难看，
                    // 而且会让人以为是网络问题反复刷新
                    event.currentTarget.style.visibility = "hidden";
                  }}
                  src={item.coverUrl}
                />
              </span>
              <span className="rz-history-id">
                {item.displayCode}
                <small>{item.updatedAt}</small>
              </span>
              <span>
                <strong>{item.clientName}</strong>
                <small>
                  {item.roomType || "待分析"} · {item.windowType}
                </small>
              </span>
              <span>
                <strong>{item.skuName}</strong>
                <small>{item.statusLabel}</small>
              </span>
              <Icon name="chevron" size={18} />
            </>
          );

          return managing ? (
            <button
              className={picked.has(item.displayCode) ? "is-picked" : ""}
              key={item.id}
              onClick={() => toggle(item.displayCode)}
              type="button"
            >
              {body}
            </button>
          ) : (
            <Link href={`/app/consultations/${item.displayCode}`} key={item.id} prefetch={false}>
              {body}
            </Link>
          );
        })}
      </div>
    </>
  );
}
