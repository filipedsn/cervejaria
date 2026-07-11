# Inicia a API de produção (backend/dist) em segundo plano.

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"

$settings = Get-QuiverTapSettings
$paths = Resolve-QuiverTapPaths -Settings $settings

if (Test-ApiHealthy -HealthUrl $paths.HealthUrl) {
  Write-Host "API ja esta no ar ($($paths.HealthUrl))." -ForegroundColor Green
  exit 0
}

if (-not (Test-Path $paths.ApiEntry)) {
  Write-Host "Build ausente. Execute na raiz do projeto: npm run build" -ForegroundColor Red
  exit 1
}

if (Test-Path $paths.ApiPidFile) {
  $oldPid = [int](Get-Content $paths.ApiPidFile -ErrorAction SilentlyContinue)
  if (Test-ProcessAlive -ProcessId $oldPid) {
    Write-Host "Processo API PID $oldPid ainda ativo; aguardando health..." -ForegroundColor Yellow
    Start-Sleep -Seconds 2
    if (Test-ApiHealthy -HealthUrl $paths.HealthUrl) { exit 0 }
    Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
  }
}

if (Test-PortListening -Port $paths.ApiPort) {
  Write-WatchdogLog -Paths $paths -Message "Porta $($paths.ApiPort) em uso sem health OK - tentando liberar."
  $conns = Get-NetTCPConnection -LocalPort $paths.ApiPort -State Listen -ErrorAction SilentlyContinue
  foreach ($c in $conns) {
    if ($c.OwningProcess) {
      Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
    }
  }
  Start-Sleep -Seconds 1
}

$nodeDir = Split-Path $paths.NodeExe -Parent
$env:Path = "$nodeDir;$env:Path"
$env:NODE_ENV = 'production'
Import-BackendEnvFile -BackendDir $paths.BackendDir -Environment production

$proc = Start-Process `
  -FilePath $paths.NodeExe `
  -ArgumentList @('dist\index.js') `
  -WorkingDirectory $paths.BackendDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput $paths.ApiLog `
  -RedirectStandardError $paths.ApiErrLog `
  -PassThru

Set-Content -Path $paths.ApiPidFile -Value $proc.Id -Encoding ASCII
Write-WatchdogLog -Paths $paths -Message "API iniciada PID $($proc.Id)."

$deadline = (Get-Date).AddSeconds(30)
do {
  Start-Sleep -Seconds 1
  if (Test-ApiHealthy -HealthUrl $paths.HealthUrl) {
    Write-Host "API no ar: $($paths.HealthUrl) (PID $($proc.Id))" -ForegroundColor Green
    exit 0
  }
} while ((Get-Date) -lt $deadline)

Write-Host "API subiu mas health check falhou. Veja $($paths.ApiErrLog)" -ForegroundColor Red
exit 1
