import { NextResponse } from "next/server";
import sharp from "sharp";
import { z } from "zod";
import { apiError } from "@/lib/api-response";
import { runAgentRecommendation } from "@/lib/agent-provider";
import { getCurrentActor } from "@/lib/auth";
import { consumeRateLimit, RequestSecurityError } from "@/lib/request-security";
import { getConsultation, updateConsultation, writeAuditLog } from "@/lib/platform-db";
import { getFileFromR2 } from "@/lib/r2";
import type { SurveyAnswers } from "@/lib/curtain-survey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 预算要够重试跑完，否则重试等于没有：
//   视觉模型  25s × 3 次 + 退避 2.4s ≈ 77s
//   重排模型  同样的上限，第三步两段是串行的
// 原先 90s 卡在中间——模型偶尔慢一次，重试还没轮完函数就被掐了，
// 前端只看到一句"请求超时"。正常一趟约 22 秒，这里放的是最坏情况的余量。
export const maxDuration = 180;

const requestSchema = z.object({
  modelId: z.string().trim().default("qwen-qwen3-vl-flash"),
  // 不在这里放行，荷/法请求会被 zod 打回 400，界面切了语言反而报错
  locale: z.enum(["zh", "en", "nl", "fr"]).default("zh"),
  roomType: z.string().trim().max(80).default(""),
  style: z.string().trim().max(80).default("自动搭配"),
  desiredColor: z.string().trim().max(80).default("自动"),
  opacityNeed: z.string().trim().max(80).default("兼顾采光与隐私"),
  extraInstruction: z.string().trim().max(1000).default(""),
  /** 顾问在第二屏更正的窗型，给了就以它为准 */
  windowTypeOverride: z.string().trim().max(40).default(""),
  /** 第一屏只读空间：跳过商品库、候选筛选与重排 */
  sceneOnly: z.boolean().default(false),
  survey: z
    .object({
      opacityNeed: z.string().nullish(),
      colors: z.array(z.string()).max(3).default([]),
      valueLevels: z.array(z.string()).max(8).default([]),
      // 色板实际点中的格子。不在这里声明的话 zod 会把它剥掉，筛选就退回按两条清单
      // 各判各的，客户点两格又变成命中四格
      colorCells: z.array(z.string()).max(24).default([]),
      texture: z.string().nullish(),
      materials: z.array(z.string()).max(8).default([]),
      fabricType: z.string().nullish(),
      tags: z.array(z.string()).max(12).default([]),
      note: z.string().max(1000).default("")
    })
    .nullish()
});

async function getSceneDataUrl(key: string) {
  const file = await getFileFromR2(key);
  if (!file) throw new Error("家庭场景图不存在，请重新上传。");
  const optimized = await sharp(file.body)
    .rotate()
    .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();
  return `data:image/jpeg;base64,${optimized.toString("base64")}`;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let actor: Awaited<ReturnType<typeof getCurrentActor>> | null = null;
  try {
    actor = await getCurrentActor();
    // 这是最贵的端点之一：一次调用要跑视觉模型 + 重排模型，实测约 22 秒。
    // 此前只有 generate 和旧的 agent/recommend 有限流，主线推荐入口一直裸奔。
    consumeRateLimit(`consultation-recommend:${actor.userId}`, { limit: 6, windowMs: 60_000 });
    const input = requestSchema.parse(await request.json().catch(() => ({})));
    const current = await getConsultation(actor, id);
    if (!current) return NextResponse.json({ error: "没有找到这条咨询。" }, { status: 404 });
    if (!current.sceneR2Key) {
      return NextResponse.json({ error: "请先上传家庭场景图。" }, { status: 400 });
    }

    await updateConsultation(actor, current.id, {
      status: "analyzing",
      roomType: input.roomType,
      preferences: {
        style: input.style,
        desiredColor: input.desiredColor,
        opacityNeed: input.opacityNeed,
        extraInstruction: input.extraInstruction,
        modelId: input.modelId,
        windowTypeOverride: input.windowTypeOverride,
        // 六题答案要落库，否则详情页事后打开只能回显表单占位符
        survey: input.survey ?? null
      }
    });

    const result = await runAgentRecommendation({
      ...input,
      survey: (input.survey as SurveyAnswers | null | undefined) ?? null,
      sceneImageDataUrl: await getSceneDataUrl(current.sceneR2Key)
    });
    const selectedSku = result.skus[0] || null;
    // 只写真正从照片读出来的东西。
    // 原先把客户自己填的 style / desiredColor 原样回显、标题却写「AI 已完成空间分析」，
    // 客户一旦发现，后面所有推荐理由的可信度都会跟着塌掉。
    const sceneAnalysis = {
      windowType: result.recommendation.inferred_window_type,
      windowTypeReason: result.recommendation.window_type_reason,
      roomType: input.roomType || "AI 自动判断",
      summary: result.recommendation.summary,
      // 第二屏展示的全部来自这里。第一屏只读空间、不写 recommendation，
      // 描述和模型名若只存在那边，这一屏就会退回占位文案。
      model: result.model,
      roomColor: result.roomColor
    };
    const recommendation = {
      ...result.recommendation,
      route: result.route,
      provider: result.provider,
      model: result.model,
      // 界面据此说话：配色到底有没有参与这次排序
      harmonyStrict: result.harmonyStrict,
      skus: result.skus,
      knowledgeMatches: result.knowledgeMatches
    };
    // 第一屏只读了空间，还没有推荐结果，不能覆盖掉已有的那一份
    const item = input.sceneOnly
      ? await updateConsultation(actor, current.id, { status: "analyzing", sceneAnalysis })
      : await updateConsultation(actor, current.id, {
          status: "recommended",
          sceneAnalysis,
          recommendation,
          selectedSkuId: selectedSku?.sku_id || null,
          selectedSkuSnapshot: selectedSku || {}
        });
    await writeAuditLog(actor, "consultation.recommended", "consultation", current.id, {
      model: result.model,
      provider: result.provider,
      skuIds: result.recommendation.recommended_sku_ids
    });
    return NextResponse.json({ item, ...result });
  } catch (error) {
    if (actor) {
      await updateConsultation(actor, id, { status: "failed" }).catch(() => undefined);
    }
    if (error instanceof RequestSecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "推荐条件格式不正确。", issues: error.issues }, { status: 400 });
    }
    return apiError(error, "AI 推荐失败。");
  }
}
