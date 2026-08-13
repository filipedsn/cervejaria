# Reinicia o ops-panel na porta configurada.

$ErrorActionPreference = 'Stop'

& "$PSScriptRoot\stop-ops-panel.ps1"
Start-Sleep -Seconds 1
& "$PSScriptRoot\start-ops-panel.ps1"
exit $LASTEXITCODE
