import { NextResponse } from "next/server";
import { ensureSchema, listStyles, listFabrics } from "@/lib/db";
import { getDb } from "@/lib/db";
import { requireOrganizationAdminMfa } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 给现有款式和面料填充英文翻译（一次性种子） */
export async function POST() {
  await requireOrganizationAdminMfa();
  await ensureSchema();
  const db = getDb();

  // ===== 款式英文 =====
  const styleEn: Record<string, { nameEn: string; descEn: string; windowsEn: string }> = {
    "style-valance": { nameEn: "Valance Curtain", descEn: "Classic valance with decorative header for an elegant atmosphere.", windowsEn: "Floor-to-ceiling, Large windows" },
    "style-roman": { nameEn: "Roman Shade", descEn: "Foldable fabric shade creating beautiful layered folds.", windowsEn: "Small-medium, Square windows" },
    "style-sheer": { nameEn: "Sheer Curtain", descEn: "Lightweight translucent curtain with soft romantic lighting.", windowsEn: "All window types" },
    "style-pleated": { nameEn: "Pleated Curtain", descEn: "Neat pleated design, clean and modern.", windowsEn: "Standard, Bay windows" },
    "style-roller": { nameEn: "Roller Blind", descEn: "Roll-up mechanism, easy to operate and space-saving.", windowsEn: "Small, Square, Bathroom windows" },
  };

  for (const [id, v] of Object.entries(styleEn)) {
    await db.query(
      `UPDATE curtain_styles SET name_en=$1, description_en=$2, suitable_windows_en=$3 WHERE id=$4`,
      [v.nameEn, v.descEn, v.windowsEn, id]
    );
  }

  // ===== 面料英文 =====
  const fabricEn: Record<string, { descEn: string; colorEn: string; materialEn: string; tagsEn: string }> = {
    "fabric-floral-classic": {
      descEn: "Off-white base with black and red floral pattern, perfect for French, luxury and American style spaces.",
      colorEn: "Off-white / Black-red floral",
      materialEn: "Polyester jacquard",
      tagsEn: "French, Luxury",
    },
    "fabric-abstract-leaf": {
      descEn: "Coral pink and mint green abstract leaf pattern, ideal for Nordic, modern minimal and natural styles.",
      colorEn: "Coral pink / Mint green",
      materialEn: "Cotton-linen blend",
      tagsEn: "Nordic, Modern Minimal",
    },
    "fabric-palm-embroidery": {
      descEn: "Bronze base with embroidered palm tree pattern, great for coastal, hotel and mid-century spaces.",
      colorEn: "Bronze / Dark green",
      materialEn: "Chenille embroidery",
      tagsEn: "Coastal, Hotel style",
    },
    "fabric-ethnic-terracotta": {
      descEn: "Terracotta color with geometric ethnic patterns, ideal for Bohemian and natural village styles.",
      colorEn: "Terracotta / Cream geometric",
      materialEn: "Cotton woven",
      tagsEn: "Bohemian, Natural village",
    },
  };

  const fabrics = await listFabrics();
  for (const f of fabrics) {
    const en = fabricEn[f.id];
    if (en) {
      await db.query(
        `UPDATE curtain_fabrics SET description_en=$1, color_en=$2, material_en=$3, style_tags_en=$4 WHERE id=$5`,
        [en.descEn, en.colorEn, en.materialEn, en.tagsEn, f.id]
      );
    }
  }

  return NextResponse.json({ ok: true, styles: Object.keys(styleEn).length, fabrics: Object.keys(fabricEn).length });
}
