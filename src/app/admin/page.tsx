import Icon from "@/components/royalzen/icon";
import IntentPrefetchLink from "@/components/royalzen/intent-prefetch-link";
import { requireOrganizationAdminMfa } from "@/lib/auth";
import { getAdminOverview } from "@/lib/platform-db";

export const dynamic = "force-dynamic";

export default async function AdminHomePage() {
  const actor = await requireOrganizationAdminMfa();
  const overview = await getAdminOverview(actor);
  const metrics = [
    { label: "机构员工", value: String(overview.members).padStart(2, "0"), note: "受邀账号与管理员" },
    { label: "可推荐 SKU", value: String(overview.skus).padStart(2, "0"), note: "真实数据库商品" },
    { label: "本月咨询", value: String(overview.consultations).padStart(2, "0"), note: `${overview.generations} 次图片生成` },
    { label: "知识与面料", value: String(overview.knowledgeDocs + overview.fabrics).padStart(2, "0"), note: `${overview.knowledgeDocs} 条知识 · ${overview.fabrics} 种面料` }
  ];
  return <div className="rz-admin-page"><header className="rz-admin-heading"><div><span className="rz-eyebrow">{actor.organizationName.toUpperCase()}</span><h1>机构概览</h1><p>管理员工权限、商品资产、知识库和 AI 使用情况。</p></div><IntentPrefetchLink className="rz-button rz-button-secondary" href="/admin/team"><Icon name="users" size={17} />管理团队</IntentPrefetchLink></header><section className="rz-admin-metrics">{metrics.map((metric) => <article key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.note}</small></article>)}</section><div className="rz-admin-grid"><section><div className="rz-section-head"><div><span className="rz-eyebrow">DATA READINESS</span><h2>业务数据状态</h2></div><IntentPrefetchLink className="rz-text-link" href="/admin/skus">查看 SKU</IntentPrefetchLink></div><div className="rz-readiness-list"><div><span>商品 SKU</span><strong>{overview.skus}</strong><i><b style={{ width: overview.skus ? "100%" : "0%" }} /></i></div><div><span>领域知识</span><strong>{overview.knowledgeDocs}</strong><i><b style={{ width: `${Math.min(100, overview.knowledgeDocs * 8)}%` }} /></i></div><div><span>面料素材</span><strong>{overview.fabrics}</strong><i><b style={{ width: `${Math.min(100, overview.fabrics * 10)}%` }} /></i></div></div></section><section><div className="rz-section-head"><div><span className="rz-eyebrow">OPERATIONS</span><h2>需要处理</h2></div></div><div className="rz-admin-tasks"><IntentPrefetchLink href="/admin/fabrics"><span>{String(overview.fabrics).padStart(2, "0")}</span><div><strong>继续完善面料资料</strong><small>补齐成分、克重、遮光率和色卡</small></div><Icon name="chevron" size={16} /></IntentPrefetchLink><IntentPrefetchLink href="/admin/history"><span>{String(overview.failures).padStart(2, "0")}</span><div><strong>最近 24 小时失败任务</strong><small>查看模型错误和重试记录</small></div><Icon name="chevron" size={16} /></IntentPrefetchLink><IntentPrefetchLink href="/admin/team"><span>{String(overview.members).padStart(2, "0")}</span><div><strong>团队成员与权限</strong><small>邀请顾问并分配机构角色</small></div><Icon name="chevron" size={16} /></IntentPrefetchLink></div></section></div></div>;
}
