# Relatório SLO simplificado — consulta Elasticsearch e imprime disponibilidade / error budget.

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_elastic-auth.ps1')
$ProjectRoot = $ObsProjectRoot
$Days = 30

Write-Host ''
Write-Host 'Quiver Tap - Relatorio SLO (ultimos 30 dias)' -ForegroundColor Cyan
Write-Host '============================================' -ForegroundColor Cyan
Write-Host ''

function Write-Utf8NoBom {
  param([string]$Path, [string]$Content)
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($Path, $Content, $utf8)
}

function Get-AvailabilityPct {
  param(
    [string]$Index,
    [string]$UrlWildcard,
    [int]$WindowDays
  )

  $body = @{
    size = 0
    query = @{
      bool = @{
        must = @(
          @{ range = @{ '@timestamp' = @{ gte = "now-${WindowDays}d/d" } } }
          @{ wildcard = @{ 'attributes.http.url' = $UrlWildcard } }
        )
      }
    }
    aggs = @{
      ok = @{
        filter = @{ term = @{ 'attributes.http.status_code' = 200 } }
      }
      total = @{
        value_count = @{ field = '@timestamp' }
      }
    }
  } | ConvertTo-Json -Depth 8 -Compress

  $tmp = Join-Path $env:TEMP "quiver-slo-$([guid]::NewGuid().ToString('N')).json"
  Write-Utf8NoBom -Path $tmp -Content $body
  $raw = Invoke-Elastic -Method POST -Path "/$Index/_search" -BodyFile $tmp
  Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue

  if ($raw -notmatch '"aggregations"') { return $null }
  $json = $raw | ConvertFrom-Json
  $total = [double]$json.aggregations.total.value
  if ($total -le 0) { return $null }
  $ok = [double]$json.aggregations.ok.doc_count
  return [math]::Round(($ok / $total) * 100, 3)
}

function Get-TransacaoFailureCount {
  param([int]$WindowHours)

  $body = @{
    size = 0
    query = @{
      bool = @{
        must = @(
          @{ range = @{ '@timestamp' = @{ gte = "now-${WindowHours}h/h" } } }
          @{ wildcard = @{ 'attributes.event.action' = 'transacao.*' } }
          @{ term = @{ 'attributes.event.outcome' = 'failure' } }
        )
      }
    }
  } | ConvertTo-Json -Depth 6 -Compress

  $tmp = Join-Path $env:TEMP "quiver-slo-tx-$([guid]::NewGuid().ToString('N')).json"
  Write-Utf8NoBom -Path $tmp -Content $body
  $raw = Invoke-Elastic -Method POST -Path '/logs-audit*.otel-prd/_count' -BodyFile $tmp
  Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue

  if ($raw -match '"count":(\d+)') { return [int]$Matches[1] }
  return $null
}

$publicPct = Get-AvailabilityPct -Index 'metrics-httpcheckreceiver.otel-infra*' -UrlWildcard '*tap.quivercloud.com.br/api/ready*' -WindowDays $Days
$originPct = Get-AvailabilityPct -Index 'metrics-httpcheckreceiver.otel-infra*' -UrlWildcard '*3001/api/ready*' -WindowDays $Days
$txFailures = Get-TransacaoFailureCount -WindowHours 1

Write-Host 'SLI                          SLO alvo    Atual (periodo)' -ForegroundColor Yellow
Write-Host ('  Public API ready             99.5%       {0}' -f $(if ($null -ne $publicPct) { "$publicPct% ($Days d)" } else { 'sem dados' }))
Write-Host ('  Origin API ready             99.9%       {0}' -f $(if ($null -ne $originPct) { "$originPct% ($Days d)" } else { 'sem dados' }))

if ($null -ne $publicPct) {
  $budgetUsed = [math]::Max(0, [math]::Round((100 - $publicPct) / (100 - 99.5) * 100, 1))
  $budgetLeft = [math]::Max(0, 100 - $budgetUsed)
  Write-Host ''
  Write-Host "Error budget (public, SLO 99.5%): ~${budgetLeft}% restante (${budgetUsed}% consumido)" -ForegroundColor $(if ($budgetLeft -lt 25) { 'Red' } elseif ($budgetLeft -lt 50) { 'Yellow' } else { 'Green' })
}

Write-Host ''
Write-Host ('Transacoes com falha (ultima 1h): {0}' -f $(if ($null -ne $txFailures) { $txFailures } else { 'sem dados' }))
Write-Host ''
Write-Host 'Fonte: deploy/observability/sli-slo.yml' -ForegroundColor Gray
Write-Host ''
