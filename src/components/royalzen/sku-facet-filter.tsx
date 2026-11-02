"use client";

import {
  FACET_GROUPS,
  countByFacet,
  countSelected,
  toggleFacet,
  type FacetKey,
  type FacetSelection
} from "@/lib/sku-facets";

/**
 * 五组标签的筛选条，前台目录与后台管理共用。
 *
 * 计数是按「其余条件已生效」算的：选了灰中性之后，花纹那一组显示的
 * 是灰中性里各有多少款，而不是全库的数字。否则顾问按着 346 款去点，
 * 点出来只有 12 款。
 */
export default function SkuFacetFilter<
  T extends Partial<Record<FacetKey, string | null | undefined>>
>({
  items,
  selection,
  onChange
}: {
  items: T[];
  selection: FacetSelection;
  onChange: (next: FacetSelection) => void;
}) {
  const selected = countSelected(selection);

  return (
    <div className="rz-facets">
      {FACET_GROUPS.map((group) => {
        // 这一组自己不参与过滤，否则选中一个之后同组其它标签全变 0，再也点不动
        const others: FacetSelection = { ...selection, [group.key]: [] };
        const pool = items.filter((item) =>
          FACET_GROUPS.every((other) => {
            const picked = others[other.key];
            if (!picked || picked.length === 0) return true;
            return picked.includes(String(item[other.key] || ""));
          })
        );
        const counts = countByFacet(pool, group.key);
        const values = group.order.filter((value) => counts.has(value));
        if (values.length === 0) return null;
        const picked = selection[group.key] || [];

        return (
          <div className="rz-facet-group" key={group.key}>
            <span className="rz-facet-label">{group.label}</span>
            <div className="rz-facet-values">
              {values.map((value) => (
                <button
                  className={picked.includes(value) ? "is-selected" : ""}
                  key={value}
                  onClick={() => onChange(toggleFacet(selection, group.key, value))}
                  type="button"
                >
                  {group.labels[value] || value}
                  <i>{counts.get(value)}</i>
                </button>
              ))}
            </div>
          </div>
        );
      })}
      {selected > 0 ? (
        <button className="rz-facet-clear" onClick={() => onChange({})} type="button">
          清除 {selected} 个筛选
        </button>
      ) : null}
    </div>
  );
}
