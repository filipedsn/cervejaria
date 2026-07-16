# Reinicia apenas a API de producao (porta 3001), sem derrubar o Cloudflare Tunnel.

param(
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"

$settings = Get-QuiverTapSettings
$paths = Resolve-QuiverTapPaths -Settings $settings

if (-not $Quiet) {
  Write-Host "Reiniciando API de producao (porta $($paths.ApiPort))..." -ForegroundColor Cyan
}

if (Test-Path $paths.ApiPidFile) {
  $oldPid = [int](Get-Content $paths.ApiPidFile -ErrorAction SilentlyContinue)
  if (Test-ProcessAlive -ProcessId $oldPid) {
    if (-not $Quiet) { Write-Host "Encerrando API (PID $oldPid)..." -ForegroundColor Yellow }
    try {
      Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
    } catch {}
    try {
      & taskkill /F /PID $oldPid *>$null
    } catch {}
    Start-Sleep -Seconds 1
  }
  Remove-Item $paths.ApiPidFile -Force -ErrorAction SilentlyContinue
}

if (Test-PortListening -Port $paths.ApiPort) {
  if (-not (Stop-PortListener -Port $paths.ApiPort -Quiet:$Quiet)) {
    $stalePid = Get-PortListenerPid -Port $paths.ApiPort
    Write-Host "Falha ao liberar a porta $($paths.ApiPort). Processo $stalePid ainda ativo." -ForegroundColor Red
    Write-Host 'Encerre manualmente: taskkill /F /PID ' + $stalePid -ForegroundColor Yellow
    exit 1
  }
}

Write-WatchdogLog -Paths $paths -Message 'API reiniciada via restart-api.ps1.'

& "$PSScriptRoot\start-api.ps1" -Force -Quiet:$Quiet
exit $LASTEXITCODE
