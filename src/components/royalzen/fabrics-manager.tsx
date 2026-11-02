"use client";

import { useState } from "react";
import AdminActionFeedback, { type AdminActionMessage } from "@/components/royalzen/admin-action-feedback";
import { ADMIN_PAGE_SIZES, type AdminDataPage } from "@/lib/admin-pagination";
import { requestJson } from "@/lib/client-api";

type Fabric = {
  id: string;
  name: string;
  nameEn: string;
  description: string;
  color: string;
  material: string;
  styleTags: string;
  textureUrl: string | null;
  curtainImageUrl: string | null;
  sortOrder: number;
};

const EMPTY: Fabric = {
  id: "",
  name: "",
  nameEn: "",
  description: "",
  color: "",
  material: "",
  styleTags: "",
  textureUrl: null,
  curtainImageUrl: null,
  sortOrder: 0,
};

const BATCH_FIELDS = [
  { key: "color", label: "颜色" },
  { key: "material", label: "材质" },
  { key: "styleTags", label: "风格标签" },
  { key: "sortOrder", label: "排序" },
];

type FabricsManagerProps = {
  initialPage: AdminDataPage<Fabric>;
};

type FabricsResponse = {
  fabrics: Fabric[];
  hasMore: boolean;
  nextOffset: number;
};

