# Recria data stream tcpcheck com mapping OTel (clona template do httpcheck).

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

Write-Host ''
Write-Host 'Quiver Tap - Corrigir data stream tcpcheck' -ForegroundColor Cyan
Write-Host '=========================================' -ForegroundColor Cyan

& node (Join-Path $ProjectRoot 'scripts\observability\fix-tcpcheck-ds.mjs')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ''
