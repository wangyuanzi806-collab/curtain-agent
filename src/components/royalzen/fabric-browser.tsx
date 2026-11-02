"use client";

import { useEffect, useMemo, useState } from "react";
import Icon from "@/components/royalzen/icon";
import SkuFacetFilter from "@/components/royalzen/sku-facet-filter";
import { thumb } from "@/lib/image-url";
import {
  COLOR_LABELS,
  MATERIAL_LABELS,
  PATTERN_LABELS,
  TYPE_LABELS,
  colorBucket,
  matchesFacets,
  type FacetSelection
} from "@/lib/sku-facets";

export type Fabric = {
  sku_id: string;
  name: string;
  composition?: string | null;
  weight_gsm?: number | null;
  color_rgb?: string | null;
  color_family?: string | null;
  color_chroma?: number | null;
  value_level?: string | null;
  pattern_level?: string | null;
  material_class?: string | null;
  material_type?: string | null;
  image_url: string;
  detail_image_url?: string | null;
};

/** 面料图比成品图重得多，一次铺太多会拖垮手机 */
const PAGE_SIZE = 18;

/**
 * "51%COTTON 17%RAYON 12%ACRYLIC" 是规格表。顾问要跟客户说的是主纤维是什么，
 * 次要的只在确实影响手感时才提。算不出来就不说——不猜。
 */
function fibreSummary(composition?: string | null) {
  if (!composition) return "";
  const parts = [...String(composition).matchAll(/([\d.]+)\s*%\s*([A-Za-z]{3,})/g)].map((m) => ({
    pct: Number(m[1]),
    name: m[2].toLowerCase()
  }));
  if (!parts.length) return "";
  parts.sort((a, b) => b.pct - a.pct);
  const cn: Record<string, string> = {
    cotton: "棉",
    linen: "麻",
    wool: "羊毛",
    polyester: "涤纶",
    rayon: "人棉",
    viscose: "粘胶",
    acrylic: "腈纶",
    silk: "真丝",
    nylon: "锦纶"
  };
  const main = cn[parts[0].name] || parts[0].name;
  const second = parts[1] && parts[1].pct >= 25 ? cn[parts[1].name] || parts[1].name : "";
  return second ? `${main} ${parts[0].pct}% · ${second} ${parts[1].pct}%` : `${main} ${parts[0].pct}%`;
}

/**
 * 面料库：看料子本身，不是看成品挂起来的样子。
 *
 * 与商品目录的分工就在这张图上——商品目录给白底成品图（统一背景便于横向比较），
 * 这里给面料细节图（看得见经纬织纹）。顾问跟客户讲"这块布是什么手感"时看这一页。
 *
 * 此前这一页是 4 条硬编码的假面料（经典花卉、抽象树叶、棕榈刺绣、民族赤陶），
 * 与库里真卖的 985 款毫无关系，`curtain_fabrics` 表则一直是 0 条。
 */
export default function FabricBrowser({ initialFabrics }: { initialFabrics: Fabric[] }) {
  const fabrics = initialFabrics;
  const [query, setQuery] = useState("");
  const [facets, setFacets] = useState<FacetSelection>({});
  const [visible, setVisible] = useState(PAGE_SIZE);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return fabrics.filter((item) => {
      if (
        keyword &&
        !`${item.sku_id} ${item.name} ${item.composition || ""}`.toLowerCase().includes(keyword)
      ) {
        return false;
      }
      return matchesFacets(item, facets);
    });
  }, [facets, fabrics, query]);

  useEffect(() => setVisible(PAGE_SIZE), [query, facets]);

  const shown = filtered.slice(0, visible);
  const withDetail = fabrics.filter((item) => item.detail_image_url).length;

  return (
    <>
      <div className="rz-catalog-toolbar">
        <label className="rz-search">
          <Icon name="search" size={18} />
          <input
            aria-label="搜索面料"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索编号或成分"
            value={query}
          />
        </label>
        <span className="rz-catalog-count">
          {filtered.length} / {fabrics.length} 种
          {withDetail < fabrics.length ? `（${fabrics.length - withDetail} 种还没有细节图）` : ""}
        </span>
      </div>

      <SkuFacetFilter items={fabrics} onChange={setFacets} selection={facets} />

      <div className="rz-fabric-grid">
        {shown.map((item, index) => (
          <article className="rz-fabric-card" key={item.sku_id}>
            <div className="rz-fabric-image">
              {/* 优先细节图。它才看得见织纹，白底成品图只是兜底 */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt={`${item.sku_id} 面料`}
                decoding="async"
                loading={index < 6 ? "eager" : "lazy"}
                src={thumb(item.detail_image_url || item.image_url, 640)}
              />
              {item.detail_image_url ? null : <span>暂用成品图</span>}
            </div>
            <div className="rz-fabric-copy">
              <small>
                {item.sku_id}
                {item.color_rgb ? (
                  <span className="rz-catalog-hex">
                    <i style={{ background: item.color_rgb }} />
                    {item.color_rgb.toUpperCase()}
                  </span>
                ) : null}
              </small>
              <h3>{COLOR_LABELS[colorBucket(item)] || item.name}</h3>
              <p>
                {[
                  fibreSummary(item.composition),
                  item.weight_gsm ? `${Math.round(item.weight_gsm)} g/m²` : "",
                  MATERIAL_LABELS[item.material_class || ""] || "",
                  PATTERN_LABELS[item.pattern_level || ""] || "",
                  TYPE_LABELS[item.material_type || ""] || ""
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          </article>
        ))}
      </div>

      {visible < filtered.length ? (
        <div className="rz-catalog-more">
          <span>
            已显示 {shown.length} / {filtered.length} 种
          </span>
          <button onClick={() => setVisible((current) => current + PAGE_SIZE)} type="button">
            再看 {Math.min(PAGE_SIZE, filtered.length - visible)} 种
          </button>
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <div className="rz-empty-state">
          <Icon name="search" size={24} />
          <strong>没有匹配的面料</strong>
          <p>尝试更换关键词或清除筛选条件。</p>
          <button
            onClick={() => {
              setQuery("");
              setFacets({});
            }}
            type="button"
          >
            清除筛选
          </button>
        </div>
      ) : null}
    </>
  );
}
