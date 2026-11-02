import Link from "next/link";
import HistoryList, { type HistoryItem } from "@/components/royalzen/history-list";
import Icon from "@/components/royalzen/icon";
import { getCurrentActor } from "@/lib/auth";
import { canDeleteConsultation, hasOrganizationAdminAccess } from "@/lib/organization-role";
import { listConsultations } from "@/lib/platform-db";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  analyzing: "正在分析",
  recommended: "等待生成",
  generating: "正在生成",
  ready: "方案已完成",
  shared: "等待客户确认",
  archived: "已归档",
  failed: "需要重试"
};

export default async function HistoryPage() {
  const actor = await getCurrentActor();
  const items = await listConsultations(actor, 50);
  // 日期在服务端格式化：交给客户端会按访客所在时区再算一次，
  // 同一条咨询在门店平板和顾问手机上显示成两个时间
  const rows: HistoryItem[] = items.map((item) => ({
    id: item.id,
    displayCode: item.displayCode,
    clientName: item.clientName,
    roomType: item.roomType || "",
    windowType: String(item.sceneAnalysis.windowType || "待判断窗型"),
    skuName: String(item.selectedSkuSnapshot.name || "尚未选择商品"),
    status: item.status,
    statusLabel: STATUS_LABELS[item.status] || item.status,
    updatedAt: new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(item.updatedAt)
    ),
    coverUrl: item.resultImageUrl || item.sceneImageUrl || "/demo/scene-bay-window.jpg"
  }));

  return (
    <div className="rz-page">
      <header className="rz-page-heading"><div><span className="rz-eyebrow">CONSULTATION HISTORY</span><h1>历史咨询</h1><p>客户需求、AI 推荐、效果图和顾问反馈保存在同一条真实咨询记录中。</p></div><Link className="rz-button rz-button-primary" href="/app/consultations/new"><Icon name="plus" size={17} />新建咨询</Link></header>
      {rows.length ? <HistoryList canDelete={canDeleteConsultation(actor.role)} items={rows} /> : <div className="rz-empty-state"><Icon name="history" size={24} /><strong>还没有咨询记录</strong><p>完成一次空间上传后，草稿就会自动保存在这里。</p><Link href="/app/consultations/new">新建咨询</Link></div>}
      <div className="rz-history-archive"><span>当前显示最近 {rows.length} 项，最多 50 项</span>{hasOrganizationAdminAccess(actor.role) ? <Link href="/admin/history">查看底层生成任务 <Icon name="arrow" size={15} /></Link> : null}</div>
    </div>
  );
}
