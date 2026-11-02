import Link from "next/link";
import Icon from "@/components/royalzen/icon";
import { getCurrentActor } from "@/lib/auth";
import { hasOrganizationAdminAccess } from "@/lib/organization-role";
import { getDashboard, type ConsultationRecord } from "@/lib/platform-db";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  draft: "咨询草稿",
  analyzing: "正在分析",
  recommended: "商品已推荐",
  generating: "正在生成",
  ready: "生成完成",
  shared: "等待客户确认",
  archived: "已归档",
  failed: "需要重试"
};

function getImage(item: ConsultationRecord) {
  return item.resultImageUrl || item.sceneImageUrl || "/demo/scene-bay-window.jpg";
}

function relativeTime(iso: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`;
  return `${Math.floor(minutes / 1440)} 天前`;
}

export default async function AdvisorDashboard() {
  const actor = await getCurrentActor();
  const dashboard = await getDashboard(actor);
  const today = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date());

  return (
    <div className="rz-page rz-dashboard">
      <section className="rz-dashboard-hero">
        <div><span className="rz-eyebrow">{today}</span><h1>你好，{actor.displayName}。</h1><p>{dashboard.metrics.awaitingFeedback ? `有 ${dashboard.metrics.awaitingFeedback} 个方案等待客户确认。` : "可以从一张客户房间照片开始新的咨询。"}</p></div>
        <Link className="rz-button rz-button-primary" href="/app/consultations/new"><Icon name="plus" size={18} /> 新建客户咨询</Link>
        <div className="rz-hero-metrics" aria-label="今日概览"><div><strong>{String(dashboard.metrics.weekly).padStart(2, "0")}</strong><span>本周咨询</span></div><div><strong>{String(dashboard.metrics.completed).padStart(2, "0")}</strong><span>完成方案</span></div><div><strong>{String(dashboard.metrics.awaitingFeedback).padStart(2, "0")}</strong><span>等待反馈</span></div></div>
      </section>

      <section className="rz-workflow-strip" aria-label="咨询流程"><span className="rz-workflow-label">一次咨询</span>{["上传空间", "分析窗型", "匹配商品", "生成预览", "分享客户"].map((label, index) => <div className="rz-workflow-step" key={label}><span>{String(index + 1).padStart(2, "0")}</span><strong>{label}</strong>{index < 4 ? <Icon name="arrow" size={16} /> : null}</div>)}</section>

      <div className="rz-dashboard-grid">
        <section className="rz-dashboard-main"><div className="rz-section-head"><div><span className="rz-eyebrow">RECENT</span><h2>最近咨询</h2></div><Link className="rz-text-link" href="/app/history">查看全部 <Icon name="arrow" size={15} /></Link></div>
          {dashboard.recent.length ? <div className="rz-consultation-list">{dashboard.recent.map((item) => <Link className="rz-consultation-row" href={`/app/consultations/${item.displayCode}`} key={item.id} prefetch={false}><span className="rz-consultation-image"><img alt={item.roomType || "客户空间"} src={getImage(item)} /></span><span className="rz-consultation-copy"><small>{item.displayCode}</small><strong>{item.clientName}</strong><span>{item.roomType || "待分析房间"} · {String(item.sceneAnalysis.windowType || "待判断窗型")}</span></span><span className="rz-consultation-state"><i />{STATUS_LABELS[item.status] || item.status}</span><span className="rz-consultation-time">{relativeTime(item.updatedAt)}</span><Icon name="chevron" size={18} /></Link>)}</div> : <div className="rz-empty-state"><Icon name="spark" size={24} /><strong>还没有真实咨询记录</strong><p>创建第一条咨询后，场景图、推荐和效果图会显示在这里。</p><Link href="/app/consultations/new">开始第一条咨询</Link></div>}
        </section>

        <aside className="rz-dashboard-aside"><div className="rz-section-head"><div><span className="rz-eyebrow">NEXT</span><h2>待处理</h2></div></div><div className="rz-task-list">{dashboard.recent.filter((item) => item.status === "draft" || item.status === "failed" || item.status === "shared").slice(0, 3).map((item, index) => <Link href={`/app/consultations/${item.displayCode}`} key={item.id} prefetch={false}><span className="rz-task-index">0{index + 1}</span><span><strong>{item.clientName} · {STATUS_LABELS[item.status]}</strong><small>{relativeTime(item.updatedAt)}</small></span><Icon name="chevron" size={16} /></Link>)}</div><div className="rz-service-note"><div><span className="rz-status-dot" /><strong>核心服务已连接</strong></div><p>Supabase、R2、推荐模型和 Seedream 由健康检查持续验证。</p>{hasOrganizationAdminAccess(actor.role) ? <Link href="/admin/history" prefetch={false}>查看任务状态</Link> : null}</div></aside>
      </div>
    </div>
  );
}
