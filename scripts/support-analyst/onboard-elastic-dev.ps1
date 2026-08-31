# Provisions the isolated DEV alert destination and the Support Analyst DEV API key.
# This script intentionally never reads, queries or updates PRD resources.

[CmdletBinding()]
param(
  [switch]$EmitValidationAlert
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path $ProjectRoot 'scripts\observability\_elastic-auth.ps1')

$AlertIndex = 'quiver-tap-alert-events-dev'
$ConnectorName = 'quiver-tap-alert-index-dev'
$ApiKeyName = 'quiver-support-analyst-shadow-dev'
$SecretFile = Join-Path $ProjectRoot 'deploy\runtime\support-analyst-dev.env'
$ValidationFile = Join-Path $ProjectRoot 'deploy\runtime\support-analyst-dev-validation.json'
$Validator = Join-Path $ProjectRoot 'scripts\support-analyst\validate-elastic-readonly.mjs'
$DevRules = @(
  'quiver-tap-telemetry-gap-dev',
  'quiver-tap-eventloop-high-dev',
  'quiver-tap-postgres-tcp-down-dev',
  'quiver-tap-public-ready-down-dev'
)

function Write-Utf8NoBom {
  param([string]$Path, [string]$Content)
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($Path, $Content, $utf8)
}

function Invoke-ElasticJson {
  param(
    [string]$Method = 'GET',
    [string]$Path,
    [object]$Body = $null
  )
  $tmp = $null
  try {
    if ($null -ne $Body) {
      $tmp = Join-Path $env:TEMP "quiver-sa02a-$([guid]::NewGuid().ToString('N')).json"
      Write-Utf8NoBom -Path $tmp -Content ($Body | ConvertTo-Json -Depth 20 -Compress)
      $raw = Invoke-Elastic -Method $Method -Path $Path -BodyFile $tmp
    } else {
      $raw = Invoke-Elastic -Method $Method -Path $Path
    }
    $parsed = $raw | ConvertFrom-Json
    if ($parsed.error) {
      throw "Elasticsearch recusou $Method $Path"
    }
    return $parsed
  } finally {
    if ($tmp) { Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue }
  }
}

function Invoke-KibanaJson {
  param(
    [string]$Method = 'GET',
    [string]$Path,
    [object]$Body = $null
  )
  $tmp = $null
  try {
    if ($null -ne $Body) {
      $tmp = Join-Path $env:TEMP "quiver-sa02a-kbn-$([guid]::NewGuid().ToString('N')).json"
      Write-Utf8NoBom -Path $tmp -Content ($Body | ConvertTo-Json -Depth 20 -Compress)
      $raw = Invoke-Kibana -Method $Method -Path $Path -BodyFile $tmp
    } else {
      $raw = Invoke-Kibana -Method $Method -Path $Path
    }
    $parsed = $raw | ConvertFrom-Json
    if ($parsed.statusCode -and $parsed.statusCode -ge 400) {
      throw "Kibana recusou $Method $Path (HTTP $($parsed.statusCode))"
    }
    return $parsed
  } finally {
    if ($tmp) { Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue }
  }
}

function Protect-SecretFile {
  param([string]$Path)
  $current = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  $system = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')
  $acl = New-Object System.Security.AccessControl.FileSecurity
  $acl.SetOwner($current)
  $acl.SetAccessRuleProtection($true, $false)
  $rights = [System.Security.AccessControl.FileSystemRights]::FullControl
  $allow = [System.Security.AccessControl.AccessControlType]::Allow
  $inheritance = [System.Security.AccessControl.InheritanceFlags]::None
  $propagation = [System.Security.AccessControl.PropagationFlags]::None
  $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($current, $rights, $inheritance, $propagation, $allow)))
  $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($system, $rights, $inheritance, $propagation, $allow)))
  Set-Acl -LiteralPath $Path -AclObject $acl
}

function Get-LocalApiKey {
  if (-not (Test-Path $SecretFile)) { return $null }
  foreach ($line in Get-Content -LiteralPath $SecretFile) {
    if ($line -match '^SUPPORT_ANALYST_ES_API_KEY=(.+)$') { return $Matches[1].Trim() }
  }
  return $null
}

