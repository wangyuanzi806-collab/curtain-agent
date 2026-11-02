"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type SkuItem = {
  sku_id: string;
  name: string;
  brand: string;
  collection: string;
  product_type: string;
  opacity: string;
  color: string;
  mounting: string;
  layer_type: string;
  price_band: string;
  style_tags: string;
  window_types: string;
  page_url: string;
  image_url: string;
  local_image: string;
  source: string;
  usage_note: string;
};

const COPY = {
  title: "商品列表",
  description:
    "这里先放一版轻量 SKU 列表和导入口，方便你梳理商品。当前重点是把“适配窗型”和“使用建议”这些标签先打扎实。",
  sourceMock: "当前数据源：本地 mock SKU",
  sourceDb: "当前数据源：数据库 SKU",
  qLabel: "关键词",
  qPlaceholder: "搜索名称、SKU、颜色、风格、窗型或使用建议",
  colorLabel: "颜色",
  opacityLabel: "透光 / 遮光",
  typeLabel: "商品类型",
  windowTypeLabel: "适配窗型",
  all: "全部",
  refresh: "刷新列表",
  loading: "加载中...",
  countPrefix: "共 ",
  countSuffix: " 个 SKU",
  importTitle: "导入 SKU",
  importDescription:
    "支持 JSON 或 CSV 文件导入。现在先做轻量导入，后面如果你们有正式字段，我再按公司商品结构继续收口。",
  replaceMode: "替换当前 SKU 库",
  upsertMode: "按 sku_id 覆盖 / 新增",
  chooseFile: "选择 JSON 或 CSV 文件",
  importButton: "开始导入",
  importMockButton: "导入当前 mock SKU",
  importing: "导入中...",
  importSuccessPrefix: "导入成功，共导入 ",
  importSuccessSuffix: " 个 SKU。",
  empty: "当前没有 SKU，可以先导入一份。",
  noImage: "暂无图片",
  sourceLabel: "来源：",
  opacityPrefix: "透光：",
  stylePrefix: "风格标签：",
  windowPrefix: "适配窗型：",
  usagePrefix: "使用建议：",
  openPage: "打开商品页",
  statusIdle: "你可以先查看 SKU 列表，或者先导入一份新的商品数据。",
  sourceHint: "数据库为空时会回退到 mock SKU；导入后这里会直接切到数据库数据。",
  filterHint: "先按颜色、透光和窗型筛一遍，再决定哪些标签值得保留进正式商品库。",
  readFailed: "读取 SKU 列表失败。",
  importFailed: "导入 SKU 失败。",
  importMockFailed: "导入 mock SKU 失败。",
  chooseFileFirst: "请先选择一个 JSON 或 CSV 文件。",
  statusLabel: "状态：",
  errorLabel: "错误：",
  skuPrefix: "SKU："
} as const;

