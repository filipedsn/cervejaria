# Funcoes compartilhadas do ops-panel: uma porta, um estado, sem surpresas.

$ErrorActionPreference = 'Stop'

$script:OpsPanelVersion = 2

function Get-OpsPanelConfiguredPort {
  param([string]$EnvFile)
  if (-not (Test-Path $EnvFile)) { return 3099 }
  foreach ($line in Get-Content -LiteralPath $EnvFile) {
    $t = $line.Trim()
    if ($t -match '^OPS_PANEL_PORT=(\d+)') { return [int]$Matches[1] }
  }
  return 3099
}

function Get-OpsPanelHealth {
  param([int]$Port)
  try {
    return Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 3
  } catch {
    return $null
  }
}

function Get-PortListenerPid {
  param([int]$Port)
  $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if (-not $conns) { return $null }
  return ($conns | Select-Object -First 1).OwningProcess
}

function Stop-PortListener {
  param([int]$Port, [switch]$Quiet)
  $procId = Get-PortListenerPid -Port $Port
  if (-not $procId) { return $false }
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
  if (-not $proc -or $proc.Name -ine 'node.exe' -or $proc.CommandLine -notlike '*server.mjs*') {
    if (-not $Quiet) { Write-Host "Listener :$Port (PID $procId) nao e o Ops Panel; nao sera encerrado." -ForegroundColor Yellow }
    return $false
  }
  if (-not $Quiet) { Write-Host "Encerrando listener :$Port (PID $procId)..." -ForegroundColor Yellow }
  & taskkill.exe /F /PID $procId 2>$null | Out-Null
  Start-Sleep -Milliseconds 400
  return $null -eq (Get-PortListenerPid -Port $Port)
}

<#
  Estados:
  - current   /api/health responde app=quiver-tap-ops na versao atual
  - legacy    /api/health responde, mas e o painel antigo
  - blocked   porta ocupada por algo que nao e o painel
  - stopped   porta livre
#>
function Get-OpsPanelLiveStatus {
  param([int]$Port)

  $url = "http://127.0.0.1:$Port"
  $health = Get-OpsPanelHealth -Port $Port
  $listener = Get-PortListenerPid -Port $Port

  $state = if ($health -and $health.app -eq 'quiver-tap-ops' -and $health.version -eq $script:OpsPanelVersion) {
    'current'
  } elseif ($health) {
    'legacy'
  } elseif ($listener) {
    'blocked'
  } else {
    'stopped'
  }

  return [ordered]@{
    state = $state
    port = $Port
    url = $url
    pid = if ($health -and $health.pid) { [int]$health.pid } else { $listener }
  }
}

function Write-OpsPanelStatusReport {
  param([object]$Status)

  Write-Host ''
  Write-Host "Tap Quiver Ops  $($Status.url)" -ForegroundColor Cyan

  switch ($Status.state) {
    'current' {
      Write-Host "Rodando (PID $($Status.pid))" -ForegroundColor Green
    }
    'legacy' {
      Write-Host "Painel antigo na porta (PID $($Status.pid)). Rode: npm run ops:restart" -ForegroundColor Red
    }
    'blocked' {
      Write-Host "Porta ocupada por outro processo (PID $($Status.pid)). Libere a porta ou mude OPS_PANEL_PORT em ops-panel/.env" -ForegroundColor Red
    }
    default {
      Write-Host 'Parado. Para subir: npm run ops:start' -ForegroundColor Yellow
    }
  }
  Write-Host ''
}
