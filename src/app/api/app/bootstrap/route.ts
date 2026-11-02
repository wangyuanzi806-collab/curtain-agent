import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { getCurrentActor } from "@/lib/auth";
import { getDashboard } from "@/lib/platform-db";
import { pingDatabase } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await getCurrentActor();
    const [dashboard] = await Promise.all([getDashboard(actor), pingDatabase()]);
    return NextResponse.json({
      actor,
      dashboard,
      services: {
        database: "healthy",
        r2: process.env.R2_BUCKET_NAME ? "configured" : "unconfigured",
        seedream: process.env.ARK_API_KEY ? "configured" : "unconfigured",
        recommendation: process.env.QWEN_API_KEY || process.env.KIMI_API_KEY ? "configured" : "unconfigured"
      }
    });
  } catch (error) {
    return apiError(error, "读取工作台数据失败。");
  }
}
