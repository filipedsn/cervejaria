# Para o ops-panel na porta configurada.

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"
. "$PSScriptRoot\ops-panel-lib.ps1"

$settings = Get-QuiverTapSettings
$paths = Resolve-QuiverTapPaths -Settings $settings

$pidFile = Join-Path $paths.RuntimeDir 'ops-panel.pid'
$port = Get-OpsPanelConfiguredPort -EnvFile (Join-Path $paths.ProjectRoot 'ops-panel\.env')

if (-not (Get-PortListenerPid -Port $port)) {
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  Write-Host 'Ops panel ja estava parado.' -ForegroundColor Yellow
  exit 0
}

if (-not (Stop-PortListener -Port $port)) {
  Write-Host "Nao foi possivel liberar a porta $port." -ForegroundColor Red
  exit 1
}

Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
Write-Host 'Ops panel parado.' -ForegroundColor Green
exit 0
