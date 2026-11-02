"use client";

import Link from "next/link";
import { ChangeEvent, useEffect, useMemo, useState } from "react";
import Icon from "@/components/royalzen/icon";
import SurveyPanel, { EMPTY_SURVEY, type SurveyValue } from "@/components/royalzen/survey-panel";
import { useLocale } from "@/lib/i18n";

const STEPS = ["上传空间", "空间分析", "客户需求", "商品推荐", "生成预览"];

type Sku = {
  sku_id: string;
  name: string;
  color: string;
  style_tags?: string;
  opacity: string;
  product_type: string;
  window_types: string;
  image_url: string;
  local_image: string;
  usage_note: string;
  /** 接口一直在返回这些，只是以前没在类型里声明，于是前端一个都拿不到 */
  pattern_level?: string | null;
  color_family?: string | null;
  value_level?: string | null;
  color_rgb?: string | null;
  weight_gsm?: number | null;
  material_class?: string | null;
};

const MATERIAL_LABELS: Record<string, string> = {
  cotton_linen: "棉麻",
  wool: "羊毛",
  viscose_soft: "柔垂",
  polyester_smooth: "顺滑",
  blend: "混纺"
};

const WINDOW_TYPE_CHOICES = ["标准窗", "落地窗", "大宽窗", "飘窗", "阳台门", "滑门/移门", "法式门窗", "小窗", "拱形窗"];

type RoomColorReading = {
  tone: string;
  toneLabel: string;
  wallBrightness: string;
  floorBrightness: string;
  trusted: boolean;
  issues: string[];
};

type SkuReason = {
  sku_id: string;
  space: string;
  why: string;
  /** 结论下面那行实测值，模型没给或走了降级路径时为空 */
  evidence?: string;
  matched: string[];
  caveat: string;
};

type Consultation = {
  id: string;
  displayCode: string;
  sceneImageUrl: string | null;
  sceneAnalysis: Record<string, unknown>;
  recommendation: Record<string, unknown>;
  selectedSkuId: string | null;
  selectedSkuSnapshot: Record<string, unknown>;
  resultImageUrl: string | null;
  qualityTier: string;
};

function ChoiceGroup({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (value: string) => void }) {
  return (
    <fieldset className="rz-choice-group">
      <legend>{label}</legend>
      <div>{options.map((item) => <button className={value === item ? "is-selected" : ""} key={item} onClick={() => onChange(item)} type="button">{item}{value === item ? <Icon name="check" size={14} /> : null}</button>)}</div>
    </fieldset>
  );
}

function getSkuImage(sku: Sku | null) {
  return sku?.image_url || sku?.local_image || "/demo/curtain-beige.jpg";
}

async function parseResponse<T>(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || `请求失败（${response.status}）`);
  return payload;
}

