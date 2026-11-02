import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { getCurrentActor } from "@/lib/auth";
import { validateImageFile } from "@/lib/files";
import { getConsultation, updateConsultation, writeAuditLog } from "@/lib/platform-db";
import { safeUploadFileToR2 } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const actor = await getCurrentActor();
    const current = await getConsultation(actor, id);
    if (!current) return NextResponse.json({ error: "没有找到这条咨询。" }, { status: 404 });

    const formData = await request.formData();
    const scene = formData.get("scene");
    if (!(scene instanceof File) || scene.size === 0) {
      return NextResponse.json({ error: "请选择家庭场景图。" }, { status: 400 });
    }
    validateImageFile(scene, "家庭场景图");

    const upload = await safeUploadFileToR2(scene, `consultations/${current.id}/scene`);
    if (!upload) throw new Error("家庭场景图上传到 R2 失败。");
    const sceneImageUrl = `/api/assets?key=${encodeURIComponent(upload.key)}`;
    const item = await updateConsultation(actor, current.id, {
      sceneR2Key: upload.key,
      sceneImageUrl,
      status: "draft"
    });
    await writeAuditLog(actor, "consultation.scene_uploaded", "consultation", current.id, { size: scene.size, type: scene.type });
    return NextResponse.json({ item });
  } catch (error) {
    return apiError(error, "上传家庭场景图失败。");
  }
}
