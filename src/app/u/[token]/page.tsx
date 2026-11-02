import type { Metadata } from "next";
import PhoneUpload from "@/components/royalzen/phone-upload";

export const metadata: Metadata = {
  title: "DRAPÉ",
  // 这个链接不该被索引，也不该在别人的分享卡片里预览出来
  robots: { index: false, follow: false }
};

export const dynamic = "force-dynamic";

/**
 * 顾客扫码后落在这里。
 *
 * **整页只有一个按钮。** 不登录、不装 App、不问他是谁——他是在别人店里
 * 用自己手机扫一个码，多一步都会让他放弃，而放弃的代价是这条线索少一张照片。
 *
 * 页面不做任何鉴权判断：token 对不对由上传那一刻的接口说了算。
 * 提前校验意味着这个页面得先读一次咨询单，而**这条路只许写不许读**。
 */
export default async function PhoneUploadPage({
  params
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <PhoneUpload token={token} />;
}
