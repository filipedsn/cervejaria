# Testa envio de alerta via Telegram (Bot API oficial) usando backend/.env.development.

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$BackendEnv = Join-Path $ProjectRoot 'backend\.env.development'

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
$token = $envMap['OBS_ALERT_TELEGRAM_BOT_TOKEN']
$chatId = $envMap['OBS_ALERT_TELEGRAM_CHAT_ID']

if (-not $token -or -not $chatId) {
  Write-Host 'OBS_ALERT_TELEGRAM_BOT_TOKEN e OBS_ALERT_TELEGRAM_CHAT_ID sao obrigatorios em backend/.env.development' -ForegroundColor Red
  Write-Host 'Crie o bot em @BotFather, envie /start ao bot e obtenha chat_id via getUpdates' -ForegroundColor Yellow
  exit 1
}

$body = @{
  chat_id = $chatId
  text = "<b>Quiver Tap — teste-manual-telegram</b>`nEstado: active`nMotivo: Validacao do canal Telegram via npm run obs:test-telegram"
  parse_mode = 'HTML'
  disable_web_page_preview = $true
} | ConvertTo-Json -Compress

$url = "https://api.telegram.org/bot$token/sendMessage"
Write-Host "Enviando teste para chat_id $chatId..." -ForegroundColor Cyan

$tmp = Join-Path $env:TEMP 'quiver-telegram-test.json'
$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($tmp, $body, $utf8)

$result = curl.exe -s -w "`nHTTP:%{http_code}" -X POST $url -H 'Content-Type: application/json' --data-binary "@$tmp"
Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue
Write-Host $result

if ($result -match '"ok":true' -or $result -match 'HTTP:200') {
  Write-Host 'OK — verifique o Telegram em alguns segundos' -ForegroundColor Green
} else {
  Write-Host 'Falha — confira token, chat_id e se voce enviou /start ao bot' -ForegroundColor Yellow
  exit 1
}
