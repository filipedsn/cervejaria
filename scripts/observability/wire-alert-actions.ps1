# Preview/apply the canonical Kibana -> .index alert wiring (firing + recovered). Default is read-only.
[CmdletBinding()]
param(
  [ValidateSet('dev', 'prd')][string]$Target = 'dev',
  [switch]$ConfirmPrd,
  [switch]$Apply,
  [string[]]$IncludeRule = @()
)

$ErrorActionPreference = 'Stop'
$script:ObsTarget = $Target
. (Join-Path $PSScriptRoot '_elastic-auth.ps1')
if ($Apply) { Assert-PrdMutationConfirmed -Confirmed:$ConfirmPrd }

$canonical = @(
  'quiver-tap-api-ready-down-prd', 'quiver-tap-public-ready-down-prd',
  'quiver-tap-postgres-tcp-down-prd', 'quiver-tap-eventloop-high-prd',
  'quiver-tap-5xx-rate-prd', 'quiver-tap-ui-error-prd',
  'quiver-tap-transacao-failure-prd', 'quiver-tap-401-surge-prd',
  'quiver-tap-telemetry-gap-prd', 'quiver-tap-slo-cozinha-slow-prd',
  'quiver-tap-disk-high-prd', 'quiver-tap-ssh-bruteforce-prd',
  'quiver-tap-ssh-login-prd', 'quiver-tap-nginx-5xx-surge-prd',
  'quiver-tap-container-restart-prd', 'quiver-tap-backup-failed-prd',
  'quiver-tap-backup-missing-prd'
)
# Somente regras temporarias de teste (prefixo quiver-tap-TESTE-) podem ser incluidas por parametro.
$canonical = @($canonical) + @($IncludeRule | Where-Object { $_ -match '^quiver-tap-TESTE-' })
$skipped = @{
  'quiver-tap-api-down-prd' = 'LEGACY'
  'quiver-tap-slo-availability-burn-prd' = 'DUPLICATED: public-ready-down e o sinal canonico'
  'quiver-tap-slo-transacao-failure-rate-prd' = 'DUPLICATED: transacao-failure e o sinal canonico'
  'quiver-tap-ui-error-surge-prd' = 'DUPLICATED: ui-error e o sinal canonico'
  'quiver-tap-es-cluster-not-green' = 'NOT_FOR_DELIVERY: regra desabilitada; Elastic e dependencia circular'
}

# Kibana 8.17: frequencia por acao; o notify_when no nivel da regra e omitido no PUT.
$frequency = [ordered]@{ summary = $false; notify_when = 'onActionGroupChange'; throttle = $null }

function New-AlertDocument {
  param([string]$State)
  # Variaveis validas da regra .es-query: rule.id, rule.name, context.message, context.link, date.
  return [ordered]@{
    ruleId = '{{rule.id}}'
    ruleName = '{{rule.name}}'
    environment = $Target
    alertState = $State
    reason = '{{context.message}}'
    viewInAppUrl = '{{context.link}}'
    '@timestamp' = '{{date}}'
  }
}

function Test-OurAction {
  param($Actions, [string]$ConnectorId, [string]$Group, [string]$State)
  $match = @(@($Actions) | Where-Object { $_ -and $_.id -eq $ConnectorId -and $_.group -eq $Group })
  if ($match.Count -ne 1) { return $false }
  $doc = @($match[0].params.documents)[0]
  return [bool]($doc -and $doc.alertState -eq $State -and $doc.reason -eq '{{context.message}}' -and $doc.ruleId -eq '{{rule.id}}')
}

$connectors = Invoke-Kibana -Path '/api/actions/connectors' | ConvertFrom-Json
$connector = $connectors | Where-Object { $_.name -eq 'quiver-tap-alert-index' } | Select-Object -First 1
if (-not $connector) { throw 'Connector quiver-tap-alert-index ausente. Rode setup-alert-email.ps1 antes.' }

