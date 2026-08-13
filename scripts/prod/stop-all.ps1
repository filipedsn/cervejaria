# Para API e tunnel iniciados pelos scripts de produção.

. "$PSScriptRoot\_config.ps1"

$settings = Get-QuiverTapSettings
$paths = Resolve-QuiverTapPaths -Settings $settings

function Stop-ByPidFile {
  param([string]$PidFile, [string]$Label)

  if (-not (Test-Path $PidFile)) { return }
  $processId = [int](Get-Content $PidFile -ErrorAction SilentlyContinue)
  if (Test-ProcessAlive -ProcessId $processId) {
    Write-Host "Encerrando $Label (PID $processId)..."
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
  }
  Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

Stop-ByPidFile -PidFile $paths.ApiPidFile -Label 'API'
Stop-ByPidFile -PidFile $paths.AlertPollerPidFile -Label 'Alert poller'
Stop-ByPidFile -PidFile (Join-Path $paths.RuntimeDir 'watchdog.pid') -Label 'Watchdog daemon'
Stop-ByPidFile -PidFile (Join-Path $paths.RuntimeDir 'ops-panel.pid') -Label 'Ops panel'
Stop-ByPidFile -PidFile $paths.FrontendPidFile -Label 'Frontend'
Stop-ByPidFile -PidFile $paths.TunnelPidFile -Label 'Tunnel'

# Não para o serviço Cloudflared instalado via `cloudflared service install`
$procs = Get-Process -Name 'cloudflared' -ErrorAction SilentlyContinue
if ($procs -and -not (Get-Service -Name 'Cloudflared' -ErrorAction SilentlyContinue)) {
  Write-Host 'Encerrando processos cloudflared...'
  $procs | Stop-Process -Force -ErrorAction SilentlyContinue
}

foreach ($port in @($paths.ApiPort, $paths.FrontendPort)) {
  $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  foreach ($c in $conns) {
    if ($c.OwningProcess) {
      Write-Host "Encerrando listener na porta $port (PID $($c.OwningProcess))..."
      Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
    }
  }
}

Write-Host 'Concluído.' -ForegroundColor Green
