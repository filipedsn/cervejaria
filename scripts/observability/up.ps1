# Sobe o EDOT Collector (OTLP :4317/:4318) conectado ao Elasticsearch existente.

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $ProjectRoot

Write-Host 'Subindo EDOT Collector...' -ForegroundColor Cyan
docker compose -f docker-compose.observability.yml up -d
docker compose -f docker-compose.observability.yml restart edot-collector | Out-Null

Start-Sleep -Seconds 3

$otlp = curl.exe -s -o NUL -w '%{http_code}' http://localhost:4318/ 2>$null
Write-Host "OTLP HTTP (:4318): $(if ($otlp -match '^(200|404|405)$') { 'OK' } else { 'FORA' })" -ForegroundColor $(if ($otlp -match '^(200|404|405)$') { 'Green' } else { 'Red' })
Write-Host 'Elasticsearch: http://localhost:9200' -ForegroundColor Gray
Write-Host 'Kibana:        http://localhost:5601' -ForegroundColor Gray
