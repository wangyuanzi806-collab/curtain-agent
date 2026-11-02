import Link from "next/link";
import SkuCatalogManager from "@/components/sku-catalog-manager";

const COPY = {
  eyebrow: "SKU Catalog",
  title: "先做一个简单的商品列表和导入口",
  subtitle:
    "这一版先把 SKU 当成轻量商品清单来管理。你可以先梳理商品、查看标签，再慢慢替换成真实的公司商品库。",
  back: "返回工作台",
  history: "查看历史记录"
} as const;

export default function SkuPage() {
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
        </div>
      </section>
      <SkuCatalogManager />
    </main>
  );
}
