"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type KnowledgeItem = {
  id: string;
  title: string;
  category: string;
  tags: string;
  content: string;
  source: string;
  createdAt: string;
  updatedAt: string;
  score?: number;
  excerpt?: string;
};

const COPY = {
  title: "知识库",
  description:
    "这里可以先维护一版轻量知识库，沉淀窗帘推荐规则、配色原则、房间场景经验和安装边界。智能体推荐商品时会优先参考这些知识。",
  searchLabel: "关键词",
  searchPlaceholder: "搜索标题、分类、标签或内容",
  categoryLabel: "分类",
  tagLabel: "标签",
  all: "全部",
  refresh: "刷新列表",
  loading: "加载中...",
  countPrefix: "共 ",
  countSuffix: " 条知识",
  empty: "当前还没有知识条目，可以先导入示例知识库，或者手动新增一条。",
  addTitle: "新增知识",
  addDescription: "先支持最简单的知识录入，后面如果你们有标准字段，我们再按内部结构定制。",
  importTitle: "导入知识库",
  importDescription: "支持 JSON 文件导入，也可以一键导入当前示例知识库。",
  titleLabel: "知识标题",
  titlePlaceholder: "例如：卧室推荐双层窗帘的场景边界",
  categoryPlaceholder: "例如：bedroom / color_matching / installation",
  tagsPlaceholder: "例如：卧室, 双层, 遮光, 奶油风",
  contentLabel: "知识内容",
  contentPlaceholder:
    "例如：卧室优先考虑遮光和睡眠质量，如果客户还强调白天柔光，优先推荐双层方案。",
  sourceLabel: "来源",
  sourcePlaceholder: "例如：公司经验 / 培训手册 / 设计团队总结",
  addButton: "新增知识",
  adding: "新增中...",
  chooseFile: "选择知识库文件",
  importButton: "导入文件",
  importSampleButton: "导入示例知识库",
  importing: "导入中...",
  replaceMode: "替换当前知识库",
  upsertMode: "按 id 覆盖 / 新增",
  statusIdle: "你可以先查看知识库，也可以直接新增或导入。",
  addSuccess: "知识已加入知识库。",
  importSuccessPrefix: "导入成功，共导入 ",
  importSuccessSuffix: " 条知识。",
  openMore: "展开全文",
  updatedPrefix: "更新时间：",
  readFailed: "读取知识库失败。",
  addFailed: "新增知识失败。",
  importFailed: "导入知识库失败。",
  fillRequired: "请至少填写知识标题和知识内容。",
  chooseFileFirst: "请先选择一个知识库文件。"
} as const;

