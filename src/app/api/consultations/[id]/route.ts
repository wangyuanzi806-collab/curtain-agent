import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api-response";
import { getCurrentActor } from "@/lib/auth";
import { canDeleteConsultation } from "@/lib/organization-role";
import { deleteConsultation, getConsultation, updateConsultation, writeAuditLog } from "@/lib/platform-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  clientName: z.string().trim().max(120).optional(),
  clientEmail: z.string().trim().email().or(z.literal("")).optional(),
  roomType: z.string().trim().max(80).optional(),
  status: z.enum(["draft", "analyzing", "recommended", "generating", "ready", "shared", "archived", "failed"]).optional(),
  preferences: z.record(z.string(), z.unknown()).optional(),
  selectedSkuId: z.string().trim().nullable().optional(),
  selectedSkuSnapshot: z.record(z.string(), z.unknown()).optional(),
  qualityTier: z.enum(["fast", "balanced", "quality"]).optional(),
  customerFeedback: z.record(z.string(), z.unknown()).optional()
});

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const actor = await getCurrentActor();
    const item = await getConsultation(actor, id);
    if (!item) return NextResponse.json({ error: "没有找到这条咨询。" }, { status: 404 });
    return NextResponse.json({ item });
  } catch (error) {
    return apiError(error, "读取咨询详情失败。");
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const actor = await getCurrentActor();
    const body = updateSchema.parse(await request.json());
    const item = await updateConsultation(actor, id, body);
    if (!item) return NextResponse.json({ error: "没有找到这条咨询。" }, { status: 404 });
    await writeAuditLog(actor, "consultation.updated", "consultation", item.id, { fields: Object.keys(body) });
    return NextResponse.json({ item });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "咨询更新内容格式不正确。", issues: error.issues }, { status: 400 });
    }
    return apiError(error, "更新咨询失败。");
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const actor = await getCurrentActor();
    // 界面上也藏了入口，但那只是别让人看见按钮。真正的关口在这里：
    // 删除会连带清掉客户照片、效果图、分享链接，且不可恢复
    if (!canDeleteConsultation(actor.role)) {
      return NextResponse.json({ error: "只有机构所有者可以删除咨询。" }, { status: 403 });
    }
    const deleted = await deleteConsultation(actor, id);
    if (!deleted) return NextResponse.json({ error: "没有找到这条咨询。" }, { status: 404 });
    await writeAuditLog(actor, "consultation.deleted", "consultation", id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error, "删除咨询失败。");
  }
}
