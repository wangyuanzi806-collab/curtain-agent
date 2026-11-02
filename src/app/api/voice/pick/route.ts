import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { getCurrentActor } from "@/lib/auth";
import { getConsultation, updateConsultation } from "@/lib/platform-db";
import { appendTap } from "@/lib/voice-sessions";
import { logVoice } from "@/lib/voice-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 顾客指着推荐里的某一款说「就这个」。
 *
 * 这是整场对话里最强的一个信号，而在此之前它**只活在浏览器内存里**：
 * 屏幕上那张卡描了个边，效果图按钮亮起来，然后顾客走了，什么都没留下。
 * 后台跟线索的人看到的是「推了五款」，看不到他挑中了哪一款；
 * 意向判断也拿不到它——而一个人从五款里指出一款，比他说十句「挺好的」都重。
 *
 * 落进 consultations.selected_sku_id（那个字段一直在，语音端从没写过），
 * 顺带记进这一场的 taps。
 */
export async function POST(request: Request) {
  try {
    const actor = await getCurrentActor();
    const body = (await request.json().catch(() => ({}))) as {
      ref?: unknown;
      color?: unknown;
      composition?: unknown;
      texture?: unknown;
      imageUrl?: unknown;
      off?: unknown;
      consultationId?: unknown;
      voiceSessionId?: unknown;
      sessionLabel?: unknown;
    };

    const ref = String(body.ref ?? "").trim();
    if (!ref) return NextResponse.json({ error: "缺少款号。" }, { status: 400 });
    const off = body.off === true;
    const consultationId = typeof body.consultationId === "string" ? body.consultationId.trim() : "";
    const voiceSessionId = typeof body.voiceSessionId === "string" ? body.voiceSessionId.trim() : "";
    const sessionLabel = typeof body.sessionLabel === "string" ? body.sessionLabel : null;
    const label = [String(body.color ?? ""), String(body.composition ?? "")].filter(Boolean).join(" · ") || ref;

    await logVoice("sku_picked", { ref, off, label }, sessionLabel);

    if (consultationId) {
      const current = await getConsultation(actor, consultationId);
      if (current) {
        await updateConsultation(actor, current.id, {
          // 取消就清空：库里留着一个他已经否掉的款，比没有更糟
          selectedSkuId: off ? null : ref,
          selectedSkuSnapshot: off
            ? {}
            : {
                sku_id: ref,
                color: String(body.color ?? ""),
                composition: String(body.composition ?? ""),
                pattern_level: String(body.texture ?? ""),
                image_url: String(body.imageUrl ?? "")
              }
        });
      }
    }
    if (voiceSessionId && !off) {
      await appendTap(actor, voiceSessionId, {
        kind: "sku",
        id: ref,
        label,
        at: new Date().toISOString()
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error, "记下这一款失败。");
  }
}
