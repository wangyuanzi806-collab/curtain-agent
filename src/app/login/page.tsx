import Image from "next/image";
import Link from "next/link";
import LoginActions from "@/components/royalzen/login-actions";
import LanguageToggle from "@/components/royalzen/language-toggle";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const params = await searchParams;
  const initialError = Array.isArray(params.error) ? params.error[0] : params.error;

  return (
    <main className="rz-login-shell">
      <section className="rz-login-visual">
        <Image alt="暖色客厅与大窗户" fill priority sizes="(max-width: 900px) 100vw, 58vw" src="/demo/scene-bay-window.jpg" />
        <div className="rz-login-overlay" />
        <Link className="rz-login-brand" href="/">
          <span className="rz-brand-mark is-light">RZ</span>
          <span><strong>RoyalZen</strong><small>CURTAIN ADVISOR</small></span>
        </Link>
        <div className="rz-login-quote">
          <span className="rz-eyebrow is-light">AI CURTAIN ADVISOR</span>
          <h1>让每一块面料，<br />都找到适合它的空间。</h1>
          <p>从房间照片到真实 SKU 推荐，再到可视化效果图。</p>
        </div>
      </section>

      <section className="rz-login-panel">
        <div className="rz-login-language"><LanguageToggle /></div>
        <div className="rz-login-card">
          <span className="rz-eyebrow">员工工作台</span>
          <h2>欢迎回来</h2>
          <p>使用机构账号登录 RoyalZen 窗帘智能顾问。</p>

          <LoginActions initialError={initialError} />
          <p className="rz-login-note">仅受邀邮箱可进入员工工作台，客户分享页面不需要登录。</p>
        </div>
        <p className="rz-login-footer">仅限受邀员工与合作门店使用 · RoyalZen 2026</p>
      </section>
    </main>
  );
}
