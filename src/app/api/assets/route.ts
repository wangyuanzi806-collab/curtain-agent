import { NextResponse } from "next/server";
import { getFileFromR2 } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key") || "";
  if (!key.startsWith("curtain-studio/") || key.includes("..")) {
    return NextResponse.json({ error: "无效的图片地址。" }, { status: 400 });
  }

  const file = await getFileFromR2(key);
  if (!file) return NextResponse.json({ error: "图片不存在。" }, { status: 404 });
  const body = file.body.buffer.slice(
    file.body.byteOffset,
    file.body.byteOffset + file.body.byteLength
  ) as ArrayBuffer;
  return new NextResponse(body, {
    headers: {
      "Content-Type": file.contentType,
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400"
    }
  });
}
