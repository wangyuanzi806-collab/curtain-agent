import Link from "next/link";
import { notFound } from "next/navigation";
import ConsultationGallery from "@/components/royalzen/consultation-gallery";
import ShareButton from "@/components/royalzen/share-button";
import type { SkuReason } from "@/lib/agent-provider";
import { getCurrentActor } from "@/lib/auth";
import { describeSurvey, type SurveyAnswers } from "@/lib/curtain-survey";
import { getConsultation } from "@/lib/platform-db";
import { PATTERN_LABELS } from "@/lib/sku-catalog";
import { listSessionsForConsultation } from "@/lib/voice-sessions";

const MATERIAL_LABELS: Record<string, string> = {
  cotton_linen: "棉麻",
  wool: "羊毛",
  viscose_soft: "柔垂",
  polyester_smooth: "顺滑",
  blend: "混纺"
};

export const dynamic = "force-dynamic";

export default async function ConsultationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getCurrentActor();
  const item = await getConsultation(actor, id);
  if (!item) notFound();
  const sku = item.selectedSkuSnapshot;
  const sceneImage = item.sceneImageUrl || "/demo/scene-bay-window.jpg";
  const skuImage = String(sku.image_url || sku.local_image || "/demo/curtain-beige.jpg");
  const recommendation = item.recommendation;

  // 没生成效果图时不放「AI 搭配预览」这一格：它会与「客户原始空间」是同一张图，
  // 顾问点来点去发现三个缩略图里有两个一模一样
  const galleryImages = [
    ...(item.resultImageUrl ? [{ src: item.resultImageUrl, label: "AI 搭配预览" }] : []),
    { src: sceneImage, label: "客户原始空间" },
    { src: skuImage, label: "窗帘商品" }
  ];

  // 只显示有实际内容的字段。此前直接拼 sku.color + sku.opacity，
  // 而遮光是有意留空的，详情页于是印出「gray · unspecified」给顾问看。
  const skuFacts = [
    PATTERN_LABELS[String(sku.pattern_level || "")] || "",
    MATERIAL_LABELS[String(sku.material_class || "")] || "",
    sku.weight_gsm ? `${Math.round(Number(sku.weight_gsm))}g/m²` : ""
  ].filter(Boolean);

  // 客户答的六题。原先这里回显的是 style / desiredColor / opacityNeed 三个
  // 表单占位符，客户没填时就退化成「自动搭配」「采光与隐私」这类空话。
  const answers = item.preferences.survey
    ? describeSurvey(item.preferences.survey as SurveyAnswers)
    : {};
  const answerTags = Object.entries(answers)
    .filter(([key]) => key !== "补充说明")
    .map(([, text]) => text);

  /**
   * 选中那一款的推荐理由。
   *
   * 这一栏此前读的是 `recommendation.summary`——而它在提示词里的定义是
   * "one or two sentences **about the room**"，是房间描述，不是选品理由。
   * 标题写着「为什么推荐这款」，底下印的却是"这是一间现代风格的客厅…"。
   * 真正的理由一直在 sku_reasons 里躺着，没人读它。
   */
  const skuReasons = (recommendation.sku_reasons as SkuReason[] | undefined) || [];
  const pickedReason =
    skuReasons.find((entry) => entry.sku_id === item.selectedSkuId) || skuReasons[0] || null;
  const roomSummary = String(item.sceneAnalysis.summary || recommendation.summary || "");

  /**
   * 门店语音聊过的那几场。
   *
   * 咨询单是**结果**（照片、推荐、效果图），会话是**过程**（顾客说了什么、
   * 指了什么）。跟线索的人最需要的恰恰是过程里那句「要给儿童房换个厚一点的」——
   * 以前它只活在店员手机的内存里，关掉页面就没了，这里是它唯一的去处。
   */
  const sessions = await listSessionsForConsultation(actor, item.id);
  const roleLabel: Record<string, string> = { user: "顾客", assistant: "DRAPÉ", tool: "系统" };

  return (
    <div className="rz-page rz-detail-page">
      <header className="rz-detail-heading"><div><Link className="rz-back-link" href="/app/history"><span>←</span> 历史咨询</Link><span className="rz-eyebrow">{item.displayCode}</span><h1>{item.clientName} 的{item.roomType || "空间"}方案</h1><p>创建于 {new Intl.DateTimeFormat("zh-CN", { dateStyle: "long", timeStyle: "short" }).format(new Date(item.createdAt))} · 顾问 {item.advisorName}</p></div><div><Link className="rz-button rz-button-secondary" href="/app/consultations/new">新建方案</Link><ShareButton consultationId={item.id} /></div></header>
      <div className="rz-detail-layout"><section className="rz-detail-visual"><ConsultationGallery images={galleryImages} /></section>
        <aside className="rz-detail-panel"><div className="rz-detail-status"><span className="rz-status-dot" /><strong>{item.status === "shared" ? "方案等待客户确认" : item.status === "ready" ? "方案已生成" : "咨询仍在进行"}</strong><small>最后更新于 {new Intl.DateTimeFormat("zh-CN", { timeStyle: "short" }).format(new Date(item.updatedAt))}</small></div><section><span className="rz-eyebrow">ROYALZEN 首选</span><h2>{String(sku.name || "尚未选择商品")}</h2>{skuFacts.length ? <p>{skuFacts.join(" · ")}</p> : null}<div className="rz-selected-product"><img alt={String(sku.name || "窗帘商品")} src={skuImage} /></div></section><section><h3>为什么推荐这款</h3>{pickedReason ? <div className="rz-detail-reason"><p>{pickedReason.why}</p>{pickedReason.evidence ? <small>{pickedReason.evidence}</small> : null}{pickedReason.matched?.length ? <em>符合你的选择：{pickedReason.matched.join(" · ")}</em> : null}{pickedReason.caveat ? <em className="is-caveat">需要注意：{pickedReason.caveat}</em> : null}</div> : <p>{String(recommendation.reasoning || "推荐解释将在 AI 匹配完成后显示。")}</p>}<div className="rz-tag-row"><span>{String(item.sceneAnalysis.windowType || "窗型适配")}</span>{answerTags.length ? answerTags.map((tag) => <span key={tag}>{tag}</span>) : <span>按房间配色自动搭配</span>}</div></section><dl className="rz-detail-facts"><div><dt>房间</dt><dd>{item.roomType || "待分析"}</dd></div><div><dt>窗型</dt><dd>{String(item.sceneAnalysis.windowType || "待判断")}</dd></div><div><dt>客户补充</dt><dd>{String(answers["补充说明"] || "未填写")}</dd></div><div><dt>生成档位</dt><dd>{item.qualityTier === "fast" ? "快速" : item.qualityTier === "quality" ? "精细" : "均衡"}</dd></div>{roomSummary ? <div className="rz-detail-full"><dt>空间描述</dt><dd>{roomSummary}</dd></div> : null}</dl><div className="rz-detail-actions"><Link href="/app/consultations/new">重新开始一份方案</Link></div></aside>
      </div>
      {sessions.length ? (
        <section className="rz-voice-log">
          <h2>门店语音记录</h2>
          <p className="rz-voice-log-lead">
            这条线索在门店里聊过 {sessions.length} 次。顾客自己的话比任何摘要都准，
            跟进前先读一遍。
          </p>
          {sessions.map((session, index) => (
            <article className="rz-voice-log-session" key={session.id}>
              <header>
                <strong>第 {index + 1} 次 · {session.source === "backoffice" ? "后台跟进" : "门店"}</strong>
                <span>
                  {new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(
                    new Date(session.startedAt)
                  )}
                </span>
              </header>
              {session.taps.length ? (
                <p className="rz-voice-log-taps">
                  他在屏幕上指了：{session.taps.map((tap) => tap.label).join("、")}
                </p>
              ) : null}
              {session.transcript.length ? (
                <ol className="rz-voice-log-turns">
                  {session.transcript
                    .filter((turn) => turn.role !== "tool")
                    .map((turn, turnIndex) => (
                      <li className={`is-${turn.role}`} key={`${session.id}-${turnIndex}`}>
                        <b>{roleLabel[turn.role] ?? turn.role}</b>
                        <span>{turn.text}</span>
                      </li>
                    ))}
                </ol>
              ) : (
                <p className="rz-voice-log-empty">这一次没有留下对话。</p>
              )}
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}
