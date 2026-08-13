# Inicia o agente de suporte autonomo em background.
#
# Fase 2 (modo sombra): abre apenas Issues no GitHub, nunca corrige codigo.
# O fixer so liga com SUPPORT_AGENT_FIXER_ENABLED=true e SUPPORT_AGENT_SHADOW=false
# em support-agent/.env.

param(
  [switch]$Force,
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$AgentDir = Join-Path $ProjectRoot 'support-agent'
$RuntimeDir = Join-Path $ProjectRoot 'deploy\runtime'
$LogDir = Join-Path $ProjectRoot 'deploy\logs'
$PidFile = Join-Path $RuntimeDir 'support-agent.pid'
$OutLog = Join-Path $LogDir 'support-agent-out.log'
$ErrLog = Join-Path $LogDir 'support-agent-err.log'

New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

if (-not (Test-Path (Join-Path $AgentDir 'node_modules'))) {
  Write-Host 'Dependencias ausentes. Rodando npm ci em support-agent...' -ForegroundColor Yellow
  Push-Location $AgentDir
  try { npm ci } finally { Pop-Location }
}

if (-not (Test-Path (Join-Path $AgentDir '.env'))) {
  Copy-Item -LiteralPath (Join-Path $AgentDir '.env.example') -Destination (Join-Path $AgentDir '.env')
  Write-Host 'Criado support-agent/.env a partir do example (modo sombra).' -ForegroundColor Yellow
}

if (Test-Path $PidFile) {
  $oldPid = [int](Get-Content $PidFile -ErrorAction SilentlyContinue)
  $alive = $false
  if ($oldPid -gt 0) {
    $alive = $null -ne (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)
  }
  if ($alive) {
    if (-not $Force) {
      if (-not $Quiet) { Write-Host "Agente de suporte ja esta rodando (PID $oldPid)." -ForegroundColor Green }
      exit 0
    }
    Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
  }
}

$nodeExe = (Get-Command node -ErrorAction Stop).Source
$tsxCli = Join-Path $AgentDir 'node_modules\tsx\dist\cli.mjs'
$entry = Join-Path $AgentDir 'src\index.ts'

if (-not (Test-Path $tsxCli)) {
  Write-Host "tsx ausente em $AgentDir. Rode: npm ci --prefix support-agent" -ForegroundColor Red
  exit 1
}

$proc = Start-Process `
  -FilePath $nodeExe `
  -ArgumentList @($tsxCli, $entry) `
  -WorkingDirectory $AgentDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput $OutLog `
  -RedirectStandardError $ErrLog `
  -PassThru

Set-Content -Path $PidFile -Value $proc.Id -Encoding ASCII

Start-Sleep -Seconds 3
if ($null -eq (Get-Process -Id $proc.Id -ErrorAction SilentlyContinue)) {
  Write-Host "Agente encerrou logo apos iniciar. Veja $ErrLog" -ForegroundColor Red
  if (Test-Path $ErrLog) { Get-Content $ErrLog -Tail 20 }
  exit 1
}

if (-not $Quiet) {
  Write-Host "Agente de suporte iniciado (PID $($proc.Id))." -ForegroundColor Green
  Write-Host "  log:    $OutLog" -ForegroundColor Gray
  Write-Host "  erros:  $ErrLog" -ForegroundColor Gray
  Write-Host "  estado: $(Join-Path $RuntimeDir 'support-agent-state.json')" -ForegroundColor Gray
}
