import Link from "next/link";
import KnowledgeBaseManager from "@/components/knowledge-base-manager";

const COPY = {
  eyebrow: "Knowledge Base",
  title: "先把窗帘领域知识沉淀下来，再让智能体参考知识推荐商品",
  subtitle:
    "这一页先做轻量知识库，适合整理配色原则、场景经验、安装边界和销售话术。智能体推荐商品时会优先参考这里的内容。",
  back: "返回工作台",
  history: "查看历史记录",
  skus: "查看 SKU 列表"
} as const;

export default function KnowledgePage() {
  return (
    <main className="shell">
      <section className="hero">
        <div className="eyebrow">{COPY.eyebrow}</div>
        <h1 className="title">{COPY.title}</h1>
        <p className="subtitle">{COPY.subtitle}</p>
        <div className="actions hero-actions">
          <Link className="button button-secondary" href="/">
            {COPY.back}
          </Link>
          <Link className="button button-secondary" href="/history">
            {COPY.history}
          </Link>
          <Link className="button button-secondary" href="/skus">
            {COPY.skus}
          </Link>
        </div>
      </section>
      <KnowledgeBaseManager />
    </main>
  );
}
