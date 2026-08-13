# Status do ops-panel — fonte unica da verdade (porta, PID, versao).

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"
. "$PSScriptRoot\ops-panel-lib.ps1"

$settings = Get-QuiverTapSettings
$paths = Resolve-QuiverTapPaths -Settings $settings

$envFile = Join-Path $paths.ProjectRoot 'ops-panel\.env'
$metaFile = Join-Path $paths.RuntimeDir 'ops-panel.meta.json'
$port = Get-OpsPanelConfiguredPort -EnvFile $envFile

$status = Get-OpsPanelLiveStatus -Port $port -MetaFile $metaFile
Write-OpsPanelStatusReport -Status $status

if ($status.state -eq 'current') { exit 0 }
exit 1
