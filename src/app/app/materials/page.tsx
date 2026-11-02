import FabricBrowser, { type Fabric } from "@/components/royalzen/fabric-browser";
import { getCurrentActor } from "@/lib/auth";
import { getCachedSkuCatalog } from "@/lib/catalog-cache";

export const dynamic = "force-dynamic";

/**
 * 面料库：看料子本身。
 *
 * 此前这一页显示 4 条硬编码的假面料（经典花卉、抽象树叶、棕榈刺绣、民族赤陶），
 * 与库里真卖的 985 款毫无关系；它读的 `curtain_fabrics` 表一直是 0 条，
 * 所以永远走兜底、永远显示那 4 条。顾问拿它给客户看，看到的是不存在的商品。
 *
 * 现在读真实的 985 款，优先展示面料细节图（看得见织纹），
 * 细节图还没补的先用白底成品图顶着并明确标注。
 */
export default async function MaterialsPage() {
  await getCurrentActor();
  const catalog = await getCachedSkuCatalog(4000).catch(() => []);
  const fabrics: Fabric[] = catalog.map((item) => ({
    sku_id: item.sku_id,
    name: item.name,
    composition: item.composition,
    weight_gsm: item.weight_gsm,
    color_rgb: item.color_rgb,
    color_family: item.color_family,
    color_chroma: item.color_chroma,
    value_level: item.value_level,
    pattern_level: item.pattern_level,
    material_class: item.material_class,
    material_type: item.material_type,
    image_url: item.image_url,
    detail_image_url: item.detail_image_url
  }));

  return (
    <div className="rz-page">
      <header className="rz-page-heading">
        <div>
          <span className="rz-eyebrow">MATERIAL LIBRARY</span>
          <h1>面料库</h1>
          <p>看料子本身的织纹与手感。商品目录看的是成品挂起来的样子，这里看的是布。</p>
        </div>
      </header>
      <FabricBrowser initialFabrics={fabrics} />
    </div>
  );
}
