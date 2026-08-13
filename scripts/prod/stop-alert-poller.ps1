# Para o worker de alertas Kibana.

. "$PSScriptRoot\_config.ps1"

$settings = Get-QuiverTapSettings
$paths = Resolve-QuiverTapPaths -Settings $settings

if (Test-Path $paths.AlertPollerPidFile) {
  $processId = [int](Get-Content $paths.AlertPollerPidFile -ErrorAction SilentlyContinue)
  if (Test-ProcessAlive -ProcessId $processId) {
    Write-Host "Encerrando Alert poller (PID $processId)..."
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
  }
  Remove-Item $paths.AlertPollerPidFile -Force -ErrorAction SilentlyContinue
}

$port = $paths.AlertPollerHealthPort
$conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
foreach ($c in $conns) {
  if ($c.OwningProcess) {
    Write-Host "Encerrando listener na porta $port (PID $($c.OwningProcess))..."
    Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
  }
}

Write-Host 'Alert poller encerrado.' -ForegroundColor Green
