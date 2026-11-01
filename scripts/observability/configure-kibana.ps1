# Configura Kibana: data view, dashboard e alertas para Quiver Tap OTel.
[CmdletBinding()]
param([ValidateSet('dev', 'prd')][string]$Target = 'dev', [switch]$ConfirmPrd)

$ErrorActionPreference = 'Stop'
$script:ObsTarget = $Target
. (Join-Path $PSScriptRoot '_elastic-auth.ps1')
Assert-PrdMutationConfirmed -Confirmed:$ConfirmPrd

function Test-SkipForTarget {
  param([string]$Name)
  if ($ObsTarget -eq 'prd' -and $Name -match '-dev(\.json|\.ndjson)?$') { return $true }
  if ($ObsTarget -eq 'dev' -and $Name -match '-prd(\.json|\.ndjson)?$') { return $true }
  return $false
}
$ProjectRoot = $ObsProjectRoot
$ObsDir = Join-Path $ProjectRoot 'deploy\observability'

function Set-QuiverDataView {
  param([string]$JsonFile)
  if (-not (Test-Path $JsonFile)) { return $false }
  if (Test-SkipForTarget ([System.IO.Path]::GetFileName($JsonFile))) { Write-Host "   Pulado no alvo ${ObsTarget}: $([System.IO.Path]::GetFileName($JsonFile))" -ForegroundColor Gray; return $true }

  $spec = Get-Content -Raw -Path $JsonFile | ConvertFrom-Json
  $name = $spec.data_view.name
  $title = $spec.data_view.title
  $timeField = $spec.data_view.timeFieldName

  $listRaw = Invoke-Kibana -Method GET -Path '/api/data_views'
  $list = $listRaw | ConvertFrom-Json
  $existing = $list.data_view | Where-Object { $_.name -eq $name } | Select-Object -First 1

  if ($existing -and $existing.title -ne $title) {
    $deleted = Invoke-Kibana -Method DELETE -Path "/api/data_views/data_view/$($existing.id)"
    if ($deleted -match '"id"' -or $deleted -match 'not_found' -or $deleted -match '404') {
      $existing = $null
    } else {
      Write-Host "   $([System.IO.Path]::GetFileName($JsonFile)) DELETE: $deleted" -ForegroundColor Yellow
    }
  }

  if ($existing -and $existing.title -eq $title) {
    Write-Host "   OK $([System.IO.Path]::GetFileName($JsonFile)) (ja existe)" -ForegroundColor Green
    return $true
  }

  if ($existing) {
    $updateBody = @{
      data_view = @{
        title = $title
        name = $name
        timeFieldName = $timeField
      }
    } | ConvertTo-Json -Depth 4 -Compress
    $tmp = Join-Path $env:TEMP "quiver-kibana-dv-$([guid]::NewGuid().ToString('N')).json"
    try {
      Set-Content -Path $tmp -Value $updateBody -Encoding UTF8 -NoNewline
      $result = Invoke-Kibana -Method PUT -Path "/api/data_views/data_view/$($existing.id)" -BodyFile $tmp
      if ($result -match '"id"') {
        Write-Host "   OK $([System.IO.Path]::GetFileName($JsonFile)) (atualizado: $($existing.title) -> $title)" -ForegroundColor Green
        return $true
      }
    } finally {
      Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue
    }
  }

  $result = Invoke-Kibana -Method POST -Path '/api/data_views/data_view' -BodyFile $JsonFile
  if ($result -match '"id"' -or $result -match 'Duplicate data view') {
    Write-Host "   OK $([System.IO.Path]::GetFileName($JsonFile)) (criado)" -ForegroundColor Green
    return $true
  }
  Write-Host "   $([System.IO.Path]::GetFileName($JsonFile)) : $result" -ForegroundColor Yellow
  return $false
}