Write-Host 'TQ-SA-02A - onboarding Elasticsearch DEV do Support Analyst' -ForegroundColor Cyan

# 1. Dedicated low-volume DEV alert index. Never PUT the shared index.
$alertExists = Test-ElasticHttpStatus -Url "$EsBase/$AlertIndex" -OkCodes @('200')
if (-not $alertExists) {
  $mapping = @{
    mappings = @{
      dynamic = 'strict'
      properties = @{
        '@timestamp' = @{ type = 'date' }
        ruleName = @{ type = 'keyword' }
        alertState = @{ type = 'keyword' }
        reason = @{ type = 'text' }
        viewInAppUrl = @{ type = 'keyword'; ignore_above = 2048 }
        environment = @{ type = 'keyword' }
      }
    }
  }
  Invoke-ElasticJson -Method PUT -Path "/$AlertIndex" -Body $mapping | Out-Null
  Write-Host "  indice DEV criado: $AlertIndex" -ForegroundColor Green
} else {
  Write-Host "  indice DEV existente: $AlertIndex" -ForegroundColor Green
}

# 2. Dedicated Kibana .index connector.
$connectors = @(Invoke-KibanaJson -Path '/api/actions/connectors')
$connector = $connectors | Where-Object { $_.name -eq $ConnectorName } | Select-Object -First 1
$connectorBody = @{
  name = $ConnectorName
  connector_type_id = '.index'
  config = @{
    index = $AlertIndex
    refresh = $true
    executionTimeField = '@timestamp'
  }
}
if ($connector) {
  if ($connector.config.index -ne $AlertIndex) {
    $connector = Invoke-KibanaJson -Method PUT -Path "/api/actions/connector/$($connector.id)" -Body $connectorBody
  }
} else {
  $connector = Invoke-KibanaJson -Method POST -Path '/api/actions/connector' -Body $connectorBody
}
if (-not $connector.id) { throw 'Connector DEV nao retornou id.' }
Write-Host "  connector DEV pronto: $ConnectorName" -ForegroundColor Green

# 3. Rewire only the explicit DEV allowlist. Exact name + development tag are mandatory.
foreach ($ruleName in $DevRules) {
  $encoded = [uri]::EscapeDataString($ruleName)
  $found = Invoke-KibanaJson -Path "/api/alerting/rules/_find?search=$encoded&per_page=20"
  $rule = @($found.data) | Where-Object {
    $_.name -eq $ruleName -and @($_.tags) -contains 'development'
  } | Select-Object -First 1
  if (-not $rule) { throw "Regra DEV esperada nao encontrada com tag development: $ruleName" }

  $detail = Invoke-KibanaJson -Path "/api/alerting/rule/$($rule.id)"
  $document = [ordered]@{
    ruleName = '{{rule.name}}'
    alertState = '{{alertState}}'
    reason = '{{context.reason}}'
    viewInAppUrl = '{{context.viewInAppUrl}}'
    environment = 'dev'
    '@timestamp' = '{{date}}'
  }
  $payload = @{
    name = $detail.name
    tags = @($detail.tags)
    schedule = $detail.schedule
    params = $detail.params
    actions = @(@{
      group = 'query matched'
      id = $connector.id
      params = @{ documents = @($document) }
    })
    notify_when = $detail.notify_when
  }
  $updatedRule = Invoke-KibanaJson -Method PUT -Path "/api/alerting/rule/$($rule.id)" -Body $payload
  if ($detail.enabled -and -not $updatedRule.enabled) {
    throw "Regra DEV foi desabilitada inesperadamente durante o update: $ruleName"
  }
  Write-Host "  regra DEV isolada: $ruleName" -ForegroundColor Green
}

# 4. A legitimate connector execution creates one safe validation alert if requested.
if ($EmitValidationAlert) {
  $validationDocument = [ordered]@{
    ruleName = 'quiver-tap-support-analyst-onboarding-dev'
    alertState = 'active'
    reason = 'Validacao segura do destino dedicado DEV do Support Analyst.'
    viewInAppUrl = ''
    environment = 'dev'
    '@timestamp' = (Get-Date).ToUniversalTime().ToString('o')
  }
  $execution = Invoke-KibanaJson -Method POST -Path "/api/actions/connector/$($connector.id)/_execute" -Body @{
    params = @{ documents = @($validationDocument) }
  }
  if ($execution.status -ne 'ok') { throw 'Execucao de validacao do connector DEV falhou.' }
  Write-Host '  alerta DEV de validacao emitido pelo connector Kibana' -ForegroundColor Green
}

