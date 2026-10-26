# Status do ops-panel (porta, PID, versao).

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"
. "$PSScriptRoot\ops-panel-lib.ps1"

$settings = Get-QuiverTapSettings
$paths = Resolve-QuiverTapPaths -Settings $settings

$port = Get-OpsPanelConfiguredPort -EnvFile (Join-Path $paths.ProjectRoot 'ops-panel\.env')
$status = Get-OpsPanelLiveStatus -Port $port
Write-OpsPanelStatusReport -Status $status

if ($status.state -eq 'current') { exit 0 }
exit 1
