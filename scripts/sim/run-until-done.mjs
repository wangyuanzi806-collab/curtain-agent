/**
 * 自愈跑批:bench 崩了就重启(断点续跑跳过已完成场次),直到 15 场攒齐或 12 次为止。
 * 用 Node 而不是 .ps1:PowerShell 5.1 读无 BOM 的 UTF-8 脚本按 ANSI 解码,
 * 中文路径全成乱码,脚本一行没跑就死——08-05 上午实锅。
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, openSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const [label = "r1", model = "gpt-realtime-2.1"] = process.argv.slice(2);
const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const outDir = path.join(root, ".tmp", "bench", label);
mkdirSync(outDir, { recursive: true });
const log = path.join(outDir, "stdout.log");

const doneCount = () => readdirSync(outDir).filter((f) => /-v\d\.json$/.test(f)).length;

for (let i = 1; i <= 12; i++) {
  const done = doneCount();
  if (done >= 15) break;
  appendFileSync(log, `RESTART ${i} (done=${done})\n`);
  const fd = openSync(log, "a");
  spawnSync(process.execPath, ["--experimental-strip-types", "scripts/sim/bench.mjs", label, model], {
    cwd: root,
    stdio: ["ignore", fd, fd]
  });
  // API 限流期整轮零进展是常态:歇两分钟再来,别把重启预算几分钟烧光
  if (doneCount() === done) {
    appendFileSync(log, `BACKOFF 120s (no progress)\n`);
    await new Promise((resolve) => setTimeout(resolve, 120_000));
  }
}
appendFileSync(log, `ALLDONE done=${doneCount()}\n`);
