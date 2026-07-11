# Para apenas o ambiente de desenvolvimento (portas 3002 / 5202).

$ErrorActionPreference = 'SilentlyContinue'
. "$PSScriptRoot\_config.ps1"

$paths = Get-DevPaths

function Stop-ByPidFile {
  param([string]$PidFile, [string]$Label)

  if (-not (Test-Path $PidFile)) { return }
  $processId = [int](Get-Content $PidFile -ErrorAction SilentlyContinue)
  if (Test-DevProcessAlive -ProcessId $processId) {
    Write-Host "Encerrando $Label (PID $processId)..." -ForegroundColor Yellow
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
  }
  Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

Stop-ByPidFile -PidFile $paths.BackendPidFile -Label 'API dev'
Stop-ByPidFile -PidFile $paths.FrontendPidFile -Label 'Frontend dev'
Stop-ByPidFile -PidFile $paths.SupervisorPidFile -Label 'Supervisor dev'

foreach ($port in @($paths.BackendPort, $paths.FrontendPort)) {
  $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  foreach ($c in $conns) {
    if ($c.OwningProcess) {
      Write-Host "Encerrando listener na porta $port (PID $($c.OwningProcess))..." -ForegroundColor Yellow
      Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
    }
  }
}

Write-Host 'Ambiente de desenvolvimento encerrado.' -ForegroundColor Green
