# Runs the real DEV API for certification on loopback only. Never points at PROD.
param([ValidateRange(1024, 65535)][int]$Port = 3102)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\prod\_config.ps1')
$backendDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..\backend')).Path
Import-BackendEnvFile -BackendDir $backendDir -Environment development
if ($env:DATABASE_URL -notmatch ':5434/' -or $env:DATABASE_URL -notmatch '/cervejaria_dev(?:\?|$)') {
  throw 'Refusing to run QA API outside the isolated DEV database.'
}
if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
  throw "Port $Port is already in use."
}

$env:NODE_ENV = 'development'
$env:HOST = '127.0.0.1'
$env:PORT = [string]$Port
$env:QA_MODE = '1'
$env:KIBANA_ALERT_POLL_IN_API = '0'
Push-Location $backendDir
try {
  & node --import ../scripts/node24-tsx-host.mjs --import tsx src/index.ts
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
