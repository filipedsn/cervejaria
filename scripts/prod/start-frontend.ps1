# Inicia o frontend (Vite na porta 5201) em segundo plano.

param(
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"
$settings = Get-QuiverTapSettings
$paths = Resolve-QuiverTapPaths -Settings $settings

if (Test-FrontendHealthy -FrontendUrl $paths.FrontendUrl) {
  if (-not $Quiet) { Write-Host "Frontend ja esta no ar ($($paths.FrontendUrl))." -ForegroundColor Green }
  exit 0
}
if (-not $paths.NpmCmd -or -not (Test-Path $paths.NpmCmd)) {
  Write-Host 'npm.cmd nao encontrado. Instale Node.js 24.' -ForegroundColor Red
  exit 1
}

if (-not (Test-Path $paths.FrontendDir)) {
  Write-Host "Pasta frontend nao encontrada: $($paths.FrontendDir)" -ForegroundColor Red
  exit 1
}

if (Test-Path $paths.FrontendPidFile) {
  $oldPid = [int](Get-Content $paths.FrontendPidFile -ErrorAction SilentlyContinue)
  if (Test-ProcessAlive -ProcessId $oldPid) {
    Write-Host "Processo frontend PID $oldPid ainda ativo; aguardando health..." -ForegroundColor Yellow
    Start-Sleep -Seconds 3
    if (Test-FrontendHealthy -FrontendUrl $paths.FrontendUrl) { exit 0 }
    Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
  }
}

if (Test-PortListening -Port $paths.FrontendPort) {
  Write-WatchdogLog -Paths $paths -Message "Porta $($paths.FrontendPort) em uso sem health OK - tentando liberar."
  $conns = Get-NetTCPConnection -LocalPort $paths.FrontendPort -State Listen -ErrorAction SilentlyContinue
  foreach ($c in $conns) {
    if ($c.OwningProcess) {
      Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
    }
  }
  Start-Sleep -Seconds 1
}

$nodeDir = Split-Path $paths.NodeExe -Parent
$env:Path = "$nodeDir;$env:Path"
$env:QUIVER_ENV = 'production'

$proc = Start-HiddenNpm `
  -NpmCmd $paths.NpmCmd `
  -WorkingDirectory $paths.FrontendDir `
  -NpmArgs @('run', 'dev') `
  -StdoutLog $paths.FrontendLog `
  -StderrLog $paths.FrontendErrLog
Set-Content -Path $paths.FrontendPidFile -Value $proc.Id -Encoding ASCII
Write-WatchdogLog -Paths $paths -Message "Frontend iniciado PID $($proc.Id) porta $($paths.FrontendPort)."

$deadline = (Get-Date).AddSeconds(90)
do {
  Start-Sleep -Seconds 2
  if (Test-FrontendHealthy -FrontendUrl $paths.FrontendUrl) {
    $listener = Get-NetTCPConnection -LocalPort $paths.FrontendPort -State Listen -ErrorAction SilentlyContinue |
      Select-Object -First 1 -ExpandProperty OwningProcess
    if ($listener) {
      Set-Content -Path $paths.FrontendPidFile -Value $listener -Encoding ASCII
    }
    $pidLabel = if ($listener) { $listener } else { $proc.Id }
    if (-not $Quiet) { Write-Host "Frontend no ar: $($paths.FrontendUrl) (PID $pidLabel)" -ForegroundColor Green }
    exit 0
  }
} while ((Get-Date) -lt $deadline)

Write-Host "Frontend subiu mas health check falhou. Veja $($paths.FrontendErrLog)" -ForegroundColor Red
exit 1
