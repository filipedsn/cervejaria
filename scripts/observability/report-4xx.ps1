# Relatorio agregado de HTTP 4xx em prod (sem PII) — ultimas 2 semanas.

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_elastic-auth.ps1')
$ProjectRoot = $ObsProjectRoot
$ObsDir = Join-Path $ProjectRoot 'deploy\observability'
$QueryFile = Join-Path $ObsDir 'es-query-4xx-report.json'

Write-Host ''
Write-Host 'Quiver Tap - Relatorio 4xx (prod, 14 dias)' -ForegroundColor Cyan
Write-Host '===========================================' -ForegroundColor Cyan
Write-Host ''

if (-not (Test-Path $QueryFile)) {
  Write-Host "Query ausente: $QueryFile" -ForegroundColor Red
  exit 1
}

$result = Invoke-Elastic -Method POST -Path '/*otel-prd*/_search' -BodyFile $QueryFile

if ($result -match '"error"') {
  Write-Host $result
  exit 1
}

$json = $result | ConvertFrom-Json
$total = $json.hits.total.value
Write-Host "Total falhas HTTP (audit): $total" -ForegroundColor $(if ($total -eq 0) { 'Green' } else { 'Yellow' })
Write-Host ''

Write-Host 'Por status:' -ForegroundColor Yellow
foreach ($b in $json.aggregations.by_status.buckets) {
  Write-Host ("  {0}: {1}" -f $b.key, $b.doc_count)
}

Write-Host ''
Write-Host 'Por rota:' -ForegroundColor Yellow
foreach ($b in $json.aggregations.by_route.buckets) {
  Write-Host ("  {0}: {1}" -f $b.key, $b.doc_count)
}

Write-Host ''
Write-Host 'Por dia:' -ForegroundColor Yellow
foreach ($b in $json.aggregations.timeline.buckets) {
  if ($b.doc_count -gt 0) {
    Write-Host ("  {0}: {1}" -f $b.key_as_string.Substring(0, 10), $b.doc_count)
  }
}

Write-Host ''