function Set-QuiverAlertRule {
  param(
    [string]$JsonFile,
    [string]$SearchName
  )
  if (-not (Test-Path $JsonFile)) {
    Write-Host "   Alerta ausente: $JsonFile" -ForegroundColor Red
    return $false
  }

  $spec = Get-Content -Raw -Path $JsonFile | ConvertFrom-Json
  $name = $spec.name
  if (Test-SkipForTarget $name) { Write-Host "   Pulado no alvo ${ObsTarget}: $name" -ForegroundColor Gray; return $true }
  $findRaw = Invoke-Kibana -Method GET -Path "/api/alerting/rules/_find?search=$SearchName&per_page=50"
  $find = $findRaw | ConvertFrom-Json
  $existing = $find.data | Where-Object { $_.name -eq $name } | Select-Object -First 1

  if ($existing) {
    # Atualiza no lugar (PUT) para preservar as acoes ja ligadas pelo wire-alert-actions.ps1.
    $detail = Invoke-Kibana -Method GET -Path "/api/alerting/rule/$($existing.id)" | ConvertFrom-Json
    $actions = @(@($detail.actions) | Where-Object { $_ } | ForEach-Object {
      $a = [ordered]@{ group = $_.group; id = $_.id; params = $_.params }
      if ($_.PSObject.Properties.Name -contains 'frequency' -and $_.frequency) { $a.frequency = $_.frequency }
      $a
    })
    $update = [ordered]@{ name = $spec.name; tags = @($spec.tags); schedule = $spec.schedule; params = $spec.params; actions = $actions }
    $hasFrequency = @($actions | Where-Object { $_.Contains('frequency') }).Count -gt 0
    if ($spec.notify_when -and -not $hasFrequency) { $update.notify_when = $spec.notify_when }
    $tmp = Join-Path $env:TEMP "quiver-rule-$([guid]::NewGuid().ToString('N')).json"
    try {
      Write-Utf8NoBom -Path $tmp -Content ($update | ConvertTo-Json -Depth 20 -Compress)
      $result = Invoke-Kibana -Method PUT -Path "/api/alerting/rule/$($existing.id)" -BodyFile $tmp
    } finally {
      Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue
    }
    if ($result -notmatch '"id"') {
      Write-Host "   $name PUT: $result" -ForegroundColor Yellow
      return $false
    }
    if ([bool]$spec.enabled -ne [bool]$detail.enabled) {
      $toggle = if ([bool]$spec.enabled) { '_enable' } else { '_disable' }
      Invoke-Kibana -Method POST -Path "/api/alerting/rule/$($existing.id)/$toggle" | Out-Null
    }
    Write-Host "   OK $name (atualizado; $($actions.Count) acoes preservadas)" -ForegroundColor Green
    return $true
  }

  $result = Invoke-Kibana -Method POST -Path '/api/alerting/rule' -BodyFile $JsonFile
  if ($result -match '"id"') {
    Write-Host "   OK $name (criado)" -ForegroundColor Green
    return $true
  }
  if ($result -match 'encryption key' -or $result -match 'Internal Server Error') {
    Write-Host '   Alertas indisponiveis: Kibana precisa de encryption key' -ForegroundColor Yellow
    return $false
  }
  Write-Host "   $name : $result" -ForegroundColor Yellow
  return $false
}

function Write-Utf8NoBom {
  param([string]$Path, [string]$Content)
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($Path, $Content, $utf8)
}

function Disable-LegacyAlert {
  param([string]$SearchName)
  $findRaw = Invoke-Kibana -Path "/api/alerting/rules/_find?search=$SearchName&per_page=20"
  if ($findRaw -notmatch '"data"') { return }
  $find = $findRaw | ConvertFrom-Json
  foreach ($rule in $find.data) {
    if ($rule.name -ne $SearchName) { continue }
    $result = Invoke-Kibana -Method DELETE -Path "/api/alerting/rule/$($rule.id)"
    if ($result -match '"id"' -or $result -match 'not_found' -or $result -match '404') {
      Write-Host "   Legado removido: $SearchName" -ForegroundColor Gray
    } elseif ($result -match '"enabled":false') {
      Write-Host "   Legado desabilitado: $SearchName" -ForegroundColor Gray
    } else {
      Write-Host "   Falha ao remover ${SearchName}: $result" -ForegroundColor Yellow
    }
  }
}

