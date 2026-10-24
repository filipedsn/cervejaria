# Daemon unico: monitora producao em loop sem abrir novas janelas a cada ciclo.

param(
  # Apos um boot, Docker e seus containers podem levar alguns minutos para ficar
  # prontos. Um ciclo curto reduz a indisponibilidade sem criar processos extras.
  [int]$IntervalSeconds = 60
)

$ErrorActionPreference = 'Continue'
. "$PSScriptRoot\_config.ps1"

try {
  $settings = Get-QuiverTapSettings
  $paths = Resolve-QuiverTapPaths -Settings $settings
} catch {
  exit 1
}

$watchdogPidFile = Join-Path $paths.RuntimeDir 'watchdog.pid'
# Lock de arquivo entre sessoes/usuarios; liberado pelo Windows ate em crash.
try {
  $daemonLock = [IO.File]::Open((Join-Path $paths.RuntimeDir 'watchdog.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
} catch [IO.IOException] {
  exit 0
}
Set-Content -Path $watchdogPidFile -Value $PID -Encoding ASCII
Write-WatchdogLog -Paths $paths -Message "Watchdog daemon em execucao PID $PID."

try {
  do {
    try {
      # Um erro/exit de dependencia nao pode encerrar o supervisor.
      & (Join-Path $PSHOME 'powershell.exe') -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot\ensure-running.ps1" -Quiet
      if ($LASTEXITCODE -ne 0) {
        Write-WatchdogLog -Paths $paths -Message 'Ciclo incompleto; nova tentativa automatica no proximo ciclo.'
      }
    } catch {
      Write-WatchdogLog -Paths $paths -Message "Erro no ciclo; supervisor continua: $($_.Exception.Message)"
    }
    Start-Sleep -Seconds $IntervalSeconds
  } while ($true)
} finally {
  Write-WatchdogLog -Paths $paths -Message "Watchdog daemon encerrado PID $PID."
  Remove-Item $watchdogPidFile -Force -ErrorAction SilentlyContinue
  $daemonLock.Dispose()
}
