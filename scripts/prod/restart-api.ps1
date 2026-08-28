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

Stop-ManagedPidFile -PidFile $paths.ApiPidFile -ExpectedProcessNames @('node.exe') -CommandLinePatterns @('index.js') -Label 'API' | Out-Null
Start-Sleep -Seconds 1

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
