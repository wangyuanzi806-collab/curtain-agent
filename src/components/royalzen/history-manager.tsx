"use client";

import { useState } from "react";
import AdminActionFeedback, { type AdminActionMessage } from "@/components/royalzen/admin-action-feedback";
import { ADMIN_PAGE_SIZES, type AdminDataPage } from "@/lib/admin-pagination";
import { requestJson } from "@/lib/client-api";
import type { GenerationRecord } from "@/lib/curtain-types";

type HistoryManagerProps = {
  initialPage: AdminDataPage<GenerationRecord>;
};

type HistoryResponse = {
  records: GenerationRecord[];
  hasMore: boolean;
  nextOffset: number;
};

function formatHistoryDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

export default function HistoryManager({ initialPage }: HistoryManagerProps) {
  const [records, setRecords] = useState(initialPage.items);
  const [hasMore, setHasMore] = useState(initialPage.hasMore);
  const [nextOffset, setNextOffset] = useState(initialPage.nextOffset);
  const [loadingMore, setLoadingMore] = useState(false);
  const [message, setMessage] = useState<AdminActionMessage | null>(null);
  const [selected, setSelected] = useState<GenerationRecord | null>(null);
  const [clearing, setClearing] = useState(false);

  async function handleLoadMore() {
    setLoadingMore(true);
    setMessage(null);
    try {
      const data = await requestJson<HistoryResponse>(
        `/api/admin/history?limit=${ADMIN_PAGE_SIZES.history}&offset=${nextOffset}`,
      );
      setRecords((current) => [...current, ...data.records]);
      setHasMore(data.hasMore);
      setNextOffset(data.nextOffset);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "加载更多历史记录失败。" });
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleClearAll() {
    if (!confirm("确认清空所有生成历史记录？此操作不可撤销。")) return;
    setClearing(true);
    setMessage(null);
    try {
      await requestJson("/api/admin/history", { method: "DELETE" });
      setRecords([]);
      setHasMore(false);
      setNextOffset(0);
      setSelected(null);
      setMessage({ tone: "success", text: "生成历史已清空。" });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "清空生成历史失败。" });
    } finally { setClearing(false); }
  }

  const statusColor: { [key: string]: string } = {
    succeeded: "bg-green-100 text-green-700",
    failed: "bg-red-100 text-red-700",
    processing: "bg-amber-100 text-amber-700"
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-stone-900">生成历史</h1>
          <p className="text-stone-500 text-sm mt-0.5">已加载 AI 生成记录（{records.length} 条）</p>
        </div>
        {records.length > 0 && (
          <button
            onClick={handleClearAll}
            disabled={clearing}
            className="px-4 py-2.5 rounded-xl bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {clearing ? "清空中..." : "清空所有记录"}
          </button>
        )}
      </div>

      <AdminActionFeedback message={message} />

      {records.length === 0 ? (
        <div className="text-stone-400 text-sm py-12 text-center border border-dashed border-stone-300 rounded-2xl">暂无生成记录</div>
      ) : (
        <div className="space-y-3">
          {records.map((r) => (
            <div
              key={r.id}
              onClick={() => setSelected(selected?.id === r.id ? null : r)}
              className="rounded-2xl border border-stone-200/60 bg-white p-4 hover:shadow-sm transition-all cursor-pointer"
            >
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-xl bg-stone-100 flex-shrink-0 overflow-hidden flex items-center justify-center">
                  {r.resultImageUrl ? (
                    <img src={r.resultImageUrl} alt="" className="w-full h-full object-cover" decoding="async" loading="lazy" />
                  ) : (
                    <span className="text-stone-300 text-[10px]">无图</span>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${statusColor[r.status] || "bg-stone-100 text-stone-500"}`}>
                      {r.status}
                    </span>
                    <span className="text-[11px] text-stone-400">
                      {formatHistoryDate(r.createdAt)}
                    </span>
                  </div>
                  <p className="text-sm text-stone-700 line-clamp-1">
                    {r.userInstruction || r.prompt?.slice(0, 80) || "-"}
                  </p>
                  {r.errorMessage && (
                    <p className="text-xs text-red-500 mt-0.5 line-clamp-1">{r.errorMessage}</p>
                  )}
                </div>

                <svg className={`w-4 h-4 text-stone-300 transition-transform ${selected?.id === r.id ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </div>

              {selected?.id === r.id && (
                <div className="mt-4 pt-4 border-t border-stone-100 space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-[11px] text-stone-400 mb-1 uppercase font-medium">模型</p>
                      <p className="text-sm text-stone-700">{r.providerModel}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-stone-400 mb-1 uppercase font-medium">SKU</p>
                      <p className="text-sm text-stone-700">{r.selectedSkuName || "-"}</p>
                    </div>
                  </div>
                  {r.userInstruction && (
                    <div>
                      <p className="text-[11px] text-stone-400 mb-1 uppercase font-medium">用户指令</p>
                      <p className="text-sm text-stone-600 leading-relaxed">{r.userInstruction}</p>
                    </div>
                  )}
                  {r.resultImageUrl && (
                    <div>
                      <p className="text-[11px] text-stone-400 mb-1 uppercase font-medium">生成结果</p>
                      <img src={r.resultImageUrl} alt="" className="max-w-md rounded-xl border border-stone-200" decoding="async" loading="lazy" />
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {hasMore ? (
        <div className="mt-6 flex justify-center">
          <button
            className="rounded-xl border border-stone-200 bg-white px-5 py-2.5 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
            disabled={loadingMore}
            onClick={handleLoadMore}
            type="button"
          >
            {loadingMore ? "加载中..." : "加载更多历史"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