function Set-UptimeMonitor {
  param([string]$JsonFile)
  if (-not (Test-Path $JsonFile)) { return $false }
  if (Test-SkipForTarget ([System.IO.Path]::GetFileName($JsonFile))) { Write-Host "   Pulado no alvo ${ObsTarget}: $([System.IO.Path]::GetFileName($JsonFile))" -ForegroundColor Gray; return $true }
  $spec = Get-Content -Raw -Path $JsonFile | ConvertFrom-Json
  $name = $spec.name
  $listRaw = Invoke-Kibana -Path '/api/synthetics/monitors'
  if ($listRaw -match $name) {
    Write-Host "   Uptime monitor OK: $name" -ForegroundColor Green
    return $true
  }
  $tmp = Join-Path $env:TEMP "quiver-uptime-$([guid]::NewGuid().ToString('N')).json"
  try {
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($tmp, (Get-Content -Raw -Path $JsonFile), $utf8)
    $result = Invoke-Kibana -Method POST -Path '/api/synthetics/monitors' -BodyFile $tmp
    if ($result -match $name -or $result -match '"id"') {
      Write-Host "   Uptime monitor criado: $name" -ForegroundColor Green
      return $true
    }
    if ($result -match 'Forbidden' -or $result -match 'license' -or $result -match 'locations') {
      Write-Host "   Uptime monitor indisponivel (Synthetics requer locations Elastic Cloud ou private location): $name" -ForegroundColor Yellow
      Write-Host "   Use httpcheck do collector + UptimeRobot (deploy/observability/outside-in.md)" -ForegroundColor Gray
      return $false
    }
    Write-Host "   Uptime monitor: $result" -ForegroundColor Yellow
  } finally {
    Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue
  }
  return $false
}

Write-Host ''
Write-Host 'Quiver Tap - Configurando Kibana' -ForegroundColor Cyan
Write-Host '=================================' -ForegroundColor Cyan
Write-Host ''

# 1. Data views metrics por ambiente (substitui otel-default*)
Write-Host '1. Data views OTel metrics (DEV / PRD)...' -ForegroundColor Yellow
Set-QuiverDataView -JsonFile (Join-Path $ObsDir 'kibana-data-view-metrics-prd.json') | Out-Null
Set-QuiverDataView -JsonFile (Join-Path $ObsDir 'kibana-data-view-metrics-dev.json') | Out-Null

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
  'kibana-logs-data-view-dev.json',
  'kibana-traces-data-view-prd.json',
  'kibana-traces-data-view-dev.json'
)
foreach ($vf in $viewFiles) {
  Set-QuiverDataView -JsonFile (Join-Path $ObsDir $vf) | Out-Null
}

