# Inicia o Cloudflare Tunnel em segundo plano (se ainda não estiver rodando).

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"

$settings = Get-QuiverTapSettings
$paths = Resolve-QuiverTapPaths -Settings $settings

if (Test-CloudflaredRunning) {
  Write-Host 'Cloudflare Tunnel ja esta em execucao.' -ForegroundColor Green
  exit 0
}

$cfExe = Find-CloudflaredExe -Preferred $paths.CloudflaredExe
if (-not $cfExe) {
  Write-Host 'cloudflared nao encontrado. Instale: winget install Cloudflare.cloudflared' -ForegroundColor Red
  exit 1
}

if (-not (Test-Path $paths.CloudflaredConfig)) {
  Write-Host "Config nao encontrado: $($paths.CloudflaredConfig)" -ForegroundColor Red
  Write-Host 'Copie deploy/cloudflared-config.example.yml para %USERPROFILE%\.cloudflared\config.yml' -ForegroundColor Yellow
  exit 1
}

if (Test-Path $paths.TunnelPidFile) {
  $oldPid = [int](Get-Content $paths.TunnelPidFile -ErrorAction SilentlyContinue)
  if (Test-ProcessAlive -ProcessId $oldPid) {
    Write-Host "Tunnel PID $oldPid ainda ativo." -ForegroundColor Yellow
    exit 0
  }
}

$args = @(
  'tunnel',
  '--config', $paths.CloudflaredConfig,
  'run', $paths.TunnelName
)

$proc = Start-Process `
  -FilePath $cfExe `
  -ArgumentList $args `
  -WindowStyle Hidden `
  -RedirectStandardOutput $paths.TunnelLog `
  -RedirectStandardError $paths.TunnelErrLog `
  -PassThru

Set-Content -Path $paths.TunnelPidFile -Value $proc.Id -Encoding ASCII
Write-WatchdogLog -Paths $paths -Message "Tunnel iniciado PID $($proc.Id) ($($paths.TunnelName))."

Start-Sleep -Seconds 3
if (Test-CloudflaredRunning) {
  Write-Host "Tunnel no ar (PID $($proc.Id))." -ForegroundColor Green
  exit 0
}

Write-Host "Tunnel pode ter falhado. Veja $($paths.TunnelErrLog)" -ForegroundColor Red
exit 1
