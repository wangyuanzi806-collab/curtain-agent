"use client";

import { useEffect, useMemo, useState } from "react";
import AdminActionFeedback, { type AdminActionMessage } from "@/components/royalzen/admin-action-feedback";
import SkuFacetFilter from "@/components/royalzen/sku-facet-filter";
import { type AdminDataPage } from "@/lib/admin-pagination";
import { requestJson } from "@/lib/client-api";
import { thumb } from "@/lib/image-url";
import {
  MATERIAL_LABELS,
  PATTERN_LABELS,
  VALUE_LABELS,
  matchesFacets,
  type FacetSelection
} from "@/lib/sku-facets";

/**
 * 商品数据：看真实在售的商品，并决定它参不参与推荐。
 *
 * 刻意不提供字段编辑。颜色、花纹、明度、质感都是白底图 CV 与视觉模型算出来的，
 * 人工改了会被下一次重标覆盖，制造无人察觉的不一致；成分与克重来自供应商，
 * 要更正应走数据重导，而不是在后台改一条。
 *
 * 此前这里是一套完整的增删改表单，但读写的都是 curtain_skus——那张表 0 条，
 * 推荐用的却是 sku_material 的 985 条。顾问打开看到空列表，改什么都不影响前台。
 */
type Sku = {
  sku_id: string;
  name: string;
  color: string;
  image_url: string;
  color_family?: string | null;
  pattern_level?: string | null;
  material_class?: string | null;
  value_level?: string | null;
  weight_gsm?: number | null;
  material_type?: string | null;
  status: string;
  hasImage: boolean;
};

type SkusManagerProps = { initialPage: AdminDataPage<Sku> };

/** 一次铺 985 张图会同时发起几百个请求。图卡三列，每批 30 正好十行 */
const PAGE_SIZE = 30;

export default function SkusManager({ initialPage }: SkusManagerProps) {
  const [skus, setSkus] = useState<Sku[]>(initialPage.items);
  const [savingId, setSavingId] = useState("");
  const [message, setMessage] = useState<AdminActionMessage | null>(null);
  const [query, setQuery] = useState("");
  const [facets, setFacets] = useState<FacetSelection>({});
  const [onlyOffline, setOnlyOffline] = useState(false);
  const [visible, setVisible] = useState(PAGE_SIZE);

  const toggleStatus = async (sku: Sku) => {
    const next = sku.status === "active" ? "inactive" : "active";
    setSavingId(sku.sku_id);
    try {
      await requestJson("/api/admin/skus", {
        method: "POST",
        body: JSON.stringify({ skuId: sku.sku_id, status: next })
      });
      setSkus((current) =>
        current.map((item) => (item.sku_id === sku.sku_id ? { ...item, status: next } : item))
      );
      setMessage({
        tone: "success",
        text: `${sku.sku_id} 已${next === "active" ? "上架" : "下架"}，前台推荐会同步更新。`
      });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "更新失败。" });
    } finally {
      setSavingId("");
    }
  };

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return skus.filter((item) => {
      if (onlyOffline && item.status === "active") return false;
      if (keyword && !`${item.sku_id} ${item.name} ${item.color}`.toLowerCase().includes(keyword)) {
        return false;
      }
      return matchesFacets(item, facets);
    });
  }, [facets, onlyOffline, query, skus]);

  useEffect(() => setVisible(PAGE_SIZE), [query, facets, onlyOffline]);

  const shown = filtered.slice(0, visible);
  const offline = skus.filter((item) => item.status !== "active").length;
  const missingImage = skus.filter((item) => !item.hasImage).length;

  return (
    <div className="rz-page">
      <header className="rz-page-heading">
        <div>
          <span className="rz-eyebrow">PRODUCT DATA</span>
          <h1>商品数据</h1>
          <p>
            共 {skus.length} 款{offline > 0 ? `，其中 ${offline} 款已下架` : ""}
            {missingImage > 0 ? `，${missingImage} 款缺白底图` : ""}。
            颜色、花纹、质感由系统从白底图算出，不在此处编辑；这一页只决定商品参不参与推荐。
          </p>
        </div>
      </header>

      <AdminActionFeedback message={message} />

      <div className="rz-catalog-toolbar">
        <label className="rz-search">
          <input
            aria-label="搜索商品"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索编号、名称或颜色"
            value={query}
          />
        </label>
        <button
          className={`rz-facet-toggle ${onlyOffline ? "is-selected" : ""}`}
          onClick={() => setOnlyOffline((current) => !current)}
          type="button"
        >
          只看已下架
          <i>{offline}</i>
        </button>
      </div>

      <SkuFacetFilter items={skus} onChange={setFacets} selection={facets} />

      <div className="rz-product-grid">
        {shown.map((sku, index) => (
          <article
            className={`rz-catalog-card ${sku.status === "active" ? "" : "is-offline"}`}
            key={sku.sku_id}
          >
            <div className="rz-catalog-image">
              {sku.hasImage ? (
                <img
                  alt={sku.name}
                  decoding="async"
                  loading={index < 6 ? "eager" : "lazy"}
                  src={thumb(sku.image_url, 384)}
                />
              ) : (
                <span className="rz-catalog-noimage">缺白底图</span>
              )}
              <span className={sku.status === "active" ? "is-ready" : "is-offline"}>
                {sku.status === "active" ? "可推荐" : "已下架"}
              </span>
            </div>
            <div className="rz-catalog-copy">
              <small>{sku.sku_id}</small>
              <h3>{sku.name}</h3>
              <p>
                {[
                  PATTERN_LABELS[sku.pattern_level || ""],
                  MATERIAL_LABELS[sku.material_class || ""],
                  VALUE_LABELS[sku.value_level || ""],
                  sku.material_type === "sheer" ? "纱帘" : ""
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <button
                className={`rz-catalog-action ${sku.status === "active" ? "" : "is-offline"}`}
                disabled={savingId === sku.sku_id}
                onClick={() => toggleStatus(sku)}
                type="button"
              >
                {savingId === sku.sku_id ? "保存中…" : sku.status === "active" ? "下架" : "上架"}
              </button>
            </div>
          </article>
        ))}
      </div>

      {visible < filtered.length ? (
        <div className="rz-catalog-more">
          <span>
            已显示 {shown.length} / {filtered.length} 款
          </span>
          <button onClick={() => setVisible((current) => current + PAGE_SIZE)} type="button">
            再看 {Math.min(PAGE_SIZE, filtered.length - visible)} 款
          </button>
        </div>
      ) : null}

      {filtered.length === 0 ? <p className="rz-empty-state">没有匹配的商品。</p> : null}
    </div>
  );
}
