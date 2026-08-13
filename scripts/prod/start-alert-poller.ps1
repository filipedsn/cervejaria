# Inicia o worker de alertas Kibana (independente da API).

param(
  [switch]$Force,
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"

$settings = Get-QuiverTapSettings
$paths = Resolve-QuiverTapPaths -Settings $settings

if ((Test-AlertPollerHealthy -HealthUrl $paths.AlertPollerHealthUrl) -and -not $Force) {
  if (-not $Quiet) {
    Write-Host "Alert poller ja esta no ar ($($paths.AlertPollerHealthUrl))." -ForegroundColor Green
  }
  exit 0
}

if (Test-Path $paths.AlertPollerPidFile) {
  $oldPid = [int](Get-Content $paths.AlertPollerPidFile -ErrorAction SilentlyContinue)
  if (Test-ProcessAlive -ProcessId $oldPid) {
    if ($Force) {
      Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
      Start-Sleep -Seconds 1
    } elseif (Test-AlertPollerHealthy -HealthUrl $paths.AlertPollerHealthUrl) {
      exit 0
    } else {
      Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
    }
  }
}

$nodeDir = Split-Path $paths.NodeExe -Parent
$env:Path = "$nodeDir;$env:Path"
$env:NODE_ENV = 'production'
$env:KIBANA_ALERT_POLL_ENABLED = 'true'
$env:KIBANA_ALERT_POLL_IN_API = 'false'
$env:KIBANA_ALERT_POLL_STATE_FILE = Join-Path $paths.RuntimeDir 'alert-poller-state.json'
$env:ALERT_POLLER_HEALTH_PORT = [string]$paths.AlertPollerHealthPort
Import-BackendEnvFile -BackendDir $paths.BackendDir -Environment production
Import-ObservabilityEnvFile -ProjectRoot (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent)

$distEntry = Join-Path $paths.BackendDir 'dist\alert-poller-worker.js'
$tsxCli = Join-Path $paths.BackendDir 'node_modules\tsx\dist\cli.mjs'
$srcEntry = Join-Path $paths.BackendDir 'src\alert-poller-worker.ts'

if (Test-Path $distEntry) {
  $args = @($distEntry)
  $workDir = $paths.BackendDir
} elseif (Test-Path $tsxCli) {
  $args = @($tsxCli, $srcEntry)
  $workDir = $paths.BackendDir
} else {
  Write-Host 'Worker de alertas ausente. Rode npm run build --prefix backend' -ForegroundColor Red
  exit 1
}

$proc = Start-Process `
  -FilePath $paths.NodeExe `
  -ArgumentList $args `
  -WorkingDirectory $workDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput $paths.AlertPollerLog `
  -RedirectStandardError $paths.AlertPollerErrLog `
  -PassThru

Set-Content -Path $paths.AlertPollerPidFile -Value $proc.Id -Encoding ASCII
Write-WatchdogLog -Paths $paths -Message "Alert poller iniciado PID $($proc.Id)."

$deadline = (Get-Date).AddSeconds(20)
do {
  Start-Sleep -Seconds 1
  if (Test-AlertPollerHealthy -HealthUrl $paths.AlertPollerHealthUrl) {
    if (-not $Quiet) {
      Write-Host "Alert poller no ar: $($paths.AlertPollerHealthUrl) (PID $($proc.Id))" -ForegroundColor Green
    }
    exit 0
  }
} while ((Get-Date) -lt $deadline)

Write-Host "Alert poller subiu mas health falhou. Veja $($paths.AlertPollerErrLog)" -ForegroundColor Red
exit 1
