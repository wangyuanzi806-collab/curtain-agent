"use client";

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import Icon from "@/components/royalzen/icon";
import { COLOR_LABELS, VALUE_LABELS } from "@/lib/sku-facets";

/**
 * 六题偏好漏斗。
 *
 * 三条底线：每题都要有「都可以」，不逼客户对不懂的事做决定；
 * 剩余数量常驻，客户最怕认真填完却一款没有；
 * 选项尽量用真实成品图，用色块选颜色和用真实窗帘图，决策质量完全不同。
 */

export type SurveyValue = {
  opacityNeed: string | null;
  colors: string[];
  valueLevels: string[];
  /** 色板上实际点中的格子，形如 `warm_tint/light`；colors 与 valueLevels 是它的两条投影 */
  colorCells: string[];
  texture: string | null;
  materials: string[];
  fabricType: string | null;
  tags: string[];
  note: string;
};

export const EMPTY_SURVEY: SurveyValue = {
  opacityNeed: null,
  colors: [],
  valueLevels: [],
  colorCells: [],

  texture: null,
  materials: [],
  fabricType: null,
  tags: [],
  note: ""
};

type Swatch = { colorFamily: string; valueLevel: string; count: number; hex: string; imageUrl: string };
type Facets = {
  total: number;
  swatches: Swatch[];
  materials: Record<string, number>;
  patterns: Record<string, number>;
  fabricTypes: Record<string, number>;
  /** 花纹、质感、布纱三题的示意图，由接口按「明度适中 + 彩度最低」从真实商品里挑 */
};
type Progress = {
  count: number;
  level: "plenty" | "focused" | "few" | "blocked";
  message: string;
};

const VALUE_ORDER = ["very_light", "light", "medium", "deep"];

const OPACITY_OPTIONS = [
  { id: "keep_light", label: "保留采光，通透明亮", hint: "光线柔和进来，不挡视野" },
  { id: "day_privacy", label: "白天透光，晚上要隐私", hint: "最常见的选择" },
  { id: "dark_sleep", label: "睡觉要够暗", hint: "早上不被光叫醒" },
  { id: "max_block", label: "尽量遮光遮热", hint: "西晒、临街或有午睡需求" }
];

const TEXTURE_OPTIONS = [
  { id: "solid", label: "素净，看不出花纹", hint: "纯色，最百搭" },
  { id: "texture", label: "有点肌理，近看才见", hint: "细织纹质感，不抢戏" },
  { id: "pattern", label: "明显的花纹图案", hint: "提花或大花型，有装饰性" }
];

const MATERIAL_OPTIONS = [
  { id: "cotton_linen", label: "棉麻自然感", hint: "透气、有自然纹理，偏休闲" },
  { id: "wool", label: "羊毛温暖感", hint: "有毛呢质地，冬天显暖" },
  { id: "viscose_soft", label: "柔软垂坠感", hint: "手感软、垂坠好" },
  { id: "polyester_smooth", label: "顺滑素面", hint: "没有明显材质感，干净利落" },
  { id: "blend", label: "混纺质感", hint: "兼顾各方面" }
];

const TAG_OPTIONS = [
  { id: "thick", label: "厚实有型" },
  { id: "light_weight", label: "轻薄通透" },
  { id: "prefer_natural", label: "偏天然材质" },
  { id: "mostly_natural", label: "天然为主" },
  { id: "easy_care", label: "好打理" },
  { id: "no_pattern", label: "不要花的" },
  { id: "want_light_color", label: "要浅色" },
  { id: "want_deep_color", label: "要深色" }
];

function toggle<T>(list: T[], value: T, max = Infinity) {
  if (list.includes(value)) return list.filter((item) => item !== value);
  if (list.length >= max) return list;
  return [...list, value];
}

