import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { getSharedConsultation } from "@/lib/platform-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const item = await getSharedConsultation(token);
    if (!item) return NextResponse.json({ error: "分享链接不存在或已过期。" }, { status: 404 });
    return NextResponse.json({ item });
  } catch (error) {
    return apiError(error, "读取客户方案失败。");
  }
}
