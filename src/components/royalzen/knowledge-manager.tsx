"use client";

import { useState } from "react";
import AdminActionFeedback, { type AdminActionMessage } from "@/components/royalzen/admin-action-feedback";
import { ADMIN_PAGE_SIZES, type AdminDataPage } from "@/lib/admin-pagination";
import { requestJson } from "@/lib/client-api";

type Doc = {
  id: string;
  title: string;
  category: string;
  tags: string;
  content: string;
  source: string;
};

type KnowledgeManagerProps = {
  initialPage: AdminDataPage<Doc>;
};

const EMPTY: Doc = { id: "", title: "", category: "general", tags: "", content: "", source: "Manual" };
const CATEGORIES = ["general", "style-guide", "installation", "fabric-care", "matching", "faq"];

type KnowledgeResponse = {
  docs: Doc[];
  hasMore: boolean;
  nextOffset: number;
};

export default function KnowledgeManager({ initialPage }: KnowledgeManagerProps) {
  const [docs, setDocs] = useState(initialPage.items);
  const [hasMore, setHasMore] = useState(initialPage.hasMore);
  const [nextOffset, setNextOffset] = useState(initialPage.nextOffset);
  const [loadingMore, setLoadingMore] = useState(false);
  const [message, setMessage] = useState<AdminActionMessage | null>(null);
  const [editing, setEditing] = useState<Doc | null>(null);
  const [saving, setSaving] = useState(false);

  async function fetchDocs(offset = 0) {
    return requestJson<KnowledgeResponse>(
      `/api/admin/knowledge?limit=${ADMIN_PAGE_SIZES.knowledge}&offset=${offset}`,
    );
  }

  async function refreshDocs() {
    const data = await fetchDocs();
    setDocs(data.docs);
    setHasMore(data.hasMore);
    setNextOffset(data.nextOffset);
  }

  async function handleLoadMore() {
    setLoadingMore(true);
    setMessage(null);
    try {
      const data = await fetchDocs(nextOffset);
      setDocs((current) => [...current, ...data.docs]);
      setHasMore(data.hasMore);
      setNextOffset(data.nextOffset);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "加载更多知识文档失败。" });
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleSave() {
    if (!editing || !editing.title.trim() || !editing.content.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      await requestJson("/api/admin/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editing.id || undefined,
          title: editing.title,
          category: editing.category,
          tags: editing.tags,
          content: editing.content,
          source: editing.source,
        }),
      });
      setEditing(null);
      await refreshDocs();
      setMessage({ tone: "success", text: "知识文档已保存。" });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "保存知识文档失败。" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("确认删除？")) return;
    setMessage(null);
    try {
      await requestJson("/api/admin/knowledge", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      await refreshDocs();
      setMessage({ tone: "success", text: "知识文档已删除。" });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "删除知识文档失败。" });
    }
  }

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-stone-900">知识库</h1>
          <p className="text-stone-500 text-sm mt-0.5">窗帘搭配知识、风格指南，AI 推荐参考</p>
        </div>
        <button onClick={() => setEditing({ ...EMPTY })} className="px-4 py-2.5 rounded-xl bg-stone-900 text-white text-sm font-medium hover:bg-stone-800">
          + 新增文档
        </button>
      </div>

      <AdminActionFeedback message={message} />

      {docs.length === 0 ? (
        <div className="text-stone-400 text-sm py-12 text-center border border-dashed border-stone-300 rounded-2xl">暂无知识文档</div>
      ) : (
        <div className="space-y-3">
          {docs.map((doc) => (
            <div key={doc.id} className="rounded-2xl border border-stone-200/60 bg-white p-4 hover:shadow-sm transition-all">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-sm text-stone-800">{doc.title}</h3>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-stone-100 text-stone-500 font-medium">{doc.category}</span>
                  </div>
                  <p className="text-xs text-stone-500 line-clamp-2 max-w-2xl">{doc.content}</p>
                  {doc.tags && <p className="text-[11px] text-stone-400">标签: {doc.tags}</p>}
                </div>
                <div className="flex gap-2 flex-shrink-0 ml-4">
                  <button onClick={() => setEditing({ ...doc })} className="text-xs text-amber-600 hover:text-amber-800 font-medium">编辑</button>
                  <button onClick={() => handleDelete(doc.id)} className="text-xs text-red-500 hover:text-red-700 font-medium">删除</button>
                </div>
              </div>
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
            {loadingMore ? "加载中..." : "加载更多知识"}
          </button>
        </div>
      ) : null}

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(event) => event.stopPropagation()}>
            <div className="p-6 space-y-4">
              <h2 className="text-lg font-bold text-stone-900">{editing.id ? "编辑文档" : "新增文档"}</h2>

              <div className="space-y-1">
                <label className="text-xs font-bold text-stone-600">标题 *</label>
                <input value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} className="w-full px-3 py-2.5 rounded-xl border border-stone-200 text-sm outline-none focus:border-amber-400" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-stone-600">分类</label>
                  <select value={editing.category} onChange={(event) => setEditing({ ...editing, category: event.target.value })} className="w-full px-3 py-2.5 rounded-xl border border-stone-200 text-sm outline-none focus:border-amber-400 bg-white">
                    {CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-stone-600">标签</label>
                  <input value={editing.tags} onChange={(event) => setEditing({ ...editing, tags: event.target.value })} placeholder="用逗号分隔" className="w-full px-3 py-2.5 rounded-xl border border-stone-200 text-sm outline-none focus:border-amber-400" />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-stone-600">内容 *</label>
                <textarea value={editing.content} onChange={(event) => setEditing({ ...editing, content: event.target.value })} rows={8} className="w-full px-3 py-2.5 rounded-xl border border-stone-200 text-sm outline-none focus:border-amber-400 resize-none" />
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={() => setEditing(null)} className="flex-1 px-4 py-2.5 rounded-xl border border-stone-200 text-sm font-medium text-stone-600 hover:bg-stone-50">取消</button>
                <button onClick={handleSave} disabled={saving || !editing.title.trim() || !editing.content.trim()} className="flex-1 px-4 py-2.5 rounded-xl bg-stone-900 text-white text-sm font-medium hover:bg-stone-800 disabled:opacity-50">
                  {saving ? "保存中..." : "保存"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
