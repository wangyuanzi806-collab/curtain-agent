import Link from "next/link";
import Icon from "@/components/royalzen/icon";
import { requirePlatformAdministrator } from "@/lib/auth";
import LanguageToggle from "@/components/royalzen/language-toggle";

export const dynamic = "force-dynamic";

export default async function PlatformPage() {
  await requirePlatformAdministrator();
  return (
    <main className="rz-platform-page">
      <header><Link className="rz-brand" href="/app"><span className="rz-brand-mark">RZ</span><span><strong>RoyalZen</strong><small>PLATFORM CONTROL</small></span></Link><div className="rz-platform-actions"><LanguageToggle compact /><Link href="/app">返回顾问工作台</Link></div></header>
      <section className="rz-platform-hero"><span className="rz-eyebrow">PLATFORM ADMINISTRATION</span><h1>平台管理</h1><p>仅平台管理员可见，用于管理机构、AI 模型、额度、异常任务和全局审计。</p></section>
      <div className="rz-platform-grid"><Link href="/admin"><Icon name="building" /><span><small>12</small><strong>机构管理</strong><p>创建机构、停用账号和查看数据隔离状态。</p></span></Link><Link href="/admin/history"><Icon name="chart" /><span><small>98.6%</small><strong>AI 任务</strong><p>查看成功率、耗时、失败原因和调用成本。</p></span></Link><Link href="/admin"><Icon name="users" /><span><small>34</small><strong>平台账号</strong><p>管理平台管理员和机构管理员授权。</p></span></Link></div>
    </main>
  );
}
