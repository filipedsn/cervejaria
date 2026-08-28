# Para o agente de suporte autonomo.

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\prod\_config.ps1')

$ProjectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$PidFile = Join-Path $ProjectRoot 'deploy\runtime\support-agent.pid'

if (-not (Test-Path $PidFile)) {
  Write-Host 'Agente de suporte nao esta rodando (sem pid file).' -ForegroundColor Yellow
  exit 0
}

$state = Stop-ManagedPidFile -PidFile $PidFile -ExpectedProcessNames @('node.exe') -CommandLinePatterns @('tsx', 'index.ts') -Label 'Agente de suporte'
if ($state -ne 'VALID') { Write-Host 'Processo do agente nao esta mais vivo ou o PID file era invalido.' -ForegroundColor Yellow }
