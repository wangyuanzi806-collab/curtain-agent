import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { getCurrentActor } from "@/lib/auth";
import { createShare, writeAuditLog } from "@/lib/platform-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const actor = await getCurrentActor();
    const share = await createShare(actor, id);
    if (!share) return NextResponse.json({ error: "没有找到这条咨询。" }, { status: 404 });
    await writeAuditLog(actor, "consultation.shared", "consultation", share.consultationId);
    return NextResponse.json({
      token: share.token,
      url: `${new URL(request.url).origin}/share/${share.token}`
    });
  } catch (error) {
    return apiError(error, "创建客户分享链接失败。");
  }
}
