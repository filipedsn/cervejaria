# Abre o ops-panel no navegador — so se a versao atual estiver no ar.

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"
. "$PSScriptRoot\ops-panel-lib.ps1"

$settings = Get-QuiverTapSettings
$paths = Resolve-QuiverTapPaths -Settings $settings

$envFile = Join-Path $paths.ProjectRoot 'ops-panel\.env'
$metaFile = Join-Path $paths.RuntimeDir 'ops-panel.meta.json'
$port = Get-OpsPanelConfiguredPort -EnvFile $envFile

$status = Get-OpsPanelLiveStatus -Port $port -MetaFile $metaFile

if ($status.state -eq 'current') {
  Start-Process $status.url
  Write-Host "Abrindo $($status.url)" -ForegroundColor Green
  exit 0
}

Write-OpsPanelStatusReport -Status $status
exit 1
