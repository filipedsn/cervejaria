# Para o worker de alertas Kibana.

. "$PSScriptRoot\_config.ps1"

$settings = Get-QuiverTapSettings
$paths = Resolve-QuiverTapPaths -Settings $settings

Stop-ManagedPidFile -PidFile $paths.AlertPollerPidFile -ExpectedProcessNames @('node.exe') -CommandLinePatterns @('alert-poller') -Label 'Alert poller' | Out-Null

$port = $paths.AlertPollerHealthPort
$conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
foreach ($c in $conns) {
  if ($c.OwningProcess) {
    Write-Host "Encerrando listener na porta $port (PID $($c.OwningProcess))..."
    Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
  }
}

Write-Host 'Alert poller encerrado.' -ForegroundColor Green