export default function FabricsManager({ initialPage }: FabricsManagerProps) {
  const [fabrics, setFabrics] = useState(initialPage.items);
  const [hasMore, setHasMore] = useState(initialPage.hasMore);
  const [nextOffset, setNextOffset] = useState(initialPage.nextOffset);
  const [loadingMore, setLoadingMore] = useState(false);
  const [message, setMessage] = useState<AdminActionMessage | null>(null);
  const [editing, setEditing] = useState<Fabric | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"texture" | "curtain" | null>(null);

  // Batch mode
  const [batchMode, setBatchMode] = useState(false);
  const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set());
  const [batchField, setBatchField] = useState<string>("color");
  const [batchValue, setBatchValue] = useState("");
  const [batchSaving, setBatchSaving] = useState(false);

  async function fetchFabrics(offset = 0) {
    return requestJson<FabricsResponse>(
      `/api/admin/fabrics?limit=${ADMIN_PAGE_SIZES.fabrics}&offset=${offset}`,
    );
  }

  async function refreshFabrics() {
    const data = await fetchFabrics();
    setFabrics(data.fabrics);
    setHasMore(data.hasMore);
    setNextOffset(data.nextOffset);
  }

  async function handleLoadMore() {
    setLoadingMore(true);
    setMessage(null);
    try {
      const data = await fetchFabrics(nextOffset);
      setFabrics((current) => [...current, ...data.fabrics]);
      setHasMore(data.hasMore);
      setNextOffset(data.nextOffset);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "加载更多面料失败。" });
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleSave() {
    if (!editing || !editing.name.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      await requestJson("/api/admin/fabrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editing.id || undefined,
          name: editing.name,
          nameEn: editing.nameEn,
          description: editing.description,
          color: editing.color,
          material: editing.material,
          styleTags: editing.styleTags,
          textureUrl: editing.textureUrl,
          curtainImageUrl: editing.curtainImageUrl,
          sortOrder: editing.sortOrder,
        }),
      });
      setEditing(null);
      await refreshFabrics();
      setMessage({ tone: "success", text: "面料已保存。" });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "保存面料失败。" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("确认删除？")) return;
    setMessage(null);
    try {
      await requestJson("/api/admin/fabrics", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      await refreshFabrics();
      setMessage({ tone: "success", text: "面料已删除。" });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "删除面料失败。" });
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>, field: "texture" | "curtain") {
    if (!e.target.files?.[0] || !editing) return;
    setUploading(field);
    try {
      const fd = new FormData();
      fd.set("file", e.target.files[0]);
      fd.set("prefix", `admin/fabrics/${field}`);
      const data = await requestJson<{ url?: string }>("/api/admin/upload", { method: "POST", body: fd });
      if (data.url) {
        if (field === "texture") {
          setEditing({ ...editing, textureUrl: data.url });
        } else {
          setEditing({ ...editing, curtainImageUrl: data.url });
        }
      }
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "上传面料图片失败。" });
    } finally {
      setUploading(null);
    }
  }

  function toggleBatchItem(id: string) {
    const next = new Set(batchSelected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setBatchSelected(next);
  }

  function toggleBatchAll() {
    if (batchSelected.size === fabrics.length) {
      setBatchSelected(new Set());
    } else {
      setBatchSelected(new Set(fabrics.map(f => f.id)));
    }
  }

  async function handleBatchApply() {
    if (batchSelected.size === 0 || !batchValue.trim()) return;
    setBatchSaving(true);
    setMessage(null);
    try {
      const updates = fabrics
        .filter(f => batchSelected.has(f.id))
        .map(f => {
          const val = batchField === "sortOrder" ? Number(batchValue) || 0 : batchValue.trim();
          return { ...f, [batchField]: val };
        });
      for (const u of updates) {
        await requestJson("/api/admin/fabrics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(u),
        });
      }
      setBatchSelected(new Set());
      setBatchValue("");
      await refreshFabrics();
      setMessage({ tone: "success", text: `已更新 ${updates.length} 个面料。` });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "批量更新面料失败。" });
    } finally { setBatchSaving(false); }
  }

  async function handleBatchDelete() {
    if (batchSelected.size === 0) return;
    if (!confirm(`确认删除选中的 ${batchSelected.size} 个面料？`)) return;
    setMessage(null);
    try {
      for (const id of batchSelected) {
        await requestJson("/api/admin/fabrics", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
      }
      const deletedCount = batchSelected.size;
      setBatchSelected(new Set());
      await refreshFabrics();
      setMessage({ tone: "success", text: `已删除 ${deletedCount} 个面料。` });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "批量删除面料失败。" });
    }
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-stone-900">面料管理</h1>
          <p className="text-stone-500 text-sm mt-0.5">管理面料纹理图和属性信息（{fabrics.length} 个）</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setBatchMode(!batchMode); setBatchSelected(new Set()); }}
            className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
              batchMode ? "bg-violet-600 text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"
            }`}
          >
            {batchMode ? "退出批量" : "批量编辑"}
          </button>
          <button
            onClick={() => setEditing({ ...EMPTY })}
            className="px-4 py-2.5 rounded-xl bg-stone-900 text-white text-sm font-medium hover:bg-stone-800 transition-colors"
          >
            + 新增面料
          </button>
        </div>
      </div>

      <AdminActionFeedback message={message} />

      {/* Batch Toolbar */}
      {batchMode && (
        <div className="mb-4 rounded-2xl border border-violet-200/60 bg-violet-50/50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={toggleBatchAll} className="text-xs font-medium text-violet-700 hover:text-violet-900">
                {batchSelected.size === fabrics.length ? "取消全选" : "全选"}
              </button>
              <span className="text-xs text-violet-500">已选 {batchSelected.size} 项</span>
            </div>
            {batchSelected.size > 0 && (
              <button onClick={handleBatchDelete} className="text-xs text-red-600 hover:text-red-800 font-medium">
                批量删除
              </button>
            )}
          </div>
          {batchSelected.size > 0 && (
            <div className="flex items-end gap-3">
              <div className="space-y-1">
                <label className="text-xs font-bold text-violet-700">批量修改字段</label>
                <select
                  value={batchField}
                  onChange={(e) => setBatchField(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-violet-200 text-sm outline-none focus:border-violet-400 bg-white"
                >
                  {BATCH_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
              </div>
              <div className="flex-1 space-y-1">
                <label className="text-xs font-bold text-violet-700">新值</label>
                <input
                  value={batchValue}
                  onChange={(e) => setBatchValue(e.target.value)}
                  placeholder="输入新值..."
                  className="w-full px-3 py-2 rounded-xl border border-violet-200 text-sm outline-none focus:border-violet-400"
                />
              </div>
              <button
                onClick={handleBatchApply}
                disabled={batchSaving || !batchValue.trim()}
                className="px-5 py-2 rounded-xl bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50"
              >
                {batchSaving ? "应用中..." : "应用"}
              </button>
            </div>
          )}
        </div>
      )}

      {fabrics.length === 0 ? (
        <div className="text-stone-400 text-sm py-12 text-center border border-dashed border-stone-300 rounded-2xl">
          暂无面料数据，点击右上角新增
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {fabrics.map((f) => (
            <div
              key={f.id}
              onClick={() => batchMode ? toggleBatchItem(f.id) : setEditing({ ...f })}
              className={`group rounded-2xl border overflow-hidden transition-all cursor-pointer ${
                batchMode && batchSelected.has(f.id)
                  ? "border-violet-400 ring-2 ring-violet-400/30 shadow-md"
                  : "border-stone-200/60 bg-white hover:shadow-md hover:-translate-y-0.5"
              }`}
            >
              <div className="aspect-square bg-stone-100 flex items-center justify-center overflow-hidden relative">
                {f.textureUrl ? (
                  <img src={f.textureUrl} alt={f.name} className="w-full h-full object-cover" decoding="async" loading="lazy" />
                ) : (
                  <span className="text-stone-300 text-xs">暂无纹理图</span>
                )}
                {batchMode && (
                  <div className={`absolute top-2 left-2 w-6 h-6 rounded-lg flex items-center justify-center ${
                    batchSelected.has(f.id) ? "bg-violet-600" : "bg-white/80 border border-stone-300"
                  }`}>
                    {batchSelected.has(f.id) && (
                      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    )}
                  </div>
                )}
                {!batchMode && (
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity text-white text-xs font-medium bg-black/50 px-3 py-1.5 rounded-full">
                      点击编辑
                    </span>
                  </div>
                )}
                {f.curtainImageUrl && (
                  <span className="absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded-md bg-green-600 text-white font-medium shadow-sm">
                    有成品图
                  </span>
                )}
              </div>
              <div className="p-3 space-y-1">
                <h3 className="font-bold text-sm text-stone-800">{f.name}</h3>
                {f.nameEn && <p className="text-[11px] text-stone-400">{f.nameEn}</p>}
                {f.color && <p className="text-xs text-stone-500">{f.color} · {f.material}</p>}
                {f.styleTags && (
                  <div className="flex flex-wrap gap-1">
                    {f.styleTags.split(",").map((t) => (
                      <span key={t} className="px-1.5 py-0.5 rounded-md bg-stone-100 text-stone-500 text-[10px]">
                        {t.trim()}
                      </span>
                    ))}
                  </div>
                )}
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
            {loadingMore ? "加载中..." : "加载更多面料"}
          </button>
        </div>
      ) : null}

      {/* Edit Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 space-y-4">
              <h2 className="text-lg font-bold text-stone-900">
                {editing.id ? "编辑面料" : "新增面料"}
              </h2>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-stone-600">面料名称 *</label>
                  <input
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    placeholder="经典花卉"
                    className="w-full px-3 py-2.5 rounded-xl border border-stone-200 text-sm outline-none focus:border-amber-400"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-stone-600">英文名</label>
                  <input
                    value={editing.nameEn}
                    onChange={(e) => setEditing({ ...editing, nameEn: e.target.value })}
                    placeholder="Classic Floral"
                    className="w-full px-3 py-2.5 rounded-xl border border-stone-200 text-sm outline-none focus:border-amber-400"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-stone-600">描述</label>
                <textarea
                  value={editing.description}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2.5 rounded-xl border border-stone-200 text-sm outline-none focus:border-amber-400 resize-none"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-stone-600">颜色</label>
                  <input
                    value={editing.color}
                    onChange={(e) => setEditing({ ...editing, color: e.target.value })}
                    placeholder="米白 / 黑红"
                    className="w-full px-3 py-2.5 rounded-xl border border-stone-200 text-sm outline-none focus:border-amber-400"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-stone-600">材质</label>
                  <input
                    value={editing.material}
                    onChange={(e) => setEditing({ ...editing, material: e.target.value })}
                    placeholder="涤纶提花"
                    className="w-full px-3 py-2.5 rounded-xl border border-stone-200 text-sm outline-none focus:border-amber-400"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-stone-600">风格标签</label>
                  <input
                    value={editing.styleTags}
                    onChange={(e) => setEditing({ ...editing, styleTags: e.target.value })}
                    placeholder="法式,轻奢"
                    className="w-full px-3 py-2.5 rounded-xl border border-stone-200 text-sm outline-none focus:border-amber-400"
                  />
                </div>
              </div>

              {/* Texture Image */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-stone-600">面料纹理图</label>
                <div className="flex items-center gap-3">
                  {editing.textureUrl && (
                    <img src={editing.textureUrl} alt="" className="w-16 h-16 object-cover rounded-lg border" />
                  )}
                  <label className={`px-4 py-2 rounded-xl border border-stone-200 text-sm cursor-pointer hover:bg-stone-50 ${uploading === "texture" ? "opacity-50 pointer-events-none" : ""}`}>
                    {uploading === "texture" ? "上传中..." : "上传纹理图"}
                    <input type="file" accept="image/*" onChange={(e) => handleUpload(e, "texture")} className="hidden" />
                  </label>
                </div>
                <input
                  value={editing.textureUrl || ""}
                  onChange={(e) => setEditing({ ...editing, textureUrl: e.target.value || null })}
                  placeholder="或粘贴图片URL"
                  className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm outline-none focus:border-amber-400 mt-1"
                />
              </div>

              {/* Curtain Product Image */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-stone-600">窗帘成品图</label>
                <p className="text-[11px] text-stone-400">该面料做成窗帘后的效果图（用于场景合成）</p>
                <div className="flex items-center gap-3">
                  {editing.curtainImageUrl && (
                    <img src={editing.curtainImageUrl} alt="" className="w-16 h-16 object-cover rounded-lg border" />
                  )}
                  <label className={`px-4 py-2 rounded-xl border border-stone-200 text-sm cursor-pointer hover:bg-stone-50 ${uploading === "curtain" ? "opacity-50 pointer-events-none" : ""}`}>
                    {uploading === "curtain" ? "上传中..." : "上传成品图"}
                    <input type="file" accept="image/*" onChange={(e) => handleUpload(e, "curtain")} className="hidden" />
                  </label>
                </div>
                <input
                  value={editing.curtainImageUrl || ""}
                  onChange={(e) => setEditing({ ...editing, curtainImageUrl: e.target.value || null })}
                  placeholder="或粘贴图片URL"
                  className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm outline-none focus:border-amber-400 mt-1"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-stone-600">排序</label>
                <input
                  type="number"
                  value={editing.sortOrder}
                  onChange={(e) => setEditing({ ...editing, sortOrder: Number(e.target.value) || 0 })}
                  className="w-24 px-3 py-2.5 rounded-xl border border-stone-200 text-sm outline-none focus:border-amber-400"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={() => setEditing(null)} className="flex-1 px-4 py-2.5 rounded-xl border border-stone-200 text-sm font-medium text-stone-600 hover:bg-stone-50">
                  取消
                </button>
                {editing.id && (
                  <button
                    onClick={() => { handleDelete(editing.id); setEditing(null); }}
                    className="px-4 py-2.5 rounded-xl bg-red-50 text-red-600 text-sm font-medium hover:bg-red-100"
                  >
                    删除
                  </button>
                )}
                <button
                  onClick={handleSave}
                  disabled={saving || !editing.name.trim()}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-stone-900 text-white text-sm font-medium hover:bg-stone-800 disabled:opacity-50"
                >
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
