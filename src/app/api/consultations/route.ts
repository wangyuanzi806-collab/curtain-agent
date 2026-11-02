import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api-response";
import { getCurrentActor } from "@/lib/auth";
import { createConsultation, listConsultations, writeAuditLog } from "@/lib/platform-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  clientName: z.string().trim().max(120).optional(),
  clientEmail: z.string().trim().email().or(z.literal("")).optional(),
  roomType: z.string().trim().max(80).optional(),
  preferences: z.record(z.string(), z.unknown()).optional()
});

export async function GET(request: Request) {
  try {
    const actor = await getCurrentActor();
    const rawLimit = Number(new URL(request.url).searchParams.get("limit") || "20");
    const items = await listConsultations(actor, Number.isFinite(rawLimit) ? rawLimit : 20);
    return NextResponse.json({ items, total: items.length });
  } catch (error) {
    return apiError(error, "读取咨询记录失败。");
  }
}

export async function POST(request: Request) {
  try {
    const actor = await getCurrentActor();
    const body = createSchema.parse(await request.json().catch(() => ({})));
    const item = await createConsultation(actor, body);
    await writeAuditLog(actor, "consultation.created", "consultation", item.id);
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "咨询信息格式不正确。", issues: error.issues }, { status: 400 });
    }
    return apiError(error, "创建咨询失败。");
  }
}
