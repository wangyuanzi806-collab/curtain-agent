"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import Icon from "@/components/royalzen/icon";
import LanguageToggle from "@/components/royalzen/language-toggle";
import type { WorkspaceActor } from "@/lib/platform-db";

const ADMIN_NAV = [
  { href: "/admin", label: "机构概览", icon: "home" as const, prefetch: false },
  { href: "/admin/team", label: "团队与权限", icon: "users" as const, prefetch: false },
  { href: "/admin/fabrics", label: "面料管理", icon: "material" as const, prefetch: false },
  { href: "/admin/skus", label: "SKU 管理", icon: "products" as const, prefetch: false },
  { href: "/admin/knowledge", label: "知识库", icon: "knowledge" as const, prefetch: false },
  { href: "/admin/history", label: "任务与历史", icon: "history" as const, prefetch: false },
];
const NAVIGATION_PROGRESS_DELAY_MS = 250;

export default function AdminShell({ children, actor, showPlatformAdmin }: { children: React.ReactNode; actor: WorkspaceActor; showPlatformAdmin: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [navigationPending, setNavigationPending] = useState(false);
  const progressTimer = useRef<number | null>(null);
  const prefetchedRoutes = useRef(new Set<string>());
  const isActive = (href: string) => href === "/admin" ? pathname === href : pathname.startsWith(href);

  useEffect(() => {
    if (progressTimer.current !== null) {
      window.clearTimeout(progressTimer.current);
      progressTimer.current = null;
    }
    setNavigationPending(false);
  }, [pathname]);

  useEffect(() => () => {
    if (progressTimer.current !== null) window.clearTimeout(progressTimer.current);
  }, []);

  useEffect(() => {
    if (!navigationPending) return;
    const timeout = window.setTimeout(() => setNavigationPending(false), 12_000);
    return () => window.clearTimeout(timeout);
  }, [navigationPending]);

  const handleNavigationClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
    if (!target || target.target === "_blank" || target.hasAttribute("download")) return;
    const destination = new URL(target.href, window.location.href);
    if (destination.origin !== window.location.origin || destination.href === window.location.href) return;
    if (progressTimer.current !== null) window.clearTimeout(progressTimer.current);
    progressTimer.current = window.setTimeout(() => setNavigationPending(true), NAVIGATION_PROGRESS_DELAY_MS);
    setOpen(false);
  };

  const prefetchOnIntent = (href: string) => {
    if (prefetchedRoutes.current.has(href)) return;
    prefetchedRoutes.current.add(href);
    router.prefetch(href);
  };

  return (
    <div className="rz-admin-shell" onClickCapture={handleNavigationClick}>
      {navigationPending ? <div aria-live="polite" className="rz-navigation-progress" role="status"><span className="rz-navigation-spinner" /><span><strong>正在打开页面</strong><small>已收到点击，正在加载...</small></span></div> : null}
      <button aria-label="关闭后台导航" className={`rz-nav-scrim ${open ? "is-open" : ""}`} onClick={() => setOpen(false)} type="button" />
      <aside className={`rz-admin-sidebar ${open ? "is-open" : ""}`}>
        <div className="rz-sidebar-head"><Link className="rz-brand" href="/admin" onFocus={() => prefetchOnIntent("/admin")} onMouseEnter={() => prefetchOnIntent("/admin")} onTouchStart={() => prefetchOnIntent("/admin")} prefetch={false}><span className="rz-brand-mark">RZ</span><span><strong>RoyalZen</strong><small>ORGANIZATION ADMIN</small></span></Link><button aria-label="关闭后台导航" className="rz-icon-button rz-mobile-only" onClick={() => setOpen(false)} type="button"><Icon name="close" /></button></div>
        <div className="rz-admin-org"><span className="rz-org-dot" /><span><small>当前机构</small><strong>{actor.organizationName}</strong></span></div>
        <nav aria-label="机构管理导航"><span className="rz-nav-label">机构管理</span>{ADMIN_NAV.map((item) => <Link className={isActive(item.href) ? "is-active" : ""} href={item.href} key={item.href} onClick={() => setOpen(false)} onFocus={() => prefetchOnIntent(item.href)} onMouseEnter={() => prefetchOnIntent(item.href)} onTouchStart={() => prefetchOnIntent(item.href)} prefetch={item.prefetch}><Icon name={item.icon} size={17} />{item.label}</Link>)}</nav>
        <div className="rz-admin-sidebar-foot"><Link href="/app"><Icon name="arrow" size={16} />返回顾问工作台</Link>{showPlatformAdmin ? <Link href="/platform"><Icon name="building" size={16} />平台管理</Link> : null}</div>
      </aside>
      <div className="rz-admin-main">
        <header className="rz-admin-topbar"><button aria-label="打开后台导航" className="rz-icon-button rz-mobile-only" onClick={() => setOpen(true)} type="button"><Icon name="menu" /></button><span>机构管理后台</span><div><LanguageToggle compact /><span className="rz-admin-health"><span className="rz-status-dot" />系统正常</span></div></header>
        <main>{children}</main>
      </div>
    </div>
  );
}
