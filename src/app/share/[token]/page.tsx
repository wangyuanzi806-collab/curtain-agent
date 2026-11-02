import Link from "next/link";
import { notFound } from "next/navigation";
import type { SkuReason } from "@/lib/agent-provider";
import { describeSurvey, type SurveyAnswers } from "@/lib/curtain-survey";
import { getSharedConsultation } from "@/lib/platform-db";
import LanguageToggle from "@/components/royalzen/language-toggle";

export const dynamic = "force-dynamic";

export default async function CustomerSharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const item = await getSharedConsultation(token);
  if (!item) notFound();
  const sku = item.selectedSkuSnapshot;
  const recommendation = item.recommendation;

  /**
   * 这一页是客户最后拿到手的东西，两处都在拿占位符充数：
   *   顾问寄语  读的是 recommendation.reasoning，而真正的选品理由在 sku_reasons 里
   *   三个标签  读的是 preferences.style / opacityNeed，那是表单占位符——
   *             客户没填时就印出"自动配色""兼顾采光与隐私"这种谁都能说的话
   * 改成客户自己答的题和这一款真实的推荐理由。
   */
  const skuReasons = (recommendation.sku_reasons as SkuReason[] | undefined) || [];
  const pickedReason =
    skuReasons.find((entry) => entry.sku_id === String(sku.sku_id || "")) || skuReasons[0] || null;
  const answers = item.preferences.survey
    ? describeSurvey(item.preferences.survey as SurveyAnswers)
    : {};
  const answerTags = Object.entries(answers)
    .filter(([key]) => key !== "补充说明")
    .map(([, text]) => text)
    .slice(0, 3);

  return <main className="rz-share-page"><header className="rz-share-nav"><Link className="rz-brand" href={`/share/${token}`}><span className="rz-brand-mark">RZ</span><span><strong>RoyalZen</strong><small>CURTAIN ADVISOR</small></span></Link><div><span>为 {item.clientName} 准备</span><LanguageToggle compact /></div></header><section className="rz-share-hero"><div><span className="rz-eyebrow">YOUR CURTAIN PROPOSAL</span><h1>属于你的窗帘<br />搭配方案。</h1><p>{String(recommendation.summary || "这份方案根据你的房间、窗型、采光需求与真实商品资料生成。")}</p></div><div className="rz-share-hero-image"><img alt="RoyalZen 窗帘搭配效果图" src={item.resultImageUrl || item.sceneImageUrl || "/demo/preview-curtain-warm.jpg"} /></div></section><section className="rz-share-product"><span className="rz-share-index">01</span><div><span className="rz-eyebrow">ROYALZEN RECOMMENDS</span><h2>{String(sku.name || "RoyalZen 窗帘方案")}</h2><p>{String(sku.color || "自动配色")} · {String(sku.opacity || "兼顾采光与隐私")}</p><div className="rz-share-reasons"><span>{String(item.sceneAnalysis.windowType || "适配当前窗型")}</span>{answerTags.length ? answerTags.map((tag) => <span key={tag}>{tag}</span>) : <span>按房间配色搭配</span>}</div></div><div className="rz-share-product-image"><img alt={String(sku.name || "推荐窗帘")} src={String(sku.image_url || sku.local_image || "/demo/curtain-beige.jpg")} /></div></section><section className="rz-share-note"><span className="rz-eyebrow">A NOTE FROM YOUR ADVISOR</span><blockquote>“{pickedReason?.why || String(recommendation.reasoning || "请结合面料实物确认最终颜色与垂感，我们会继续协助完成测量和安装方案。")}”</blockquote>{pickedReason?.caveat ? <p className="rz-share-caveat">需要注意：{pickedReason.caveat}</p> : null}<p>{item.advisorName} · RoyalZen</p></section><footer className="rz-share-footer"><div><strong>想查看面料实物？</strong><p>联系我们预约门店看样或上门测量。</p></div><a href="mailto:advisor@royalzen.com">联系我的顾问</a></footer><p className="rz-share-disclaimer">AI 搭配预览用于辅助选择，实际颜色、纹理和垂感请以面料样品及最终安装为准。</p></main>;
}
