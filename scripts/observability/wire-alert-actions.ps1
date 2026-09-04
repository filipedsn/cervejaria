# Preview/apply the canonical Kibana -> .index alert wiring. Default is read-only.
[CmdletBinding()]
param([switch]$Apply)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_elastic-auth.ps1')

$canonical = @(
  'quiver-tap-api-ready-down-prd', 'quiver-tap-public-ready-down-prd',
  'quiver-tap-postgres-tcp-down-prd', 'quiver-tap-eventloop-high-prd',
  'quiver-tap-5xx-rate-prd', 'quiver-tap-ui-error-prd',
  'quiver-tap-transacao-failure-prd', 'quiver-tap-401-surge-prd',
  'quiver-tap-telemetry-gap-prd', 'quiver-tap-slo-cozinha-slow-prd'
)
$skipped = @{
  'quiver-tap-api-down-prd' = 'LEGACY'
  'quiver-tap-slo-availability-burn-prd' = 'DUPLICATED: public-ready-down e o sinal canonico'
  'quiver-tap-slo-transacao-failure-rate-prd' = 'DUPLICATED: transacao-failure e o sinal canonico'
  'quiver-tap-es-cluster-not-green' = 'NOT_FOR_DELIVERY: regra desabilitada; Elastic e dependencia circular'
}

$connectors = Invoke-Kibana -Path '/api/actions/connectors' | ConvertFrom-Json
$connector = $connectors | Where-Object { $_.name -eq 'quiver-tap-alert-index' } | Select-Object -First 1
if (-not $connector) { throw 'Connector quiver-tap-alert-index ausente.' }

$rules = (Invoke-Kibana -Path '/api/alerting/rules/_find?search=quiver-tap&per_page=100' | ConvertFrom-Json).data
$results = @()
foreach ($rule in $rules) {
  $classification = if ($canonical -contains $rule.name) { 'CANONICAL' } elseif ($skipped.ContainsKey($rule.name)) { $skipped[$rule.name] } elseif ($rule.name -match '-dev$') { 'NOT_FOR_DELIVERY: DEV' } else { 'HUMAN_DECISION_REQUIRED' }
  if ($classification -ne 'CANONICAL') {
    $results += [pscustomobject]@{ Rule=$rule.name; CurrentAction=@($rule.actions).Count; ExpectedAction='index connector'; Result="WOULD_SKIP ($classification)" }
    continue
  }
  if (-not $rule.enabled) {
    $results += [pscustomobject]@{ Rule=$rule.name; CurrentAction=@($rule.actions).Count; ExpectedAction='index connector'; Result='WOULD_SKIP (DISABLED)' }
    continue
  }

  $detail = Invoke-Kibana -Path "/api/alerting/rule/$($rule.id)" | ConvertFrom-Json
  $matching = @($detail.actions | Where-Object { $_.id -eq $connector.id -and $_.group -eq 'query matched' })
  if ($matching.Count -gt 0) {
    $results += [pscustomobject]@{ Rule=$rule.name; CurrentAction='correct'; ExpectedAction='index connector'; Result='NO_CHANGE' }
    continue
  }
  if (-not $Apply) {
    $results += [pscustomobject]@{ Rule=$rule.name; CurrentAction='missing'; ExpectedAction='index connector'; Result='WOULD_ADD' }
    continue
  }

  $document = [ordered]@{ ruleId='{{rule.id}}'; ruleName='{{rule.name}}'; environment='prd'; alertState='{{alertState}}'; reason='{{context.reason}}'; viewInAppUrl='{{context.viewInAppUrl}}'; '@timestamp'='{{date}}' }
  $action = @{ group='query matched'; id=$connector.id; params=@{ documents=@($document) } }
  $payload = @{ name=$detail.name; tags=@($detail.tags); schedule=$detail.schedule; params=$detail.params; actions=@($detail.actions) + @($action); notify_when=$detail.notify_when }
  $tmp = Join-Path $env:TEMP "quiver-wire-$([guid]::NewGuid().ToString('N')).json"
  try {
    [IO.File]::WriteAllText($tmp, ($payload | ConvertTo-Json -Depth 20 -Compress), [Text.UTF8Encoding]::new($false))
    Invoke-Kibana -Method PUT -Path "/api/alerting/rule/$($rule.id)" -BodyFile $tmp | Out-Null
    $results += [pscustomobject]@{ Rule=$rule.name; CurrentAction='missing'; ExpectedAction='index connector'; Result='ADD' }
  } finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
}

$results | Sort-Object Rule | Format-Table -AutoSize
if ($Apply) {
  Write-Host 'Modo APPLY: somente regras CANONICAL foram alteradas.'
} else {
  Write-Host 'Modo DRY-RUN: nenhuma regra foi alterada. Use -Apply somente em ativacao autorizada.'
}