export default function KnowledgeBaseManager() {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [tag, setTag] = useState("");
  const [title, setTitle] = useState("");
  const [manualCategory, setManualCategory] = useState("");
  const [tags, setTags] = useState("");
  const [content, setContent] = useState("");
  const [source, setSource] = useState("Manual");
  const [importMode, setImportMode] = useState("replace");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [status, setStatus] = useState<string>(COPY.statusIdle);
  const [error, setError] = useState<string | null>(null);

  const categoryOptions = useMemo(
    () => Array.from(new Set(items.map((item) => item.category).filter(Boolean))).sort(),
    [items]
  );

  const loadItems = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const url = new URL("/api/knowledge", window.location.origin);
      if (query.trim()) url.searchParams.set("q", query.trim());
      if (category) url.searchParams.set("category", category);
      if (tag.trim()) url.searchParams.set("tag", tag.trim());
      url.searchParams.set("limit", "200");

      const response = await fetch(url.toString(), { cache: "no-store" });
      const data = (await response.json()) as {
        items?: KnowledgeItem[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || COPY.readFailed);
      }

      setItems(data.items || []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : COPY.readFailed);
    } finally {
      setIsLoading(false);
    }
  }, [category, query, tag]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !content.trim()) {
      setError(COPY.fillRequired);
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/knowledge", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          title,
          category: manualCategory,
          tags,
          content,
          source
        })
      });

      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || COPY.addFailed);
      }

      setTitle("");
      setManualCategory("");
      setTags("");
      setContent("");
      setSource("Manual");
      setStatus(COPY.addSuccess);
      await loadItems();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : COPY.addFailed);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleImport(sourceMode: "file" | "sample") {
    if (sourceMode === "file" && !importFile) {
      setError(COPY.chooseFileFirst);
      return;
    }

    setIsImporting(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.set("mode", importMode);
      if (sourceMode === "sample") {
        formData.set("source", "sample");
      } else if (importFile) {
        formData.set("file", importFile);
      }

      const response = await fetch("/api/knowledge/import", {
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

  return (
    <section className="grid">
      <div className="panel">
        <div className="panel-inner">
          <h2 className="section-title">{COPY.title}</h2>
          <p className="section-copy">{COPY.description}</p>

          <div className="hint-row" style={{ marginBottom: 18 }}>
            <span className="hint-chip">
              {COPY.countPrefix}
              {items.length}
              {COPY.countSuffix}
            </span>
          </div>

          <div className="agent-form">
            <label>
              <span className="label">{COPY.searchLabel}</span>
              <input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={COPY.searchPlaceholder} />
            </label>

            <label>
              <span className="label">{COPY.categoryLabel}</span>
              <div className="select-wrap">
                <select className="select" value={category} onChange={(event) => setCategory(event.target.value)}>
                  <option value="">{COPY.all}</option>
                  {categoryOptions.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </div>
            </label>

            <label className="agent-wide">
              <span className="label">{COPY.tagLabel}</span>
              <input className="input" value={tag} onChange={(event) => setTag(event.target.value)} placeholder={COPY.tagsPlaceholder} />
            </label>
          </div>

          <div className="actions" style={{ marginTop: 16 }}>
            <button className="button button-secondary" type="button" onClick={() => void loadItems()}>
              {isLoading ? COPY.loading : COPY.refresh}
            </button>
          </div>

          <div className={`status ${error ? "status-error" : "status-ok"}`} style={{ marginTop: 12 }}>
            {error ? error : status}
          </div>

          <div className="knowledge-grid">
            {items.length === 0 ? (
              <div className="result-empty">{COPY.empty}</div>
            ) : (
              items.map((item) => (
                <article key={item.id} className="knowledge-card">
                  <div className="hint-row">
                    <span className="hint-chip">{item.category}</span>
                    <span className="hint-chip">{item.source}</span>
                  </div>
                  <h3>{item.title}</h3>
                  <p className="knowledge-tags">{item.tags || "-"}</p>
                  <p>{item.excerpt || item.content}</p>
                  <details>
                    <summary>{COPY.openMore}</summary>
                    <p>{item.content}</p>
                  </details>
                  <p className="small">
                    {COPY.updatedPrefix}
                    {new Date(item.updatedAt).toLocaleString("zh-CN")}
                  </p>
                </article>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-inner">
          <h2 className="section-title">{COPY.addTitle}</h2>
          <p className="section-copy">{COPY.addDescription}</p>

          <form className="form-grid" onSubmit={handleAdd}>
            <label>
              <span className="label">{COPY.titleLabel}</span>
              <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder={COPY.titlePlaceholder} />
            </label>

            <label>
              <span className="label">{COPY.categoryLabel}</span>
              <input className="input" value={manualCategory} onChange={(event) => setManualCategory(event.target.value)} placeholder={COPY.categoryPlaceholder} />
            </label>

            <label>
              <span className="label">{COPY.tagLabel}</span>
              <input className="input" value={tags} onChange={(event) => setTags(event.target.value)} placeholder={COPY.tagsPlaceholder} />
            </label>

            <label>
              <span className="label">{COPY.sourceLabel}</span>
              <input className="input" value={source} onChange={(event) => setSource(event.target.value)} placeholder={COPY.sourcePlaceholder} />
            </label>

            <label className="agent-wide">
              <span className="label">{COPY.contentLabel}</span>
              <textarea className="textarea" value={content} onChange={(event) => setContent(event.target.value)} placeholder={COPY.contentPlaceholder} />
            </label>

            <div className="actions">
              <button className="button" type="submit" disabled={isSubmitting}>
                {isSubmitting ? COPY.adding : COPY.addButton}
              </button>
            </div>
          </form>

          <div style={{ height: 20 }} />

          <h2 className="section-title">{COPY.importTitle}</h2>
          <p className="section-copy">{COPY.importDescription}</p>

          <div className="form-grid">
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
              <input className="input" type="file" accept=".json,.txt,.md" onChange={(event) => setImportFile(event.target.files?.[0] || null)} />
            </label>

            <div className="actions">
              <button className="button" type="button" onClick={() => void handleImport("file")} disabled={isImporting}>
                {isImporting ? COPY.importing : COPY.importButton}
              </button>
              <button className="button button-secondary" type="button" onClick={() => void handleImport("sample")} disabled={isImporting}>
                {COPY.importSampleButton}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
