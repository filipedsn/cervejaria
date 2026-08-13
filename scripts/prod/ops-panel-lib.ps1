# Funcoes compartilhadas do ops-panel — uma porta, um estado, sem surpresas.

$ErrorActionPreference = 'Stop'

function Get-OpsPanelConfiguredPort {
  param([string]$EnvFile)
  if (-not (Test-Path $EnvFile)) { return 3099 }
  foreach ($line in Get-Content -LiteralPath $EnvFile) {
    $t = $line.Trim()
    if ($t -match '^OPS_PANEL_PORT=(\d+)') { return [int]$Matches[1] }
  }
  return 3099
}

function Test-OpsPanelCurrent {
  param([int]$Port)
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/session" -UseBasicParsing -TimeoutSec 3
    return $r.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Test-OpsPanelHealthOnly {
  param([int]$Port)
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 3
    return $r.StatusCode -eq 200
  } catch {
    return $false
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
  if (-not $Quiet) { Write-Host "Encerrando listener :$Port (PID $procId)..." -ForegroundColor Yellow }
  Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 400
  & taskkill.exe /F /PID $procId 2>$null | Out-Null
  Start-Sleep -Milliseconds 400
  return $null -eq (Get-PortListenerPid -Port $Port)
}

function Read-OpsPanelMeta {
  param([string]$MetaFile)
  if (-not (Test-Path $MetaFile)) { return $null }
  try {
    $raw = Get-Content -LiteralPath $MetaFile -Raw -Encoding UTF8
    if ($raw.Length -gt 0 -and [int][char]$raw[0] -eq 0xFEFF) { $raw = $raw.Substring(1) }
    return $raw | ConvertFrom-Json
  } catch {
    return $null
  }
}

<#
  Estados:
  - current   versao atual respondendo em /api/session
  - legacy    /api/health ok mas sem /api/session (instancia antiga)
  - blocked   porta ocupada mas nao responde como ops-panel
  - stopped   porta livre
#>
function Get-OpsPanelLiveStatus {
  param(
    [int]$Port,
    [string]$MetaFile = ''
  )

  $url = "http://127.0.0.1:$Port"
  $meta = if ($MetaFile) { Read-OpsPanelMeta -MetaFile $MetaFile } else { $null }

  if (Test-OpsPanelCurrent -Port $Port) {
    return [ordered]@{
      state = 'current'
      port = $Port
      url = $url
      pid = if ($meta -and $meta.pid) { [int]$meta.pid } else { Get-PortListenerPid -Port $Port }
      meta = $meta
    }
  }

  if (Test-OpsPanelHealthOnly -Port $Port) {
    return [ordered]@{
      state = 'legacy'
      port = $Port
      url = $url
      pid = Get-PortListenerPid -Port $Port
      meta = $null
    }
  }

  $blocker = Get-PortListenerPid -Port $Port
  if ($blocker) {
    return [ordered]@{
      state = 'blocked'
      port = $Port
      url = $url
      pid = $blocker
      meta = $null
    }
  }

  return [ordered]@{
    state = 'stopped'
    port = $Port
    url = $url
    pid = $null
    meta = $null
  }
}

function Write-OpsPanelStatusReport {
  param(
    [object]$Status,
    [int[]]$ExtraPortsToScan = @(3100)
  )

  $state = $Status.state
  $port = $Status.port
  $url = $Status.url

  Write-Host ''
  Write-Host 'Quiver Tap Ops Panel' -ForegroundColor Cyan
  Write-Host '====================' -ForegroundColor Cyan
  Write-Host "Porta configurada   $port"
  Write-Host "URL                 $url"

  switch ($state) {
    'current' {
      Write-Host 'Estado              RODANDO (versao atual)' -ForegroundColor Green
      if ($Status.pid) { Write-Host "PID                 $($Status.pid)" }
      if ($Status.meta -and $Status.meta.startedAt) {
        Write-Host "Iniciado em         $($Status.meta.startedAt)"
      }
    }
    'legacy' {
      Write-Host 'Estado              LEGADO - instancia antiga na porta' -ForegroundColor Red
      Write-Host "PID bloqueando      $($Status.pid)" -ForegroundColor Yellow
      Write-Host ''
      Write-Host 'Esta instancia nao tem sessao local nem agente de suporte.' -ForegroundColor Yellow
      Write-Host 'Encerre o processo (PowerShell como Administrador):' -ForegroundColor Yellow
      Write-Host "  taskkill /F /PID $($Status.pid)" -ForegroundColor Gray
      Write-Host '  npm run ops:start' -ForegroundColor Gray
    }
    'blocked' {
      Write-Host 'Estado              PORTA OCUPADA por outro processo' -ForegroundColor Red
      Write-Host "PID bloqueando      $($Status.pid)" -ForegroundColor Yellow
      Write-Host ''
      Write-Host 'A porta nao responde como ops-panel. Libere-a ou encerre o processo.' -ForegroundColor Yellow
    }
    default {
      Write-Host 'Estado              PARADO' -ForegroundColor Yellow
      Write-Host ''
      Write-Host 'Para subir: npm run ops:start' -ForegroundColor Gray
    }
  }

  foreach ($extra in $ExtraPortsToScan) {
    if ($extra -eq $port) { continue }
    $extraStatus = Get-OpsPanelLiveStatus -Port $extra
    if ($extraStatus.state -eq 'current') {
      Write-Host ''
      Write-Host "AVISO: outra instancia CURRENT na porta $extra ($($extraStatus.url))." -ForegroundColor Yellow
      Write-Host 'Pare com: npm run ops:stop' -ForegroundColor Gray
    } elseif ($extraStatus.state -in @('legacy', 'blocked')) {
      Write-Host ''
      Write-Host "AVISO: processo estranho na porta $extra (PID $($extraStatus.pid))." -ForegroundColor DarkYellow
    }
  }

  Write-Host ''
}
