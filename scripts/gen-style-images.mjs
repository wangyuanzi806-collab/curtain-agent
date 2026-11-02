/**
 * 用 Seedream API 生成 5 种窗帘款式的参考图
 * 用法: node scripts/gen-style-images.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "public", "styles");

const API_KEY = process.env.ARK_API_KEY;
const MODEL = process.env.ARK_IMAGE_MODEL || "doubao-seedream-5-0-260128";
const API_URL = "https://ark.cn-beijing.volces.com/api/v3/images/generations";

const STYLES = [
  {
    file: "valance.jpg",
    prompt:
      "A beautiful window with elegant valance curtain (帘头/平幔), showing a decorative fabric header pelmet at the top of the window with flowing curtain panels below, luxurious fabric draping, in a bright elegant living room, professional interior photography, warm natural lighting, high quality, 4K",
  },
  {
    file: "roman-shade.jpg",
    prompt:
      "A window with a classic roman shade blind, the fabric shade is partially raised showing its distinctive horizontal folds and pleats, clean lines, fabric neatly folded in layers when pulled up, in a modern bright room, professional interior photography, natural lighting, high quality, 4K",
  },
  {
    file: "pleated.jpg",
    prompt:
      "A large window with elegant pinch pleat curtains (百褶帘), showing beautiful vertical fabric pleats and folds, luxurious thick drapes hanging from curtain rod with pinch pleat hooks, in a sophisticated living room, professional interior photography, warm lighting, high quality, 4K",
  },
  {
    file: "roller.jpg",
    prompt:
      "A window with a modern roller blind (卷帘), showing a single piece of fabric partially rolled down from a cylindrical tube at the top, clean minimalist design, the fabric hanging flat without folds, in a modern office or bedroom, professional interior photography, natural lighting, high quality, 4K",
  },
];

async function generateImage(prompt) {
  if (!API_KEY) throw new Error("ARK_API_KEY is required.");
  console.log("  Calling Seedream API...");
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      size: "2048x2048",
      response_format: "url",
      watermark: false,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const url = data?.data?.[0]?.url;
  if (!url) throw new Error("No image URL in response: " + JSON.stringify(data));
  return url;
}

async function downloadImage(url, filepath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(filepath, buffer);
  console.log(`  Saved: ${filepath} (${buffer.length} bytes)`);
}

async function main() {
  // 确保输出目录存在
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const style of STYLES) {
    const outPath = path.join(OUT_DIR, style.file);
    console.log(`\n=== Generating: ${style.file} ===`);
    console.log(`  Prompt: ${style.prompt.slice(0, 80)}...`);

    try {
      const imageUrl = await generateImage(style.prompt);
      console.log(`  Image URL: ${imageUrl.slice(0, 80)}...`);
      await downloadImage(imageUrl, outPath);
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
    }
  }

  console.log("\nDone! Sheer curtain (sheer.jpg) was already downloaded from Pexels.");
}

main();
