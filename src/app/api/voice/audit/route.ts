import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { getCurrentActor } from "@/lib/auth";
import { reportUnverified, scanUnverified } from "@/lib/voice-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 助手每说完一轮，页面把原话回传到这里检查。
 *
 * **这是告警不是拦截**：音频从 OpenAI 直接进顾客耳朵，转录到达服务端时话已出口。
 * 它买到的是「说过几次、说的哪个词」，于是「助手从不声称遮光」从一句期望
 * 变成一个可以看的数字。为此改架构（把音频绕经服务端）会牺牲实时性，
 * 老板 08-01 明确决定不改。
 */
export async function POST(request: Request) {
  try {
    await getCurrentActor();
    const body = await request.json();
    const said = String(body?.text ?? "");
    const sessionLabel = typeof body?.session_label === "string" ? body.session_label : null;

    const terms = scanUnverified(said);
    if (terms.length > 0) {
      await reportUnverified(terms, said, sessionLabel);
    }
    return NextResponse.json({ flagged: terms });
  } catch (error) {
    return apiError(error, "检查失败。");
  }
}
