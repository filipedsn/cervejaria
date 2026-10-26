# Inicia o ops-panel na porta configurada (padrao 3099). Sem fallback silencioso.

param(
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"
. "$PSScriptRoot\ops-panel-lib.ps1"

$settings = Get-QuiverTapSettings
$paths = Resolve-QuiverTapPaths -Settings $settings

$opsPanelDir = Join-Path $paths.ProjectRoot 'ops-panel'
$envFile = Join-Path $opsPanelDir '.env'
$envExample = Join-Path $opsPanelDir '.env.example'

$port = Get-OpsPanelConfiguredPort -EnvFile $envFile
$live = Get-OpsPanelLiveStatus -Port $port

if ($live.state -eq 'current') {
  if (-not $Quiet) { Write-Host "Ops panel ja ativo: $($live.url) (PID $($live.pid))" -ForegroundColor Green }
  exit 0
}

if ($live.state -eq 'legacy') {
  if (-not $Quiet) { Write-Host "Painel antigo na porta $port (PID $($live.pid)); encerrando..." -ForegroundColor Yellow }
  if (-not (Stop-PortListener -Port $port -Quiet:$Quiet)) {
    if (-not $Quiet) { Write-Host "Nao foi possivel liberar a porta $port. Rode como Administrador: taskkill /F /PID $($live.pid)" -ForegroundColor Red }
    exit 1
  }
} elseif ($live.state -eq 'blocked') {
  if (-not $Quiet) { Write-Host "Porta $port ocupada pelo PID $($live.pid), que nao e o ops-panel. Mude OPS_PANEL_PORT em ops-panel/.env" -ForegroundColor Red }
  exit 1
}

if (-not (Test-Path $envFile) -and (Test-Path $envExample)) {
  Copy-Item $envExample $envFile
}

if (-not (Test-Path (Join-Path $opsPanelDir 'node_modules'))) {
  if (-not $Quiet) { Write-Host 'Instalando dependencias do ops-panel...' -ForegroundColor Cyan }
  $npmCmd = if ($paths.NpmCmd) { $paths.NpmCmd } else { 'npm' }
  & $npmCmd ci --prefix $opsPanelDir
  if ($LASTEXITCODE -ne 0) { exit 1 }
}

$opsLog = Join-Path $paths.LogDir 'ops-panel-stdout.log'
$opsErrLog = Join-Path $paths.LogDir 'ops-panel-error.log'

Start-Process `
  -FilePath $paths.NodeExe `
  -ArgumentList @((Join-Path $opsPanelDir 'src\server.mjs')) `
  -WorkingDirectory $opsPanelDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput $opsLog `
  -RedirectStandardError $opsErrLog | Out-Null

$deadline = (Get-Date).AddSeconds(10)
do {
  Start-Sleep -Milliseconds 500
  $live = Get-OpsPanelLiveStatus -Port $port
} while ($live.state -ne 'current' -and (Get-Date) -lt $deadline)

if ($live.state -ne 'current') {
  if (-not $Quiet) {
    Write-Host "Ops panel nao subiu em http://127.0.0.1:$port" -ForegroundColor Red
    if (Test-Path $opsErrLog) { Get-Content $opsErrLog -Tail 5 | Write-Host -ForegroundColor Gray }
  }
  exit 1
}

if (-not $Quiet) { Write-Host "Ops panel: $($live.url) (PID $($live.pid))" -ForegroundColor Green }
exit 0
