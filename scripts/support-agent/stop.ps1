# Para o agente de suporte autonomo.

$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$PidFile = Join-Path $ProjectRoot 'deploy\runtime\support-agent.pid'

if (-not (Test-Path $PidFile)) {
  Write-Host 'Agente de suporte nao esta rodando (sem pid file).' -ForegroundColor Yellow
  exit 0
}

$agentPid = [int](Get-Content $PidFile -ErrorAction SilentlyContinue)
if ($agentPid -gt 0 -and $null -ne (Get-Process -Id $agentPid -ErrorAction SilentlyContinue)) {
  Stop-Process -Id $agentPid -Force
  Write-Host "Agente de suporte parado (PID $agentPid)." -ForegroundColor Green
} else {
  Write-Host 'Processo do agente nao esta mais vivo.' -ForegroundColor Yellow
}

Remove-Item -LiteralPath $PidFile -ErrorAction SilentlyContinue
