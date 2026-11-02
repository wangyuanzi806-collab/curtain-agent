"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import Icon from "@/components/royalzen/icon";
import LanguageToggle from "@/components/royalzen/language-toggle";
import { hasOrganizationAdminAccess, organizationRoleLabel } from "@/lib/organization-role";
import type { WorkspaceActor } from "@/lib/platform-db";

const NAVIGATION = [
  { href: "/app", label: "工作台", icon: "home" as const, prefetch: false },
  { href: "/app/consultations/new", label: "新建咨询", icon: "plus" as const, prefetch: true },
  { href: "/app/voice", label: "语音顾问", icon: "voice" as const, prefetch: false },
  { href: "/app/products", label: "商品目录", icon: "products" as const, prefetch: true },
  { href: "/app/materials", label: "面料库", icon: "material" as const, prefetch: true },
  { href: "/app/knowledge", label: "搭配知识", icon: "knowledge" as const, prefetch: true },
  { href: "/app/history", label: "历史咨询", icon: "history" as const, prefetch: false },
];
const NAVIGATION_PROGRESS_DELAY_MS = 250;

function isActivePath(pathname: string, href: string) {
  return href === "/app" ? pathname === href : pathname.startsWith(href);
}

function getActorInitials(actor: WorkspaceActor | null) {
  if (!actor) return "RZ";
  return actor.displayName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const prefetchedRoutes = useRef(new Set<string>());
  const [actor, setActor] = useState<WorkspaceActor | null>(null);
  const [actorError, setActorError] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [navigationPending, setNavigationPending] = useState(false);
  const progressTimer = useRef<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    void fetch("/api/profile", {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) {
          window.location.assign("/login");
          return null;
        }
        if (response.status === 403) {
          window.location.assign("/login?error=access_denied");
          return null;
        }
        if (!response.ok) throw new Error(`Profile request failed with ${response.status}`);
        return response.json() as Promise<{ actor: WorkspaceActor }>;
      })
      .then((payload) => {
        if (payload?.actor) setActor(payload.actor);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setActorError(true);
      });

    return () => controller.abort();
  }, []);

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
    setMobileOpen(false);
  };

  const prefetchOnIntent = (href: string, eagerPrefetch: boolean) => {
    if (eagerPrefetch || prefetchedRoutes.current.has(href)) return;
    prefetchedRoutes.current.add(href);
    router.prefetch(href);
  };

  return (
    <div className="rz-app-shell" onClickCapture={handleNavigationClick}>
      {navigationPending ? <div aria-live="polite" className="rz-navigation-progress" role="status"><span className="rz-navigation-spinner" /><span><strong>正在打开页面</strong><small>已收到点击，正在加载...</small></span></div> : null}
      <button aria-label="关闭导航" className={`rz-nav-scrim ${mobileOpen ? "is-open" : ""}`} onClick={() => setMobileOpen(false)} type="button" />
      <aside className={`rz-sidebar ${mobileOpen ? "is-open" : ""}`}>
        <div className="rz-sidebar-head">
          <Link className="rz-brand" href="/app" onClick={() => setMobileOpen(false)}>
            <span className="rz-brand-mark">RZ</span>
            <span><strong>RoyalZen</strong><small>CURTAIN ADVISOR</small></span>
          </Link>
          <button aria-label="关闭导航" className="rz-icon-button rz-mobile-only" onClick={() => setMobileOpen(false)} type="button"><Icon name="close" /></button>
        </div>

        <nav className="rz-sidebar-nav" aria-label="顾问工作台导航">
          <span className="rz-nav-label">顾问工作区</span>
          {NAVIGATION.map((item) => (
            <Link
              className={`rz-nav-item ${isActivePath(pathname, item.href) ? "is-active" : ""}`}
              href={item.href}
              key={item.href}
              onClick={() => setMobileOpen(false)}
              onFocus={() => prefetchOnIntent(item.href, item.prefetch)}
              onMouseEnter={() => prefetchOnIntent(item.href, item.prefetch)}
              onTouchStart={() => prefetchOnIntent(item.href, item.prefetch)}
              prefetch={item.prefetch}
            >
              <Icon name={item.icon} size={18} />
              <span>{item.label}</span>
              {item.href === "/app/consultations/new" ? <span className="rz-nav-key">N</span> : null}
            </Link>
          ))}
        </nav>

        <div className="rz-sidebar-foot">
          {actor && hasOrganizationAdminAccess(actor.role) ? <Link className="rz-workspace-switch" href="/admin">
            <span className="rz-workspace-icon"><Icon name="admin" size={18} /></span>
            <span><small>切换工作区</small><strong>机构管理后台</strong></span>
            <Icon name="chevron" size={16} />
          </Link> : null}
          <div aria-busy={!actor} className="rz-user-card">
            <span className="rz-avatar">{getActorInitials(actor)}</span>
            <span>
              <strong>{actor?.displayName || "正在载入账户"}</strong>
              <small>{actor ? organizationRoleLabel(actor.role) : actorError ? "账户信息暂不可用" : "正在验证权限"}</small>
            </span>
            <Link aria-label="账号设置" className="rz-icon-button" href="/app/settings"><Icon name="settings" size={17} /></Link>
          </div>
        </div>
      </aside>

      <div className="rz-app-main">
        <header className="rz-topbar">
          <button aria-label="打开导航" className="rz-icon-button rz-mobile-only" onClick={() => setMobileOpen(true)} type="button"><Icon name="menu" /></button>
          <details className="rz-org-switcher">
            <summary><span className="rz-org-dot" />{actor?.organizationName || "RoyalZen"}<Icon name="chevron" size={14} /></summary>
            <div className="rz-org-menu">
              <button className="is-selected" type="button">{actor?.organizationName || "RoyalZen"} <Icon name="check" size={15} /></button>
              {actor && hasOrganizationAdminAccess(actor.role) ? <Link href="/admin">管理机构</Link> : null}
            </div>
          </details>
          {/* 这里原来还常驻一句服务状态提示——静态文字，不接任何健康检查，
              永远显示同一句话。四语言切换器变宽后，手机上两者挤在一起，
              而那句话本身不传达信息，删掉比继续为它挪地方更值。 */}
          <div className="rz-topbar-actions"><LanguageToggle compact /></div>
        </header>
        <main className="rz-content">{children}</main>
      </div>
    </div>
  );
}
