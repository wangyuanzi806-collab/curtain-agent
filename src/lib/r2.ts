import { randomUUID } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

type UploadResult = { key: string };
type DownloadResult = {
  body: Uint8Array;
  contentType: string;
};

let client: S3Client | null = null;

function getClient() {
  if (!client) {
    if (!process.env.R2_ENDPOINT) {
      throw new Error("R2_ENDPOINT is missing.");
    }
    if (!process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
      throw new Error("R2 credentials are missing.");
    }

    client = new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
      }
    });
  }

  return client;
}

function getBucketName() {
  if (!process.env.R2_BUCKET_NAME) {
    throw new Error("R2_BUCKET_NAME is missing.");
  }
  return process.env.R2_BUCKET_NAME;
}

async function saveBodyToR2(
  body: Uint8Array | Buffer,
  contentType: string,
  prefix: string,
  extension: string
): Promise<UploadResult> {
  // ⚠️ `curtain-studio/` 是第一代产品留下的存储前缀，路由虽已下线但前缀不能改：
  // 线上所有已归档的场景图与效果图都在这个前缀下，改了就取不到。
  const key = `curtain-studio/${prefix}/${Date.now()}-${randomUUID()}.${extension}`;

  await getClient().send(
    new PutObjectCommand({
      Bucket: getBucketName(),
      Key: key,
      Body: body,
      ContentType: contentType
    })
  );

  return { key };
}

export async function safeUploadFileToR2(file: File, prefix: string): Promise<UploadResult | null> {
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const extension = file.name.includes(".") ? file.name.split(".").pop() || "jpg" : "jpg";
    return await saveBodyToR2(buffer, file.type || "application/octet-stream", prefix, extension);
  } catch (error) {
    console.error("Failed to upload file to R2:", error);
    return null;
  }
}

export async function safeUploadBytesToR2(
  body: Uint8Array | Buffer,
  contentType: string,
  prefix: string
): Promise<UploadResult | null> {
  try {
    const extension = contentType.includes("png") ? "png" : "jpg";
    return await saveBodyToR2(body, contentType || "image/jpeg", prefix, extension);
  } catch (error) {
    console.error("Failed to upload raw bytes to R2:", error);
    return null;
  }
}

export async function safeUploadExternalToR2(
  url: string,
  prefix: string,
  options: { timeoutMs?: number } = {}
): Promise<UploadResult | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(options.timeoutMs ?? 45_000)
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch provider output: ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    const body = Buffer.from(await response.arrayBuffer());
    return await safeUploadBytesToR2(body, contentType, prefix);
  } catch (error) {
    console.error("Failed to upload provider result to R2:", error);
    return null;
  }
}

export async function getFileFromR2(key: string): Promise<DownloadResult | null> {
  try {
    const response = await getClient().send(
      new GetObjectCommand({
        Bucket: getBucketName(),
        Key: key
      })
    );

    if (!response.Body) {
      return null;
    }

    return {
      body: await response.Body.transformToByteArray(),
      contentType: response.ContentType || "image/jpeg"
    };
  } catch (error) {
    console.error("Failed to read file from R2:", error);
    return null;
  }
}
