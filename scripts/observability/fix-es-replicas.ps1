# Corrige cluster Elasticsearch yellow em single-node (replicas nao alocadas).
# Aplica number_of_replicas=0 em indices existentes e template para novos indices OTel.

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_elastic-auth.ps1')

Write-Host ''
Write-Host 'Quiver Tap - Corrigir replicas ES (single-node)' -ForegroundColor Cyan
Write-Host '==============================================' -ForegroundColor Cyan
Write-Host ''

$healthBefore = Invoke-Elastic -Path '/_cluster/health?pretty'
Write-Host "Cluster antes:" -ForegroundColor Yellow
Write-Host $healthBefore

Write-Host ''
Write-Host '1. Ajustando replicas=0 em indices existentes...' -ForegroundColor Yellow
$settingsFile = Join-Path $env:TEMP "quiver-es-replicas.json"
'{"index":{"number_of_replicas":0}}' | Set-Content -Path $settingsFile -Encoding UTF8 -NoNewline
$settingsResult = Invoke-Elastic -Method PUT -Path '/*/_settings' -BodyFile $settingsFile
Remove-Item -LiteralPath $settingsFile -ErrorAction SilentlyContinue
Write-Host $settingsResult

Write-Host ''
Write-Host '2. Index template (opcional — indices OTel usam data streams)...' -ForegroundColor Yellow
Write-Host '   Retencao de replicas=0 aplicada nos indices existentes.' -ForegroundColor Gray
Write-Host '   Novos indices herdam number_of_replicas=0 via npm run obs:ilm' -ForegroundColor Gray

Write-Host ''
Write-Host '3. Aguardando cluster...' -ForegroundColor Yellow
Start-Sleep -Seconds 3
$healthAfter = Invoke-Elastic -Path '/_cluster/health?pretty'
Write-Host $healthAfter

if ($healthAfter -match '"status"\s*:\s*"green"') {
  Write-Host ''
  Write-Host 'Cluster GREEN.' -ForegroundColor Green
} elseif ($healthAfter -match '"status"\s*:\s*"yellow"') {
  Write-Host ''
  Write-Host 'Cluster ainda yellow — verifique shards UNASSIGNED:' -ForegroundColor Yellow
  Invoke-Elastic -Path '/_cat/shards?v' | Select-String 'UNASSIGNED'
} else {
  Write-Host ''
  Write-Host 'Verifique saude do cluster manualmente.' -ForegroundColor Yellow
}

Write-Host ''
