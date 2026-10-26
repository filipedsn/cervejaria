# Diagnostico SOMENTE LEITURA do Elastic/Kibana PRD (TQ-OBS-04). Nao altera nada.
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/observability/diagnose-prd.ps1 [-SkipCorrelation]
[CmdletBinding()]
param([switch]$SkipCorrelation)

$ErrorActionPreference = 'Stop'
$script:ObsTarget = 'prd'
. (Join-Path $PSScriptRoot '_elastic-auth.ps1')

# Regras PRD obrigatorias. O WI-B acrescenta 'quiver-tap-disk-high-prd' a esta lista.
$ExpectedRules = @(
  'quiver-tap-ui-error-prd', 'quiver-tap-transacao-failure-prd', 'quiver-tap-telemetry-gap-prd',
  'quiver-tap-slo-transacao-failure-rate-prd', 'quiver-tap-slo-cozinha-slow-prd', 'quiver-tap-slo-availability-burn-prd',
  'quiver-tap-public-ready-down-prd', 'quiver-tap-postgres-tcp-down-prd', 'quiver-tap-eventloop-high-prd',
  'quiver-tap-api-ready-down-prd', 'quiver-tap-5xx-rate-prd', 'quiver-tap-401-surge-prd'
)

$results = New-Object System.Collections.Generic.List[object]
$extra = [ordered]@{}

function Add-Result {
  param([string]$Id, [string]$Check, [ValidateSet('PASS', 'FAIL', 'WARN', 'INFO', 'INCONCLUSIVO')][string]$Status, [string]$Evidence)
  $results.Add([pscustomobject]@{ Id = $Id; Verificacao = $Check; Resultado = $Status; Evidencia = $Evidence })
}

function Get-Count {
  param($Value)
  if ($null -eq $Value) { return 0 }
  return @($Value).Count
}

