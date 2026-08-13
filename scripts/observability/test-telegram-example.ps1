# Envia exemplo de alerta operacional com o formato didatico (Telegram).

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$BackendDir = Join-Path $ProjectRoot 'backend'

Push-Location $BackendDir
try {
  node scripts/run-with-env.mjs development npx tsx scripts/send-telegram-alert-example.ts
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}
