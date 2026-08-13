# Credenciais centralizadas para scripts obs:* (Elasticsearch / Kibana com xpack.security).
$ErrorActionPreference = 'Stop'

$script:ObsProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$script:ObsEnvFile = Join-Path $ObsProjectRoot 'deploy\observability\.env.observability'

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
