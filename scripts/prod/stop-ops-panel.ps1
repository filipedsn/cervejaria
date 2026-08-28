# Para o ops-panel na porta configurada.

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"
. "$PSScriptRoot\ops-panel-lib.ps1"

$settings = Get-QuiverTapSettings
$paths = Resolve-QuiverTapPaths -Settings $settings

$envFile = Join-Path $paths.ProjectRoot 'ops-panel\.env'
$pidFile = Join-Path $paths.RuntimeDir 'ops-panel.pid'
$metaFile = Join-Path $paths.RuntimeDir 'ops-panel.meta.json'
$port = Get-OpsPanelConfiguredPort -EnvFile $envFile

$stopped = $false

$panelIdentity = Test-ManagedPidFile -PidFile $pidFile -ExpectedProcessNames @('node.exe') -CommandLinePatterns @('server.mjs')
if ($panelIdentity.State -eq 'VALID') {
  Stop-ManagedPidFile -PidFile $pidFile -ExpectedProcessNames @('node.exe') -CommandLinePatterns @('server.mjs') -Label 'Ops panel' | Out-Null
  $stopped = $true
} elseif ($panelIdentity.State -ne 'MISSING') {
  Clear-InvalidManagedPidFile -Identity $panelIdentity -PidFile $pidFile | Out-Null
}

if (Get-PortListenerPid -Port $port) {
  if (Stop-PortListener -Port $port) {
    Write-Host "Listener :$port encerrado." -ForegroundColor Green
    $stopped = $true
  } else {
    Write-Host "Nao foi possivel liberar a porta $port (acesso negado)." -ForegroundColor Red
    exit 1
  }
}

Remove-Item $metaFile -Force -ErrorAction SilentlyContinue

# Limpa instancia extra na 3100 (fallback antigo, removido).
$extra = Get-OpsPanelLiveStatus -Port 3100
if ($extra.state -eq 'current') {
  if (Stop-PortListener -Port 3100) {
    Write-Host 'Instancia extra na porta 3100 encerrada.' -ForegroundColor Yellow
    $stopped = $true
  }
}

if (-not $stopped) {
  Write-Host 'Ops panel ja estava parado.' -ForegroundColor Yellow
}

exit 0
