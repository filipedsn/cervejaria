# Reinicia o ops-panel (porta 3099).

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"

$settings = Get-QuiverTapSettings
$paths = Resolve-QuiverTapPaths -Settings $settings

$opsPidFile = Join-Path $paths.RuntimeDir 'ops-panel.pid'

if (Test-Path $opsPidFile) {
  $processId = [int](Get-Content $opsPidFile -ErrorAction SilentlyContinue)
  if (Test-ProcessAlive -ProcessId $processId) {
    Write-Host "Encerrando ops-panel (PID $processId)..."
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
  }
  Remove-Item $opsPidFile -Force -ErrorAction SilentlyContinue
}

$conns = Get-NetTCPConnection -LocalPort 3099 -State Listen -ErrorAction SilentlyContinue
foreach ($c in $conns) {
  if ($c.OwningProcess) {
    Write-Host "Encerrando listener :3099 (PID $($c.OwningProcess))..."
    Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
  }
}

Start-Sleep -Seconds 1
& "$PSScriptRoot\start-ops-panel.ps1"
exit $LASTEXITCODE
