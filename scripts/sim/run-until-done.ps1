# 自愈跑批:bench 进程崩了就重启(断点续跑会跳过已完成的场),直到 15 场攒齐或 12 次为止
param(
  [string]$Label = "r1",
  [string]$Model = "gpt-realtime-2.1"
)
$dir = (Resolve-Path (Join-Path $PSScriptRoot "../.." )).Path
$out = Join-Path $dir ".tmp\bench\$Label"
New-Item -ItemType Directory -Force $out | Out-Null
$log = Join-Path $out "stdout.log"
for ($i = 1; $i -le 12; $i++) {
  $done = (Get-ChildItem "$out\*-v*.json" -ErrorAction SilentlyContinue).Count
  if ($done -ge 15) { break }
  Add-Content -Encoding utf8 $log "RESTART $i (done=$done)"
  Set-Location $dir
  # 输出直接追加进同一份日志,监视器只盯这一个文件
  node --experimental-strip-types scripts/sim/bench.mjs $Label $Model 2>&1 |
    Out-File -Encoding utf8 -Append $log
  Start-Sleep -Seconds 5
}
Add-Content -Encoding utf8 $log ("ALLDONE done=" + (Get-ChildItem "$out\*-v*.json" -ErrorAction SilentlyContinue).Count)
