# Credenciais centralizadas para scripts obs:* (Elasticsearch / Kibana com xpack.security).
# Alvo: defina $script:ObsTarget = 'dev' (padrao) ou 'prd' ANTES do dot-source deste arquivo.
$ErrorActionPreference = 'Stop'

if (-not (Get-Variable -Name ObsTarget -Scope Script -ErrorAction SilentlyContinue)) { $script:ObsTarget = 'dev' }
if ($script:ObsTarget -notin @('dev', 'prd')) { throw "ObsTarget invalido: $script:ObsTarget" }

$script:ObsProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$script:ObsEnvFile = if ($script:ObsTarget -eq 'prd') {
  Join-Path $ObsProjectRoot 'deploy\observability\.env.observability.prd'
} else {
  Join-Path $ObsProjectRoot 'deploy\observability\.env.observability'
}

if ($script:ObsTarget -eq 'prd') {
  if (-not (Test-Path -LiteralPath $ObsEnvFile)) { throw 'Alvo PRD exige deploy\observability\.env.observability.prd (nao versionado). Peca ao Filipe para criar.' }
  foreach ($n in 'ELASTICSEARCH_URL', 'KIBANA_URL', 'ELASTIC_API_KEY', 'ELASTIC_USER', 'ELASTIC_PASSWORD') {
    Remove-Item -Path "env:$n" -ErrorAction SilentlyContinue
  }
}

function Import-ObservabilityEnv {
  if (-not (Test-Path $ObsEnvFile)) { return }
  Get-Content -LiteralPath $ObsEnvFile | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith('#')) { return }
    $eq = $line.IndexOf('=')
    if ($eq -lt 1) { return }
    $key = $line.Substring(0, $eq).Trim()
    $val = $line.Substring($eq + 1).Trim()
    if ($val.Length -ge 2) {
      $q = $val[0]
      if (($q -eq '"' -or $q -eq "'") -and $val.EndsWith($q)) {
        $val = $val.Substring(1, $val.Length - 2)
      }
    }
    if ($key -and $val) {
      Set-Item -Path "env:$key" -Value $val
    }
  }
}

Import-ObservabilityEnv

foreach ($n in 'ELASTICSEARCH_URL', 'KIBANA_URL') {
  $v = [Environment]::GetEnvironmentVariable($n)
  $isLocal = $v -match '^https?://(localhost|127\.0\.0\.1|\[::1\])(:|/|$)'
  if ($script:ObsTarget -eq 'prd') {
    if (-not $v) { throw "$n obrigatorio no alvo PRD." }
    if ($isLocal) { throw "$n aponta para localhost (DEV). Recusado no alvo PRD." }
  } elseif ($v -and -not $isLocal) {
    throw "$n aponta para fora do PC no alvo DEV. Recusado (para o VPS use o alvo PRD)."
  }
}
if ($script:ObsTarget -eq 'prd') { Write-Host 'ALVO: PRD (cluster do VPS)' -ForegroundColor Red }

$script:EsBase = if ($env:ELASTICSEARCH_URL) { $env:ELASTICSEARCH_URL.TrimEnd('/') } else { 'http://localhost:9200' }
$script:KibanaBase = if ($env:KIBANA_URL) { $env:KIBANA_URL.TrimEnd('/') } else { 'http://localhost:5601' }

function Get-ElasticAuthHeader {
  if ($env:ELASTIC_API_KEY) {
    return "ApiKey $($env:ELASTIC_API_KEY)"
  }
  $user = if ($env:ELASTIC_USER) { $env:ELASTIC_USER } else { 'elastic' }
  $pass = $env:ELASTIC_PASSWORD
  if ($pass) {
    $b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${user}:${pass}"))
    return "Basic $b64"
  }
  return $null
}

$script:ElasticAuthHeader = Get-ElasticAuthHeader

function Invoke-Elastic {
  param(
    [string]$Method = 'GET',
    [string]$Path,
    [string]$BodyFile = '',
    [string]$Body = ''
  )
  $url = if ($Path -match '^https?://') { $Path } else { "$EsBase$Path" }
  $curlArgs = @('-s', '-X', $Method, $url, '-H', 'Content-Type: application/json')
  if ($ElasticAuthHeader) { $curlArgs += @('-H', "Authorization: $ElasticAuthHeader") }
  if ($BodyFile) { $curlArgs += @('--data-binary', "@$BodyFile") }
  elseif ($Body) { $curlArgs += @('-d', $Body) }
  return curl.exe @curlArgs
}

function Invoke-Kibana {
  param(
    [string]$Method = 'GET',
    [string]$Path,
    [string]$BodyFile = '',
    [string]$Body = ''
  )
  $url = if ($Path -match '^https?://') { $Path } else { "$KibanaBase$Path" }
  $curlArgs = @('-s', '-X', $Method, $url, '-H', 'kbn-xsrf: true', '-H', 'Content-Type: application/json')
  if ($ElasticAuthHeader) { $curlArgs += @('-H', "Authorization: $ElasticAuthHeader") }
  if ($BodyFile) { $curlArgs += @('--data-binary', "@$BodyFile") }
  elseif ($Body) { $curlArgs += @('-d', $Body) }
  return curl.exe @curlArgs
}

function Test-ElasticHttpStatus {
  param(
    [string]$Url,
    [string[]]$OkCodes = @('200')
  )
  $curlArgs = @('-s', '-o', 'NUL', '-w', '%{http_code}', $Url)
  if ($ElasticAuthHeader) { $curlArgs += @('-H', "Authorization: $ElasticAuthHeader") }
  $code = curl.exe @curlArgs 2>$null
  return $OkCodes -contains $code
}

function Get-ElasticCurlAuthArgs {
  if (-not $ElasticAuthHeader) { return @() }
  return @('-H', "Authorization: $ElasticAuthHeader")
}

function Assert-PrdMutationConfirmed {
  param([bool]$Confirmed)
  if ($script:ObsTarget -eq 'prd' -and -not $Confirmed) {
    throw 'Mutacao em PRD exige -ConfirmPrd (e GATE autorizado pelo Filipe).'
  }
}
