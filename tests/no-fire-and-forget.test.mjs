import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * API 路由里禁止 void (async () => {})()。
 *
 * Vercel 在响应返回的那一刻冻结实例，这种写法里的活**根本不会发生**，
 * 而且不报错、不留日志，只能靠查数据反推。已经栽过两次：
 *   08-03 token 路由：失败留痕没落库，报「连不上」时库里干干净净
 *   08-04 sessions 路由：自动叫店员从来没成功过一次（handoffs 全是 []）
 *
 * 注意只禁这一种写法。next/server 的 after() 挂在 waitUntil 上，
 * 生产上有反证它是活的（generate 路由的 R2 归档 8/9 都完成了），不禁。
 *
 * 真要异步只有一种情况：它失败了也无所谓，且有别的地方能兜——
 * 那也请写成 after()，别写成 void IIFE。
 */
const API_DIR = fileURLToPath(new URL("../src/app/api/", import.meta.url));

test("Vercel 上的 API 路由里不许有 void (async) fire-and-forget", () => {
  const offenders = [];
  for (const entry of readdirSync(API_DIR, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
    const path = join(entry.parentPath, entry.name);
    const source = readFileSync(path, "utf8");
    /*
     * 先整体抹掉块注释，再逐行扫。
     *
     * 原先是逐行剥 `//` 和整行 `*`——但块注释正文里以 `**必须 await。**` 这种
     * markdown 强调开头的行，前缀是 ` * **`，`^\s*\*.*$` 剥不掉（`*` 后面紧跟的
     * 还是 `*`），于是注释里"这里原来是 void (async)"这句解释被当成真代码，
     * 报了一个假阳性。抹的时候把注释内容换成等量换行，行号才还能对得上。
     */
    const code = source.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "));
    code.split("\n").forEach((line, i) => {
      const withoutLineComment = line.replace(/\/\/.*$/, "");
      if (/\bvoid\s*\(\s*async\b/.test(withoutLineComment)) offenders.push(`${path}:${i + 1}`);
    });
  }
  assert.deepEqual(
    offenders,
    [],
    `这些地方的副作用会被 Vercel 冻结、根本不会发生——改成 await：\n  ${offenders.join("\n  ")}`
  );
});
