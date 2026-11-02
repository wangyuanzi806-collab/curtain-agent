import { NextResponse } from "next/server";
import { getAgentModels } from "@/lib/agent-models";
import { apiError } from "@/lib/api-response";
import { getCurrentActor } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getCurrentActor();
    return NextResponse.json({
      items: getAgentModels()
    });
  } catch (error) {
    return apiError(error, "\u8bfb\u53d6\u667a\u80fd\u4f53\u6a21\u578b\u5931\u8d25\u3002");
  }
}
