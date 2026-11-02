import { NextResponse } from "next/server";
import {
  addKnowledgeDoc,
  listKnowledgeDocs,
  searchKnowledgeDocs
} from "@/lib/knowledge-base";
import { getCurrentActor, requireOrganizationAdminMfa } from "@/lib/auth";
import { apiError } from "@/lib/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await getCurrentActor();
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q")?.trim() || "";
    const category = searchParams.get("category")?.trim() || "";
    const tag = searchParams.get("tag")?.trim() || "";
    const limit = Number(searchParams.get("limit") || 100);

    const docs = q
      ? await searchKnowledgeDocs({
          roomType: q,
          style: q,
          desiredColor: q,
          opacityNeed: q,
          extraInstruction: q,
          limit
        })
      : await listKnowledgeDocs(limit);

    const filtered = docs.filter((doc) => {
      const categoryMatch = category
        ? doc.category.toLowerCase().includes(category.toLowerCase())
        : true;
      const tagMatch = tag ? doc.tags.toLowerCase().includes(tag.toLowerCase()) : true;
      return categoryMatch && tagMatch;
    });

    return NextResponse.json({
      items: filtered,
      total: filtered.length
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取知识库失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requireOrganizationAdminMfa();
    const body = (await request.json()) as {
      title?: string;
      category?: string;
      tags?: string;
      content?: string;
      source?: string;
    };

    if (!body.title?.trim() || !body.content?.trim()) {
      return NextResponse.json(
        { error: "请至少填写知识标题和知识内容。" },
        { status: 400 }
      );
    }

    const item = await addKnowledgeDoc({
      title: body.title.trim(),
      category: body.category?.trim() || "general",
      tags: body.tags?.trim() || "",
      content: body.content.trim(),
      source: body.source?.trim() || "Manual"
    });

    return NextResponse.json({ item });
  } catch (error) {
    return apiError(error, "新增知识失败。");
  }
}
