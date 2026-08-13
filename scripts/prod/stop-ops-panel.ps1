# Para o ops-panel na porta configurada.

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"
. "$PSScriptRoot\ops-panel-lib.ps1"

$settings = Get-QuiverTapSettings
$paths = Resolve-QuiverTapPaths -Settings $settings

$envFile = Join-Path $paths.ProjectRoot 'ops-panel\.env'
$pidFile = Join-Path $paths.RuntimeDir 'ops-panel.pid'
$metaFile = Join-Path $paths.RuntimeDir 'ops-panel.meta.json'
$port = Get-OpsPanelConfiguredPort -EnvFile $envFile

$stopped = $false

if (Test-Path $pidFile) {
  $panelPid = [int](Get-Content $pidFile -ErrorAction SilentlyContinue)
  if ($panelPid -gt 0 -and (Test-ProcessAlive -ProcessId $panelPid)) {
    Stop-Process -Id $panelPid -Force -ErrorAction SilentlyContinue
    if (Test-ProcessAlive -ProcessId $panelPid) {
      & taskkill.exe /F /PID $panelPid 2>$null | Out-Null
    }
    Write-Host "Ops panel parado (PID $panelPid)." -ForegroundColor Green
    $stopped = $true
  }
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

if (Get-PortListenerPid -Port $port) {
  if (Stop-PortListener -Port $port) {
    Write-Host "Listener :$port encerrado." -ForegroundColor Green
    $stopped = $true
  } else {
    Write-Host "Nao foi possivel liberar a porta $port (acesso negado)." -ForegroundColor Red
    exit 1
  }
}

Remove-Item $metaFile -Force -ErrorAction SilentlyContinue

# Limpa instancia extra na 3100 (fallback antigo, removido).
$extra = Get-OpsPanelLiveStatus -Port 3100
if ($extra.state -eq 'current') {
  if (Stop-PortListener -Port 3100) {
    Write-Host 'Instancia extra na porta 3100 encerrada.' -ForegroundColor Yellow
    $stopped = $true
  }
}

if (-not $stopped) {
  Write-Host 'Ops panel ja estava parado.' -ForegroundColor Yellow
}

exit 0