/**
 * 一个选项卡片。
 *
 * 示意图用**面料细节图**，不是成品缩略图——这一点是踩出来的。成品图上
 * 「棉麻」会挑出满版树叶、「柔垂」挑出几何小图案、「布帘」挑出蓝白格子，
 * 客户学到的对应关系全是错的；而「羊毛/顺滑/混纺」在成品图上都是素净灰，
 * 根本分不出。换过选图规则也没用——细肌理与素净的差别在成品缩略图上
 * 本来就呈现不出来，客户看到的只是两款颜色不同的窗帘。
 *
 * 面料细节图看得见经纬织纹，这才佐证得了它要说明的那件事。十张都是人工挑的，
 * 且同一道题内颜色接近：颜色一拉开，客户会以为在选颜色而不是选质地。
 * 源图统一居中裁切成 480×480 后落在 public/facets/，形状与大小完全一致。
 */
function Option({
  label,
  hint,
  count,
  facet,
  selected,
  onSelect
}: {
  label: string;
  hint?: string;
  count?: number;
  /** 对应 public/facets/{facet}.webp。给了才有图 */
  facet?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      aria-pressed={selected}
      className={selected ? "is-selected" : ""}
      onClick={onSelect}
      type="button"
    >
      {facet ? (
        <span className="rz-opt-thumb">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="" decoding="async" loading="lazy" src={`/facets/${facet}.webp`} />
        </span>
      ) : null}
      <span className="rz-opt-text">
        <strong>{label}</strong>
        {hint ? <small>{hint}</small> : null}
        {count ? <i>{count} 款</i> : null}
      </span>
    </button>
  );
}

