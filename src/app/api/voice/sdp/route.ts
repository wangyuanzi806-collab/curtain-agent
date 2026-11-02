import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { getCurrentActor } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 把 WebRTC 的那一次握手（SDP offer → answer）改由服务端转发。
 *
 * **为什么需要它**：建连的信令这一跳原本是浏览器直接 POST 到
 * `api.openai.com/v1/realtime/calls`。在比利时门店这样最快；但在中国大陆的
 * 手机网络上，浏览器根本连不上那个域名——服务端在 Vercel 连得上（所以凭证
 * 铸得出来），手机连不上（所以 SDP 换不了）。表现就是屏幕停在「交换 SDP」，
 * 而所有日志都显示凭证是好的。老板 2026-08-03 在 5G 上撞的就是这个。
 *
 * 所以页面先试直连，失败才回落到这里。两边都不牺牲：
 * 门店走直连的快路径，墙内走转发。
 *
 * **只转发信令，不碰音频。** 媒体流仍然由浏览器与 OpenAI 的媒体服务器直连
 * （ICE/DTLS/SRTP），这条路由每场通话只被调用一次、只传一段几 KB 的文本。
 * 把音频也绕经服务端会牺牲实时性，老板 08-01 明确决定不改。
 *
 * 用的是页面手上那枚 600 秒的临时凭证，不是主密钥——主密钥永远不进浏览器
 * 这条约束不因为多一跳而松动。
 */
export async function POST(request: Request) {
  try {
    // 认证只为挡住外人白嫖这条转发，凭证本身才是对 OpenAI 的身份
    await getCurrentActor();

    const model = new URL(request.url).searchParams.get("model")?.trim();
    const ephemeral = request.headers.get("x-ephemeral-key")?.trim();
    if (!model || !ephemeral) {
      return NextResponse.json({ error: "缺少 model 或凭证。" }, { status: 400 });
    }

    const offer = await request.text();
    if (!offer.startsWith("v=")) {
      return NextResponse.json({ error: "offer 不是一段 SDP。" }, { status: 400 });
    }

    const upstream = await fetch(
      `https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(model)}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${ephemeral}`, "Content-Type": "application/sdp" },
        body: offer,
        signal: AbortSignal.timeout(30_000)
      }
    );

    const answer = await upstream.text();
    if (!upstream.ok) {
      return NextResponse.json(
        { error: "OpenAI 拒绝了这次握手。", status: upstream.status, detail: answer.slice(0, 300) },
        { status: 502 }
      );
    }

    // 原样把 answer 回给页面：它要直接喂给 setRemoteDescription
    return new NextResponse(answer, {
      status: 200,
      headers: { "content-type": "application/sdp" }
    });
  } catch (error) {
    return apiError(error, "交换 SDP 失败。");
  }
}
