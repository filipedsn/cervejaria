# Verifica infra OTel e guia configuracao do Kibana Observability.

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $ProjectRoot

function Test-HttpStatus {
  param(
    [string]$Url,
    [string[]]$OkCodes = @('200')
  )
  $code = curl.exe -s -o NUL -w '%{http_code}' $Url 2>$null
  return $OkCodes -contains $code
}

Write-Host ''
Write-Host 'Quiver Tap - Setup Kibana Observability' -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor Cyan
Write-Host ''

$esOk = Test-HttpStatus -Url 'http://localhost:9200'
$kbOk = Test-HttpStatus -Url 'http://localhost:5601/api/status'
$otlpOk = Test-HttpStatus -Url 'http://localhost:4318/' -OkCodes @('200', '404', '405')

Write-Host "Elasticsearch (:9200): $(if ($esOk) { 'OK' } else { 'FORA' })" -ForegroundColor $(if ($esOk) { 'Green' } else { 'Red' })
Write-Host "Kibana (:5601):        $(if ($kbOk) { 'OK' } else { 'FORA' })" -ForegroundColor $(if ($kbOk) { 'Green' } else { 'Red' })
Write-Host "OTLP Collector (:4318): $(if ($otlpOk) { 'OK' } else { 'FORA' })" -ForegroundColor $(if ($otlpOk) { 'Green' } else { 'Red' })

if (-not $otlpOk) {
  Write-Host ''
  Write-Host 'Collector ausente. Execute: npm run obs:up' -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'Instalando integracoes OTel via Fleet API...' -ForegroundColor Cyan

$packages = @(
  'system_otel',
  'docker_otel'
)

foreach ($pkg in $packages) {
  $installUrl = "http://localhost:5601/api/fleet/epm/packages/$pkg"
  $result = curl.exe -s -X POST $installUrl -H 'kbn-xsrf: true' -H 'Content-Type: application/json' -d '{}' 2>$null
  if ($LASTEXITCODE -eq 0 -and $result -notmatch '"statusCode":(4|5)\d\d') {
    Write-Host "  $pkg : instalado ou ja presente" -ForegroundColor Green
  } else {
    Write-Host "  $pkg : instale manualmente em Kibana > Integrations" -ForegroundColor Yellow
  }
}

Write-Host ''
Write-Host 'Proximos passos no Kibana (http://localhost:5601):' -ForegroundColor Yellow
Write-Host '  1. Observability > Applications > Service Inventory' -ForegroundColor Gray
Write-Host '     Servicos: quiver-tap-api (prod) | quiver-tap-api-dev (dev)' -ForegroundColor Gray
Write-Host '  2. Dashboards > Create dashboard (sugestoes):' -ForegroundColor Gray
Write-Host '     - Latencia p95 por rota HTTP (transaction.duration)' -ForegroundColor Gray
Write-Host '     - Taxa de erro 5xx (http.response.status_code >= 500)' -ForegroundColor Gray
Write-Host '     - Tempo de query Postgres (db.system = postgresql)' -ForegroundColor Gray
Write-Host '  3. Rules > Create rule (sugestoes):' -ForegroundColor Gray
Write-Host '     - API indisponivel: uptime monitor em /api/ready' -ForegroundColor Gray
Write-Host '     - Erro rate > 5% em 5 minutos' -ForegroundColor Gray
Write-Host '     - Latencia p95 > 2s' -ForegroundColor Gray
Write-Host ''
Write-Host 'API Key (somente se ES tiver seguranca):' -ForegroundColor Yellow
Write-Host '  Stack Management > API Keys > Create API key (ingest)' -ForegroundColor Gray
Write-Host '  OTEL_EXPORTER_OTLP_HEADERS=Authorization=ApiKey SUA_CHAVE' -ForegroundColor Gray
Write-Host ''