# 2. Dashboards DEV + PRD
Write-Host '2. Dashboards Quiver Tap (DEV / PRD)...' -ForegroundColor Yellow
foreach ($dashFile in @('quiver-tap-dashboard-prd.ndjson', 'quiver-tap-dashboard-dev.ndjson', 'quiver-tap-dashboard-infra.ndjson', 'quiver-tap-dashboard-slo.ndjson', 'quiver-tap-dashboard-business.ndjson')) {
  if (Test-SkipForTarget $dashFile) { Write-Host "   Pulado no alvo ${ObsTarget}: $dashFile" -ForegroundColor Gray; continue }
  $ndjson = Join-Path $ObsDir $dashFile
  if (-not (Test-Path $ndjson)) {
    Write-Host "   Arquivo ausente: $dashFile" -ForegroundColor Red
    continue
  }
  $authArgs = Get-ElasticCurlAuthArgs
  $import = curl.exe -s -X POST "$KibanaBase/api/saved_objects/_import?overwrite=true" `
    -H 'kbn-xsrf: true' `
    @authArgs `
    -F "file=@$ndjson"
  if ($import -match '"success":true' -or $import -match '"successCount"') {
    Write-Host "   Dashboard importado: $dashFile" -ForegroundColor Green
  } else {
    Write-Host "   Import $dashFile : $import" -ForegroundColor Yellow
  }
}

# 3. Alertas: telemetria prod/dev + uptime API
Write-Host '3. Alertas observabilidade...' -ForegroundColor Yellow
Disable-LegacyAlert -SearchName 'quiver-tap-api-down'
Set-QuiverAlertRule -JsonFile (Join-Path $ObsDir 'kibana-alert-telemetry-gap-prd.json') -SearchName 'quiver-tap-telemetry-gap-prd' | Out-Null
Set-QuiverAlertRule -JsonFile (Join-Path $ObsDir 'kibana-alert-telemetry-gap-dev.json') -SearchName 'quiver-tap-telemetry-gap-dev' | Out-Null
Set-QuiverAlertRule -JsonFile (Join-Path $ObsDir 'kibana-alert-api-ready-down-prd.json') -SearchName 'quiver-tap-api-ready-down-prd' | Out-Null
Set-QuiverAlertRule -JsonFile (Join-Path $ObsDir 'kibana-alert-public-ready-down-prd.json') -SearchName 'quiver-tap-public-ready-down-prd' | Out-Null
Set-QuiverAlertRule -JsonFile (Join-Path $ObsDir 'kibana-alert-public-ready-down-dev.json') -SearchName 'quiver-tap-public-ready-down-dev' | Out-Null
Set-QuiverAlertRule -JsonFile (Join-Path $ObsDir 'kibana-alert-postgres-tcp-down-prd.json') -SearchName 'quiver-tap-postgres-tcp-down-prd' | Out-Null
Set-QuiverAlertRule -JsonFile (Join-Path $ObsDir 'kibana-alert-disk-high-prd.json') -SearchName 'quiver-tap-disk-high-prd' | Out-Null
Set-QuiverAlertRule -JsonFile (Join-Path $ObsDir 'kibana-alert-ssh-bruteforce-prd.json') -SearchName 'quiver-tap-ssh-bruteforce-prd' | Out-Null
Set-QuiverAlertRule -JsonFile (Join-Path $ObsDir 'kibana-alert-ssh-login-prd.json') -SearchName 'quiver-tap-ssh-login-prd' | Out-Null
Set-QuiverAlertRule -JsonFile (Join-Path $ObsDir 'kibana-alert-nginx-5xx-surge-prd.json') -SearchName 'quiver-tap-nginx-5xx-surge-prd' | Out-Null
Set-QuiverAlertRule -JsonFile (Join-Path $ObsDir 'kibana-alert-container-restart-prd.json') -SearchName 'quiver-tap-container-restart-prd' | Out-Null
Set-QuiverAlertRule -JsonFile (Join-Path $ObsDir 'kibana-alert-backup-failed-prd.json') -SearchName 'quiver-tap-backup-failed-prd' | Out-Null
Set-QuiverAlertRule -JsonFile (Join-Path $ObsDir 'kibana-alert-backup-missing-prd.json') -SearchName 'quiver-tap-backup-missing-prd' | Out-Null
Set-QuiverAlertRule -JsonFile (Join-Path $ObsDir 'kibana-alert-analyst-heartbeat-missing-prd.json') -SearchName 'quiver-tap-analyst-heartbeat-missing-prd' | Out-Null
Set-QuiverAlertRule -JsonFile (Join-Path $ObsDir 'kibana-alert-postgres-tcp-down-dev.json') -SearchName 'quiver-tap-postgres-tcp-down-dev' | Out-Null
Set-QuiverAlertRule -JsonFile (Join-Path $ObsDir 'kibana-alert-es-cluster.json') -SearchName 'quiver-tap-es-cluster-not-green' | Out-Null

# 3b. Uptime monitors (URLs publicas)
Write-Host '3b. Uptime monitors (Synthetics)...' -ForegroundColor Yellow
Set-UptimeMonitor -JsonFile (Join-Path $ObsDir 'kibana-uptime-monitor-prd.json') | Out-Null
Set-UptimeMonitor -JsonFile (Join-Path $ObsDir 'kibana-uptime-monitor-dev.json') | Out-Null

# 4. Alertas: event loop por ambiente
Write-Host '4. Alertas event loop delay (DEV / PRD)...' -ForegroundColor Yellow
Disable-LegacyAlert -SearchName 'quiver-tap-eventloop-high'
Set-QuiverAlertRule -JsonFile (Join-Path $ObsDir 'kibana-alert-eventloop-prd.json') -SearchName 'quiver-tap-eventloop-high-prd' | Out-Null
Set-QuiverAlertRule -JsonFile (Join-Path $ObsDir 'kibana-alert-eventloop-dev.json') -SearchName 'quiver-tap-eventloop-high-dev' | Out-Null

# 4a. Alertas funcionais PRD
Write-Host '4a. Alertas funcionais (PRD)...' -ForegroundColor Yellow
Set-QuiverAlertRule -JsonFile (Join-Path $ObsDir 'kibana-alert-5xx-rate-prd.json') -SearchName 'quiver-tap-5xx-rate-prd' | Out-Null
Set-QuiverAlertRule -JsonFile (Join-Path $ObsDir 'kibana-alert-401-surge-prd.json') -SearchName 'quiver-tap-401-surge-prd' | Out-Null
Set-QuiverAlertRule -JsonFile (Join-Path $ObsDir 'kibana-alert-ui-error-prd.json') -SearchName 'quiver-tap-ui-error-prd' | Out-Null
Set-QuiverAlertRule -JsonFile (Join-Path $ObsDir 'kibana-alert-transacao-failure-prd.json') -SearchName 'quiver-tap-transacao-failure-prd' | Out-Null
Set-QuiverAlertRule -JsonFile (Join-Path $ObsDir 'kibana-alert-api-latency-p95-prd.json') -SearchName 'quiver-tap-api-latency-p95-prd' | Out-Null

# 4c. Alertas SLO
Write-Host '4c. Alertas SLO (PRD)...' -ForegroundColor Yellow
Set-QuiverAlertRule -JsonFile (Join-Path $ObsDir 'kibana-alert-slo-availability-burn-prd.json') -SearchName 'quiver-tap-slo-availability-burn-prd' | Out-Null
Set-QuiverAlertRule -JsonFile (Join-Path $ObsDir 'kibana-alert-slo-transacao-failure-rate-prd.json') -SearchName 'quiver-tap-slo-transacao-failure-rate-prd' | Out-Null
Set-QuiverAlertRule -JsonFile (Join-Path $ObsDir 'kibana-alert-slo-cozinha-slow-prd.json') -SearchName 'quiver-tap-slo-cozinha-slow-prd' | Out-Null

# 4b. Saved search 4xx UX
Write-Host '4b. Saved search 4xx PRD...' -ForegroundColor Yellow
$search4xx = Join-Path $ObsDir 'kibana-4xx-saved-search.ndjson'
if (Test-Path $search4xx) {
  $authArgs = Get-ElasticCurlAuthArgs
  $import4xx = curl.exe -s -X POST "$KibanaBase/api/saved_objects/_import?overwrite=true" `
    -H 'kbn-xsrf: true' `
    @authArgs `
    -F "file=@$search4xx"
  if ($import4xx -match '"success":true' -or $import4xx -match '"successCount"') {
    Write-Host '   Saved search 4xx importada' -ForegroundColor Green
  } else {
    Write-Host "   Import 4xx: $import4xx" -ForegroundColor Yellow
  }
}

