# Testa POST /api/observability/kibana-alert com payload JSON (sem expor secret na linha de comando).

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$BackendEnv = Join-Path $ProjectRoot 'backend\.env.development'
$PayloadFile = Join-Path $ProjectRoot 'deploy\observability\es-webhook-test-payload.json'
$ApiPort = 3002

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

$envMap = Read-DotEnv $BackendEnv
$secret = $envMap['KIBANA_ALERT_WEBHOOK_SECRET']
if (-not $secret) {
  Write-Host 'KIBANA_ALERT_WEBHOOK_SECRET nao encontrado em backend/.env.development' -ForegroundColor Red
  exit 1
}

if (-not (Test-Path $PayloadFile)) {
  @{
    ruleName = 'teste-webhook-manual'
    alertState = 'active'
    reason = 'Validacao do endpoint webhook -> SMTP'
  } | ConvertTo-Json -Compress | Set-Content -Path $PayloadFile -Encoding UTF8
}

$url = "http://localhost:$ApiPort/api/observability/kibana-alert"
$result = curl.exe -s -w "`nHTTP:%{http_code}" -X POST $url -H "Authorization: Bearer $secret" -H 'Content-Type: application/json' --data-binary "@$PayloadFile"

Write-Host $result
if ($result -match 'HTTP:200') {
  Write-Host 'OK — verifique a caixa OBS_ALERT_EMAIL_TO' -ForegroundColor Green
} else {
  Write-Host 'Falha — confira API dev (:3002), SMTP e OBS_ALERT_EMAIL_TO' -ForegroundColor Yellow
}
