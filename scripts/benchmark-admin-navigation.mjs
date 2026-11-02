import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";

const port = Number(process.env.PERF_PORT || 3110);
const origin = `http://127.0.0.1:${port}`;
const rounds = Number(process.env.PERF_ROUNDS || 2);
const routes = [
  "/admin",
  "/admin/team",
  "/admin/styles",
  "/admin/fabrics",
  "/admin/skus",
  "/admin/knowledge",
  "/admin/history",
];
const apiRoutes = [
  "/api/admin/styles",
  "/api/admin/fabrics",
  "/api/admin/skus",
  "/api/admin/knowledge",
  "/api/admin/history",
  "/api/admin/history?limit=50",
];

async function waitForServer(child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Performance server exited with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`${origin}/login`);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for the performance server");
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

async function measure(path) {
  const startedAt = performance.now();
  const response = await fetch(`${origin}${path}`);
  const body = await response.arrayBuffer();
  return {
    path,
    status: response.status,
    elapsedMs: Math.round(performance.now() - startedAt),
    bytes: body.byteLength,
  };
}

const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "-p", String(port)],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AUTH_BYPASS_ENABLED: "1",
      RUNTIME_SCHEMA_SETUP: "0",
    },
    stdio: "ignore",
  },
);

try {
  await waitForServer(child);
  for (let round = 1; round <= rounds; round += 1) {
    const results = [];
    for (const path of [...routes, ...apiRoutes]) {
      results.push(await measure(path));
    }
    process.stdout.write(`${JSON.stringify({ round, results })}\n`);
  }
} finally {
  await stopServer(child);
}