# 5. Verificar telemetria segregada no ES
Write-Host ''
Write-Host '5. Telemetria segregada no Elasticsearch...' -ForegroundColor Yellow
$esResult = Invoke-Elastic -Method POST -Path '/metrics-generic.otel-*/_search' -BodyFile (Join-Path $ObsDir 'es-verify-metrics-env.json')
if ($esResult -match '"buckets"') {
  Write-Host "   $esResult" -ForegroundColor Gray
  if ($esResult -match '"key":"prd"' -and $esResult -match 'quiver-tap-api') {
    Write-Host '   Metricas PRD em metrics-generic.otel-prd*' -ForegroundColor Green
  } elseif ($esResult -match 'quiver-tap-api') {
    Write-Host '   Metricas prod ainda em otel-dev (reinicie collector: npm run obs:up)' -ForegroundColor Yellow
  }
  if ($esResult -match 'quiver-tap-api-dev') {
    Write-Host '   Metricas DEV em metrics-generic.otel-dev*' -ForegroundColor Green
  }
} else {
  Write-Host '   Nenhuma metrica recente - reinicie API e collector' -ForegroundColor Red
}

# 6. Fleet / integracoes
Write-Host ''
Write-Host '6. Integracoes OTel (Fleet)...' -ForegroundColor Yellow
$fleet = Invoke-Kibana -Path '/api/fleet/epm/packages/system_otel'
if ($fleet -match 'security must be enabled' -or $fleet -match 'Forbidden') {
  Write-Host '   Fleet indisponivel (verifique permissoes do usuario elastic)' -ForegroundColor Yellow
  Write-Host '   Metricas de host ja chegam via EDOT Node.js (runtime/host metrics)' -ForegroundColor Gray
  Write-Host '   Para System/Docker OTel Assets: instale via Kibana > Integrations' -ForegroundColor Gray
} else {
  Write-Host '   Fleet disponivel - instale em Integrations' -ForegroundColor Green
}

