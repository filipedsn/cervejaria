# Status do agente de suporte: processo, modo de operacao e resumo do estado.

$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$AgentDir = Join-Path $ProjectRoot 'support-agent'
$PidFile = Join-Path $ProjectRoot 'deploy\runtime\support-agent.pid'
$StateFile = Join-Path $ProjectRoot 'deploy\runtime\support-agent-state.json'
$EnvFile = Join-Path $AgentDir '.env'

function Get-EnvValue {
  param([string]$Key, [string]$Default)
  if (-not (Test-Path $EnvFile)) { return $Default }
  $line = Select-String -Path $EnvFile -Pattern "^$Key=" -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $line) { return $Default }
  return ($line.Line -split '=', 2)[1].Trim()
}

Write-Host ''
Write-Host 'Agente de suporte autonomo' -ForegroundColor Cyan
Write-Host '==========================' -ForegroundColor Cyan

$running = $false
if (Test-Path $PidFile) {
  $agentPid = [int](Get-Content $PidFile -ErrorAction SilentlyContinue)
  if ($agentPid -gt 0 -and $null -ne (Get-Process -Id $agentPid -ErrorAction SilentlyContinue)) {
    $running = $true
    Write-Host "Processo         no ar (PID $agentPid)" -ForegroundColor Green
  }
}
if (-not $running) {
  Write-Host 'Processo         parado' -ForegroundColor Yellow
}

$shadow = Get-EnvValue -Key 'SUPPORT_AGENT_SHADOW' -Default 'true'
$fixer = Get-EnvValue -Key 'SUPPORT_AGENT_FIXER_ENABLED' -Default 'false'
$dryRun = Get-EnvValue -Key 'SUPPORT_AGENT_DRY_RUN' -Default 'false'

$modo = if ($shadow -eq 'true') { 'sombra (somente Issues)' } else { 'completo' }
Write-Host "Modo             $modo"

# O kill switch de arquivo vence a config: ele desliga o fixer de um agente que ja
# esta rodando, sem parar a triagem.
$killSwitchFile = Join-Path $ProjectRoot 'deploy\runtime\support-agent-fixer.disabled'
$killActive = Test-Path $killSwitchFile

if ($killActive) {
  $motivo = (Get-Content $killSwitchFile -Raw -ErrorAction SilentlyContinue).Trim()
  Write-Host "Fixer            DESLIGADO pelo kill switch" -ForegroundColor Yellow
  Write-Host "  motivo         $(if ($motivo) { $motivo } else { 'sem motivo registrado' })"
  Write-Host "  religar com    npm run agent:fixer:on"
} elseif ($shadow -eq 'true' -or $fixer -ne 'true') {
  Write-Host 'Fixer            desligado (config)'
} else {
  Write-Host 'Fixer            LIGADO' -ForegroundColor Green
  Write-Host '  desligar com   npm run agent:fixer:off -- "motivo"'
}
Write-Host "Dry-run          $dryRun"

if (Test-Path $StateFile) {
  $state = Get-Content $StateFile -Raw | ConvertFrom-Json
  $fpCount = ($state.fingerprints.PSObject.Properties | Measure-Object).Count
  Write-Host ''
  Write-Host 'Estado' -ForegroundColor Cyan
  Write-Host "  ultimo poll        $($state.lastPollIso)"
  Write-Host "  alertas vistos     $($state.processedAlertIds.Count)"
  Write-Host "  fingerprints       $fpCount"
  Write-Host "  PRs hoje           $($state.today.prsOpened)"
  # Estado gravado por versoes anteriores nao tem estes campos; sem o coalesce a linha
  # sai em branco e parece erro de leitura.
  $runs = if ($null -ne $state.today.runs) { $state.today.runs } else { 0 }
  $cliMs = if ($null -ne $state.today.cliDurationMs) { $state.today.cliDurationMs } else { 0 }
  Write-Host "  execucoes do CLI   $runs hoje"
  Write-Host ("  tempo de CLI       {0:N1} min hoje" -f ($cliMs / 60000))
} else {
  Write-Host ''
  Write-Host 'Estado           ainda nao criado (agente nunca rodou)' -ForegroundColor Yellow
}

Write-Host ''
