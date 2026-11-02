import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { getCurrentActor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getFileFromR2 } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 按资产 id 取图。
 *
 * 2026-08-01 之前落库的 scene_image_url 都是 `/api/assets/<id>` 这个形状，
 * 之后改成了 `/api/assets?key=…`，而按 id 取的这条路由一直没建——
 * 于是那之前的历史咨询封面全是 404，列表里一排灰块。老链接不能改写了事：
 * 分享出去的方案页也用同一个地址。
 *
 * 与 ?key= 那条不同，这里查得到归属，所以把权限校验补上：
 * 私有资产是客户家里的照片，不该跨机构可读。
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getCurrentActor();
    const { id } = await params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return NextResponse.json({ error: "无效的图片地址。" }, { status: 400 });
    }

    const db = getDb();
    const result = await db.query(
      `select object_key, content_type
         from private_assets
        where id = $1 and organization_id = $2`,
      [id, actor.organizationId]
    );
    const row = result.rows[0] as { object_key?: string; content_type?: string } | undefined;
    if (!row?.object_key) {
      console.warn(`[assets] 没有这条资产记录 id=${id} org=${actor.organizationId}`);
      return NextResponse.json({ error: "图片不存在。" }, { status: 404 });
    }

    const file = await getFileFromR2(String(row.object_key));
    if (!file) {
      console.warn(`[assets] 记录在库里但对象不在存储里 id=${id}`);
      return NextResponse.json({ error: "图片不存在。" }, { status: 404 });
    }

    const body = file.body.buffer.slice(
      file.body.byteOffset,
      file.body.byteOffset + file.body.byteLength
    ) as ArrayBuffer;
    return new NextResponse(body, {
      headers: {
        "Content-Type": file.contentType || String(row.content_type || "image/jpeg"),
        "Cache-Control": "private, max-age=3600"
      }
    });
  } catch (error) {
    return apiError(error, "读取图片失败。");
  }
}
