# Inicia o Cloudflare Tunnel em segundo plano (se ainda não estiver rodando).

param([switch]$Quiet)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"

$settings = Get-QuiverTapSettings
$paths = Resolve-QuiverTapPaths -Settings $settings

# O servico usa token/config remota. Nunca abrir um segundo conector local.
$service = Get-Service -Name 'Cloudflared' -ErrorAction SilentlyContinue
if ($service) {
  try {
    if ($service.Status -ne 'Running') {
      Start-Service -Name 'Cloudflared' -ErrorAction Stop
      $service.WaitForStatus('Running', [TimeSpan]::FromSeconds(20))
    }
    Write-WatchdogLog -Paths $paths -Message 'Cloudflared gerenciado pelo servico Windows: Running.'
    exit 0
  } catch {
    Write-WatchdogLog -Paths $paths -Message "Falha ao iniciar servico Cloudflared: $($_.Exception.Message)"
    exit 1
  }
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

$tunnelIdentity = Test-ManagedPidFile -PidFile $paths.TunnelPidFile -ExpectedProcessNames @('cloudflared.exe') -CommandLinePatterns @('tunnel', $paths.TunnelName)
if ($tunnelIdentity.State -eq 'VALID') {
  Write-Host "Cloudflare Tunnel ja esta em execucao (PID $($tunnelIdentity.ProcessId))." -ForegroundColor Green
  exit 0
}
if ($tunnelIdentity.State -ne 'MISSING') { Clear-InvalidManagedPidFile -Identity $tunnelIdentity -PidFile $paths.TunnelPidFile | Out-Null }

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