# 5. Create the exclusive API key once. If a local key exists, reuse it idempotently.
$analystApiKey = Get-LocalApiKey
if (-not $analystApiKey) {
  $existingKeys = Invoke-ElasticJson -Path "/_security/api_key?name=$ApiKeyName"
  if (@($existingKeys.api_keys).Count -gt 0) {
    throw "API key $ApiKeyName ja existe, mas o secret local nao esta disponivel. Revise antes de rotacionar."
  }

  $keyResponse = Invoke-ElasticJson -Method POST -Path '/_security/api_key' -Body @{
    name = $ApiKeyName
    expiration = '90d'
    role_descriptors = @{
      support_analyst_shadow_dev = @{
        cluster = @()
        indices = @(@{
          names = @(
            $AlertIndex,
            'logs-audit*.otel-dev*',
            'logs-technical*.otel-dev*'
          )
          privileges = @('read', 'view_index_metadata')
        })
      }
    }
    metadata = @{
      application = 'quiver-tap-support-analyst'
      environment = 'dev'
      mode = 'shadow'
    }
  }
  $analystApiKey = $keyResponse.encoded
  if (-not $analystApiKey) { throw 'Elasticsearch nao retornou API key encoded.' }

  New-Item -ItemType Directory -Path (Split-Path -Parent $SecretFile) -Force | Out-Null
  $secretContent = @(
    "SUPPORT_ANALYST_ES_URL=$EsBase",
    'SUPPORT_ANALYST_ENV=dev',
    "SUPPORT_ANALYST_ES_API_KEY=$analystApiKey"
  ) -join [Environment]::NewLine
  Write-Utf8NoBom -Path $SecretFile -Content ($secretContent + [Environment]::NewLine)
  Protect-SecretFile -Path $SecretFile
  Write-Host '  API key DEV criada e salva em arquivo local ignorado, com ACL restrita' -ForegroundColor Green
} else {
  Write-Host '  API key DEV local existente; reutilizando sem exibir o secret' -ForegroundColor Green
}

# 6. Run the fail-closed validator with only the Analyst runtime variables.
$previousUrl = $env:SUPPORT_ANALYST_ES_URL
$previousEnv = $env:SUPPORT_ANALYST_ENV
$previousKey = $env:SUPPORT_ANALYST_ES_API_KEY
try {
  $env:SUPPORT_ANALYST_ES_URL = $EsBase
  $env:SUPPORT_ANALYST_ENV = 'dev'
  $env:SUPPORT_ANALYST_ES_API_KEY = $analystApiKey
  Remove-Item Env:SUPPORT_ANALYST_ALLOW_PRD -ErrorAction SilentlyContinue
  $validationOutput = & node $Validator 2>&1
  $validationExit = $LASTEXITCODE
  if ($validationExit -ne 0) {
    $validationOutput | ForEach-Object { Write-Host $_ -ForegroundColor Red }
    throw "Validator DEV falhou com exit code $validationExit"
  }
  Write-Utf8NoBom -Path $ValidationFile -Content (($validationOutput -join [Environment]::NewLine) + [Environment]::NewLine)
  Write-Host '  validator DEV: PASS' -ForegroundColor Green
} finally {
  if ($null -eq $previousUrl) { Remove-Item Env:SUPPORT_ANALYST_ES_URL -ErrorAction SilentlyContinue } else { $env:SUPPORT_ANALYST_ES_URL = $previousUrl }
  if ($null -eq $previousEnv) { Remove-Item Env:SUPPORT_ANALYST_ENV -ErrorAction SilentlyContinue } else { $env:SUPPORT_ANALYST_ENV = $previousEnv }
  if ($null -eq $previousKey) { Remove-Item Env:SUPPORT_ANALYST_ES_API_KEY -ErrorAction SilentlyContinue } else { $env:SUPPORT_ANALYST_ES_API_KEY = $previousKey }
}

Write-Host 'TQ-SA-02A concluida para DEV.' -ForegroundColor Cyan
