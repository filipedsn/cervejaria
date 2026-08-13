# Cria API keys Elasticsearch para collector OTel e alert poller.
# Requer xpack.security habilitado e deploy/observability/.env.observability com ELASTIC_PASSWORD.

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_elastic-auth.ps1')

$EnvFile = Join-Path $ObsProjectRoot 'deploy\observability\.env.observability'
$ExampleFile = Join-Path $ObsProjectRoot 'deploy\observability\.env.observability.example'

if (-not (Test-Path $EnvFile)) {
  if (Test-Path $ExampleFile) {
    Copy-Item -LiteralPath $ExampleFile -Destination $EnvFile
    Write-Host "Criado $EnvFile a partir do example." -ForegroundColor Yellow
  } else {
    throw "Arquivo ausente: $EnvFile"
  }
}

if (-not $env:ELASTIC_PASSWORD) {
  throw 'ELASTIC_PASSWORD ausente em .env.observability'
}

function New-ElasticApiKey {
  param(
    [string]$Name,
    [hashtable]$RoleDescriptors
  )
  $body = @{
    name = $Name
    role_descriptors = $RoleDescriptors
  } | ConvertTo-Json -Depth 10 -Compress

  $tmp = Join-Path $env:TEMP "quiver-apikey-$([guid]::NewGuid().ToString('N')).json"
  try {
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($tmp, $body, $utf8)
    $raw = Invoke-Elastic -Method POST -Path '/_security/api_key' -BodyFile $tmp
    $json = $raw | ConvertFrom-Json
    if (-not $json.encoded) {
      throw "Falha ao criar API key $Name : $raw"
    }
    return $json.encoded
  } finally {
    Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue
  }
}

Write-Host ''
Write-Host 'Quiver Tap - Criando API keys Elasticsearch' -ForegroundColor Cyan
Write-Host '===========================================' -ForegroundColor Cyan
Write-Host ''

$health = Invoke-Elastic -Path '/_cluster/health'
if ($health -notmatch '"status"') {
  throw "Elasticsearch inacessivel ou sem auth: $health"
}

$collectorKey = New-ElasticApiKey -Name 'quiver-collector' -RoleDescriptors @{
  collector = @{
    cluster = @('monitor')
    index = @(
      @{
        names = @('metrics-*', 'logs-*', 'traces-*')
        privileges = @('auto_configure', 'create_index', 'write', 'index')
      }
    )
  }
}

$pollerKey = New-ElasticApiKey -Name 'quiver-alert-poller' -RoleDescriptors @{
  alert_poller = @{
    cluster = @('monitor')
    index = @(
      @{
        names = @('quiver-tap-alert-events')
        privileges = @('read', 'write', 'index', 'create_index')
      }
    )
  }
}

# Agente de suporte: le alertas e correlaciona com logs/traces. Somente leitura,
# exceto pelo flag de triagem que ele grava no proprio indice de alertas.
$supportAgentKey = New-ElasticApiKey -Name 'quiver-support-agent' -RoleDescriptors @{
  support_agent = @{
    cluster = @('monitor')
    index = @(
      @{
        names = @('quiver-tap-alert-events')
        privileges = @('read', 'write', 'index')
      },
      @{
        names = @('logs-*', 'traces-*', 'metrics-*', '.ds-logs-*', '.ds-traces-*', '.ds-metrics-*')
        privileges = @('read', 'view_index_metadata')
      }
    )
  }
}

$lines = Get-Content -LiteralPath $EnvFile
$seenSupportAgent = $false
$out = foreach ($line in $lines) {
  if ($line -match '^ELASTIC_API_KEY_COLLECTOR=') {
    "ELASTIC_API_KEY_COLLECTOR=$collectorKey"
  } elseif ($line -match '^ELASTIC_API_KEY_ALERT_POLLER=') {
    "ELASTIC_API_KEY_ALERT_POLLER=$pollerKey"
  } elseif ($line -match '^ELASTIC_API_KEY_SUPPORT_AGENT=') {
    $seenSupportAgent = $true
    "ELASTIC_API_KEY_SUPPORT_AGENT=$supportAgentKey"
  } else {
    $line
  }
}
if (-not $seenSupportAgent) {
  $out = @($out) + @('', '# Agente de suporte autonomo (support-agent/)', "ELASTIC_API_KEY_SUPPORT_AGENT=$supportAgentKey")
}
$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllLines($EnvFile, $out, $utf8)

Write-Host 'API keys criadas e salvas em deploy/observability/.env.observability' -ForegroundColor Green
Write-Host '  quiver-collector' -ForegroundColor Gray
Write-Host '  quiver-alert-poller' -ForegroundColor Gray
Write-Host '  quiver-support-agent' -ForegroundColor Gray
Write-Host ''
Write-Host 'Reinicie o collector: npm run obs:up' -ForegroundColor Yellow
Write-Host ''
