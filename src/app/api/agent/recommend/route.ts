import { NextResponse } from "next/server";
import { fileToDataUrl, validateImageFile } from "@/lib/files";
import { runAgentRecommendation } from "@/lib/agent-provider";
import { apiError } from "@/lib/api-response";
import { getCurrentActor } from "@/lib/auth";
import { consumeRateLimit, RequestSecurityError } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const actor = await getCurrentActor();
    consumeRateLimit(`agent-recommend:${actor.userId}`, { limit: 6, windowMs: 60_000 });
    const contentType = request.headers.get("content-type") || "";
    let body: {
      modelId?: string;
      roomType?: string;
      style?: string;
      desiredColor?: string;
      opacityNeed?: string;
      extraInstruction?: string;
      sceneImageDataUrl?: string;
    };

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const scene = formData.get("scene");
      let sceneImageDataUrl: string | undefined;

      if (scene instanceof File && scene.size > 0) {
        validateImageFile(scene, "家庭场景图");
        sceneImageDataUrl = await fileToDataUrl(scene);
      }

      body = {
        modelId: String(formData.get("modelId") || ""),
        roomType: String(formData.get("roomType") || ""),
        style: String(formData.get("style") || ""),
        desiredColor: String(formData.get("desiredColor") || ""),
        opacityNeed: String(formData.get("opacityNeed") || ""),
        extraInstruction: String(formData.get("extraInstruction") || ""),
        sceneImageDataUrl
      };
    } else {
      body = (await request.json()) as {
        modelId?: string;
        roomType?: string;
        style?: string;
        desiredColor?: string;
        opacityNeed?: string;
        extraInstruction?: string;
        sceneImageDataUrl?: string;
      };
    }

    if (!body.modelId) {
      return NextResponse.json(
        { error: "\u8bf7\u9009\u62e9\u667a\u80fd\u4f53\u6a21\u578b\u3002" },
        { status: 400 }
      );
    }

    const result = await runAgentRecommendation({
      modelId: body.modelId,
      roomType: body.roomType || "",
      style: body.style || "",
      desiredColor: body.desiredColor || "",
      opacityNeed: body.opacityNeed || "",
      extraInstruction: body.extraInstruction || "",
      sceneImageDataUrl: body.sceneImageDataUrl || undefined
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status, headers: error.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : undefined }
      );
    }
    return apiError(error, "\u667a\u80fd\u4f53\u63a8\u8350\u5931\u8d25\u3002");
  }
}
