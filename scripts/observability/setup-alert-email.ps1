# Alertas Kibana (licenca Basic): connector .index -> ES -> poller -> Telegram/e-mail.
# Nao requer Gold (.webhook/.email bloqueados no Basic).
[CmdletBinding()]
param([ValidateSet('dev', 'prd')][string]$Target = 'dev', [switch]$ConfirmPrd)

$ErrorActionPreference = 'Stop'
$script:ObsTarget = $Target
. (Join-Path $PSScriptRoot '_elastic-auth.ps1')
Assert-PrdMutationConfirmed -Confirmed:$ConfirmPrd
$ProjectRoot = $ObsProjectRoot
$AlertIndex = 'quiver-tap-alert-events'

function Write-Utf8NoBom {
  param([string]$Path, [string]$Content)
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($Path, $Content, $utf8)
}

Write-Host ''
Write-Host 'Quiver Tap - Alertas por e-mail (Kibana Basic)' -ForegroundColor Cyan
Write-Host '==============================================' -ForegroundColor Cyan

$mappingBody = @{
  mappings = @{
    properties = @{
      '@timestamp' = @{ type = 'date' }
      ruleId = @{ type = 'keyword' }
      ruleName = @{ type = 'keyword' }
      environment = @{ type = 'keyword' }
      alertState = @{ type = 'keyword' }
      reason = @{ type = 'text' }
      viewInAppUrl = @{ type = 'keyword' }
      processed = @{ type = 'boolean' }
      processedAt = @{ type = 'date' }
    }
  }
} | ConvertTo-Json -Depth 6 -Compress

$mappingFile = Join-Path $env:TEMP "quiver-alert-index-$([guid]::NewGuid().ToString('N')).json"
try {
  Write-Utf8NoBom -Path $mappingFile -Content $mappingBody
  $indexResult = (Invoke-Elastic -Method PUT -Path "/$AlertIndex" -BodyFile $mappingFile | Out-String)
} finally {
  Remove-Item -LiteralPath $mappingFile -ErrorAction SilentlyContinue
}
if ($indexResult -match '"acknowledged"\s*:\s*true') {
  Write-Host "  Indice ES criado: $AlertIndex" -ForegroundColor Green
} elseif ($indexResult -match 'resource_already_exists_exception') {
  Write-Host "  Indice ES ja existe: $AlertIndex" -ForegroundColor Green
} else {
  Write-Host "  Falha ao criar indice: $indexResult" -ForegroundColor Red
  exit 1
}

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
  Write-Host '  Connector .index ja existe' -ForegroundColor Green
} else {
  $result = Invoke-Kibana -Method POST -Path '/api/actions/connector' -BodyFile $tmp
  if ($result -match '"id"') {
    Write-Host '  Connector .index criado' -ForegroundColor Green
  } else {
    Write-Host "  Falha ao criar connector: $result" -ForegroundColor Red
    exit 1
  }
}

Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue

Write-Host ''
Write-Host 'Vinculando acoes aos alertas...' -ForegroundColor Yellow
& (Join-Path $PSScriptRoot 'wire-alert-actions.ps1') -Target $Target

Write-Host ''
Write-Host 'Fluxo:' -ForegroundColor Cyan
Write-Host '  Kibana alerta -> ES quiver-tap-alert-events -> API poll (30s) -> e-mail e/ou Telegram' -ForegroundColor Gray
Write-Host ''
Write-Host 'Configure OBS_ALERT_EMAIL_TO e/ou OBS_ALERT_TELEGRAM_* em backend/.env.development' -ForegroundColor Yellow
Write-Host 'Teste e-mail: npm run obs:test-webhook' -ForegroundColor Gray
Write-Host 'Teste Telegram: npm run obs:test-telegram' -ForegroundColor Gray
Write-Host ''
