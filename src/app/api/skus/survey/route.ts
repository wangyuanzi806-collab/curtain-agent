import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api-response";
import { getCurrentActor } from "@/lib/auth";
import { getCachedSkuCatalog } from "@/lib/catalog-cache";
import { colorBucket } from "@/lib/sku-facets";
import type { SkuCatalogItem } from "@/lib/sku-catalog";
import {
  COLOR_FAMILIES,
  MATERIAL_CLASSES,
  SURVEY_TAGS,
  VALUE_LEVELS,
  evaluateSurvey,
  type SurveyAnswers
} from "@/lib/curtain-survey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const answersSchema = z.object({
  opacityNeed: z.enum(["keep_light", "day_privacy", "dark_sleep", "max_block"]).nullish(),
  // 最多三个颜色。再多等于没筛选
  colors: z.array(z.enum(COLOR_FAMILIES)).max(3).default([]),
  valueLevels: z.array(z.enum(VALUE_LEVELS)).max(VALUE_LEVELS.length).default([]),
  // 色板实际点中的格子。少了它，这里数出来的"还剩多少款"会比真实筛选结果多
  colorCells: z.array(z.string()).max(24).default([]),
  texture: z.enum(["solid", "texture", "pattern"]).nullish(),
  materials: z.array(z.enum(MATERIAL_CLASSES)).max(MATERIAL_CLASSES.length).default([]),
  fabricType: z.enum(["cloth", "layered", "sheer"]).nullish(),
  tags: z.array(z.enum(SURVEY_TAGS)).max(SURVEY_TAGS.length).default([]),
  note: z.string().trim().max(1000).default("")
});

/**
 * 每个色块格子的代表色。
 *
 * 取该格所有商品 `color_rgb` 的中位色（按明度排序取中间那款），而不是平均——
 * 平均会把一撮米白和一撮芥末黄算成一个不存在的土黄。
 */
function medianItem(items: SkuCatalogItem[]) {
  const withColor = items
    .filter((item) => item.color_rgb && item.color_lab_l !== null && item.color_lab_l !== undefined)
    .sort((a, b) => (a.color_lab_l as number) - (b.color_lab_l as number));
  return withColor.length ? withColor[Math.floor(withColor.length / 2)] : null;
}

function medianColor(items: SkuCatalogItem[]) {
  return medianItem(items)?.color_rgb || null;
}

/**
 * 问卷的选项数据：每个选项有多少款、色板每格是什么颜色。
 *
 * 空格子不返回——让客户选了一个必然得到零结果的格子，是最没必要的挫败。
 *
 * **只有颜色题给图形，其余各题只给文字。** 原先花纹、质感、布纱三题各配一张
 * 成品缩略图，实测全是帮倒忙：「棉麻」挑出满版树叶、「柔垂」挑出几何小图案、
 * 「布帘」挑出蓝白格子，客户看图学到的是错的对应关系；而「羊毛/顺滑/混纺」
 * 三张都是素净灰，根本分不出。换过选图规则也没用——细肌理与素净的差别
 * 在 62px 高的成品缩略图上本来就呈现不出来，客户看到的只是两款颜色不同的窗帘，
 * 无从判断差异来自哪里。
 *
 * 颜色是唯一例外：色块本身就是那个颜色，不存在"表达不准"的问题。
 * 而且色块取自商品自己的 `color_rgb`，不是外部参考图——客户点中的色块，
 * 就是库里真有的那些布的颜色。
 */
export async function GET() {
  try {
    await getCurrentActor();
    const catalog = await getCachedSkuCatalog(4000);

    const grouped = new Map<string, SkuCatalogItem[]>();
    const countBy = (key: keyof (typeof catalog)[number]) => {
      const acc = new Map<string, number>();
      for (const item of catalog) {
        const value = item[key];
        if (!value) continue;
        acc.set(String(value), (acc.get(String(value)) || 0) + 1);
      }
      return Object.fromEntries(acc);
    };

    for (const item of catalog) {
      if (!item.color_family || !item.value_level) continue;
      const key = `${colorBucket(item)}/${item.value_level}`;
      const list = grouped.get(key) || [];
      list.push(item);
      grouped.set(key, list);
    }

    const swatches = [...grouped.entries()]
      .map(([key, items]) => {
        const [colorFamily, valueLevel] = key.split("/");
        return {
          colorFamily,
          valueLevel,
          count: items.length,
          hex: medianColor(items),
          // 图仍然给：色块用来选，图用来确认「这块布挂起来什么样」。
          // 取该格中位色那一款，而不是排序碰巧第一的那款
          imageUrl: medianItem(items)?.image_url || items[0].image_url
        };
      })
      .filter((row) => row.hex)
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({
      total: catalog.length,
      swatches,
      materials: countBy("material_class"),
      patterns: countBy("pattern_level"),
      fabricTypes: countBy("material_type")
    });
  } catch (error) {
    return apiError(error, "读取筛选选项失败。");
  }
}

/**
 * 每答一题就刷新一次剩余数量。
 *
 * 客户最怕的是认真填完六题、结果一款也没有。所以数量必须在她还能改的时候就摆在眼前，
 * 而不是等到提交后才说。零结果时一并给出该放宽哪一项。
 */
export async function POST(request: Request) {
  try {
    await getCurrentActor();
    const parsed = answersSchema.parse(await request.json().catch(() => ({})));
    const answers: SurveyAnswers = {
      opacityNeed: parsed.opacityNeed ?? null,
      colors: parsed.colors,
      valueLevels: parsed.valueLevels,
      colorCells: parsed.colorCells,
      texture: parsed.texture ?? null,
      materials: parsed.materials,
      fabricType: parsed.fabricType ?? null,
      tags: parsed.tags,
      note: parsed.note
    };

    const catalog = await getCachedSkuCatalog(4000);
    return NextResponse.json({ total: catalog.length, ...evaluateSurvey(catalog, answers) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "筛选条件格式不正确。", issues: error.issues }, { status: 400 });
    }
    return apiError(error, "读取商品数量失败。");
  }
}