Write-Host ''
Write-Host 'Links uteis:' -ForegroundColor Cyan
Write-Host "  Dashboard PRD: $KibanaBase/app/dashboards#/view/quiver-tap-observability-prd" -ForegroundColor Gray
Write-Host "  Dashboard DEV: $KibanaBase/app/dashboards#/view/quiver-tap-observability-dev" -ForegroundColor Gray
Write-Host "  Dashboard Infra: $KibanaBase/app/dashboards#/view/quiver-tap-observability-infra" -ForegroundColor Gray
Write-Host "  Dashboard SLO:   $KibanaBase/app/dashboards#/view/quiver-tap-observability-slo" -ForegroundColor Gray
Write-Host "  Dashboard Biz:   $KibanaBase/app/dashboards#/view/quiver-tap-observability-business" -ForegroundColor Gray
Write-Host "  Dashboard Agente: $KibanaBase/app/dashboards#/view/quiver-tap-observability-agente" -ForegroundColor Gray
Write-Host "  Metrics PRD:   $KibanaBase/app/discover#/?_a=(index:'metrics-generic.otel-prd*')" -ForegroundColor Gray
Write-Host "  Metrics DEV:   $KibanaBase/app/discover#/?_a=(index:'metrics-generic.otel-dev*')" -ForegroundColor Gray
  Write-Host "  4xx PRD:    $KibanaBase/app/discover#/?_a=(index:'logs-audit*.otel-prd')&_g=(filters:!(),query:(language:kuery,query:'attributes.event.outcome:%20failure'))" -ForegroundColor Gray
Write-Host "  Audit DEV:  $KibanaBase/app/discover#/?_a=(index:'logs-audit*.otel-dev')" -ForegroundColor Gray
Write-Host "  Logs PRD:   $KibanaBase/app/discover#/?_a=(index:'logs-*.otel-prd')" -ForegroundColor Gray
Write-Host "  Logs DEV:   $KibanaBase/app/discover#/?_a=(index:'logs-*.otel-dev')" -ForegroundColor Gray
Write-Host "  Traces PRD: $KibanaBase/app/discover#/?_a=(index:'traces-*.otel-prd')" -ForegroundColor Gray
Write-Host "  Traces DEV: $KibanaBase/app/discover#/?_a=(index:'traces-*.otel-dev')" -ForegroundColor Gray
Write-Host "  Infra:      $KibanaBase/app/discover#/?_a=(index:'metrics-*.otel-infra*')" -ForegroundColor Gray
Write-Host "  Alertas:    $KibanaBase/app/management/insightsAndAlerting/triggersActions/rules" -ForegroundColor Gray
Write-Host "  Service Inv:$KibanaBase/app/apm/services (requer traces APM)" -ForegroundColor Gray
Write-Host ''