$rules = (Invoke-Kibana -Path '/api/alerting/rules/_find?search=quiver-tap&per_page=100' | ConvertFrom-Json).data
$results = @()
foreach ($rule in $rules) {
  $classification = if ($canonical -contains $rule.name) { 'CANONICAL' } elseif ($skipped.ContainsKey($rule.name)) { $skipped[$rule.name] } elseif ($rule.name -match '-dev$') { 'NOT_FOR_DELIVERY: DEV' } else { 'HUMAN_DECISION_REQUIRED' }
  if ($classification -ne 'CANONICAL') {
    $results += [pscustomobject]@{ Rule = $rule.name; Current = @($rule.actions).Count; Result = "WOULD_SKIP ($classification)" }
    continue
  }
  if (-not $rule.enabled) {
    $results += [pscustomobject]@{ Rule = $rule.name; Current = @($rule.actions).Count; Result = 'WOULD_SKIP (DISABLED)' }
    continue
  }

  $detail = Invoke-Kibana -Path "/api/alerting/rule/$($rule.id)" | ConvertFrom-Json
  $ourCount = @(@($detail.actions) | Where-Object { $_ -and $_.id -eq $connector.id }).Count
  $okFiring = Test-OurAction $detail.actions $connector.id 'query matched' 'active'
  $okRecovered = Test-OurAction $detail.actions $connector.id 'recovered' 'recovered'
  $current = "nossas=$ourCount firing=$okFiring recovered=$okRecovered"
  if ($okFiring -and $okRecovered -and $ourCount -eq 2) {
    $results += [pscustomobject]@{ Rule = $rule.name; Current = $current; Result = 'NO_CHANGE' }
    continue
  }
  if (-not $Apply) {
    $results += [pscustomobject]@{ Rule = $rule.name; Current = $current; Result = 'WOULD_REWIRE' }
    continue
  }

  $kept = @(@($detail.actions) | Where-Object { $_ -and $_.id -ne $connector.id } | ForEach-Object {
    $a = [ordered]@{ group = $_.group; id = $_.id; params = $_.params }
    $a.frequency = if ($_.PSObject.Properties.Name -contains 'frequency' -and $_.frequency) { $_.frequency } else { $frequency }
    $a
  })
  $new = @(
    [ordered]@{ group = 'query matched'; id = $connector.id; params = @{ documents = @(New-AlertDocument 'active') }; frequency = $frequency },
    [ordered]@{ group = 'recovered'; id = $connector.id; params = @{ documents = @(New-AlertDocument 'recovered') }; frequency = $frequency }
  )
  $payload = [ordered]@{ name = $detail.name; tags = @($detail.tags); schedule = $detail.schedule; params = $detail.params; actions = @($kept) + @($new) }
  $tmp = Join-Path $env:TEMP "quiver-wire-$([guid]::NewGuid().ToString('N')).json"
  try {
    [IO.File]::WriteAllText($tmp, ($payload | ConvertTo-Json -Depth 20 -Compress), [Text.UTF8Encoding]::new($false))
    $response = (Invoke-Kibana -Method PUT -Path "/api/alerting/rule/$($rule.id)" -BodyFile $tmp | Out-String)
  } finally {
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
  }
  if ($response -match '"id"\s*:') {
    $results += [pscustomobject]@{ Rule = $rule.name; Current = $current; Result = 'REWIRED' }
  } else {
    $short = ($response -replace '\s+', ' ')
    if ($short.Length -gt 300) { $short = $short.Substring(0, 300) }
    $results += [pscustomobject]@{ Rule = $rule.name; Current = $current; Result = "FAILED: $short" }
  }
}

$results | Sort-Object Rule | Format-Table -AutoSize -Wrap
if ($Apply) {
  Write-Host 'Modo APPLY: somente regras CANONICAL foram alteradas.'
} else {
  Write-Host 'Modo DRY-RUN: nenhuma regra foi alterada. Use -Apply somente em ativacao autorizada.'
}
if (@($results | Where-Object { $_.Result -like 'FAILED*' }).Count -gt 0) { exit 1 }
