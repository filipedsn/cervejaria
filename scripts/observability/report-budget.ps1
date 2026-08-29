# Relatório de orçamento de telemetria — docs/hora por índice e escopo OTel.

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_elastic-auth.ps1')
$ProjectRoot = $ObsProjectRoot
$ObsDir = Join-Path $ProjectRoot 'deploy\observability'
$Minutes = 60

Write-Host ''
Write-Host 'Quiver Tap - Orçamento de telemetria (ultima hora)' -ForegroundColor Cyan
Write-Host '===================================================' -ForegroundColor Cyan
Write-Host ''

function Write-Utf8NoBom {
  param([string]$Path, [string]$Content)
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($Path, $Content, $utf8)
}

$indices = @(
  'metrics-generic.otel-dev*',
  'metrics-generic.otel-prd*',
  'metrics-*.otel-infra*',
  'logs-generic.otel-dev*',
  'logs-generic.otel-prd*',
  'logs-technical.otel-dev*',
  'logs-technical.otel-prd*',
  'logs-audit*.otel-dev*',
  'logs-audit*.otel-prd*',
  'traces-*.otel-dev*',
  'traces-*.otel-prd*'
)

$CountQueryFile = Join-Path $ObsDir 'es-count-hour.json'
if (-not (Test-Path $CountQueryFile)) {
  Write-Host "Arquivo de query ausente: $CountQueryFile" -ForegroundColor Red
  exit 1
}

Write-Host "Periodo: ultimos ${Minutes} minutos" -ForegroundColor Gray
Write-Host ''

foreach ($idx in $indices) {
  $raw = Invoke-Elastic -Method POST -Path "/$idx/_count" -BodyFile $CountQueryFile
  if ($raw -match '"count":(\d+)') {
    $count = [int]$Matches[1]
    $perHour = [math]::Round($count * (60 / $Minutes))
    $color = if ($perHour -gt 20000) { 'Yellow' } elseif ($count -gt 0) { 'Green' } else { 'Gray' }
    Write-Host ("  {0,-35} {1,8} docs  (~{2,6}/h)" -f $idx, $count, $perHour) -ForegroundColor $color
  } else {
    Write-Host ("  {0,-35} (indisponivel)" -f $idx) -ForegroundColor Red
  }
}

Write-Host ''
Write-Host 'Escopos (metrics-generic.otel-dev):' -ForegroundColor Yellow
$scopeQ = @{
  size = 0
  query = @{ range = @{ '@timestamp' = @{ gte = "now-${Minutes}m" } } }
  aggs = @{
    scope = @{ terms = @{ field = 'scope.name'; size = 15 } }
    instances = @{ cardinality = @{ field = 'resource.attributes.service.instance.id' } }
  }
} | ConvertTo-Json -Depth 5 -Compress
$tmp2 = Join-Path $env:TEMP "quiver-budget-scope.json"
Write-Utf8NoBom -Path $tmp2 -Content $scopeQ
$scopeRaw = Invoke-Elastic -Method POST -Path '/metrics-generic.otel-dev/_search' -BodyFile $tmp2
Remove-Item -LiteralPath $tmp2 -ErrorAction SilentlyContinue
if ($scopeRaw -match '"buckets":\[') {
  $scope = $scopeRaw | ConvertFrom-Json
  foreach ($b in $scope.aggregations.scope.buckets) {
    Write-Host ("    {0,-50} {1,8}" -f $b.key, $b.doc_count) -ForegroundColor Gray
  }
  $inst = $scope.aggregations.instances.value
  Write-Host ("    service.instance.id distintos: {0}" -f $inst) -ForegroundColor $(if ($inst -gt 2) { 'Yellow' } else { 'Gray' })
}

Write-Host ''
Write-Host 'Segregacao cruzada (prod em indice dev, ultima hora):' -ForegroundColor Yellow
$crossQ = @{
  size = 0
  query = @{
    bool = @{
      must = @(
        @{ range = @{ '@timestamp' = @{ gte = "now-${Minutes}m" } } }
        @{ term = @{ 'resource.attributes.deployment.environment.name' = 'production' } }
      )
    }
  }
} | ConvertTo-Json -Depth 6 -Compress
$tmp3 = Join-Path $env:TEMP "quiver-budget-cross.json"
Write-Utf8NoBom -Path $tmp3 -Content $crossQ
$crossRaw = Invoke-Elastic -Method POST -Path '/metrics-generic.otel-dev/_count' -BodyFile $tmp3
Remove-Item -LiteralPath $tmp3 -ErrorAction SilentlyContinue
if ($crossRaw -match '"count":(\d+)') {
  $cross = [int]$Matches[1]
  if ($cross -gt 0) {
    Write-Host "  AVISO: $cross docs de production em metrics-generic.otel-dev" -ForegroundColor Yellow
  } else {
    Write-Host '  OK: nenhum doc de production em otel-dev (ultima hora)' -ForegroundColor Green
  }
}

Write-Host ''
