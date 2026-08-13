# Politicas ILM para indices OTel (traces 30d, audit 90d).

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_elastic-auth.ps1')
$ProjectRoot = $ObsProjectRoot
$ObsDir = Join-Path $ProjectRoot 'deploy\observability'

Write-Host ''
Write-Host 'Quiver Tap - ILM indices OTel' -ForegroundColor Cyan
Write-Host '=============================' -ForegroundColor Cyan

foreach ($pair in @(
  @{ Name = 'quiver-otel-traces-30d'; File = 'es-ilm-policy-traces.json'; Pattern = 'traces-*' },
  @{ Name = 'quiver-otel-audit-90d'; File = 'es-ilm-policy-audit.json'; Pattern = 'logs-audit*' },
  @{ Name = 'quiver-otel-metrics-45d'; File = 'es-ilm-policy-metrics.json'; Pattern = 'metrics-generic.otel-*' },
  @{ Name = 'quiver-otel-logs-30d'; File = 'es-ilm-policy-logs.json'; Pattern = 'logs-generic.otel-*' },
  @{ Name = 'quiver-otel-infra-15d'; File = 'es-ilm-policy-infra.json'; Pattern = 'metrics-infra.otel-*' }
)) {
  Write-Host "Politica $($pair.Name)..." -ForegroundColor Yellow
  $policyPath = Join-Path $ObsDir $pair.File
  Invoke-Elastic -Method PUT -Path "/_ilm/policy/$($pair.Name)" -BodyFile $policyPath | Write-Host

  $templateBody = @{
    index_patterns = @($pair.Pattern)
    template = @{
      settings = @{
        number_of_replicas = 0
        'index.lifecycle.name' = $pair.Name
      }
    }
    priority = 110
  } | ConvertTo-Json -Depth 6 -Compress

  $tmp = Join-Path $env:TEMP "quiver-ilm-$($pair.Name).json"
  Set-Content -Path $tmp -Value $templateBody -Encoding UTF8 -NoNewline
  Invoke-Elastic -Method PUT -Path "/_index_template/$($pair.Name)-template" -BodyFile $tmp | Write-Host
  Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host 'ILM configurado. Indices novos herdam retencao automaticamente.' -ForegroundColor Green
Write-Host ''
