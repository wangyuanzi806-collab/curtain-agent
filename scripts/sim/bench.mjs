/**
 * 跑一轮 benchmark:5 人设 × 3 变体 = 15 场,并发 3。
 * 产物:.tmp/bench/<label>/ 下每场 .md(转写,给 judge 盲评)+ .json(日志),
 * 外加 mech-summary.json / report.md(机械分表)。
 * Judge 分由子 agent 评完后用 combine.mjs 合成总分。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PERSONAS } from "./personas.mjs";
import { mechScore } from "./metrics.mjs";

/**
 * undici 的 socket 在 abort 后补写会抛到进程顶层,一次网络抖动就把整批带崩
 * (08-05 凌晨 1:06 实锅:崩在 blackout-v3,整夜没人发现)。注册了处理器,
 * node 就不再因 uncaughtException 退出;受伤的那一场靠死线/重排自愈。
 */
process.on("uncaughtException", (e) => console.error("uncaught:", String(e).slice(0, 200)));
process.on("unhandledRejection", (e) => console.error("unhandledRejection:", String(e).slice(0, 200)));

const label = process.argv[2] || `run-${Math.random().toString(36).slice(2, 7)}`;
const model = process.argv[3] || "gpt-realtime-2.1";
const outDir = path.resolve(".tmp/bench", label);
mkdirSync(outDir, { recursive: true });

const { runSession, loadFixtures } = await import("./harness.mjs");
const fixtures = await loadFixtures();

const jobs = [];
for (const persona of PERSONAS) {
  for (let v = 0; v < 3; v++) {
    // 断点续跑:后台任务有 10 分钟上限,跑完的场不重跑
    if (existsSync(path.join(outDir, `${persona.id}-v${v + 1}.json`))) continue;
    jobs.push({ persona, variantIndex: v });
  }
}
console.log(`待跑 ${jobs.length}/15 场`);

let cursor = 0;
async function worker(id) {
  while (cursor < jobs.length) {
    const job = jobs[cursor++];
    const tag = `${job.persona.id}-v${job.variantIndex + 1}`;
    console.log(`[${id}] ▶ ${tag}`);
    try {
      const run = await runSession({ ...job, model, outDir, fixtures });
      const score = mechScore(run);
      console.log(`[${id}] ✔ ${tag} mech=${score.mech} ratio=${score.detail.ratio} median=${score.detail.medianChars}字`);
    } catch (error) {
      console.error(`[${id}] ✘ ${tag}`, String(error).slice(0, 200));
      // 握手超时这类基建错重排一次,还不行就留给下一段
      if ((job.retries ?? 0) < 1) jobs.push({ ...job, retries: 1 });
    }
  }
}
// 单路:两路以上会撞 realtime 的 rate limit,response.create 连环 failed,
// 顾客就在对一堵墙说话。慢一点,但每一场都算数
await worker("w1");

// 汇总从盘上重算:分批续跑时,本进程只跑了一部分场
const results = [];
for (const persona of PERSONAS) {
  for (let v = 0; v < 3; v++) {
    const tag = `${persona.id}-v${v + 1}`;
    const file = path.join(outDir, `${tag}.json`);
    if (!existsSync(file)) {
      results.push({ tag, error: "未跑完" });
      continue;
    }
    const run = JSON.parse(readFileSync(file, "utf8"));
    results.push({ tag, ...mechScore(run) });
  }
}
const ok = results.filter((r) => !r.error);
const avg = (key) => +(ok.reduce((a, r) => a + r[key], 0) / Math.max(1, ok.length)).toFixed(1);
const summary = {
  label,
  model,
  runs: results,
  mechAvg: avg("mech"),
  a1: avg("a1"),
  a2: avg("a2"),
  a3: avg("a3"),
  a4: avg("a4"),
  violations: ok.flatMap((r) => r.detail.violations.map((v) => ({ tag: r.tag, ...v })))
};
writeFileSync(path.join(outDir, "mech-summary.json"), JSON.stringify(summary, null, 2), "utf8");

const lines = [
  `# 机械分 · ${label} · ${model}`,
  "",
  "| 场 | A1节奏 | A2反应 | A3引导 | A4红线 | 机械分/50 | 轮比 | 中位字数 | 打断率 | 锚定率 | 收窄 |",
  "|---|---|---|---|---|---|---|---|---|---|---|",
  ...results.map((r) =>
    r.error
      ? `| ${r.tag} | — | — | — | — | 失败 | ${r.error} |`
      : `| ${r.tag} | ${r.a1} | ${r.a2} | ${r.a3} | ${r.a4} | **${r.mech}** | ${r.detail.ratio} | ${r.detail.medianChars} | ${r.detail.interruptRate ?? "无机会"} | ${r.detail.anchorRate ?? "无机会"} | ${r.detail.narrowingBeforeRecommend ?? "未推荐"} |`
  ),
  "",
  `**均值:A1 ${summary.a1} · A2 ${summary.a2} · A3 ${summary.a3} · A4 ${summary.a4} · 机械分 ${summary.mechAvg}/50**`,
  summary.violations.length
    ? `\n⚠️ 红线违规 ${summary.violations.length} 次(一票否决):\n` +
      summary.violations.map((v) => `- [${v.tag}] ${v.label}: …${v.quote}…`).join("\n")
    : "\n红线违规:0"
];
writeFileSync(path.join(outDir, "report.md"), lines.join("\n"), "utf8");
console.log("\n" + lines.join("\n"));
