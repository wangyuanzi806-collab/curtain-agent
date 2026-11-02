import { NextResponse } from "next/server";
import { safeUploadFileToR2 } from "@/lib/r2";
import { validateImageFile } from "@/lib/files";
import { requireOrganizationAdminMfa } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 通用图片上传接口，返回 R2 key（后台管理用） */
export async function POST(request: Request) {
  try {
    await requireOrganizationAdminMfa();
    const formData = await request.formData();
    const file = formData.get("file");
    const prefix = String(formData.get("prefix") || "admin");

    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "文件不能为空" }, { status: 400 });
    }

    validateImageFile(file, "上传图片");

    const result = await safeUploadFileToR2(file, prefix);
    if (!result) {
      return NextResponse.json({ error: "上传失败，请检查 R2 配置" }, { status: 500 });
    }

    // 构造公开访问 URL（如果有 R2 公开域名，在这里拼接）
    const publicUrl = process.env.R2_PUBLIC_URL
      ? `${process.env.R2_PUBLIC_URL}/${result.key}`
      : result.key;

    return NextResponse.json({ key: result.key, url: publicUrl });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
