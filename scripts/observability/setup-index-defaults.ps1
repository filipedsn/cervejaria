# Template composable: replicas=0 para novos indices OTel (single-node).

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_elastic-auth.ps1')
$ProjectRoot = $ObsProjectRoot
$TemplateFile = Join-Path $ProjectRoot 'deploy\observability\es-index-template-otel-replicas.json'

Write-Host ''
Write-Host 'Quiver Tap - Index defaults OTel (replicas=0)' -ForegroundColor Cyan
Write-Host '=============================================' -ForegroundColor Cyan

$result = Invoke-Elastic -Method PUT -Path '/_index_template/quiver-otel-replicas-zero' -BodyFile $TemplateFile
Write-Host $result

Write-Host ''
Write-Host 'Aplicando replicas=0 em indices existentes...' -ForegroundColor Yellow
& (Join-Path $PSScriptRoot 'fix-es-replicas.ps1')

Write-Host ''
Write-Host 'Concluido.' -ForegroundColor Green
Write-Host ''
