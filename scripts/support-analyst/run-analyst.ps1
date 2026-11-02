# Executa o Support Analyst com o env local (deploy\runtime\support-analyst-<alvo>.env, nao versionado).
# Modos de laco (watch/pilot) reiniciam o processo se ele sair. Modos *-once e notify-test rodam uma vez.
# O proprio processo do watch espera a rede/Elastic apos o boot (backoff 5/10/30/60 s) sem alertar nos
# primeiros SUPPORT_ANALYST_BOOT_QUIET_MINUTES (padrao 10) minutos.
[CmdletBinding()]
param(
  [ValidateSet('dev', 'prd')][string]$Target = 'prd',
  [ValidateSet('watch', 'pilot', 'watch-once', 'pilot-once', 'notify-test')][string]$Mode = 'watch'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
# TAP-171: o plantao PRD roda no VPS. Com este marcador o PC nao sobe o watch (evita dois plantoes no Telegram);
# Disable-ScheduledTask exige elevacao porque a tarefa foi registrada elevada.
$disabledMarker = Join-Path $root "deploy\runtime\support-analyst-$Target.disabled"
if ($Mode -in @('watch', 'pilot') -and (Test-Path -LiteralPath $disabledMarker)) {
  Write-Host "Watch $Target desabilitado no PC ($disabledMarker existe). Apague o arquivo para usar a reserva."
  exit 0
}
$envFile = Join-Path $root "deploy\runtime\support-analyst-$Target.env"
if (-not (Test-Path -LiteralPath $envFile)) { throw "Arquivo de ambiente ausente: deploy\runtime\support-analyst-$Target.env" }
foreach ($line in Get-Content -LiteralPath $envFile) {
  $t = $line.Trim()
  if (-not $t -or $t.StartsWith('#')) { continue }
  $eq = $t.IndexOf('=')
  if ($eq -lt 1) { continue }
  $value = $t.Substring($eq + 1).Trim()
  if ($value.Length -ge 2 -and ($value[0] -eq '"' -or $value[0] -eq "'") -and $value.EndsWith([string]$value[0])) { $value = $value.Substring(1, $value.Length - 2) }
  Set-Item -Path ("env:" + $t.Substring(0, $eq).Trim()) -Value $value
}
if ($env:SUPPORT_ANALYST_ENV -ne $Target) { throw "SUPPORT_ANALYST_ENV do arquivo difere de -Target $Target" }
if (-not $env:SUPPORT_ANALYST_RUNTIME_DIR) { $env:SUPPORT_ANALYST_RUNTIME_DIR = "deploy\runtime\support-analyst-$Target" }
if (-not [IO.Path]::IsPathRooted($env:SUPPORT_ANALYST_RUNTIME_DIR)) { $env:SUPPORT_ANALYST_RUNTIME_DIR = Join-Path $root $env:SUPPORT_ANALYST_RUNTIME_DIR }

$entry = Join-Path $root 'support-analyst\dist\index.js'
# A tarefa roda o dist; sem recompilar, um merge na main nunca entraria em vigor.
function Update-AnalystBuild {
  $newest = Get-ChildItem -LiteralPath (Join-Path $root 'support-analyst\src') -Recurse -Filter '*.ts' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ((Test-Path -LiteralPath $entry) -and $newest.LastWriteTime -le (Get-Item -LiteralPath $entry).LastWriteTime) { return 'atual' }
  & npm.cmd run build --prefix (Join-Path $root 'support-analyst') 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { return 'recompilado' }
  return "falhou (codigo $LASTEXITCODE)"
}
$build = Update-AnalystBuild
if (-not (Test-Path -LiteralPath $entry)) { throw "support-analyst nao compilado ($build). Rode: npm run build --prefix support-analyst" }
$flag = @{ 'watch' = '--watch-run'; 'pilot' = '--pilot-run'; 'watch-once' = '--watch-once'; 'pilot-once' = '--pilot-once'; 'notify-test' = '--notify-test' }[$Mode]
Set-Location (Join-Path $root 'support-analyst')

if ($Mode -in @('watch-once', 'pilot-once', 'notify-test')) {
  & node $entry $flag
  exit $LASTEXITCODE
}

$logDir = Join-Path $env:SUPPORT_ANALYST_RUNTIME_DIR 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
# 'Continue': no PowerShell 5.1, stderr de processo nativo com 'Stop' vira erro terminal.
$ErrorActionPreference = 'Continue'
while ($true) {
  $log = Join-Path $logDir ("{0}-{1:yyyyMMdd}.log" -f $Mode, (Get-Date))
  "[$(Get-Date -Format o)] build do analista: $build" | Out-File -FilePath $log -Append -Encoding utf8
  & node $entry $flag 2>&1 | ForEach-Object { "$_" } | Out-File -FilePath $log -Append -Encoding utf8
  $build = Update-AnalystBuild
  "[$(Get-Date -Format o)] processo saiu com codigo $LASTEXITCODE; reiniciando em 30s" | Out-File -FilePath $log -Append -Encoding utf8
  Start-Sleep -Seconds 30
}
