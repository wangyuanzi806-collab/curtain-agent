import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import test from "node:test";

const PORT = 3111;
const ORIGIN = `http://127.0.0.1:${PORT}`;

test("primary navigation eagerly warms core routes and intent-prefetches database-heavy routes", () => {
  const appShell = readFileSync("src/components/royalzen/app-shell.tsx", "utf8");
  const adminShell = readFileSync("src/components/royalzen/admin-shell.tsx", "utf8");
  const adminOverview = readFileSync("src/app/admin/page.tsx", "utf8");
  const intentLink = readFileSync("src/components/royalzen/intent-prefetch-link.tsx", "utf8");
  const advisorLoading = readFileSync("src/app/app/loading.tsx", "utf8");
  const adminLoading = readFileSync("src/app/admin/loading.tsx", "utf8");
  const styles = readFileSync("src/app/royalzen.css", "utf8");
  const advisorNavigation = appShell.slice(
    appShell.indexOf("{NAVIGATION.map"),
    appShell.indexOf("</nav>", appShell.indexOf("{NAVIGATION.map")),
  );
  const adminNavigation = adminShell.slice(
    adminShell.indexOf("{ADMIN_NAV.map"),
    adminShell.indexOf("</nav>", adminShell.indexOf("{ADMIN_NAV.map")),
  );

  assert.match(appShell, /useRouter\(\)/);
  assert.match(appShell, /router\.prefetch\(href\)/);
  assert.match(appShell, /onMouseEnter=\{\(\) => prefetchOnIntent\(item\.href, item\.prefetch\)\}/);
  assert.match(appShell, /onFocus=\{\(\) => prefetchOnIntent\(item\.href, item\.prefetch\)\}/);
  assert.match(appShell, /onTouchStart=\{\(\) => prefetchOnIntent\(item\.href, item\.prefetch\)\}/);
  assert.match(appShell, /\{ href: "\/app",[^}]+prefetch: false \}/);
  assert.match(appShell, /\{ href: "\/app\/history",[^}]+prefetch: false \}/);
  assert.match(appShell, /\{ href: "\/app\/consultations\/new",[^}]+prefetch: true \}/);
  assert.match(appShell, /\{ href: "\/app\/products",[^}]+prefetch: true \}/);
  assert.match(appShell, /\{ href: "\/app\/materials",[^}]+prefetch: true \}/);
  assert.match(appShell, /\{ href: "\/app\/knowledge",[^}]+prefetch: true \}/);
  assert.match(advisorNavigation, /prefetch=\{item\.prefetch\}/);
  assert.match(adminShell, /useRouter\(\)/);
  assert.match(adminShell, /router\.prefetch\(href\)/);
  assert.match(adminShell, /onMouseEnter=\{\(\) => prefetchOnIntent\(item\.href\)\}/);
  assert.match(adminShell, /onFocus=\{\(\) => prefetchOnIntent\(item\.href\)\}/);
  assert.match(adminShell, /onTouchStart=\{\(\) => prefetchOnIntent\(item\.href\)\}/);
  assert.match(adminNavigation, /prefetch=\{item\.prefetch\}/);
  assert.doesNotMatch(adminNavigation, /prefetch=\{true\}/);
  // 「窗帘模板」已删除（curtain_styles 0 条、推荐链路零引用），所以是 6 项不是 7 项
  assert.equal((adminShell.match(/prefetch: false/g) || []).length, 6);
  assert.doesNotMatch(adminOverview, /import Link from "next\/link"/);
  assert.match(adminOverview, /IntentPrefetchLink/);
  assert.match(intentLink, /router\.prefetch\(String\(href\)\)/);
  assert.match(intentLink, /prefetch=\{false\}/);
  assert.match(appShell, /onClickCapture=\{handleNavigationClick\}/);
  assert.match(appShell, /rz-navigation-progress/);
  assert.match(adminShell, /onClickCapture=\{handleNavigationClick\}/);
  assert.match(adminShell, /rz-navigation-progress/);
  assert.match(advisorLoading, /rz-route-loading/);
  assert.match(adminLoading, /rz-route-loading/);
  assert.match(styles, /\.rz-navigation-progress \{[^}]*pointer-events: none;/);
});

