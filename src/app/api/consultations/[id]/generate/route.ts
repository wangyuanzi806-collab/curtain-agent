import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, NextResponse } from "next/server";
import sharp from "sharp";
import { z } from "zod";
import { apiError } from "@/lib/api-response";
import { getCurrentActor } from "@/lib/auth";
import { createSucceededGeneration } from "@/lib/db";
import { getGenerationQualityProfile } from "@/lib/generation-quality";
import { getConsultation, updateConsultation, writeAuditLog } from "@/lib/platform-db";
import { getFileFromR2, safeUploadExternalToR2 } from "@/lib/r2";
import { buildCurtainPrompt, generateCurtainImage } from "@/lib/seedream";
import { consumeRateLimit, RequestSecurityError } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const requestSchema = z.object({
  qualityTier: z.enum(["fast", "balanced", "quality"]).default("balanced"),
  userInstruction: z.string().trim().max(1500).default(""),
  selectedSkuId: z.string().trim().optional(),
  selectedSkuSnapshot: z.record(z.string(), z.unknown()).optional()
});

async function optimizeDataUrl(bytes: Uint8Array, maxDimension: number, quality: number) {
  const optimized = await sharp(bytes)
    .rotate()
    .resize(maxDimension, maxDimension, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
  return `data:image/jpeg;base64,${optimized.toString("base64")}`;
}

/**
 * 商品图在 R2 上是不可变的（URL 带内容哈希），所以进程内缓存住就行。
 * 同一款被连续试几次是常态，每次都跨网重下一遍纯属浪费。
 */
const skuImageCache = new Map<string, Uint8Array>();
const SKU_IMAGE_CACHE_MAX = 32;

function rememberSkuImage(key: string, bytes: Uint8Array) {
  if (skuImageCache.size >= SKU_IMAGE_CACHE_MAX) {
    const oldest = skuImageCache.keys().next().value;
    if (oldest !== undefined) skuImageCache.delete(oldest);
  }
  skuImageCache.set(key, bytes);
}

async function readSkuImage(snapshot: Record<string, unknown>, origin: string) {
  const imageUrl = String(snapshot.image_url || snapshot.imageUrl || "").trim();
  const localImage = String(snapshot.local_image || snapshot.localImage || "").trim();
  const candidate = imageUrl || localImage;
  if (!candidate) throw new Error("所选商品缺少窗帘图片。");

  const cached = skuImageCache.get(candidate);
  if (cached) return cached;

  if (candidate.startsWith("/")) {
    const publicPath = join(process.cwd(), "public", candidate.replace(/^\/+/, ""));
    try {
      return new Uint8Array(await readFile(publicPath));
    } catch {
      const response = await fetch(new URL(candidate, origin), { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error("无法读取所选窗帘图片。");
      return new Uint8Array(await response.arrayBuffer());
    }
  }

  const response = await fetch(candidate, { signal: AbortSignal.timeout(25_000) });
  if (!response.ok) throw new Error("无法下载所选窗帘图片。");
  const bytes = new Uint8Array(await response.arrayBuffer());
  rememberSkuImage(candidate, bytes);
  return bytes;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let actor: Awaited<ReturnType<typeof getCurrentActor>> | null = null;
  try {
    actor = await getCurrentActor();
    consumeRateLimit(`consultation-generate:${actor.userId}`, { limit: 4, windowMs: 60_000 });
    const input = requestSchema.parse(await request.json().catch(() => ({})));
    const current = await getConsultation(actor, id);
    if (!current) return NextResponse.json({ error: "没有找到这条咨询。" }, { status: 404 });
    if (!current.sceneR2Key) return NextResponse.json({ error: "请先上传家庭场景图。" }, { status: 400 });

    const skuSnapshot = input.selectedSkuSnapshot || current.selectedSkuSnapshot;
    const selectedSkuId = input.selectedSkuId || current.selectedSkuId;
    if (!selectedSkuId || Object.keys(skuSnapshot).length === 0) {
      return NextResponse.json({ error: "请先选择推荐商品。" }, { status: 400 });
    }

    await updateConsultation(actor, current.id, {
      status: "generating",
      selectedSkuId,
      selectedSkuSnapshot: skuSnapshot,
      qualityTier: input.qualityTier
    });

    const profile = getGenerationQualityProfile(input.qualityTier);
    // 场景图与商品图互不依赖，一起取
    const prepStartedAt = Date.now();
    const [sceneFile, curtainBytes] = await Promise.all([
      getFileFromR2(current.sceneR2Key),
      readSkuImage(skuSnapshot, new URL(request.url).origin)
    ]);
    if (!sceneFile) throw new Error("家庭场景图不存在，请重新上传。");
    const fetchedMs = Date.now() - prepStartedAt;

    const encodeStartedAt = Date.now();
    const [sceneDataUrl, curtainDataUrl] = await Promise.all([
      optimizeDataUrl(sceneFile.body, profile.maxDimension, profile.jpegQuality),
      optimizeDataUrl(curtainBytes, profile.maxDimension, profile.jpegQuality)
    ]);
    const encodedMs = Date.now() - encodeStartedAt;

    const renderInstruction = String(current.recommendation.recommended_render_instruction || "").trim();
    const prompt = buildCurtainPrompt([renderInstruction, input.userInstruction].filter(Boolean).join(" "));
    const generated = await generateCurtainImage({
      prompt,
      sceneDataUrl,
      curtainDataUrl,
      referenceDataUrls: []
    });

    // 归档不再挡在用户前面：先把模型给的 URL 交出去，落 R2 放到响应之后做。
    // 那一步是「下载回美东再传 Cloudflare」两次跨网，纯粹是让人干等。
    // 代价是模型 URL 有时效，所以 after 里必须把稳定地址补回咨询记录。
    const stableImageUrl = generated.imageUrl;
    const timings = {
      fetchedMs,
      encodedMs,
      modelMs: generated.tookMs,
      requestBytes: generated.requestBytes,
      attempts: generated.attempts,
      tier: input.qualityTier
    };
    console.info(
      `[generate] consultation=${current.id} 取图=${fetchedMs}ms 编码=${encodedMs}ms ` +
        `模型=${generated.tookMs}ms 请求体=${Math.round(generated.requestBytes / 1024)}KB ` +
        `重试=${generated.attempts - 1} 档位=${input.qualityTier}`
    );

    const generation = await createSucceededGeneration({
      prompt,
      userInstruction: input.userInstruction,
      sceneR2Key: current.sceneR2Key,
      curtainR2Key: null,
      referenceR2Keys: [],
      agentRequestedModel: String(current.preferences.modelId || "") || null,
      agentUsedProvider: String(current.recommendation.provider || "") || null,
      agentUsedModel: String(current.recommendation.model || "") || null,
      agentAttemptModels:
        current.recommendation.route &&
        typeof current.recommendation.route === "object" &&
        Array.isArray((current.recommendation.route as Record<string, unknown>).attemptModels)
          ? ((current.recommendation.route as Record<string, unknown>).attemptModels as string[])
          : [],
      recommendedSkuIds: Array.isArray(current.recommendation.recommended_sku_ids)
        ? (current.recommendation.recommended_sku_ids as string[])
        : [],
      selectedSkuId,
      selectedSkuName: String(skuSnapshot.name || selectedSkuId),
      resultImageUrl: generated.imageUrl,
      resultR2Key: null,
      providerRequest: generated.requestPayload,
      providerResponse: { ...generated.rawResponse, timings }
    });
    const item = await updateConsultation(actor, current.id, {
      status: "ready",
      generationId: generation.id,
      resultImageUrl: stableImageUrl,
      resultR2Key: null,
      qualityTier: input.qualityTier
    });
    await writeAuditLog(actor, "consultation.generated", "consultation", current.id, {
      generationId: generation.id,
      qualityTier: input.qualityTier,
      timings
    });

    // 响应已经发出去了，这里再慢也没人等
    const owner = actor;
    after(async () => {
      const archiveStartedAt = Date.now();
      try {
        const archive = await safeUploadExternalToR2(
          generated.imageUrl,
          `consultations/${current.id}/results`,
          { timeoutMs: 45_000 }
        );
        if (!archive?.key) {
          console.warn(`[generate] 归档没拿到 key consultation=${current.id}，仍在用模型的临时地址`);
          return;
        }
        await updateConsultation(owner, current.id, {
          resultImageUrl: `/api/assets?key=${encodeURIComponent(archive.key)}`,
          resultR2Key: archive.key
        });
        console.info(`[generate] 归档完成 consultation=${current.id} 用时=${Date.now() - archiveStartedAt}ms`);
      } catch (error) {
        // 归档失败不影响这次已经交付的图，但要留痕：模型给的地址会过期
        console.error(`[generate] 归档失败 consultation=${current.id}`, error);
      }
    });

    return NextResponse.json({ item, generation, displayImageUrl: stableImageUrl });
  } catch (error) {
    if (actor) await updateConsultation(actor, id, { status: "failed" }).catch(() => undefined);
    if (error instanceof RequestSecurityError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status, headers: error.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : undefined }
      );
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "生成参数格式不正确。", issues: error.issues }, { status: 400 });
    }
    return apiError(error, "生成窗帘效果图失败。");
  }
}