export default function SurveyPanel({
  value,
  onChange,
  onBlockedChange
}: {
  value: SurveyValue;
  onChange: Dispatch<SetStateAction<SurveyValue>>;
  onBlockedChange?: (blocked: boolean) => void;
}) {
  const [facets, setFacets] = useState<Facets | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [allColors, setAllColors] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/skus/survey")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (alive && data) setFacets(data);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // 每次改动都重新问一次剩余数量。提示要在客户还能改的时候给出，而不是提交后才说
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      fetch("/api/skus/survey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value)
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!alive || !data) return;
          setProgress(data);
          onBlockedChange?.(data.level === "blocked");
        })
        .catch(() => undefined);
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [value, onBlockedChange]);

  // 用函数式更新，别拿闭包里的 value 去拼。
  // 两次点击之间若 React 还没重渲染，后一次会用旧值覆盖前一次——
  // 实测连点「颜色」再点「花纹」，颜色选择被静默吃掉，而客户不会知道。
  const patch = useCallback(
    (next: Partial<SurveyValue> | ((current: SurveyValue) => Partial<SurveyValue>)) =>
      onChange((current) => ({
        ...current,
        ...(typeof next === "function" ? next(current) : next)
      })),
    [onChange]
  );

  const swatchRows = useMemo(() => {
    if (!facets) return [];
    const byFamily = new Map<string, Swatch[]>();
    for (const swatch of facets.swatches) {
      const list = byFamily.get(swatch.colorFamily) || [];
      list.push(swatch);
      byFamily.set(swatch.colorFamily, list);
    }
    return [...byFamily.entries()]
      .map(([family, cells]) => ({
        family,
        total: cells.reduce((sum, cell) => sum + cell.count, 0),
        cells: cells.sort((a, b) => VALUE_ORDER.indexOf(a.valueLevel) - VALUE_ORDER.indexOf(b.valueLevel))
      }))
      .sort((a, b) => b.total - a.total);
  }, [facets]);

  // 色族按款数降序，前 6 族已覆盖九成以上；其余折起来，
  // 否则光是颜色一题就要占掉一屏半。已选中的色族一定展开，不能藏起来。
  const visibleRows = useMemo(() => {
    if (allColors) return swatchRows;
    return swatchRows.filter((row, index) => index < 6 || value.colors.includes(row.family));
  }, [allColors, swatchRows, value.colors]);
  const hiddenRows = swatchRows.length - visibleRows.length;

  const answered = [
    value.opacityNeed,
    value.colors.length || value.valueLevels.length ? "y" : null,
    value.texture,
    value.materials.length ? "y" : null,
    value.fabricType,
    value.tags.length || value.note.trim() ? "y" : null
  ].filter(Boolean).length;

  return (
    <div className="rz-survey">
      <section className="rz-survey-q">
        <div className="rz-survey-ask">
          <h3>这个房间的窗帘，最重要的是什么？</h3>
          <p>会写进推荐说明，但不筛掉商品。</p>
        </div>
        <div className="rz-survey-answer">
          <div className="rz-survey-options is-plain">
            {OPACITY_OPTIONS.map((option) => (
              <Option
                hint={option.hint}
                key={option.id}
                label={option.label}
                onSelect={() =>
                  patch((current) => ({
                    opacityNeed: current.opacityNeed === option.id ? null : option.id
                  }))
                }
                selected={value.opacityNeed === option.id}
              />
            ))}
            <Option
              hint="交给系统判断"
              label="都可以"
              onSelect={() => patch({ opacityNeed: null })}
              selected={value.opacityNeed === null}
            />
          </div>
        </div>
      </section>

      <section className="rz-survey-q">
        <div className="rz-survey-ask">
          <h3>喜欢什么颜色？</h3>
          <p>可多选，最多 3 个。选「都可以」时按你家空间来搭。</p>
        </div>
        <div className="rz-survey-answer">
        {swatchRows.length === 0 ? (
          <p className="rz-survey-note">正在加载配色…</p>
        ) : (
          <div className="rz-swatch-grid">
            {visibleRows.map((row) => (
              <div className="rz-swatch-row" key={row.family}>
                <span className="rz-swatch-label">
                  {COLOR_LABELS[row.family] || row.family}
                  <small>{row.total} 款</small>
                </span>
                <div className="rz-swatch-cells">
                  {row.cells.map((cell) => {
                    const cellKey = `${cell.colorFamily}/${cell.valueLevel}`;
                    // 只看这一格自己选没选中。原先是「色族在清单里 且 深浅在清单里」——
                    // 点了「米白·浅」和「暖灰·中」之后，「米白·中」两个条件也都成立，
                    // 于是没点过的格子跟着亮起来，客户点两格却选中了四格。
                    const active = value.colorCells.includes(cellKey);
                    return (
                      <button
                        className={active ? "is-selected" : ""}
                        key={cell.valueLevel}
                        onClick={() =>
                          patch((current) => {
                            // 一格一选，各不相干。colors / valueLevels 退居为它的两条投影，
                            // 只供展示和推荐提示词用，筛选一律以格子为准。
                            const on = current.colorCells.includes(cellKey);
                            const colorCells = on
                              ? current.colorCells.filter((key) => key !== cellKey)
                              : [...current.colorCells, cellKey];
                            const colors = [...new Set(colorCells.map((key) => key.split("/")[0]))];
                            // 色系仍然最多三个：再多客户自己也说不清想要什么
                            if (!on && colors.length > 3) return current;
                            return {
                              colorCells,
                              colors,
                              valueLevels: [...new Set(colorCells.map((key) => key.split("/")[1]))]
                            };
                          })
                        }
                        title={`${COLOR_LABELS[cell.colorFamily] || cell.colorFamily} · ${VALUE_LABELS[cell.valueLevel]}（${cell.count} 款）`}
                        type="button"
                      >
                        {/* 纯色卡。色块用商品自己的主色，不掺成品图——
                            上半截色块下半截窗帘，两种东西并排反而让人不知道在比什么 */}
                        <em className="rz-swatch-chip" style={{ background: cell.hex }} />
                        <span>
                          {VALUE_LABELS[cell.valueLevel]}
                          <small>{cell.count}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {hiddenRows > 0 ? (
              <button
                className="rz-swatch-more"
                onClick={() => setAllColors((current) => !current)}
                type="button"
              >
                {allColors ? "收起少见的颜色" : `还有 ${hiddenRows} 种颜色`}
              </button>
            ) : null}
          </div>
        )}
        <button
          className={`rz-survey-any ${value.colors.length === 0 && value.valueLevels.length === 0 ? "is-selected" : ""}`}
          onClick={() => patch({ colors: [], valueLevels: [] })}
          type="button"
        >
          都可以，按我家空间来搭
        </button>
        </div>
      </section>

      <section className="rz-survey-q">
        <div className="rz-survey-ask">
          <h3>要素净还是有花纹？</h3>
          <p>图是库里的真实成品，按这三档各挑了一款。</p>
        </div>
        <div className="rz-survey-answer">
          <div className="rz-survey-options">
            {TEXTURE_OPTIONS.map((option) => (
              <Option
                count={facets?.patterns?.[option.id]}
                facet={option.id}
                hint={option.hint}
                key={option.id}
                label={option.label}
                onSelect={() =>
                  patch((current) => ({ texture: current.texture === option.id ? null : option.id }))
                }
                selected={value.texture === option.id}
              />
            ))}
            <Option
              label="都可以"
              onSelect={() => patch({ texture: null })}
              selected={value.texture === null}
            />
          </div>
        </div>
      </section>

      <section className="rz-survey-q">
        <div className="rz-survey-ask">
          <h3>想要什么质感？</h3>
          <p>可多选。白底图上质感差别不大，以文字说明为准。</p>
        </div>
        <div className="rz-survey-answer">
          <div className="rz-survey-options">
            {MATERIAL_OPTIONS.map((option) => (
              <Option
                count={facets?.materials?.[option.id]}
                facet={option.id}
                hint={option.hint}
                key={option.id}
                label={option.label}
                onSelect={() =>
                  patch((current) => ({ materials: toggle(current.materials, option.id) }))
                }
                selected={value.materials.includes(option.id)}
              />
            ))}
            <Option
              label="都可以"
              onSelect={() => patch({ materials: [] })}
              selected={value.materials.length === 0}
            />
          </div>
        </div>
      </section>

      <section className="rz-survey-q">
        <div className="rz-survey-ask">
          <h3>想要一层还是两层？</h3>
          <p>纱帘目前只有 {facets?.fabricTypes?.sheer ?? 4} 款，双层暂未开放。</p>
        </div>
        <div className="rz-survey-answer">
          <div className="rz-survey-options">
            <Option
              count={facets?.fabricTypes?.main}
              facet="main"
              hint="简洁，遮光看布料厚度"
              label="只要一层布帘"
              onSelect={() =>
                patch((current) => ({ fabricType: current.fabricType === "cloth" ? null : "cloth" }))
              }
              selected={value.fabricType === "cloth"}
            />
            <Option
              count={facets?.fabricTypes?.sheer}
              facet="sheer"
              hint="轻薄通透，白天柔化光线"
              label="只要一层纱帘"
              onSelect={() =>
                patch((current) => ({ fabricType: current.fabricType === "sheer" ? null : "sheer" }))
              }
              selected={value.fabricType === "sheer"}
            />
            <Option
              hint="不确定就交给系统"
              label="帮我推荐"
              onSelect={() => patch({ fabricType: null })}
              selected={value.fabricType === null}
            />
          </div>
        </div>
      </section>

      <section className="rz-survey-q">
        <div className="rz-survey-ask">
          <h3>还有什么要求？</h3>
          <p>只有「不要花的」会筛掉商品，其余进排序与理由。</p>
        </div>
        <div className="rz-survey-answer">
        <div className="rz-survey-tags">
          {TAG_OPTIONS.map((tag) => (
            <button
              className={value.tags.includes(tag.id) ? "is-selected" : ""}
              key={tag.id}
              onClick={() => patch((current) => ({ tags: toggle(current.tags, tag.id) }))}
              type="button"
            >
              {tag.label}
            </button>
          ))}
        </div>
        <label className="rz-field">
          <span>
            补充说明 <small>可选，会带进推荐理由</small>
          </span>
          <textarea
            onChange={(event) => patch({ note: event.target.value })}
            placeholder="例：客户不喜欢明显花型，家里木色重，预算别太高"
            value={value.note}
          />
        </label>
        </div>
      </section>

      <div className={`rz-survey-bar is-${progress?.level || "plenty"}`}>
        <span className="rz-survey-count">
          {progress ? progress.message : "正在统计符合条件的窗帘…"}
        </span>
        <span className="rz-survey-progress">
          <Icon name="check" size={14} /> 已答 {answered} / 6
        </span>
      </div>
    </div>
  );
}
