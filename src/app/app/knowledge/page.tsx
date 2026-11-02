import Link from "next/link";
import Icon from "@/components/royalzen/icon";
import { getCurrentActor } from "@/lib/auth";
import { getCachedKnowledgeDocs } from "@/lib/catalog-cache";
import { hasOrganizationAdminAccess } from "@/lib/organization-role";

export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const actor = await getCurrentActor();
  const articles = await getCachedKnowledgeDocs(100).catch(() => []);
  return <div className="rz-page"><header className="rz-page-heading"><div><span className="rz-eyebrow">KNOWLEDGE BASE</span><h1>搭配知识</h1><p>AI 推荐实际使用的窗型、配色、遮光和销售沟通规则。</p></div>{hasOrganizationAdminAccess(actor.role) ? <Link className="rz-button rz-button-secondary" href="/admin/knowledge"><Icon name="settings" size={17} />管理知识库</Link> : null}</header><div className="rz-knowledge-layout"><aside><span className="rz-eyebrow">DOMAINS</span><h2>让推荐来自真实经验，而不是模型自由发挥。</h2><p>知识条目会参与推荐解释，但不能覆盖 SKU 的人工确认字段。</p><dl><div><dt>已启用条目</dt><dd>{String(articles.length).padStart(2, "0")}</dd></div><div><dt>数据来源</dt><dd>Supabase</dd></div></dl></aside>{articles.length ? <div className="rz-article-list">{articles.map((article, index) => <article key={article.id}><span>KB {String(index + 1).padStart(2, "0")}</span><div><small>{article.category}</small><h3>{article.title}</h3><p>{article.content.length > 180 ? `${article.content.slice(0, 180)}...` : article.content}</p></div><span aria-label="知识条目"><Icon name="knowledge" size={18} /></span></article>)}</div> : <div className="rz-empty-state"><Icon name="knowledge" size={24} /><strong>知识库还没有内容</strong><p>从后台导入窗型、材质和配色规则后，AI 推荐会自动引用。</p>{hasOrganizationAdminAccess(actor.role) ? <Link href="/admin/knowledge">导入知识</Link> : null}</div>}</div></div>;
}
