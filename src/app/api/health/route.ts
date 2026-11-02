import { NextResponse } from "next/server";
import { pingDatabase } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const startedAt = Date.now();
    await pingDatabase();

    return NextResponse.json({
      ok: true,
      model: process.env.ARK_IMAGE_MODEL || "doubao-seedream-5-0-260128",
      storage: {
        r2Configured: Boolean(
          process.env.R2_ENDPOINT &&
          process.env.R2_BUCKET_NAME &&
          process.env.R2_ACCESS_KEY_ID &&
          process.env.R2_SECRET_ACCESS_KEY
        ),
        r2PublicUrlConfigured: Boolean(process.env.R2_PUBLIC_URL)
      },
      auth: {
        configured: Boolean(
          process.env.NEXT_PUBLIC_SUPABASE_URL &&
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        )
      },
      agents: {
        qwenConfigured: Boolean(process.env.QWEN_API_KEY),
        kimiConfigured: Boolean(process.env.KIMI_API_KEY)
      },
      // 线上跑的是哪个提交。2026-08-03 花了一个多小时才查清「代码推了但线上没变」，
      // 全程只能靠「猜某个接口的状态码」来反推版本——那种排查不该再发生一次。
      // Git 部署时 Vercel 会注入这个变量；CLI 手工部署时没有，于是显示 unknown，
      // 这本身也是有用的信息：说明这一版不是从 Git 自动上来的。
      commit: (process.env.VERCEL_GIT_COMMIT_SHA || "unknown").slice(0, 7),
      databaseLatencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "\u5065\u5eb7\u68c0\u67e5\u5931\u8d25\u3002";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
