# Configura Kibana: data view, dashboard e alertas para Quiver Tap OTel.

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$ObsDir = Join-Path $ProjectRoot 'deploy\observability'
$KibanaBase = 'http://localhost:5601'
$Headers = @{
  'kbn-xsrf' = 'true'
  'Content-Type' = 'application/json'
}

function Invoke-Kibana {
  param(
    [string]$Method,
    [string]$Path,
    [string]$BodyFile = ''
  )
  $args = @('-s', '-X', $Method, "$KibanaBase$Path", '-H', 'kbn-xsrf: true', '-H', 'Content-Type: application/json')
  if ($BodyFile) { $args += @('--data-binary', "@$BodyFile") }
  return curl.exe @args
}

Write-Host ''
Write-Host 'Quiver Tap - Configurando Kibana' -ForegroundColor Cyan
Write-Host '=================================' -ForegroundColor Cyan
Write-Host ''

# 1. Data view metrics
Write-Host '1. Data view OTel metrics...' -ForegroundColor Yellow
$existing = Invoke-Kibana -Method GET -Path '/api/data_views/data_view/metrics-generic.otel-default*'
if ($existing -match 'not_found' -or $existing -match '"statusCode":404') {
  $dv = Invoke-Kibana -Method POST -Path '/api/data_views/data_view' -BodyFile (Join-Path $ObsDir 'kibana-data-view.json')
  if ($dv -match '"id"' -or $dv -match 'Duplicate data view') {
    Write-Host '   Data view OK (Quiver Tap OTel Metrics)' -ForegroundColor Green
  } else {
    Write-Host "   Falha: $dv" -ForegroundColor Red
  }
} else {
  Write-Host '   Data view ja existe' -ForegroundColor Green
}

# 1b. Data view logs
Write-Host '1b. Data view OTel logs...' -ForegroundColor Yellow
$existingLogs = Invoke-Kibana -Method GET -Path '/api/data_views/data_view/logs-generic.otel-default*'
if ($existingLogs -match 'not_found' -or $existingLogs -match '"statusCode":404') {
  $dvLogs = Invoke-Kibana -Method POST -Path '/api/data_views/data_view' -BodyFile (Join-Path $ObsDir 'kibana-logs-data-view.json')
  if ($dvLogs -match '"id"' -or $dvLogs -match 'Duplicate data view') {
    Write-Host '   Data view OK (Quiver Tap OTel Logs)' -ForegroundColor Green
  } else {
    Write-Host "   Falha: $dvLogs" -ForegroundColor Red
  }
} else {
  Write-Host '   Data view logs ja existe' -ForegroundColor Green
}

# 1c. Data views por ambiente (logs/traces/audit/infra)
Write-Host '1c. Data views por cervejaria/ambiente...' -ForegroundColor Yellow
$viewFiles = @(
  'kibana-audit-data-view-prd.json',
  'kibana-audit-data-view-dev.json',
  'kibana-metrics-infra-data-view.json',
  'kibana-logs-data-view-prd.json',
  'kibana-traces-data-view-prd.json'
)
foreach ($vf in $viewFiles) {
  $path = Join-Path $ObsDir $vf
  if (-not (Test-Path $path)) { continue }
  $result = Invoke-Kibana -Method POST -Path '/api/data_views/data_view' -BodyFile $path
  if ($result -match '"id"' -or $result -match 'Duplicate data view') {
    Write-Host "   OK $vf" -ForegroundColor Green
  } else {
    Write-Host "   $vf : $result" -ForegroundColor Yellow
  }
}

# 2. Dashboard + visualizations via saved objects import
Write-Host '2. Dashboard Quiver Tap...' -ForegroundColor Yellow
$ndjson = Join-Path $ObsDir 'quiver-tap-dashboard.ndjson'
if (Test-Path $ndjson) {
  $import = curl.exe -s -X POST "$KibanaBase/api/saved_objects/_import?overwrite=true" `
    -H 'kbn-xsrf: true' `
    -F "file=@$ndjson"
  if ($import -match '"success":true' -or $import -match '"successCount"') {
    Write-Host '   Dashboard importado' -ForegroundColor Green
  } else {
    Write-Host "   Import: $import" -ForegroundColor Yellow
  }
} else {
  Write-Host '   Arquivo NDJSON ausente' -ForegroundColor Red
}