export default function SkuCatalogManager() {
  const [items, setItems] = useState<SkuItem[]>([]);
  const [source, setSource] = useState<"mock" | "database">("mock");
  const [query, setQuery] = useState("");
  const [color, setColor] = useState("");
  const [opacity, setOpacity] = useState("");
  const [productType, setProductType] = useState("");
  const [windowType, setWindowType] = useState("");
  const [importMode, setImportMode] = useState("replace");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [status, setStatus] = useState<string>(COPY.statusIdle);
  const [error, setError] = useState<string | null>(null);

  const colorOptions = useMemo(
    () => Array.from(new Set(items.map((item) => item.color).filter(Boolean))).sort(),
    [items]
  );
  const opacityOptions = useMemo(
    () => Array.from(new Set(items.map((item) => item.opacity).filter(Boolean))).sort(),
    [items]
  );
  const typeOptions = useMemo(
    () => Array.from(new Set(items.map((item) => item.product_type).filter(Boolean))).sort(),
    [items]
  );
  const windowTypeOptions = useMemo(
    () =>
      Array.from(
        new Set(
          items
            .flatMap((item) => item.window_types.split(","))
            .map((item) => item.trim())
            .filter(Boolean)
        )
      ).sort(),
    [items]
  );

  const loadItems = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const url = new URL("/api/skus", window.location.origin);
      if (query.trim()) url.searchParams.set("q", query.trim());
      if (color) url.searchParams.set("color", color);
      if (opacity) url.searchParams.set("opacity", opacity);
      if (productType) url.searchParams.set("product_type", productType);
      if (windowType) url.searchParams.set("window_type", windowType);
      url.searchParams.set("limit", "200");

      const response = await fetch(url.toString(), { cache: "no-store" });
      const data = (await response.json()) as {
        items?: SkuItem[];
        source?: "mock" | "database";
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || COPY.readFailed);
      }

      setItems(data.items || []);
      setSource(data.source || "mock");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : COPY.readFailed);
    } finally {
      setIsLoading(false);
    }
  }, [color, opacity, productType, query, windowType]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  async function handleImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!importFile) {
      setError(COPY.chooseFileFirst);
      return;
    }

    setIsImporting(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.set("file", importFile);
      formData.set("mode", importMode);

      const response = await fetch("/api/skus/import", {
        method: "POST",
        body: formData
      });
      const data = (await response.json()) as { imported?: number; error?: string };
      if (!response.ok) {
        throw new Error(data.error || COPY.importFailed);
      }

      setStatus(`${COPY.importSuccessPrefix}${data.imported || 0}${COPY.importSuccessSuffix}`);
      setImportFile(null);
      await loadItems();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : COPY.importFailed);
    } finally {
      setIsImporting(false);
    }
  }

  async function importMockSkus() {
    setIsImporting(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.set("source", "mock");
      formData.set("mode", importMode);

      const response = await fetch("/api/skus/import", {
        method: "POST",
        body: formData
      });
      const data = (await response.json()) as { imported?: number; error?: string };
      if (!response.ok) {
        throw new Error(data.error || COPY.importMockFailed);
      }

      setStatus(`${COPY.importSuccessPrefix}${data.imported || 0}${COPY.importSuccessSuffix}`);
      await loadItems();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : COPY.importMockFailed);
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <section className="grid">
      <div className="panel">
        <div className="panel-inner">
          <h2 className="section-title">{COPY.title}</h2>
          <p className="section-copy">{COPY.description}</p>

          <div className="hint-row" style={{ marginBottom: 18 }}>
            <span className="hint-chip">{source === "database" ? COPY.sourceDb : COPY.sourceMock}</span>
            <span className="hint-chip">
              {COPY.countPrefix}
              {items.length}
              {COPY.countSuffix}
            </span>
          </div>
          <p className="field-note" style={{ marginTop: -8, marginBottom: 18 }}>
            {COPY.sourceHint}
          </p>

          <div className="agent-form">
            <label>
              <span className="label">{COPY.qLabel}</span>
              <input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={COPY.qPlaceholder} />
            </label>

            <label>
              <span className="label">{COPY.colorLabel}</span>
              <div className="select-wrap">
                <select className="select" value={color} onChange={(event) => setColor(event.target.value)}>
                  <option value="">{COPY.all}</option>
                  {colorOptions.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </div>
            </label>

            <label>
              <span className="label">{COPY.opacityLabel}</span>
              <div className="select-wrap">
                <select className="select" value={opacity} onChange={(event) => setOpacity(event.target.value)}>
                  <option value="">{COPY.all}</option>
                  {opacityOptions.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </div>
            </label>

            <label>
              <span className="label">{COPY.typeLabel}</span>
              <div className="select-wrap">
                <select className="select" value={productType} onChange={(event) => setProductType(event.target.value)}>
                  <option value="">{COPY.all}</option>
                  {typeOptions.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </div>
            </label>

            <label>
              <span className="label">{COPY.windowTypeLabel}</span>
              <div className="select-wrap">
                <select className="select" value={windowType} onChange={(event) => setWindowType(event.target.value)}>
                  <option value="">{COPY.all}</option>
                  {windowTypeOptions.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </div>
            </label>

            <div className="actions">
              <button className="button button-secondary" type="button" onClick={() => void loadItems()}>
                {isLoading ? COPY.loading : COPY.refresh}
              </button>
            </div>
          </div>
          <p className="field-note" style={{ marginTop: 12 }}>
            {COPY.filterHint}
          </p>

          <div className="panel" style={{ marginTop: 20 }}>
            <div className="panel-inner">
              <h3 className="section-title" style={{ fontSize: "1.05rem" }}>{COPY.importTitle}</h3>
              <p className="section-copy">{COPY.importDescription}</p>

              <form className="agent-form" onSubmit={(event) => void handleImport(event)}>
                <label>
                  <span className="label">导入模式</span>
                  <div className="select-wrap">
                    <select className="select" value={importMode} onChange={(event) => setImportMode(event.target.value)}>
                      <option value="replace">{COPY.replaceMode}</option>
                      <option value="upsert">{COPY.upsertMode}</option>
                    </select>
                  </div>
                </label>

                <label>
                  <span className="label">{COPY.chooseFile}</span>
                  <input className="input" type="file" accept=".json,.csv" onChange={(event) => setImportFile(event.target.files?.[0] || null)} />
                </label>

                <div className="actions">
                  <button className="button" type="submit" disabled={isImporting}>
                    {isImporting ? COPY.importing : COPY.importButton}
                  </button>
                  <button className="button button-secondary" type="button" onClick={() => void importMockSkus()} disabled={isImporting}>
                    {isImporting ? COPY.importing : COPY.importMockButton}
                  </button>
                </div>
              </form>
            </div>
          </div>

          <div className="status-box" style={{ marginTop: 20 }}>
            <strong>{COPY.statusLabel}</strong>
            <span>{status}</span>
          </div>

          {error ? (
            <div className="status-box" style={{ marginTop: 12, borderColor: "#d66", color: "#8a3b2c" }}>
              <strong>{COPY.errorLabel}</strong>
              <span>{error}</span>
            </div>
          ) : null}

          <div className="sku-grid" style={{ marginTop: 22 }}>
            {items.length === 0 ? (
              <div className="meta-card">
                <dd>{COPY.empty}</dd>
              </div>
            ) : (
              items.map((item) => (
                <article key={item.sku_id} className="sku-card">
                  {item.image_url ? (
                    <img className="sku-image" src={item.image_url} alt={item.name} />
                  ) : (
                    <div className="sku-image sku-image-empty">{COPY.noImage}</div>
                  )}
                  <h3>{item.name}</h3>
                  <p>{COPY.skuPrefix}{item.sku_id}</p>
                  <p>{COPY.sourceLabel}{item.source || "-"}</p>
                  <p>{COPY.opacityPrefix}{item.opacity || "-"}</p>
                  <p>{COPY.stylePrefix}{item.style_tags || "-"}</p>
                  <p>{COPY.windowPrefix}{item.window_types || "-"}</p>
                  <p>{COPY.usagePrefix}{item.usage_note || "-"}</p>
                  <div className="actions" style={{ marginTop: 12 }}>
                    {item.page_url ? (
                      <a className="button button-secondary" href={item.page_url} target="_blank" rel="noreferrer">
                        {COPY.openPage}
                      </a>
                    ) : null}
                  </div>
                </article>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
