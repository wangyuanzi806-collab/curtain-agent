import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api-response";
import { getCurrentActor } from "@/lib/auth";
import { updateActorProfile, writeAuditLog } from "@/lib/platform-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  displayName: z.string().trim().min(1).max(100),
  // 少了荷/法两项的话，设置页选了却存不进去，zod 会直接拒掉这次保存
  locale: z.enum(["zh-CN", "en-US", "nl-NL", "fr-FR"]).default("zh-CN")
});

export async function GET() {
  try {
    return NextResponse.json({ actor: await getCurrentActor() });
  } catch (error) {
    return apiError(error, "读取账号资料失败。");
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await getCurrentActor();
    const input = schema.parse(await request.json());
    const updated = await updateActorProfile(actor, input);
    await writeAuditLog(actor, "profile.updated", "user", actor.userId);
    return NextResponse.json({ actor: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "账号资料格式不正确。", issues: error.issues }, { status: 400 });
    }
    return apiError(error, "更新账号资料失败。");
  }
}