# 3. Alerta: API sem metricas (proxy de indisponibilidade)
Write-Host '3. Alerta API sem telemetria...' -ForegroundColor Yellow
$alertFile = Join-Path $ObsDir 'kibana-alert-api-down.json'
$rules = Invoke-Kibana -Method GET -Path '/api/alerting/rules/_find?search=quiver-tap-api-down'
if ($rules -notmatch 'quiver-tap-api-down') {
  $alert = Invoke-Kibana -Method POST -Path '/api/alerting/rule' -BodyFile $alertFile
  if ($alert -match '"id"') {
    Write-Host '   Alerta criado: quiver-tap-api-down' -ForegroundColor Green
  } elseif ($alert -match 'encryption key' -or $alert -match 'Internal Server Error') {
    Write-Host '   Alertas indisponiveis: Kibana precisa de encryption key' -ForegroundColor Yellow
    Write-Host '   Execute no container Kibana: bin/kibana-encryption-keys generate' -ForegroundColor Gray
  } else {
    Write-Host "   Alerta: $alert" -ForegroundColor Yellow
  }
} else {
  Write-Host '   Alerta ja existe' -ForegroundColor Green
}

# 4. Alerta: event loop alto
Write-Host '4. Alerta event loop delay...' -ForegroundColor Yellow
$alert2File = Join-Path $ObsDir 'kibana-alert-eventloop.json'
$rules2 = Invoke-Kibana -Method GET -Path '/api/alerting/rules/_find?search=quiver-tap-eventloop-high'
if ($rules2 -notmatch 'quiver-tap-eventloop-high') {
  $alert2 = Invoke-Kibana -Method POST -Path '/api/alerting/rule' -BodyFile $alert2File
  if ($alert2 -match '"id"') {
    Write-Host '   Alerta criado: quiver-tap-eventloop' -ForegroundColor Green
  } else {
    Write-Host "   Alerta: $alert2" -ForegroundColor Yellow
  }
} else {
  Write-Host '   Alerta ja existe' -ForegroundColor Green
}

# 5. Verificar telemetria no ES
Write-Host ''
Write-Host '5. Telemetria no Elasticsearch...' -ForegroundColor Yellow
$esResult = curl.exe -s -X POST 'http://localhost:9200/metrics-generic.otel-default/_search' `
  -H 'Content-Type: application/json' `
  --data-binary "@$(Join-Path $ObsDir 'es-all-services.json')"
if ($esResult -match 'quiver-tap-api') {
  Write-Host '   Servico quiver-tap-api-dev encontrado nos indices OTel' -ForegroundColor Green
} else {
  Write-Host '   Nenhuma metrica encontrada - reinicie a API' -ForegroundColor Red
}

# 6. Fleet / integracoes
Write-Host ''
Write-Host '6. Integracoes OTel (Fleet)...' -ForegroundColor Yellow
$fleet = curl.exe -s "$KibanaBase/api/fleet/epm/packages/system_otel" -H 'kbn-xsrf: true'
if ($fleet -match 'security must be enabled' -or $fleet -match 'Forbidden') {
  Write-Host '   Fleet indisponivel sem seguranca no Elasticsearch' -ForegroundColor Yellow
  Write-Host '   Metricas de host ja chegam via EDOT Node.js (runtime/host metrics)' -ForegroundColor Gray
  Write-Host '   Para System/Docker OTel Assets: habilite xpack.security no ES 8.17' -ForegroundColor Gray
} else {
  Write-Host '   Fleet disponivel - instale em Integrations' -ForegroundColor Green
}

Write-Host ''
Write-Host 'Links uteis:' -ForegroundColor Cyan
Write-Host "  Dashboard:  $KibanaBase/app/dashboards#/view/quiver-tap-observability" -ForegroundColor Gray
Write-Host "  Discover:   $KibanaBase/app/discover#/?_a=(index:'metrics-generic.otel-default*')" -ForegroundColor Gray
Write-Host "  Audit PRD:  $KibanaBase/app/discover#/?_a=(index:'audit-*.otel-prd')" -ForegroundColor Gray
Write-Host "  Audit DEV:  $KibanaBase/app/discover#/?_a=(index:'audit-*.otel-dev')" -ForegroundColor Gray
Write-Host "  Logs PRD:   $KibanaBase/app/discover#/?_a=(index:'logs-*.otel-prd')" -ForegroundColor Gray
Write-Host "  Traces PRD: $KibanaBase/app/discover#/?_a=(index:'traces-*.otel-prd')" -ForegroundColor Gray
Write-Host "  Infra:      $KibanaBase/app/discover#/?_a=(index:'metrics-infra.otel-*')" -ForegroundColor Gray
Write-Host "  Alertas:    $KibanaBase/app/management/insightsAndAlerting/triggersActions/rules" -ForegroundColor Gray
Write-Host "  Service Inv:$KibanaBase/app/apm/services (requer traces APM)" -ForegroundColor Gray
Write-Host ''