function Invoke-ReadOnly {
  param([ValidateSet('es', 'kibana')][string]$Api, [string]$Method = 'GET', [string]$Path, [string]$Body = '')
  $cleanPath = ($Path -split '\?')[0]
  $allowed = ($Method -eq 'GET') -or ($Method -eq 'POST' -and ($cleanPath -match '/_search$' -or $cleanPath -match '/_count$'))
  if (-not $allowed) { throw "Invoke-ReadOnly recusou $Method $cleanPath (somente leitura)." }
  $tmp = $null
  try {
    $bodyArgs = @{}
    if ($Body) {
      $tmp = Join-Path $env:TEMP "quiver-diag-$([guid]::NewGuid().ToString('N')).json"
      [IO.File]::WriteAllText($tmp, $Body, [Text.UTF8Encoding]::new($false))
      $bodyArgs.BodyFile = $tmp
    }
    $raw = if ($Api -eq 'es') { Invoke-Elastic -Method $Method -Path $Path @bodyArgs } else { Invoke-Kibana -Method $Method -Path $Path @bodyArgs }
  } finally {
    if ($tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
  }
  $text = ($raw | Out-String).Trim()
  if (-not $text) { return $null }
  try { return ($text | ConvertFrom-Json) } catch { return $null }
}

function Get-LatestAgeMinutes {
  param([string]$Pattern)
  $r = Invoke-ReadOnly -Api es -Method POST -Path "/$Pattern/_search?ignore_unavailable=true" -Body '{"size":1,"sort":[{"@timestamp":"desc"}],"_source":["@timestamp"]}'
  if (-not $r -or $r.error) { return $null }
  $hit = @($r.hits.hits) | Select-Object -First 1
  if (-not $hit) { return $null }
  $raw = $hit._source.'@timestamp'
  $ts = if ($raw -is [datetime]) { [DateTimeOffset]$raw.ToUniversalTime() } else { [DateTimeOffset]::Parse([string]$raw, [Globalization.CultureInfo]::InvariantCulture) }
  return [math]::Round(([DateTimeOffset]::UtcNow - $ts).TotalMinutes, 1)
}

function Add-FreshnessResult {
  param([string]$Id, [string]$Pattern, [double]$MaxMinutes, [string]$WhenOld = 'FAIL', [switch]$InfoOnly)
  $age = Get-LatestAgeMinutes -Pattern $Pattern
  if ($null -eq $age) { Add-Result $Id "Ultimo dado em $Pattern" 'FAIL' 'nenhum documento (data stream ausente ou vazio)'; return }
  if ($InfoOnly) { Add-Result $Id "Ultimo dado em $Pattern" 'PASS' "existe; idade $age min"; return }
  $status = if ($age -le $MaxMinutes) { 'PASS' } else { $WhenOld }
  Add-Result $Id "Ultimo dado em $Pattern" $status "idade $age min (limite $MaxMinutes)"
}

# ES-01 / ES-02
$health = Invoke-ReadOnly -Api es -Path '/_cluster/health'
if ($health -and $health.status) {
  Add-Result 'ES-01' 'Saude do cluster' $(if ($health.status -eq 'green') { 'PASS' } else { 'FAIL' }) "status=$($health.status) nodes=$($health.number_of_nodes)"
} else {
  Add-Result 'ES-01' 'Saude do cluster' 'FAIL' 'sem resposta (rede/Tailscale/credencial)'
}
$nodes = Invoke-ReadOnly -Api es -Path '/_cat/nodes?format=json&h=name,heap.percent,disk.used_percent,ram.percent'
if ((Get-Count $nodes) -gt 0 -and -not $nodes.error) {
  $n = @($nodes)[0]
  $ok = ([double]$n.'heap.percent' -lt 85) -and ([double]$n.'disk.used_percent' -lt 80)
  Add-Result 'ES-02' 'Heap e disco do no' $(if ($ok) { 'PASS' } else { 'FAIL' }) "heap=$($n.'heap.percent')% disco=$($n.'disk.used_percent')% ram=$($n.'ram.percent')%"
} else {
  Add-Result 'ES-02' 'Heap e disco do no' 'FAIL' 'sem resposta'
}

# DS-01..07
Add-FreshnessResult 'DS-01' 'metrics-generic.otel-prd*' 5
Add-FreshnessResult 'DS-02' 'logs-technical*.otel-prd*' 60 -WhenOld 'WARN'
Add-FreshnessResult 'DS-03' 'logs-audit*.otel-prd*' 0 -InfoOnly
Add-FreshnessResult 'DS-04' 'traces-*.otel-prd*' 60 -WhenOld 'WARN'
Add-FreshnessResult 'DS-05' 'metrics-httpcheckreceiver.otel-infra*' 5
Add-FreshnessResult 'DS-06' 'metrics-tcpcheckreceiver.otel-infra*' 5
Add-FreshnessResult 'DS-07' 'metrics-hostmetricsreceiver.otel-infra*' 5

# DS-08 segregacao
$devStreams = Invoke-ReadOnly -Api es -Path '/_data_stream/*otel-dev*'
if (-not $devStreams -or $devStreams.error) {
  Add-Result 'DS-08' 'Nenhum data stream DEV no cluster PRD' 'INCONCLUSIVO' 'sem resposta do Elasticsearch'
} else {
  $devCount = Get-Count $devStreams.data_streams
  Add-Result 'DS-08' 'Nenhum data stream DEV no cluster PRD' $(if ($devCount -eq 0) { 'PASS' } else { 'FAIL' }) "$devCount data stream(s) *otel-dev*"
}

# ILM-01
$prdStreams = Invoke-ReadOnly -Api es -Path '/_data_stream/*otel-prd*,*otel-infra*'
$streams = if ($prdStreams -and -not $prdStreams.error -and $prdStreams.data_streams) { @($prdStreams.data_streams) } else { @() }
$noPolicy = @($streams | Where-Object { -not $_.ilm_policy } | ForEach-Object { $_.name })
$defaultPolicy = @($streams | Where-Object { $_.ilm_policy -and $_.ilm_policy -notmatch '^quiver-tap-' } | ForEach-Object { "$($_.name)=$($_.ilm_policy)" })
if ($streams.Count -eq 0) {
  Add-Result 'ILM-01' 'Retencao (ILM) dos data streams PRD/infra' 'FAIL' 'nenhum data stream encontrado'
} elseif ($noPolicy.Count -gt 0) {
  Add-Result 'ILM-01' 'Retencao (ILM) dos data streams PRD/infra' 'FAIL' ("sem politica: " + ($noPolicy -join ', '))
} elseif ($defaultPolicy.Count -gt 0) {
  Add-Result 'ILM-01' 'Retencao (ILM) dos data streams PRD/infra' 'WARN' ("politica padrao (sem delete): " + ($defaultPolicy -join ', '))
} else {
  Add-Result 'ILM-01' 'Retencao (ILM) dos data streams PRD/infra' 'PASS' "$($streams.Count) streams com politica quiver-tap-*"
}

# MAP-01
$ct = Invoke-ReadOnly -Api es -Path '/_component_template/metrics-otel@custom'
$hasHash = $false
if ($ct -and $ct.component_templates) {
  $props = @($ct.component_templates)[0].component_template.template.mappings.properties
  $hasHash = ($null -ne $props) -and ($props.PSObject.Properties.Name -contains '_metric_names_hash')
}
Add-Result 'MAP-01' 'Mapping _metric_names_hash' $(if ($hasHash) { 'PASS' } else { 'FAIL' }) "presente=$hasHash"

# ALT-01
$alt = Invoke-ReadOnly -Api es -Path '/_cat/indices/quiver-tap-alert-events?format=json&h=index,docs.count'
if ($alt -and -not $alt.error -and (Get-Count $alt) -gt 0) {
  Add-Result 'ALT-01' 'Indice quiver-tap-alert-events' 'PASS' "docs=$(@($alt)[0].'docs.count')"
} else {
  Add-Result 'ALT-01' 'Indice quiver-tap-alert-events' 'WARN' 'ausente (sera criado no WI-B, GATE G8)'
}

# KB-01..05
$status = Invoke-ReadOnly -Api kibana -Path '/api/status'
$level = if ($status -and $status.status) { $status.status.overall.level } else { 'sem resposta' }
Add-Result 'KB-01' 'Kibana disponivel' $(if ($level -eq 'available') { 'PASS' } else { 'FAIL' }) "overall=$level"

$alertHealth = Invoke-ReadOnly -Api kibana -Path '/api/alerting/_health'
$hasKey = [bool]($alertHealth -and $alertHealth.has_permanent_encryption_key)
Add-Result 'KB-02' 'Chave de criptografia do Kibana' $(if ($hasKey) { 'PASS' } else { 'FAIL' }) "has_permanent_encryption_key=$hasKey"

$find = Invoke-ReadOnly -Api kibana -Path '/api/alerting/rules/_find?search=quiver-tap&per_page=100'
$rules = if ($find -and $find.data) { @($find.data) } else { @() }
$names = @($rules | ForEach-Object { $_.name })
$missing = @($ExpectedRules | Where-Object { $names -notcontains $_ })
$erroring = @($rules | Where-Object { $_.execution_status.status -eq 'error' } | ForEach-Object { $_.name })
$detail = (@($rules | Where-Object { $_.name -match '-prd$' } | ForEach-Object { "$($_.name)[enabled=$($_.enabled);acoes=$(Get-Count $_.actions);status=$($_.execution_status.status)]" })) -join '; '
$kbStatus = if ($missing.Count -eq 0 -and $erroring.Count -eq 0) { 'PASS' } else { 'FAIL' }
Add-Result 'KB-03' 'Regras PRD presentes e sem erro' $kbStatus ("faltando: " + ($missing -join ',') + " | com erro: " + ($erroring -join ','))
$extra.rules = $detail

$connectors = Invoke-ReadOnly -Api kibana -Path '/api/actions/connectors'
$hasConnector = (@($connectors | Where-Object { $_.name -eq 'quiver-tap-alert-index' })).Count -gt 0
Add-Result 'KB-04' 'Connector quiver-tap-alert-index' $(if ($hasConnector) { 'PASS' } else { 'WARN' }) "existe=$hasConnector (WARN antes do WI-B e esperado)"

$views = Invoke-ReadOnly -Api kibana -Path '/api/data_views'
$prdViews = if ($views -and $views.data_view) { @($views.data_view | Where-Object { $_.title -match 'otel-prd' }) } else { @() }
Add-Result 'KB-05' 'Data views PRD no Kibana' $(if ($prdViews.Count -gt 0) { 'PASS' } else { 'FAIL' }) "$($prdViews.Count) data view(s) com otel-prd"

# HM-01 disco via hostmetrics (INFO: comparar com df -h / do G2)
$fc = Invoke-ReadOnly -Api es -Path '/metrics-hostmetricsreceiver.otel-infra*/_field_caps?fields=*filesystem.utilization*,*mountpoint*'
$utilField = $null; $mountField = $null
if ($fc -and $fc.fields) {
  $fieldNames = @($fc.fields.PSObject.Properties.Name)
  $utilField = $fieldNames | Where-Object { $_ -match 'system\.filesystem\.utilization$' } | Select-Object -First 1
  $mountField = $fieldNames | Where-Object { $_ -match '(^|\.)mountpoint$' } | Select-Object -First 1
}
$extra.hostmetricsUtilField = $utilField
$extra.hostmetricsMountField = $mountField
if (-not $utilField -or -not $mountField) {
  Add-Result 'HM-01' 'Disco via hostmetrics' 'FAIL' "campos nao encontrados (util=$utilField mount=$mountField)"
} else {
  $q = @{ size = 50; _source = $false; fields = @($utilField, $mountField); sort = @(@{ '@timestamp' = 'desc' }); query = @{ bool = @{ filter = @(@{ exists = @{ field = $utilField } }, @{ range = @{ '@timestamp' = @{ gte = 'now-10m' } } }) } } } | ConvertTo-Json -Depth 8 -Compress
  $r = Invoke-ReadOnly -Api es -Method POST -Path '/metrics-hostmetricsreceiver.otel-infra*/_search' -Body $q
  $byMount = [ordered]@{}
  foreach ($hit in @($r.hits.hits)) {
    if (-not $hit -or -not $hit.fields) { continue }
    $mount = @($hit.fields.PSObject.Properties[$mountField].Value)[0]
    $util = @($hit.fields.PSObject.Properties[$utilField].Value)[0]
    if ($mount -and -not $byMount.Contains([string]$mount)) { $byMount[[string]$mount] = [math]::Round([double]$util * 100, 1) }
  }
  $evidence = (@($byMount.Keys | ForEach-Object { "$_=$($byMount[$_])%" })) -join '; '
  Add-Result 'HM-01' 'Disco via hostmetrics (comparar com df -h / do VPS)' 'INFO' "util=$utilField mount=$mountField | $evidence"
}

# COR-01 correlacao ponta a ponta
if ($SkipCorrelation) {
  Add-Result 'COR-01' 'correlationId ponta a ponta' 'INFO' 'pulado (-SkipCorrelation)'
} else {
  $cid = [guid]::NewGuid().ToString()
  foreach ($u in 'https://tap.quivercloud.com.br/api/health', 'https://tap.quivercloud.com.br/api/diag-inexistente') {
    curl.exe -s -o NUL -H "x-correlation-id: $cid" $u | Out-Null
  }
  Write-Host 'COR-01: aguardando 120s para a ingestao...' -ForegroundColor Gray
  Start-Sleep -Seconds 120
  $found = 0
  foreach ($field in 'attributes.correlationId.keyword', 'attributes.correlationId') {
    $cq = @{ size = 5; _source = @('@timestamp'); query = @{ term = @{ $field = $cid } } } | ConvertTo-Json -Depth 6 -Compress
    $cr = Invoke-ReadOnly -Api es -Method POST -Path '/logs-technical*.otel-prd*,logs-audit*.otel-prd*/_search?ignore_unavailable=true' -Body $cq
    if ($cr -and $cr.hits) { $found = Get-Count $cr.hits.hits }
    if ($found -gt 0) { break }
  }
  $ds02 = ($results | Where-Object { $_.Id -eq 'DS-02' } | Select-Object -First 1).Resultado
  $corStatus = if ($found -gt 0) { 'PASS' } elseif ($ds02 -eq 'PASS') { 'INCONCLUSIVO' } else { 'FAIL' }
  Add-Result 'COR-01' 'correlationId ponta a ponta' $corStatus "documentos encontrados: $found"
}

$outDir = Join-Path $ObsProjectRoot 'deploy\runtime'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outFile = Join-Path $outDir ("diagnose-prd-{0:yyyyMMdd-HHmmss}.json" -f (Get-Date))
$payload = [ordered]@{ generatedAt = (Get-Date).ToString('o'); target = 'prd'; results = $results; extra = $extra }
[IO.File]::WriteAllText($outFile, ($payload | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
$results | Format-Table -AutoSize -Wrap
Write-Host "JSON completo: $outFile"

