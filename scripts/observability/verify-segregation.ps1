# Verifica segregacao dev/prd nos indices OTel (ultima hora).

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_elastic-auth.ps1')
$ProjectRoot = $ObsProjectRoot
$ObsDir = Join-Path $ProjectRoot 'deploy\observability'

Write-Host ''
Write-Host 'Quiver Tap - Verificacao segregacao DEV/PRD' -ForegroundColor Cyan
Write-Host '===========================================' -ForegroundColor Cyan

$failed = $false

$crossDev = @{
  size = 0
  query = @{
    bool = @{
      must = @(
        @{ range = @{ '@timestamp' = @{ gte = 'now-1h' } } }
        @{ term = @{ 'resource.attributes.deployment.environment.name' = 'production' } }
      )
    }
  }
} | ConvertTo-Json -Depth 8 -Compress

$tmp = Join-Path $env:TEMP 'quiver-seg-cross.json'
Set-Content -Path $tmp -Value $crossDev -Encoding UTF8 -NoNewline

foreach ($idx in @('metrics-generic.otel-dev', 'logs-generic.otel-dev', 'logs-technical.otel-dev', 'traces-*.otel-dev')) {
  $raw = Invoke-Elastic -Method POST -Path "/$idx/_count" -BodyFile $tmp
  if ($raw -match '"count":(\d+)' -and [int]$Matches[1] -gt 0) {
    Write-Host "  FALHA: $($Matches[1]) docs production em $idx (ultima hora)" -ForegroundColor Red
    $failed = $true
  } else {
    Write-Host "  OK: $idx sem production recente" -ForegroundColor Green
  }
}

Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue

$health = Invoke-Elastic -Path '/_cluster/health?pretty'
if ($health -match '"status"\s*:\s*"yellow"') {
  Write-Host '  AVISO: cluster Elasticsearch YELLOW (replicas em single-node)' -ForegroundColor Yellow
  Write-Host '         Correcao: npm run obs:fix-es-replicas' -ForegroundColor Gray
} elseif ($health -match '"status"\s*:\s*"green"') {
  Write-Host '  OK: cluster Elasticsearch GREEN' -ForegroundColor Green
}

if ($failed) {
  Write-Host ''
  Write-Host 'Segregacao: FALHOU' -ForegroundColor Red
  exit 1
}

Write-Host ''
Write-Host 'Segregacao: OK' -ForegroundColor Green
Write-Host ''
