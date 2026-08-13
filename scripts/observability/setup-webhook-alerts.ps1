# Cria connector Index no Kibana (licenca Basic) e vincula alertas quiver-tap*.
# Kibana indexa eventos em ES; a API faz poll e envia e-mail via SMTP.
# Connector .webhook/.email exigem Gold — tentamos webhook apenas se licenca permitir.

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_elastic-auth.ps1')
$ProjectRoot = $ObsProjectRoot
$BackendEnv = Join-Path $ProjectRoot 'backend\.env.development'
$ConnectorsEnv = Join-Path $ProjectRoot 'deploy\observability\.env.connectors'
$AlertIndex = 'quiver-tap-alert-events'

function Read-DotEnv {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return @{} }
  $map = @{}
  Get-Content $Path | ForEach-Object {
    if ($_ -match '^\s*([^#=]+)=(.*)$') {
      $map[$Matches[1].Trim()] = $Matches[2].Trim().Trim('"')
    }
  }
  return $map
}

function Write-Utf8NoBom {
  param([string]$Path, [string]$Content)
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($Path, $Content, $utf8)
}

$envMap = Read-DotEnv $BackendEnv
$connMap = Read-DotEnv $ConnectorsEnv

$secret = $envMap['KIBANA_ALERT_WEBHOOK_SECRET']
if (-not $secret) { $secret = $connMap['KIBANA_ALERT_WEBHOOK_SECRET'] }

$webhookUrl = $connMap['KIBANA_ALERT_WEBHOOK_URL']
if (-not $webhookUrl) { $webhookUrl = 'http://host.docker.internal:3002/api/observability/kibana-alert' }

Write-Host ''
Write-Host 'Quiver Tap - Alertas Kibana -> API (SMTP)' -ForegroundColor Cyan
Write-Host '=========================================' -ForegroundColor Cyan

$mappingBody = @{
  mappings = @{
    properties = @{
      '@timestamp' = @{ type = 'date' }
      ruleName = @{ type = 'keyword' }
      alertState = @{ type = 'keyword' }
      reason = @{ type = 'text' }
      viewInAppUrl = @{ type = 'keyword' }
    }
  }
} | ConvertTo-Json -Depth 6 -Compress

Invoke-Elastic -Method PUT -Path "/$AlertIndex" -Body $mappingBody | Out-Null
Write-Host "  Indice ES: $AlertIndex" -ForegroundColor Gray

$typesRaw = Invoke-Kibana -Path '/api/actions/connector_types' | ConvertFrom-Json
$webhookEnabled = ($typesRaw | Where-Object { $_.id -eq '.webhook' -and $_.enabled -eq $true }) -ne $null

if ($webhookEnabled -and $secret) {
  Write-Host '  Licenca permite .webhook — criando connector webhook' -ForegroundColor Green
  $connectorBody = @{
    name = 'quiver-tap-webhook'
    connector_type_id = '.webhook'
    config = @{
      url = $webhookUrl
      method = 'post'
      headers = @{
        Authorization = "Bearer $secret"
        'Content-Type' = 'application/json'
      }
    }
  } | ConvertTo-Json -Depth 6 -Compress
  $tmp = Join-Path $env:TEMP 'quiver-webhook-connector.json'
  Write-Utf8NoBom -Path $tmp -Content $connectorBody
  $list = Invoke-Kibana -Path '/api/actions/connectors' | ConvertFrom-Json
  $existing = $list | Where-Object { $_.name -eq 'quiver-tap-webhook' } | Select-Object -First 1
  if ($existing) {
    Invoke-Kibana -Method PUT -Path "/api/actions/connector/$($existing.id)" -BodyFile $tmp | Out-Null
  } else {
    Invoke-Kibana -Method POST -Path '/api/actions/connector' -BodyFile $tmp | Out-Null
  }
  Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue
} else {
  Write-Host '  Licenca Basic: usando connector .index (poll ES na API)' -ForegroundColor Yellow
  $connectorBody = @{
    name = 'quiver-tap-alert-index'
    connector_type_id = '.index'
    config = @{
      index = $AlertIndex
      refresh = $true
      executionTimeField = '@timestamp'
    }
  } | ConvertTo-Json -Depth 6 -Compress
  $tmp = Join-Path $env:TEMP 'quiver-index-connector.json'
  Write-Utf8NoBom -Path $tmp -Content $connectorBody
  $list = Invoke-Kibana -Path '/api/actions/connectors' | ConvertFrom-Json
  $existing = $list | Where-Object { $_.name -eq 'quiver-tap-alert-index' } | Select-Object -First 1
  if ($existing) {
    $result = Invoke-Kibana -Method PUT -Path "/api/actions/connector/$($existing.id)" -BodyFile $tmp
  } else {
    $result = Invoke-Kibana -Method POST -Path '/api/actions/connector' -BodyFile $tmp
  }
  if ($result -match '"id"') {
    Write-Host '  Connector .index criado/atualizado' -ForegroundColor Green
  } else {
    Write-Host "  Connector .index: $result" -ForegroundColor Yellow
  }
  Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue
  Write-Host '  Configure na API: KIBANA_ALERT_POLL_ENABLED=true (padrao se OBS_ALERT_EMAIL_TO definido)' -ForegroundColor Gray
}

Write-Host ''
Write-Host 'Vinculando acoes aos alertas...' -ForegroundColor Yellow
& (Join-Path $PSScriptRoot 'wire-alert-actions.ps1')

Write-Host ''
Write-Host 'Teste manual do endpoint webhook:' -ForegroundColor Cyan
Write-Host "  npm run obs:test-webhook" -ForegroundColor Gray
Write-Host ''
