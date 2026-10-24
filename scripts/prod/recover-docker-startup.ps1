# Recuperacao unica do motor Docker travado no login apos desligamento abrupto.
param([int]$GraceSeconds = 300, [int]$RecoveryWaitSeconds = 180)
$ErrorActionPreference='Stop'
. "$PSScriptRoot\_config.ps1"
. "$PSScriptRoot\boot-dependencies.ps1"
if ([Security.Principal.WindowsIdentity]::GetCurrent().IsSystem) { exit 0 }
$paths=Resolve-QuiverTapPaths -Settings (Get-QuiverTapSettings)
try { $lock=[IO.File]::Open((Join-Path $paths.RuntimeDir 'docker-startup.lock'),'OpenOrCreate','ReadWrite','None') } catch [IO.IOException] { exit 0 }
try {
  if (Wait-ProdDockerEngine -TimeoutSeconds $GraceSeconds) { exit 0 }
  $boot=(Get-CimInstance Win32_OperatingSystem -ErrorAction Stop).LastBootUpTime.ToUniversalTime().Ticks
  $stamp=Join-Path $paths.RuntimeDir 'docker-startup-recovery.boot'
  $alreadyAttempted=(Test-Path $stamp) -and (([string](Get-Content $stamp -ErrorAction Stop)).Trim() -eq [string]$boot)
  # Nunca derrubar motor responsivo ou producao viva; respeitar deploy/recovery.
  $engineReady=[bool](Invoke-ProdDocker -DockerArgs @('info','--format','{{.ServerVersion}}'))
  $apiAlive=Test-ApiHealthy -HealthUrl $paths.HealthUrl
  $databaseListening=Test-PortListening -Port 5432
  $paused=Test-DeployPaused -Paths $paths
  if (-not (Test-DockerStartupRecoveryAllowed -EngineReady $engineReady -ApiAlive $apiAlive -DatabaseListening $databaseListening -Paused $paused -AlreadyAttempted $alreadyAttempted)) {
    Write-WatchdogLog -Paths $paths -Message 'Recuperacao Docker no login cancelada: motor/PROD ativo, pausa operacional ou tentativa ja realizada neste boot.'
    exit 0
  }
  Set-Content -LiteralPath $stamp -Value ([string]$boot) -Encoding ASCII
  Write-WatchdogLog -Paths $paths -Message "Motor Docker nao respondeu por $GraceSeconds segundos no login; recuperacao unica do Docker/WSL, sem apagar volumes."
  $dockerRoot=Join-Path $env:ProgramFiles 'Docker\Docker'
  foreach($name in @('Docker Desktop','com.docker.backend','com.docker.build')) {
    foreach($process in @(Get-Process -Name $name -ErrorAction SilentlyContinue)) {
      # Somente executaveis da instalacao Docker conhecida.
      if ($process.Path -and $process.Path.StartsWith($dockerRoot+'\',[StringComparison]::OrdinalIgnoreCase)) {
        Stop-Process -Id $process.Id -Force -ErrorAction Stop
      }
    }
  }
  $wsl=Start-Process -FilePath (Join-Path $env:WINDIR 'System32\wsl.exe') -ArgumentList @('--terminate','docker-desktop') -WindowStyle Hidden -PassThru
  $null=$wsl.Handle
  if(-not $wsl.WaitForExit(30000)) {
    Stop-Process -Id $wsl.Id -Force -ErrorAction SilentlyContinue
    throw 'WSL nao concluiu a parada de docker-desktop em 30s; nenhuma nova tentativa automatica neste boot.'
  }
  $wsl.Refresh()
  if($wsl.ExitCode -ne 0){throw 'WSL recusou a parada de docker-desktop; nenhuma distribuicao foi removida.'}
  Start-ProdDockerDesktop
  if(Wait-ProdDockerEngine -TimeoutSeconds $RecoveryWaitSeconds) {
    Write-WatchdogLog -Paths $paths -Message 'Motor Docker recuperado; watchdog retoma banco PROD e API.'
  } else { throw 'Motor Docker continua indisponivel; intervencao manual necessaria, sem repetir reset neste boot.' }
} catch {
  Write-WatchdogLog -Paths $paths -Message "Recuperacao Docker no login falhou: $($_.Exception.Message)"
  exit 1
} finally { $lock.Dispose() }
