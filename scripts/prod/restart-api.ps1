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
    Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
  }
  Remove-Item $paths.ApiPidFile -Force -ErrorAction SilentlyContinue
}

if (Test-PortListening -Port $paths.ApiPort) {
  $conns = Get-NetTCPConnection -LocalPort $paths.ApiPort -State Listen -ErrorAction SilentlyContinue
  foreach ($c in $conns) {
    if ($c.OwningProcess) {
      if (-not $Quiet) { Write-Host "Encerrando listener na porta $($paths.ApiPort) (PID $($c.OwningProcess))..." -ForegroundColor Yellow }
      Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
    }
  }
  Start-Sleep -Seconds 1
}

Write-WatchdogLog -Paths $paths -Message 'API reiniciada via restart-api.ps1.'

& "$PSScriptRoot\start-api.ps1" -Force -Quiet:$Quiet
exit $LASTEXITCODE
