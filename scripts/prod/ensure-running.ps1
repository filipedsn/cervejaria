# Watchdog: garante backend (3001) + frontend estatico + Cloudflare Tunnel no ar.

param(
  [switch]$Quiet
)

$ErrorActionPreference = 'Continue'
. "$PSScriptRoot\_config.ps1"
. "$PSScriptRoot\boot-dependencies.ps1"

try {
  $settings = Get-QuiverTapSettings
  $paths = Resolve-QuiverTapPaths -Settings $settings
} catch {
  if (-not $Quiet) { Write-Host $_.Exception.Message -ForegroundColor Red }
  exit 1
}

if (Test-DeployPaused -Paths $paths) {
  Write-WatchdogLog -Paths $paths -Message 'Ciclo ignorado: deploy em andamento (deploy.pause).'
  if (-not $Quiet) {
    Write-Host 'Watchdog pausado: deploy em andamento.' -ForegroundColor Yellow
  }
  exit 0
}

$apiOk = Test-ApiHealthy -HealthUrl $paths.ReadyUrl
$alertPollerOk = Test-AlertPollerHealthy -HealthUrl $paths.AlertPollerHealthUrl
$frontendOk = Test-FrontendHealthy -FrontendUrl $paths.FrontendUrl
$tunnelOk = Test-CloudflaredRunning

if (-not $tunnelOk) {
  & (Join-Path $PSHOME 'powershell.exe') -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot\start-tunnel.ps1" -Quiet
  $tunnelOk = Test-CloudflaredRunning
}

if (-not $apiOk -and (Test-PortListening -Port $paths.ApiPort)) {
  Start-Sleep -Seconds 3
  $apiOk = Test-ApiHealthy -HealthUrl $paths.ReadyUrl -Retries 3
}

if (-not $frontendOk -and (Test-PortListening -Port $paths.FrontendPort)) {
  Start-Sleep -Seconds 3
  $frontendOk = Test-FrontendHealthy -FrontendUrl $paths.FrontendUrl -Retries 3
}

if (-not $apiOk) {
  if (Ensure-ProdDatabaseContainer -Paths $paths) {
    Write-WatchdogLog -Paths $paths -Message 'Banco PROD healthy; iniciando API.'
    & "$PSScriptRoot\start-api.ps1" -Quiet:$Quiet
    $apiOk = Test-ApiHealthy -HealthUrl $paths.ReadyUrl
  }
}

if (-not $frontendOk -and -not $paths.ServeFrontendFromApi) {
  Write-WatchdogLog -Paths $paths -Message 'Frontend fora do ar - iniciando.'
  & "$PSScriptRoot\start-frontend.ps1" -Quiet:$Quiet
  $frontendOk = Test-FrontendHealthy -FrontendUrl $paths.FrontendUrl
} elseif ($paths.ServeFrontendFromApi -and $apiOk) {
  $frontendOk = Test-FrontendHealthy -FrontendUrl $paths.FrontendUrl
}

# Auxiliares nao devem impedir recuperacao da API e do tunel.
& (Join-Path $PSHOME 'powershell.exe') -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot\start-ops-panel.ps1" -Quiet
if (-not $alertPollerOk) {
  & (Join-Path $PSHOME 'powershell.exe') -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot\start-alert-poller.ps1" -Quiet
  $alertPollerOk = Test-AlertPollerHealthy -HealthUrl $paths.AlertPollerHealthUrl
}

if ($apiOk -and $alertPollerOk -and $frontendOk -and $tunnelOk) {
  if (-not $Quiet) { Write-Host 'OK - API, alert poller, frontend e tunnel no ar.' -ForegroundColor Green }
  exit 0
}

if (-not $Quiet) {
  if (-not $alertPollerOk) { Write-Host 'Falha: alert poller indisponivel.' -ForegroundColor Red }
  if (-not $apiOk) { Write-Host 'Falha: API indisponivel.' -ForegroundColor Red }
  if (-not $frontendOk) { Write-Host 'Falha: frontend indisponivel.' -ForegroundColor Red }
  if (-not $tunnelOk) { Write-Host 'Falha: tunnel indisponivel.' -ForegroundColor Red }
}
exit 1
