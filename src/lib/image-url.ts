/**
 * 走 Next 的图片优化管线出缩略图。
 *
 * 商品白底图原始尺寸约 836×836、单张 76–249 KB，而界面上的色板格子只有 60×46。
 * 直接挂原图等于下载两百多倍于所需的像素：问卷 31 个格子合计约 4.6 MB，
 * 商品目录 200 张更是让页面十几秒打不开——这就是"图片刷得很慢"的由来。
 *
 * width 必须是 next.config 的 imageSizes / deviceSizes 里已有的值，否则优化接口会拒绝。
 * 默认可用：16 32 48 64 96 128 256 384，以及 640 750 828 1080 1200 1920 2048 3840。
 */
export function thumb(url: string, width: number) {
  if (!url || url.startsWith("data:") || url.startsWith("/_next/")) return url;
  return `/_next/image?url=${encodeURIComponent(url)}&w=${width}&q=70`;
}
