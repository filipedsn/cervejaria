# Abre o ops-panel no navegador; sobe o painel antes se estiver parado.

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"
. "$PSScriptRoot\ops-panel-lib.ps1"

$settings = Get-QuiverTapSettings
$paths = Resolve-QuiverTapPaths -Settings $settings

$port = Get-OpsPanelConfiguredPort -EnvFile (Join-Path $paths.ProjectRoot 'ops-panel\.env')
$status = Get-OpsPanelLiveStatus -Port $port

if ($status.state -ne 'current') {
  & "$PSScriptRoot\start-ops-panel.ps1"
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  $status = Get-OpsPanelLiveStatus -Port $port
}

Start-Process $status.url
Write-Host "Abrindo $($status.url)" -ForegroundColor Green
exit 0
