"use client";

import { useEffect, useMemo, useState } from "react";
import Icon from "@/components/royalzen/icon";
import SkuFacetFilter from "@/components/royalzen/sku-facet-filter";
import { thumb } from "@/lib/image-url";
import {
  COLOR_LABELS,
  MATERIAL_LABELS,
  VALUE_LABELS,
  colorBucket,
  matchesFacets,
  type FacetSelection
} from "@/lib/sku-facets";

type Product = {
  sku_id: string;
  name: string;
  color: string;
  opacity: string;
  window_types: string;
  image_url: string;
  local_image: string;
  source: string;
  color_family?: string | null;
  color_rgb?: string | null;
  color_chroma?: number | null;
  value_level?: string | null;
  material_type?: string | null;
  pattern_level?: string | null;
  material_class?: string | null;
  weight_gsm?: number | null;
};

/** 每次渲染多少张。全部铺开会让浏览器同时发起几百个图片请求，页面十几秒打不开 */
const PAGE_SIZE = 24;

/** 遮光等级尚无实测数据，未标注的一律不显示——把 unspecified 印给顾问看毫无意义 */
function opacityLabel(value: string) {
  if (!value || value === "unspecified") return "";
  if (value === "sheer") return "纱帘";
  return value;
}

export default function ProductBrowser({ initialProducts }: { initialProducts: Product[] }) {
  const products = initialProducts;
  const [query, setQuery] = useState("");
  const [facets, setFacets] = useState<FacetSelection>({});
  const [visible, setVisible] = useState(PAGE_SIZE);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return products.filter((item) => {
      if (keyword && !`${item.sku_id} ${item.name} ${item.color}`.toLowerCase().includes(keyword)) {
        return false;
      }
      return matchesFacets(item, facets);
    });
  }, [facets, products, query]);

  useEffect(() => setVisible(PAGE_SIZE), [query, facets]);

  const shown = filtered.slice(0, visible);

  return (
    <>
      <div className="rz-catalog-toolbar">
        <label className="rz-search">
          <Icon name="search" size={18} />
          <input
            aria-label="搜索商品"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索编号、名称或颜色"
            value={query}
          />
        </label>
        <span className="rz-catalog-count">{filtered.length} / {products.length} 款</span>
      </div>

      <SkuFacetFilter items={products} onChange={setFacets} selection={facets} />

      <div className="rz-product-grid">
        {shown.map((item, index) => {
          // 名称里已经有颜色、观感和克重了，这里只补它没有的
          const tags = [
            COLOR_LABELS[colorBucket(item)] || "",
            MATERIAL_LABELS[item.material_class || ""] || "",
            VALUE_LABELS[item.value_level || ""] || "",
            opacityLabel(item.opacity)
          ].filter(Boolean);
          return (
            <article className="rz-catalog-card" key={item.sku_id}>
              <div className="rz-catalog-image">
                <img
                  alt={item.name}
                  decoding="async"
                  // 首屏那几张早点出来，其余等滚到了再加载
                  loading={index < 6 ? "eager" : "lazy"}
                  src={thumb(item.image_url || item.local_image || "/demo/curtain-beige.jpg", 384)}
                />
                <span className="is-ready">可推荐</span>
              </div>
              <div className="rz-catalog-copy">
                <small>
                  {item.sku_id}
                  {/* 色号就是从白底图算出来的主色。顾问报色号，比形容「有点米又有点灰」准得多 */}
                  {item.color_rgb ? (
                    <span className="rz-catalog-hex">
                      <i style={{ background: item.color_rgb }} />
                      {item.color_rgb.toUpperCase()}
                    </span>
                  ) : null}
                </small>
                <h3>{item.name}</h3>
                {tags.length ? <p>{tags.join(" · ")}</p> : null}
              </div>
            </article>
          );
        })}
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

      {filtered.length === 0 ? (
        <div className="rz-empty-state">
          <Icon name="search" size={24} />
          <strong>没有匹配的商品</strong>
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
