# Vincula connector .index (Basic) a regras quiver-tap* habilitadas.

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_elastic-auth.ps1')

$webhookBodyTemplate = '{"ruleName":"{{rule.name}}","alertState":"{{alertState}}","reason":"{{context.reason}}","viewInAppUrl":"{{context.viewInAppUrl}}"}'

$connectors = Invoke-Kibana -Path '/api/actions/connectors' | ConvertFrom-Json
$webhook = $connectors | Where-Object { $_.name -eq 'quiver-tap-webhook' } | Select-Object -First 1
$indexConn = $connectors | Where-Object { $_.name -eq 'quiver-tap-alert-index' } | Select-Object -First 1
$indexConnDev = $connectors | Where-Object { $_.name -eq 'quiver-tap-alert-index-dev' } | Select-Object -First 1

if (-not $webhook -and -not $indexConn -and -not $indexConnDev) {
  Write-Host 'Nenhum connector encontrado — rode npm run obs:alert-email primeiro.' -ForegroundColor Yellow
  exit 0
}

$useWebhook = $null -ne $webhook
$mode = if ($useWebhook) { 'webhook/index-dev' } else { 'index' }

Write-Host ''
Write-Host "Quiver Tap - Vincular $mode aos alertas" -ForegroundColor Cyan
Write-Host '=======================================' -ForegroundColor Cyan

$findRaw = Invoke-Kibana -Path '/api/alerting/rules/_find?search=quiver-tap&per_page=100'
$find = $findRaw | ConvertFrom-Json

foreach ($rule in $find.data) {
  if (-not $rule.enabled) { continue }
  if ($rule.name -match '^quiver-tap-(api-down|eventloop-high)$') { continue }

  $isDev = $rule.name -match '-dev$' -and @($rule.tags) -contains 'development'
  if ($isDev -and -not $indexConnDev) {
    Write-Host "   $($rule.name): connector quiver-tap-alert-index-dev ausente; regra DEV nao sera ligada ao indice compartilhado." -ForegroundColor Yellow
    continue
  }
  if (-not $isDev -and -not $webhook -and -not $indexConn) {
    Write-Host "   $($rule.name): nenhum connector aplicavel; regra nao sera alterada." -ForegroundColor Yellow
    continue
  }

  $connector = if ($isDev) { $indexConnDev } elseif ($useWebhook) { $webhook } else { $indexConn }

  $detailRaw = Invoke-Kibana -Path "/api/alerting/rule/$($rule.id)"
  $detail = $detailRaw | ConvertFrom-Json

  if ($useWebhook -and -not $isDev) {
    $action = @{
      group = 'query matched'
      id = $connector.id
      params = @{ body = $webhookBodyTemplate }
    }
  } else {
    $doc = [ordered]@{
      ruleName = '{{rule.name}}'
      alertState = '{{alertState}}'
      reason = '{{context.reason}}'
      viewInAppUrl = '{{context.viewInAppUrl}}'
      '@timestamp' = '{{date}}'
    }
    if ($isDev) { $doc.environment = 'dev' }
    $action = @{
      group = 'query matched'
      id = $connector.id
      params = @{ documents = @($doc) }
    }
  }

  $payload = @{
    name = $detail.name
    tags = @($detail.tags)
    schedule = $detail.schedule
    params = $detail.params
    actions = @($action)
    notify_when = $detail.notify_when
  }

  $tmp = Join-Path $env:TEMP "quiver-wire-$([guid]::NewGuid().ToString('N')).json"
  try {
    $json = $payload | ConvertTo-Json -Depth 20 -Compress
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($tmp, $json, $utf8)
    $result = Invoke-Kibana -Method PUT -Path "/api/alerting/rule/$($rule.id)" -BodyFile $tmp
    if ($result -match '"id"') {
      Write-Host "   OK $($rule.name)" -ForegroundColor Green
    } else {
      Write-Host "   $($rule.name): $result" -ForegroundColor Yellow
    }
  } finally {
    Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue
  }
}

Write-Host ''
