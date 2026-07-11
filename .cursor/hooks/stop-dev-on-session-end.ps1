# Fallback: encerra dev se o supervisor nao conseguir desmontar ao fechar o Cursor.

$ErrorActionPreference = 'SilentlyContinue'

if (Get-Process -Name 'Cursor' -ErrorAction SilentlyContinue) {
  exit 0
}

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$stopScript = Join-Path $projectRoot 'scripts\dev\stop-dev.ps1'

if (Test-Path $stopScript) {
  & $stopScript | Out-Null
}

exit 0
