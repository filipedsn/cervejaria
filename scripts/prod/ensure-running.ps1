# Watchdog: garante backend (3001) + frontend estatico + Cloudflare Tunnel no ar.

param(
  [switch]$Quiet
)

$ErrorActionPreference = 'Continue'
. "$PSScriptRoot\_config.ps1"

try {
  $settings = Get-QuiverTapSettings
  $paths = Resolve-QuiverTapPaths -Settings $settings
} catch {
  if (-not $Quiet) { Write-Host $_.Exception.Message -ForegroundColor Red }
  exit 1
}

$apiOk = Test-ApiHealthy -HealthUrl $paths.ReadyUrl
$frontendOk = Test-FrontendHealthy -FrontendUrl $paths.FrontendUrl
$tunnelOk = Test-CloudflaredRunning

if (-not $apiOk -and (Test-PortListening -Port $paths.ApiPort)) {
  Start-Sleep -Seconds 3
  $apiOk = Test-ApiHealthy -HealthUrl $paths.ReadyUrl -Retries 3
}

if (-not $frontendOk -and (Test-PortListening -Port $paths.FrontendPort)) {
  Start-Sleep -Seconds 3
  $frontendOk = Test-FrontendHealthy -FrontendUrl $paths.FrontendUrl -Retries 3
}

if (-not $apiOk) {
  Write-WatchdogLog -Paths $paths -Message 'API fora do ar - iniciando.'
  & "$PSScriptRoot\start-api.ps1" -Quiet:$Quiet
  $apiOk = Test-ApiHealthy -HealthUrl $paths.ReadyUrl
}

if (-not $frontendOk -and -not $paths.ServeFrontendFromApi) {
  Write-WatchdogLog -Paths $paths -Message 'Frontend fora do ar - iniciando.'
  & "$PSScriptRoot\start-frontend.ps1" -Quiet:$Quiet
  $frontendOk = Test-FrontendHealthy -FrontendUrl $paths.FrontendUrl
} elseif ($paths.ServeFrontendFromApi -and $apiOk) {
  $frontendOk = Test-FrontendHealthy -FrontendUrl $paths.FrontendUrl
}

if (-not $tunnelOk) {
  Write-WatchdogLog -Paths $paths -Message 'Tunnel fora do ar - iniciando.'
  & "$PSScriptRoot\start-tunnel.ps1" -Quiet:$Quiet
  $tunnelOk = Test-CloudflaredRunning
}

if ($apiOk -and $frontendOk -and $tunnelOk) {
  if (-not $Quiet) { Write-Host 'OK - API, frontend e tunnel no ar.' -ForegroundColor Green }
  exit 0
}

if (-not $Quiet) {
  if (-not $apiOk) { Write-Host 'Falha: API indisponivel.' -ForegroundColor Red }
  if (-not $frontendOk) { Write-Host 'Falha: frontend indisponivel.' -ForegroundColor Red }
  if (-not $tunnelOk) { Write-Host 'Falha: tunnel indisponivel.' -ForegroundColor Red }
}
exit 1
