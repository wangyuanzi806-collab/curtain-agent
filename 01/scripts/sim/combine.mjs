/**
 * 合成总分:机械分(mech-summary.json)+ judge 分(judges/*.json)→ 总分表。
 * 用法:node scripts/sim/combine.mjs .tmp/bench/<label>
 * judge 文件格式:[{file, b1..b4, ...}](judge-rubric.md 的输出,按场聚合取均值)
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("用法: node scripts/sim/combine.mjs .tmp/bench/<label>");
  process.exit(1);
}
const mech = JSON.parse(readFileSync(path.join(dir, "mech-summary.json"), "utf8"));

const judgeScores = {}; // file → [{b1..b4}]
for (const f of readdirSync(path.join(dir, "judges"))) {
  if (!f.endsWith(".json")) continue;
  for (const row of JSON.parse(readFileSync(path.join(dir, "judges", f), "utf8"))) {
    const key = row.file.replace(/\.md$/, "");
    (judgeScores[key] ??= []).push(row);
  }
}

const rows = [];
for (const run of mech.runs) {
  if (run.error) continue;
  const js = judgeScores[run.tag] ?? [];
  const avg = (k) => {
    const vals = js.map((r) => r[k]).filter((v) => typeof v === "number");
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const b1 = avg("b1");
  const b2 = avg("b2");
  const b3 = avg("b3"); // n/a 的场不计
  const b4 = avg("b4");
  // B3 n/a:把 10 分权重摊给 B1/B2(各 +5/1.5 权),避免没推荐的场吃亏或占便宜
  const judge50 =
    b3 === null
      ? (b1 ?? 0) * 2 + (b2 ?? 0) * 2 + (b4 ?? 0) * 1
      : (b1 ?? 0) * 1.5 + (b2 ?? 0) * 1.5 + b3 * 1 + (b4 ?? 0) * 1;
  const total = +(run.mech + judge50).toFixed(1);
  rows.push({ tag: run.tag, mech: run.mech, b1, b2, b3, b4, judge50: +judge50.toFixed(1), total });
}

const totalAvg = +(rows.reduce((a, r) => a + r.total, 0) / Math.max(1, rows.length)).toFixed(1);
const minRun = rows.reduce((a, r) => (r.total < a.total ? r : a), rows[0]);
const vetoed = mech.violations.length > 0;
const verdict = vetoed
  ? `不及格(红线违规 ${mech.violations.length} 次,一票否决)`
  : totalAvg >= 85 && minRun.total >= 70
    ? `及格(均分 ${totalAvg} ≥85 且最低单场 ${minRun.total} ≥70)`
    : `未达标(均分 ${totalAvg},最低单场 ${minRun.tag}=${minRun.total})`;

const md = [
  `# 总分 · ${mech.label} · ${mech.model}`,
  "",
  "| 场 | 机械/50 | B1 | B2 | B3 | B4 | judge/50 | 总分/100 |",
  "|---|---|---|---|---|---|---|---|",
  ...rows.map(
    (r) =>
      `| ${r.tag} | ${r.mech} | ${r.b1?.toFixed(1) ?? "—"} | ${r.b2?.toFixed(1) ?? "—"} | ${r.b3?.toFixed(1) ?? "n/a"} | ${r.b4?.toFixed(1) ?? "—"} | ${r.judge50} | **${r.total}** |`
  ),
  "",
  `## ${verdict}`
];
writeFileSync(path.join(dir, "total.md"), md.join("\n"), "utf8");
writeFileSync(path.join(dir, "total.json"), JSON.stringify({ rows, totalAvg, min: minRun, vetoed, verdict }, null, 2), "utf8");
console.log(md.join("\n"));
