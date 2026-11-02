import Image from "next/image";
import Link from "next/link";
import LanguageToggle from "@/components/royalzen/language-toggle";

export default function CustomerSharePage() {
  return (
    <main className="rz-share-page">
      <header className="rz-share-nav"><Link className="rz-brand" href="/share/demo"><span className="rz-brand-mark">RZ</span><span><strong>RoyalZen</strong><small>CURTAIN ADVISOR</small></span></Link><div><span>为 Sophie Laurent 准备</span><LanguageToggle compact /></div></header>
      <section className="rz-share-hero"><div><span className="rz-eyebrow">YOUR CURTAIN PROPOSAL</span><h1>更安静、更温暖的<br />客厅光线。</h1><p>我们为你的转角窗选择了暖米色亚麻遮光帘，让自然木色得到延续，同时保留房间原有的明亮感。</p></div><div className="rz-share-hero-image"><Image alt="RoyalZen 暖米色窗帘搭配氛围图" fill priority sizes="(max-width: 800px) 100vw, 58vw" src="/demo/preview-curtain-warm.jpg" /></div></section>
      <section className="rz-share-product"><span className="rz-share-index">01</span><div><span className="rz-eyebrow">ROYALZEN RECOMMENDS</span><h2>Siena 亚麻遮光帘</h2><p>暖米色 · 亚麻纹理 · 90% 遮光</p><div className="rz-share-reasons"><span>适配转角轨道</span><span>协调浅橡木家具</span><span>兼顾采光与隐私</span></div></div><div className="rz-share-product-image"><Image alt="Siena 亚麻遮光帘商品图" fill sizes="(max-width: 800px) 100vw, 35vw" src="/demo/curtain-beige.jpg" /></div></section>
      <section className="rz-share-note"><span className="rz-eyebrow">A NOTE FROM YOUR ADVISOR</span><blockquote>“没有选择纯白，是因为暖米色能更自然地连接木质家具和奶油墙面；安装时建议采用顶装转角轨道，让窗户显得更完整。”</blockquote><p>Demo Advisor · RoyalZen Antwerp</p></section>
      <footer className="rz-share-footer"><div><strong>想查看面料实物？</strong><p>联系我们预约门店看样或上门测量。</p></div><a href="mailto:advisor@royalzen.com">联系我的顾问</a></footer>
      <p className="rz-share-disclaimer">AI 搭配预览用于辅助选择，实际颜色、纹理和垂感请以面料样品及最终安装为准。</p>
    </main>
  );
}
