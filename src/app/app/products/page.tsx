import Link from "next/link";
import ProductBrowser from "@/components/royalzen/product-browser";
import Icon from "@/components/royalzen/icon";
import { getCurrentActor } from "@/lib/auth";
import { getCachedSkuCatalog } from "@/lib/catalog-cache";
import { hasOrganizationAdminAccess } from "@/lib/organization-role";

export default async function ProductsPage() {
  const actor = await getCurrentActor();
  // 要按标签筛就得全部在手上。取 200 的话点「羊毛」只在前 200 款里找，
  // 而库里 985 款——顾问会以为剩下那些不存在
  const products = await getCachedSkuCatalog(4000).catch(() => []);

  return (
    <div className="rz-page">
      <header className="rz-page-heading"><div><span className="rz-eyebrow">PRODUCT CATALOG</span><h1>商品目录</h1><p>浏览当前机构可推荐的窗帘 SKU，可按编号名称搜索，或按颜色、深浅、花纹、质感、布纱叠加筛选。</p></div>{hasOrganizationAdminAccess(actor.role) ? <Link className="rz-button rz-button-secondary" href="/admin/skus"><Icon name="settings" size={17} />管理商品数据</Link> : null}</header>
      <ProductBrowser initialProducts={products} />
    </div>
  );
}
