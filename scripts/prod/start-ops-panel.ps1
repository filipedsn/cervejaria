# Inicia o ops-panel (porta 3099) se ainda nao estiver ativo.

param(
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"

$settings = Get-QuiverTapSettings
$paths = Resolve-QuiverTapPaths -Settings $settings

$opsPanelDir = Join-Path $paths.ProjectRoot 'ops-panel'
$opsPidFile = Join-Path $paths.RuntimeDir 'ops-panel.pid'
$envFile = Join-Path $opsPanelDir '.env'
$envExample = Join-Path $opsPanelDir '.env.example'

if (-not (Test-Path $opsPanelDir)) {
  if (-not $Quiet) { Write-Host 'ops-panel/ nao encontrado.' -ForegroundColor Red }
  exit 1
}

if (Test-Path $opsPidFile) {
  $existingPid = [int](Get-Content $opsPidFile -ErrorAction SilentlyContinue)
  if (Test-ProcessAlive -ProcessId $existingPid) {
    try {
      $health = Invoke-WebRequest -Uri 'http://127.0.0.1:3099/api/health' -UseBasicParsing -TimeoutSec 3
      if ($health.StatusCode -eq 200) {
        if (-not $Quiet) { Write-Host "Ops panel ja ativo (PID $existingPid)." -ForegroundColor Green }
        exit 0
      }
    } catch {}
    Stop-Process -Id $existingPid -Force -ErrorAction SilentlyContinue
  }
  Remove-Item $opsPidFile -Force -ErrorAction SilentlyContinue
}

if (-not (Test-Path $envFile) -and (Test-Path $envExample)) {
  Copy-Item $envExample $envFile
  Write-WatchdogLog -Paths $paths -Message 'ops-panel/.env criado a partir de .env.example — defina OPS_PANEL_TOKEN.'
}

$nodeModules = Join-Path $opsPanelDir 'node_modules'
if (-not (Test-Path $nodeModules)) {
  if (-not $Quiet) { Write-Host 'Instalando dependencias do ops-panel...' -ForegroundColor Cyan }
  $npmCmd = $paths.NpmCmd
  if ($npmCmd) {
    if (Test-Path (Join-Path $opsPanelDir 'package-lock.json')) {
      & $npmCmd ci --prefix $opsPanelDir
    } else {
      & $npmCmd install --prefix $opsPanelDir
    }
  } else {
    if (Test-Path (Join-Path $opsPanelDir 'package-lock.json')) {
      npm ci --prefix $opsPanelDir
    } else {
      npm install --prefix $opsPanelDir
    }
  }
  if ($LASTEXITCODE -ne 0) { exit 1 }
}

$nodeDir = Split-Path $paths.NodeExe -Parent
$env:Path = "$nodeDir;$env:Path"

$serverEntry = Join-Path $opsPanelDir 'src\server.mjs'
$opsLog = Join-Path $paths.LogDir 'ops-panel-stdout.log'
$opsErrLog = Join-Path $paths.LogDir 'ops-panel-error.log'

$proc = Start-Process `
  -FilePath $paths.NodeExe `
  -ArgumentList @($serverEntry) `
  -WorkingDirectory $opsPanelDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput $opsLog `
  -RedirectStandardError $opsErrLog `
  -PassThru

Start-Sleep -Seconds 2

if (Test-Path $opsPidFile) {
  $panelPid = [int](Get-Content $opsPidFile -ErrorAction SilentlyContinue)
} else {
  $panelPid = $proc.Id
  Set-Content -Path $opsPidFile -Value $proc.Id -Encoding ASCII
}

Write-WatchdogLog -Paths $paths -Message "Ops panel iniciado PID $panelPid."
if (-not $Quiet) {
  Write-Host "Ops panel: http://127.0.0.1:3099 (PID $panelPid)" -ForegroundColor Green
}

exit 0