export default function ConsultationFlow() {
  const { locale } = useLocale();
  const [step, setStep] = useState(1);
  const [consultation, setConsultation] = useState<Consultation | null>(null);
  const [sceneFile, setSceneFile] = useState<File | null>(null);
  const [sceneUrl, setSceneUrl] = useState<string | null>(null);
  const [clientName, setClientName] = useState("");
  const [roomType, setRoomType] = useState("自动判断");
  const [survey, setSurvey] = useState<SurveyValue>(EMPTY_SURVEY);
  const [surveyBlocked, setSurveyBlocked] = useState(false);
  const [windowTypeOverride, setWindowTypeOverride] = useState("");
  const [quality, setQuality] = useState<"fast" | "balanced" | "quality">("balanced");
  const [recommendations, setRecommendations] = useState<Sku[]>([]);
  const [selectedSkuId, setSelectedSkuId] = useState("");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [lastRecommendationSignature, setLastRecommendationSignature] = useState("");
  const [loading, setLoading] = useState("");
  const [error, setError] = useState("");

  const selectedSku = useMemo(
    () => recommendations.find((item) => item.sku_id === selectedSkuId) || recommendations[0] || null,
    [recommendations, selectedSkuId]
  );
  const preferenceSignature = JSON.stringify({ roomType, survey, windowTypeOverride });
  const analysis = consultation?.sceneAnalysis || {};
  const recommendation = consultation?.recommendation || {};
  const skuReasons = (recommendation.sku_reasons as SkuReason[] | undefined) || [];
  const rankingSource = recommendation.ranking_source as string | undefined;
  const harmonyStrict = recommendation.harmonyStrict === true;
  // 取色读数存在 sceneAnalysis 里。这里原先读的是 recommendation.roomColor，
  // 取值位置对不上，那一栏于是从上线起就没显示过，
  // 连"配色无法可靠分析"的警告也一并沉默了。
  const roomColor = (analysis as Record<string, unknown>).roomColor as
    | RoomColorReading
    | undefined;

  useEffect(() => () => {
    if (sceneUrl?.startsWith("blob:")) URL.revokeObjectURL(sceneUrl);
  }, [sceneUrl]);

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (sceneUrl?.startsWith("blob:")) URL.revokeObjectURL(sceneUrl);
    setSceneFile(file);
    setSceneUrl(URL.createObjectURL(file));
    setError("");
  };

  const useDemoScene = async () => {
    setLoading("正在准备演示场景...");
    try {
      const response = await fetch("/demo/scene-bay-window.jpg");
      const blob = await response.blob();
      const file = new File([blob], "scene-bay-window.jpg", { type: blob.type || "image/jpeg" });
      setSceneFile(file);
      setSceneUrl(URL.createObjectURL(file));
      setError("");
    } catch {
      setError("演示场景加载失败，请直接选择图片。");
    } finally {
      setLoading("");
    }
  };

  const ensureConsultationAndScene = async () => {
    if (!sceneFile) throw new Error("请先选择家庭场景图。");
    let current = consultation;
    if (!current) {
      const created = await parseResponse<{ item: Consultation }>(await fetch("/api/consultations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientName: clientName || "未命名客户", roomType })
      }));
      current = created.item;
      setConsultation(current);
    }

    if (!current.sceneImageUrl || sceneFile) {
      const formData = new FormData();
      formData.set("scene", sceneFile);
      const uploaded = await parseResponse<{ item: Consultation }>(await fetch(`/api/consultations/${current.id}/scene`, {
        method: "POST",
        body: formData
      }));
      current = uploaded.item;
      setConsultation(current);
      setSceneUrl(current.sceneImageUrl);
      setSceneFile(null);
    }
    return current;
  };

  const runRecommendation = async (
    current: Consultation,
    options: { force?: boolean; sceneOnly?: boolean } = {}
  ) => {
    const { force = false, sceneOnly = false } = options;
    if (!force && lastRecommendationSignature === preferenceSignature && recommendations.length) return;
    const payload = await parseResponse<{
      item: Consultation;
      skus: Sku[];
      recommendation: Record<string, unknown>;
    }>(await fetch(`/api/consultations/${current.id}/recommend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        modelId: "qwen-qwen3-vl-flash",
        locale,
        roomType,
        // 这三项客户没填过，留空即可。原先塞的占位符会被模型
        // 当成客户的诉求，五张卡片的「满足了你的选择」就都写成了同一句话。
        style: "",
        desiredColor: "",
        opacityNeed: "",
        extraInstruction: survey.note,
        // 窗型更正走独立字段做硬约束。原先只拼进一句提示词，模型照样自己判断，改了等于没改。
        windowTypeOverride,
        sceneOnly,
        survey
      })
    }));
    setConsultation(payload.item);
    if (sceneOnly) return;
    setRecommendations(payload.skus || []);
    setSelectedSkuId(payload.skus?.[0]?.sku_id || "");
    setLastRecommendationSignature(preferenceSignature);
  };

  const analyzeScene = async () => {
    setLoading("正在上传并读取空间，通常需要 10–20 秒...");
    setError("");
    try {
      const current = await ensureConsultationAndScene();
      // 这一步只读空间。问卷还没答，此时选出来的商品必然在第三步被整个覆盖，
      // 跑完整链路等于把二十多秒和两次模型调用白花一遍。
      await runRecommendation(current, { force: true, sceneOnly: true });
      setStep(2);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "空间分析失败。");
    } finally {
      setLoading("");
    }
  };

  const refreshRecommendation = async () => {
    if (!consultation) return;
    setLoading("AI 正在结合窗型、颜色和知识库重新匹配商品...");
    setError("");
    try {
      await runRecommendation(consultation);
      setStep(4);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "商品推荐失败。");
    } finally {
      setLoading("");
    }
  };

  const generatePreview = async () => {
    if (!consultation || !selectedSku) return;
    setLoading("Seedream 正在生成窗帘预览，通常需要 30–120 秒，请勿关闭页面...");
    setError("");
    try {
      const payload = await parseResponse<{ item: Consultation; displayImageUrl: string }>(await fetch(`/api/consultations/${consultation.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          qualityTier: quality,
          selectedSkuId: selectedSku.sku_id,
          selectedSkuSnapshot: selectedSku,
          userInstruction: survey.note
        })
      }));
      setConsultation(payload.item);
      setResultUrl(payload.displayImageUrl);
      setStep(5);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "效果图生成失败。");
    } finally {
      setLoading("");
    }
  };

  // 排序依据要如实说。原先这句话是写死的，不看配色这次到底跑没跑——
  // 顾问一旦发现，后面所有推荐理由的可信度都会跟着塌掉。
  const rankingNote = !roomColor
    ? "本次没有依据房间颜色筛选，只按你的偏好排序。"
    : !roomColor.trusted
      ? `这张照片的配色无法可靠分析（${roomColor.issues[0] || "取色不稳定"}），本次只按你的偏好排序。`
      : harmonyStrict
        ? "已按房间配色、你的偏好和整体观感排序，这几款是平等的好选择。"
        : "符合你条件的款式不多，这几款已按与房间的贴合度排序。";

  const goBack = () => setStep((current) => Math.max(1, current - 1));
  const nextAction = () => {
    if (step === 1) return analyzeScene();
    if (step === 2) return setStep(3);
    if (step === 3) return refreshRecommendation();
    if (step === 4) return generatePreview();
  };

  return (
    <div className="rz-page rz-flow-page">
      <header className="rz-flow-header">
        <div>
          <Link className="rz-back-link" href="/app"><span>←</span> 返回工作台</Link>
          <span className="rz-eyebrow">NEW CONSULTATION</span>
          <h1>新建客户咨询</h1>
          <p>按照空间、需求和商品逐步完成一份可解释、可保存、可分享的窗帘方案。</p>
        </div>
        <span className="rz-draft-state">{consultation ? `已保存 · ${consultation.displayCode}` : "尚未创建草稿"}</span>
      </header>

      <nav className="rz-stepper" aria-label="咨询进度">
        {STEPS.map((label, index) => {
          const number = index + 1;
          const completed = number < step;
          return <button className={`${number === step ? "is-active" : ""} ${completed ? "is-complete" : ""}`} disabled={number > step || Boolean(loading)} key={label} onClick={() => setStep(number)} type="button"><span>{completed ? <Icon name="check" size={14} /> : number}</span><strong>{label}</strong></button>;
        })}
      </nav>

      {loading ? <div className="rz-agent-status" role="status"><Icon name="spark" size={18} /><span>{loading}</span></div> : null}
      {error ? <div className="rz-error-banner" role="alert"><strong>没有完成这一步</strong><span>{error}</span><button onClick={() => setError("")} type="button">关闭</button></div> : null}

      <section className="rz-flow-surface" aria-busy={Boolean(loading)}>
        {step === 1 ? <div className="rz-flow-grid rz-scene-step">
          <div className="rz-flow-copy"><span className="rz-step-count">01 / 05</span><h2>先看客户的空间</h2><p>上传一张正对窗户的照片。窗户越清晰，窗型判断和商品匹配越准确。</p><label className="rz-field"><span>客户称呼 <small>可选</small></span><input onChange={(event) => setClientName(event.target.value)} placeholder="例如 Sophie Laurent" value={clientName} /></label><ul className="rz-photo-guidance"><li><Icon name="window" size={18} /><span><strong>窗户保持完整</strong>不要裁掉窗框和两侧墙面</span></li><li><Icon name="palette" size={18} /><span><strong>保留房间颜色</strong>避免滤镜和过度曝光</span></li><li><Icon name="upload" size={18} /><span><strong>推荐横向照片</strong>JPG、PNG，单张不超过 10MB</span></li></ul></div>
          <div className={`rz-scene-upload ${sceneUrl ? "has-image" : ""}`}>{sceneUrl ? <><img alt="已上传的客户家庭场景" src={sceneUrl} /><div className="rz-scene-actions"><label><Icon name="upload" size={16} />更换照片<input accept="image/*" onChange={handleFile} type="file" /></label><button onClick={() => { setSceneFile(null); setSceneUrl(null); }} type="button">移除</button></div></> : <div className="rz-upload-empty"><span className="rz-upload-icon"><Icon name="upload" size={24} /></span><strong>拖入或选择房间照片</strong><p>建议画面中窗户面积不少于 20%</p><label className="rz-button rz-button-secondary">选择照片<input accept="image/*" onChange={handleFile} type="file" /></label><button className="rz-demo-link" onClick={useDemoScene} type="button">使用演示场景</button></div>}</div>
        </div> : null}

        {step === 2 ? <div className="rz-analysis-step"><div className="rz-flow-copy"><span className="rz-step-count">02 / 05</span><h2>我看到了你的空间</h2><p>下面是从照片里读出来的。有不对的地方点一下就能改，改完不用重新分析。</p></div><div className="rz-analysis-layout"><div className="rz-analysis-image"><img alt="客户上传的家庭场景" src={sceneUrl || consultation?.sceneImageUrl || "/demo/scene-bay-window.jpg"} /><span><Icon name="window" size={16} /> 已识别主要窗区</span></div><div className="rz-analysis-results"><div className="rz-analysis-primary"><span>窗户类型</span>{windowTypeOverride ? <><strong>{windowTypeOverride}</strong><p>已按你的更正处理。</p></> : <><strong>{String(analysis.windowType || "标准窗")}</strong><p>{String(analysis.windowTypeReason || "已结合窗框形态和开合方式判断。")}</p></>}<div className="rz-window-fix">{WINDOW_TYPE_CHOICES.map((name) => <button className={(windowTypeOverride || analysis.windowType) === name ? "is-selected" : ""} key={name} onClick={() => setWindowTypeOverride(name)} type="button">{name}</button>)}</div></div><dl>{roomColor ? <><div><dt>空间色调</dt><dd>{roomColor.toneLabel} · {roomColor.wallBrightness} · {roomColor.floorBrightness}</dd></div>{roomColor.trusted ? null : <div className="rz-analysis-full"><dt>配色分析</dt><dd className="rz-analysis-warn">这张照片的空间配色无法可靠分析（{roomColor.issues[0]}），本次不会依据房间颜色做筛选。</dd></div>}</> : null}<div><dt>房间类型</dt><dd>{String(analysis.roomType || roomType)}</dd></div><div className="rz-analysis-full"><dt>场景描述</dt><dd>{String(analysis.summary || recommendation.summary || "已完成识别。")}</dd></div></dl></div></div></div> : null}

        {step === 3 ? <div className="rz-preference-step"><div className="rz-flow-copy"><span className="rz-step-count">03 / 05</span><h2>下面告诉我你的偏好，我来挑</h2><p>每题都可以选「都可以」。底部会实时显示还剩多少款符合条件。</p></div><ChoiceGroup label="房间类型" onChange={setRoomType} options={["自动判断", "客厅", "主卧", "儿童房", "餐厅", "书房", "厨房", "浴室", "商业空间", "其他"]} value={roomType} /><SurveyPanel onBlockedChange={setSurveyBlocked} onChange={setSurvey} value={survey} /></div> : null}

        {step === 4 ? <div className="rz-recommendation-step"><div className="rz-recommendation-head"><div className="rz-flow-copy"><span className="rz-step-count">04 / 05</span><h2>最适合你的 {recommendations.length} 款</h2><p>{rankingNote}{rankingSource === "rules" ? " 排序由配色规则给出，模型未参与。" : ""}</p></div>{recommendation.reasoning || recommendation.summary ? <div className="rz-ai-rationale"><Icon name="spark" size={19} /><span><strong>我看到的空间</strong>{String(recommendation.reasoning || recommendation.summary)}</span></div> : null}{/* 这一块印的是 summary，而 summary 在提示词里就是 "one or two sentences about the room"——
          房间描述。挂「搭配结论」的名字等于拿房间分析冒充选品理由，真正的理由在每张卡片里 */}</div>{/* 三个词只解释一次。卡片里每款都写一遍会把这一屏塞满，
          而客户只要知道这些数是怎么来的，就明白推荐不是拍脑袋给的 */}
        {skuReasons.some((entry) => entry.evidence) ? <p className="rz-metric-note">每款都按你这张照片的实测色值筛过：<b>亮度</b> 0 全黑～100 全白 · <b>暖调</b> 正数偏暖、负数偏冷 · <b>鲜艳度</b> 越低越接近灰白。房间那一侧的数值取自照片本身，不是估的。</p> : null}<div className="rz-product-recommendations">{recommendations.map((item, index) => { const reason = skuReasons.find((entry) => entry.sku_id === item.sku_id); const patterned = item.pattern_level === "pattern"; return <button className={selectedSku?.sku_id === item.sku_id ? "is-selected" : ""} key={item.sku_id} onClick={() => setSelectedSkuId(item.sku_id)} type="button"><span className="rz-product-image"><img alt={item.name} src={getSkuImage(item)} />{patterned ? <i className="is-note">图案面料，颜色以主调为准</i> : null}</span><span className="rz-product-order">0{index + 1}</span><span className="rz-product-copy"><small>{item.sku_id}</small><strong>{item.name}</strong>{reason ? <span className="rz-product-reason">{/* 「为什么这款合适」这个标签独占一行却不带信息——卡片上就这一段正文，它本来就是理由 */}{reason.why}{reason.evidence ? <em className="rz-product-evidence">{reason.evidence}</em> : null}{reason.matched.length ? <em className="rz-product-matched">符合你的选择：{reason.matched.join(" · ")}</em> : null}<em className="rz-product-caveat">需要注意：{reason.caveat}</em></span> : <p>{item.usage_note}</p>}</span><span className="rz-select-mark">{selectedSku?.sku_id === item.sku_id ? <Icon name="check" size={16} /> : "选择"}</span></button>; })}</div><div className="rz-quality-picker" aria-label="生成质量"><span>生成档位</span>{([{ id: "fast", label: "快速" }, { id: "balanced", label: "均衡" }, { id: "quality", label: "精细" }] as const).map((item) => <button className={quality === item.id ? "is-selected" : ""} key={item.id} onClick={() => setQuality(item.id)} type="button">{item.label}</button>)}</div></div> : null}

        {step === 5 ? <div className="rz-preview-step"><div className="rz-preview-head"><div className="rz-flow-copy"><span className="rz-step-count">05 / 05</span><h2>确认搭配预览</h2><p>结果已保存到咨询记录和 R2，可继续查看、重新生成或分享给客户。</p></div></div><div className="rz-comparison"><figure><div><img alt="客户原始房间" src={sceneUrl || consultation?.sceneImageUrl || "/demo/scene-bay-window.jpg"} /></div><figcaption><span>BEFORE</span>客户原始空间</figcaption></figure><figure><div><img alt="RoyalZen 窗帘搭配预览" src={resultUrl || consultation?.resultImageUrl || "/demo/preview-curtain-warm.jpg"} /></div><figcaption><span>ROYALZEN PREVIEW</span>{selectedSku?.name || "窗帘搭配方案"}</figcaption></figure></div><div className="rz-preview-summary"><div><span className="rz-swatch" style={{ background: selectedSku?.color_rgb || "var(--rz-line)" }} /><span><small>已选商品</small><strong>{selectedSku?.name || selectedSkuId}</strong></span></div><p>{[selectedSku?.material_class ? MATERIAL_LABELS[selectedSku.material_class] : "", selectedSku?.weight_gsm ? `${Math.round(selectedSku.weight_gsm)}g/m²` : "", `当前档位：${quality === "fast" ? "快速" : quality === "quality" ? "精细" : "均衡"}`].filter(Boolean).join(" · ")}</p></div></div> : null}
      </section>

      <footer className="rz-flow-actions"><button className="rz-button rz-button-ghost" disabled={step === 1 || Boolean(loading)} onClick={goBack} type="button">上一步</button><span>第 {step} 步，共 5 步</span>{step < 5 ? <button className="rz-button rz-button-primary" disabled={(step === 1 && !sceneFile) || (step === 3 && surveyBlocked) || (step === 4 && !selectedSku) || Boolean(loading)} onClick={nextAction} type="button">{step === 1 ? "分析这个空间" : step === 3 ? "让 AI 推荐商品" : step === 4 ? "生成效果图" : "继续"}<Icon name="arrow" size={17} /></button> : <div className="rz-final-actions"><button className="rz-button rz-button-secondary" onClick={() => setStep(4)} type="button">调整并重新生成</button><Link className="rz-button rz-button-primary" href={`/app/consultations/${consultation?.displayCode || consultation?.id}`}>保存并查看方案<Icon name="arrow" size={17} /></Link></div>}</footer>
    </div>
  );
}