test("advisor layout streams a static shell while profile data loads independently", () => {
  const layout = readFileSync("src/app/app/layout.tsx", "utf8");
  const appShell = readFileSync("src/components/royalzen/app-shell.tsx", "utf8");
  const protectedCatalogs = [
    readFileSync("src/app/app/products/page.tsx", "utf8"),
    readFileSync("src/app/app/materials/page.tsx", "utf8"),
    readFileSync("src/app/app/knowledge/page.tsx", "utf8"),
  ];

  assert.doesNotMatch(layout, /getCurrentActor/);
  assert.doesNotMatch(layout, /force-dynamic/);
  assert.match(layout, /<AppShell>\{children\}<\/AppShell>/);
  assert.match(appShell, /fetch\("\/api\/profile"/);
  assert.match(appShell, /aria-busy=\{!actor\}/);
  for (const page of protectedCatalogs) {
    assert.match(page, /await getCurrentActor\(\)/);
  }
});

test("navigation progress waits briefly before covering a slow route", () => {
  const shells = [
    readFileSync("src/components/royalzen/app-shell.tsx", "utf8"),
    readFileSync("src/components/royalzen/admin-shell.tsx", "utf8"),
  ];

  for (const shell of shells) {
    assert.match(shell, /NAVIGATION_PROGRESS_DELAY_MS\s*=\s*250/);
    assert.match(shell, /window\.setTimeout\(\(\) => setNavigationPending\(true\), NAVIGATION_PROGRESS_DELAY_MS\)/);
    assert.match(shell, /window\.clearTimeout\(progressTimer\.current\)/);
  }
});

test("bound identities avoid the invitation transaction on routine navigation", () => {
  const platformDb = readFileSync("src/lib/platform-db.ts", "utf8");
  const actorResolution = platformDb.slice(
    platformDb.indexOf("export async function resolveActorFromAuth"),
    platformDb.indexOf("export async function createConsultation"),
  );
  const boundLookupIndex = actorResolution.indexOf("const boundMembership = await getDb().query");
  const boundReturnIndex = actorResolution.indexOf("if (boundMembership.rowCount)");
  const transactionConnectionIndex = actorResolution.indexOf("const client = await getDb().connect()");

  assert.ok(boundLookupIndex >= 0, "expected a read-only lookup for an already-bound identity");
  assert.ok(boundReturnIndex > boundLookupIndex, "expected the bound identity to return from the fast path");
  assert.ok(
    transactionConnectionIndex > boundReturnIndex,
    "the invitation transaction must only start after the bound-identity fast path",
  );
});

test("server actor verification uses JWT claims instead of a remote user lookup", () => {
  const auth = readFileSync("src/lib/auth.ts", "utf8");

  assert.match(auth, /supabase\.auth\.getClaims\(\)/);
  assert.doesNotMatch(auth, /supabase\.auth\.getUser\(\)/);
  assert.match(
    auth,
    /async function resolveCurrentActor[^]*?if \(isDevelopmentAuthBypassEnabled\(\)\) return ensureDemoActor\(\);[^]*?isSupabaseAuthConfigured\(\)/,
  );
});

test("dynamic history links do not trigger background detail-page renders", () => {
  const dashboard = readFileSync("src/app/app/page.tsx", "utf8");
  const history = readFileSync("src/app/app/history/page.tsx", "utf8");

  assert.match(dashboard, /href=\{`\/app\/consultations\/\$\{item\.displayCode\}`\}[^>]+prefetch=\{false\}/);
  assert.match(history, /href=\{`\/app\/consultations\/\$\{item\.displayCode\}`\}[^>]+prefetch=\{false\}/);
});

test("recent generation lists do not load archived provider payloads", () => {
  const database = readFileSync("src/lib/db.ts", "utf8");
  const listRecentGenerations = database.slice(
    database.indexOf("export async function listRecentGenerations"),
    database.indexOf("// ==================== Curtain Styles"),
  );

  assert.doesNotMatch(listRecentGenerations, /select\s+\*/i);
  assert.doesNotMatch(listRecentGenerations, /provider_(?:request|response)/i);
  assert.match(listRecentGenerations, /selected_sku_name/i);
  assert.doesNotMatch(listRecentGenerations, /await expireStaleGenerations\(\)/);
  assert.match(listRecentGenerations, /limit \$1[^]*offset \$2/i);
  assert.match(listRecentGenerations, /case[^]*status = 'processing'/i);
});

test("page entry animation does not move completed page layouts", () => {
  const styles = readFileSync("src/app/royalzen.css", "utf8");
  const pageEntryAnimation = styles.slice(
    styles.indexOf("@keyframes rz-page-in"),
    styles.indexOf("@keyframes", styles.indexOf("@keyframes rz-page-in") + 1),
  );

  assert.match(pageEntryAnimation, /opacity/i);
  assert.doesNotMatch(pageEntryAnimation, /transform/i);
});

test("admin history sends its first data set with the server-rendered page", () => {
  const historyPage = readFileSync("src/app/admin/history/page.tsx", "utf8");
  const historyManager = readFileSync("src/components/royalzen/history-manager.tsx", "utf8");

  assert.doesNotMatch(historyPage, /"use client"/);
  assert.match(historyPage, /await getAdminHistoryPage\(\)/);
  assert.match(historyPage, /initialPage=\{initialPage\}/);
  assert.match(historyManager, /toISOString\(\)/);
  assert.doesNotMatch(historyManager, /toLocaleString\(/);
});

test("admin catalog pages send their first data set with the server-rendered page", () => {
  const pages = [
    ["src/app/admin/skus/page.tsx", "getAdminSkusPage"],
    ["src/app/admin/fabrics/page.tsx", "getAdminFabricsPage"],
    ["src/app/admin/knowledge/page.tsx", "getAdminKnowledgePage"],
  ];

  for (const [path, listFunction] of pages) {
    const page = readFileSync(path, "utf8");
    assert.doesNotMatch(page, /"use client"/);
    assert.match(page, /export const runtime = "nodejs"/);
    assert.match(page, new RegExp(`await ${listFunction}\\(\\)`));
    assert.match(page, /initialPage=\{initialPage\}/);
  }
});

test("readonly catalogs are cached, server hydrated, and invalidated after writes", () => {
  const catalogCache = readFileSync("src/lib/catalog-cache.ts", "utf8");
  const productsPage = readFileSync("src/app/app/products/page.tsx", "utf8");
  const productBrowser = readFileSync("src/components/royalzen/product-browser.tsx", "utf8");
  const knowledgePage = readFileSync("src/app/app/knowledge/page.tsx", "utf8");
  const skuWrites = [
    readFileSync("src/app/api/admin/skus/route.ts", "utf8"),
  ].join("\n");
  const knowledgeWrites = [
    readFileSync("src/app/api/admin/knowledge/route.ts", "utf8"),
    readFileSync("src/app/api/knowledge/import/route.ts", "utf8"),
  ].join("\n");

  assert.match(catalogCache, /unstable_cache/);
  // 断言下限而不是具体秒数：要保住的性质是"确实缓存了、且不会短到失去意义"，
  // 而不是某一个数值。写入侧有 revalidateTag 主动失效，时间只是兜底。
  const revalidateSeconds = Number(
    catalogCache.match(/CATALOG_REVALIDATE_SECONDS\s*=\s*(\d+)/)?.[1]
  );
  assert.ok(
    Number.isFinite(revalidateSeconds) && revalidateSeconds >= 300,
    `目录缓存时长应不短于 5 分钟，实际 ${revalidateSeconds}`
  );
  assert.match(catalogCache, /revalidate:\s*CATALOG_REVALIDATE_SECONDS/);
  // 200 改成全量：前台也按标签筛了，取 200 的话点「羊毛」只在前 200 款里找
  const frontCatalogLimit = Number(productsPage.match(/getCachedSkuCatalog\((\d+)\)/)?.[1]);
  assert.ok(
    Number.isFinite(frontCatalogLimit) && frontCatalogLimit >= 1000,
    `前台目录要一次拿全 985 款，实际 ${frontCatalogLimit}`
  );
  assert.match(productsPage, /<ProductBrowser initialProducts=\{products\}/);
  assert.doesNotMatch(productBrowser, /fetch\("\/api\/skus/);
  assert.match(knowledgePage, /await getCachedKnowledgeDocs\(100\)/);
  assert.match(skuWrites, /revalidateSkuCatalog\(\)/);
  assert.match(knowledgeWrites, /revalidateKnowledgeCatalog\(\)/);
});

// 面料库改读真实的 985 款：原先它读 curtain_fabrics，而那张表一直是 0 条，
// 于是永远走兜底、永远显示 4 条硬编码的假面料（经典花卉、抽象树叶……），
// 顾问拿它给客户看，看到的是不存在的商品。
test("material library reads the real catalogue and prefers fabric detail images", () => {
  const materialsPage = readFileSync("src/app/app/materials/page.tsx", "utf8");
  const browser = readFileSync("src/components/royalzen/fabric-browser.tsx", "utf8");

  assert.match(materialsPage, /getCachedSkuCatalog/);
  assert.doesNotMatch(materialsPage, /FABRICS|fabrics-data/);
  assert.doesNotMatch(materialsPage, /await ensureSchema\(\)/);
  // 面料库存在的理由就是这张图：细节图看得见织纹，白底成品图看不见
  assert.match(browser, /detail_image_url \|\| item\.image_url/);
  assert.match(browser, /SkuFacetFilter/);
});

test("admin lists paginate and all client mutations reject failed responses", () => {
  const pagination = readFileSync("src/lib/admin-pagination.ts", "utf8");
  const clientApi = readFileSync("src/lib/client-api.ts", "utf8");
  const managers = [
    "fabrics-manager.tsx",
    "knowledge-manager.tsx",
    "history-manager.tsx",
  ].map((name) => readFileSync(`src/components/royalzen/${name}`, "utf8"));

  assert.match(pagination, /history:\s*12/);
  assert.match(clientApi, /if \(!response\.ok\)/);
  assert.match(clientApi, /throw new Error/);
  for (const manager of managers) {
    assert.match(manager, /requestJson/);
    assert.match(manager, /nextOffset/);
    assert.match(manager, /loadingMore/);
    assert.match(manager, /AdminActionFeedback/);
  }
});

// 商品刻意不在这个循环里：它按标签筛，就必须先全部在手上。
// 分页取 10 条再筛，点「棉麻」只会在这 10 条里找，而库里有 985 款。
test("admin sku catalog loads whole and filters client-side", () => {
  const pagination = readFileSync("src/lib/admin-pagination.ts", "utf8");
  const manager = readFileSync("src/components/royalzen/skus-manager.tsx", "utf8");

  const skuPageSize = Number(pagination.match(/skus:\s*(\d+)/)?.[1]);
  assert.ok(
    Number.isFinite(skuPageSize) && skuPageSize >= 1000,
    `后台商品要一次拿全 985 款，实际每页 ${skuPageSize}`
  );
  assert.match(manager, /SkuFacetFilter/);
  assert.match(manager, /matchesFacets/);
  assert.match(manager, /AdminActionFeedback/);
  // 图还是分批渲染的：一次铺 985 张会同时发起几百个请求
  assert.match(manager, /PAGE_SIZE/);
  assert.doesNotMatch(manager, /loadMore/);
});

test("admin data failures have a visible retry boundary", () => {
  const boundary = readFileSync("src/app/admin/error.tsx", "utf8");
  const feedback = readFileSync("src/components/royalzen/admin-action-feedback.tsx", "utf8");

  assert.match(boundary, /reset/);
  assert.match(boundary, /重新加载/);
  assert.match(boundary, /onClick=\{reset\}/);
  assert.match(feedback, /role=\{message\.tone === "error"/);
});

async function waitForServer(child) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Next.js exited with code ${child.exitCode}`);
    try {
      const response = await fetch(`${ORIGIN}/login`);
      if (response.ok) return;
    } catch {
      // The process has not started listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Timed out waiting for the performance test server");
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
  await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 3000))]);
}

test("new consultation stays fast while remote database routes remain reachable", { timeout: 45_000 }, async (context) => {
  const child = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        AUTH_BYPASS_ENABLED: "1",
        RUNTIME_SCHEMA_SETUP: "0"
      },
      stdio: "ignore"
    }
  );

  try {
    await waitForServer(child);
    const startedAt = performance.now();
    const response = await fetch(`${ORIGIN}/app/consultations/new`);
    const elapsedMs = performance.now() - startedAt;

    assert.equal(response.status, 200);
    context.diagnostic(`new consultation cold response: ${elapsedMs.toFixed(0)}ms`);
    assert.ok(elapsedMs < 1000, `new consultation cold navigation took ${elapsedMs.toFixed(0)}ms`);

    const dashboardStartedAt = performance.now();
    const dashboardResponse = await fetch(`${ORIGIN}/app`);
    const dashboardElapsedMs = performance.now() - dashboardStartedAt;

    assert.equal(dashboardResponse.status, 200);
    context.diagnostic(`dashboard cold database response: ${dashboardElapsedMs.toFixed(0)}ms`);
    assert.ok(dashboardElapsedMs < 12000, `dashboard navigation exceeded the remote-database guardrail at ${dashboardElapsedMs.toFixed(0)}ms`);

    const teamStartedAt = performance.now();
    const teamResponse = await fetch(`${ORIGIN}/admin/team`);
    const teamElapsedMs = performance.now() - teamStartedAt;

    assert.equal(teamResponse.status, 200);
    context.diagnostic(`admin team cold response: ${teamElapsedMs.toFixed(0)}ms`);
    assert.ok(teamElapsedMs < 12000, `admin team navigation exceeded the remote-database guardrail at ${teamElapsedMs.toFixed(0)}ms`);
  } finally {
    await stopServer(child);
  }
});
