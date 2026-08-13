# Deploy de producao: preflight, backup, build, migrate, publicacao, restart e smoke test.
#
# O watchdog sobe a API elevada (tarefas agendadas com RunLevel=Highest) e um shell comum nao
# consegue encerrar processo elevado. Por isso o deploy se relanca elevado sozinho quando o
# preflight detecta que nao tem direito de encerrar os processos de producao.
#
# O preflight roda antes de qualquer acao destrutiva: sem isso o script descobria o bloqueio
# somente na publicacao, deixando o banco migrado e o codigo antigo no ar.

param(
  [switch]$Confirmed,
  [switch]$SkipBackup,
  [switch]$SkipMigrate,
  [switch]$SkipBackfill,
  [switch]$FrontendOnly,
  [switch]$BackendOnly,
  [switch]$DryRun,
  [switch]$PreflightOnly,
  # Internos: preenchidos quando o script se relanca elevado.
  [switch]$NoElevate,
  [string]$LogFile = '',
  [string]$ExitCodeFile = ''
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"
. "$PSScriptRoot\publish-artifacts.ps1"

if ($FrontendOnly -and $BackendOnly) {
  Write-Host 'Use apenas -FrontendOnly ou -BackendOnly, nao ambos.' -ForegroundColor Red
  exit 1
}

$settings = Get-QuiverTapSettings
$paths = Resolve-QuiverTapPaths -Settings $settings

Set-Location $paths.ProjectRoot

$env:NODE_ENV = 'production'
Import-BackendEnvFile -BackendDir $paths.BackendDir -Environment production

$buildFrontend = -not $BackendOnly
$buildBackend = -not $FrontendOnly
$watchdogPidFile = Join-Path $paths.RuntimeDir 'watchdog.pid'

$plan = [ordered]@{
  Backup   = -not $SkipBackup
  BuildFE  = $buildFrontend
  BuildBE  = $buildBackend
  Migrate  = -not $SkipMigrate
  Backfill = -not $SkipBackfill -and -not $SkipMigrate
  Publish  = $true
  Restart  = $true
  Smoke    = $true
}

# ---------------------------------------------------------------- preflight

function Get-DeployProcessTargets {
  $targets = @()
  $seen = @{}

  $entries = @(
    @{ Label = 'API';          PidFile = $paths.ApiPidFile },
    @{ Label = 'Alert poller'; PidFile = $paths.AlertPollerPidFile }
  )

  foreach ($entry in $entries) {
    $procId = Get-PidFromFile -PidFile $entry.PidFile
    if ($procId -gt 0 -and (Test-ProcessAlive -ProcessId $procId) -and -not $seen.ContainsKey($procId)) {
      $seen[$procId] = $true
      $targets += [pscustomobject]@{ Label = $entry.Label; ProcessId = $procId }
    }
  }

  # Deteccao por porta cobre o caso de arquivo de PID perdido (deploy anterior abortado):
  # esses processos seguram handles em prod-artifacts e travam a publicacao.
  $ports = @(
    @{ Label = 'API';          Port = $paths.ApiPort },
    @{ Label = 'Alert poller'; Port = $paths.AlertPollerHealthPort }
  )
  foreach ($entry in $ports) {
    if (-not $entry.Port) { continue }
    $listenerPid = Get-PortListenerPid -Port $entry.Port
    if ($listenerPid -gt 0 -and -not $seen.ContainsKey($listenerPid)) {
      $seen[$listenerPid] = $true
      $targets += [pscustomobject]@{
        Label     = "$($entry.Label) na porta $($entry.Port)"
        ProcessId = $listenerPid
      }
    }
  }

  return $targets
}

function Test-DockerContainerRunning {
  param([string]$Name)

  try {
    $found = & docker ps --filter "name=$Name" --filter 'status=running' --format '{{.Names}}' 2>$null
  } catch {
    return $false
  }
  return [bool]($found -match [regex]::Escape($Name))
}

function Invoke-DeployPreflight {
  Write-Host 'Preflight' -ForegroundColor Cyan
  Write-Host '---------' -ForegroundColor Cyan

  $blockers = New-Object 'System.Collections.Generic.List[string]'
  $warnings = New-Object 'System.Collections.Generic.List[string]'
  $needsElevation = $false

  $elevated = Test-IsElevated
  Write-Host "  Shell elevado           : $(if ($elevated) { 'sim' } else { 'nao' })"

  if ($paths.NpmCmd -and (Test-Path $paths.NpmCmd)) {
    Write-Host '  npm.cmd                 : OK'
  } else {
    $blockers.Add('npm.cmd nao encontrado. Instale Node 20+ ou ajuste o PATH.')
    Write-Host '  npm.cmd                 : FALTA' -ForegroundColor Red
  }

  if ($plan.Backup -or $plan.Migrate) {
    if (Test-DockerContainerRunning -Name 'cervejaria-db') {
      Write-Host '  Container cervejaria-db : rodando'
    } else {
      $blockers.Add('Container cervejaria-db nao esta rodando. Suba o banco antes (docker start cervejaria-db).')
      Write-Host '  Container cervejaria-db : PARADO' -ForegroundColor Red
    }
  }

  try {
    $drive = (Get-Item $paths.ProdArtifactsDir).PSDrive
    if ($drive -and $null -ne $drive.Free) {
      $freeGb = [math]::Round($drive.Free / 1GB, 1)
      Write-Host "  Espaco livre em $($drive.Name):      $freeGb GB"
      if ($freeGb -lt 2) {
        $warnings.Add("Apenas $freeGb GB livres em $($drive.Name): - backup e artefatos podem falhar.")
      }
    }
  } catch {
    $warnings.Add('Nao foi possivel medir espaco livre em disco.')
  }

  $targets = @(Get-DeployProcessTargets)
  if ($targets.Count -eq 0) {
    Write-Host '  Processos de producao   : nenhum ativo'
  } else {
    foreach ($target in $targets) {
      $canKill = Test-CanTerminateProcess -ProcessId $target.ProcessId
      if ($canKill) {
        Write-Host "  $($target.Label) (PID $($target.ProcessId)) : pode encerrar"
      } else {
        $needsElevation = $true
        Write-Host "  $($target.Label) (PID $($target.ProcessId)) : SEM PERMISSAO (processo elevado)" -ForegroundColor Yellow
      }
    }
  }

  if ($needsElevation -and $elevated) {
    $stuck = ($targets | Where-Object { -not (Test-CanTerminateProcess -ProcessId $_.ProcessId) } |
      ForEach-Object { "$($_.Label) PID $($_.ProcessId)" }) -join ', '
    $blockers.Add("Mesmo elevado nao ha permissao para encerrar: $stuck. Encerre pelo Gerenciador de Tarefas.")
  }

  foreach ($warning in $warnings) {
    Write-Host "  aviso: $warning" -ForegroundColor Yellow
  }

  Write-Host ''

  return [pscustomobject]@{
    Ok             = ($blockers.Count -eq 0)
    NeedsElevation = ($needsElevation -and -not $elevated)
    Blockers       = $blockers
    Elevated       = $elevated
    Targets        = $targets
  }
}

# ------------------------------------------------------------- auto-elevacao

function Write-LogTail {
  param(
    [string]$Path,
    [ref]$Position
  )

  if (-not (Test-Path $Path)) { return }

  try {
    $stream = [System.IO.File]::Open(
      $Path,
      [System.IO.FileMode]::Open,
      [System.IO.FileAccess]::Read,
      [System.IO.FileShare]::ReadWrite
    )
  } catch {
    return
  }

  try {
    $length = $stream.Length
    $pending = [int]($length - $Position.Value)
    if ($pending -le 0) { return }

    [void]$stream.Seek([int64]$Position.Value, [System.IO.SeekOrigin]::Begin)
    $buffer = New-Object byte[] $pending
    $read = $stream.Read($buffer, 0, $pending)
    if ($read -le 0) { return }

    $Position.Value = $Position.Value + $read
    Write-Host -NoNewline ([System.Text.Encoding]::UTF8.GetString($buffer, 0, $read))
  } finally {
    $stream.Dispose()
  }
}

function Show-UacDeployNotice {
  $message = @(
    'O Windows vai pedir permissao de Administrador para encerrar a API em producao.'
    ''
    'Clique em SIM no prompt UAC (pode aparecer atras do navegador ou na barra de tarefas).'
    ''
    'Se cancelar ou ignorar, o deploy nao sera executado e nada sera alterado.'
  ) -join "`n"

  try {
    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show(
      $message,
      'Quiver Tap - Confirmar UAC',
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Information
    )
  } catch {
    Write-Host ''
    Write-Host '>>> ACEITE O PROMPT UAC DO WINDOWS (clique em Sim) <<<' -ForegroundColor Yellow
    Write-Host 'O prompt pode aparecer atras do navegador.' -ForegroundColor Yellow
    Write-Host ''
  }
}

function Invoke-SelfElevatedDeploy {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $log = Join-Path $paths.LogDir "deploy-$stamp.log"
  $exitFile = Join-Path $paths.RuntimeDir "deploy-$stamp.exit"
  Remove-Item $exitFile -Force -ErrorAction SilentlyContinue

  Show-UacDeployNotice

  $childArgs = @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', "`"$PSCommandPath`"",
    '-NoElevate',
    '-Confirmed',
    '-LogFile', "`"$log`"",
    '-ExitCodeFile', "`"$exitFile`""
  )
  foreach ($switchName in @('SkipBackup', 'SkipMigrate', 'SkipBackfill', 'FrontendOnly', 'BackendOnly')) {
    if ($PSBoundParameters.ContainsKey($switchName) -and $PSBoundParameters[$switchName]) {
      $childArgs += "-$switchName"
    }
  }

  Write-Host 'Elevando o deploy (confirme o UAC)...' -ForegroundColor Cyan
  Write-Host "Log: $log" -ForegroundColor DarkGray
  Write-Host ''

  try {
    $child = Start-Process -FilePath 'powershell.exe' -ArgumentList $childArgs `
      -Verb RunAs -WindowStyle Normal -PassThru
  } catch {
    Write-Host ''
    Write-Host 'UAC recusado ou elevacao indisponivel. Deploy nao executado.' -ForegroundColor Red
    Write-Host 'Nada foi alterado. Tente de novo e clique em Sim no UAC.' -ForegroundColor Yellow
    Write-Host 'Alternativa: abra PowerShell como Administrador e rode: .\deploy.cmd -Confirmed' -ForegroundColor Yellow
    $script:deployExit = 1
    return
  }

  $position = [int64]0
  while (-not $child.HasExited) {
    Start-Sleep -Milliseconds 400
    Write-LogTail -Path $log -Position ([ref]$position)
  }
  Start-Sleep -Milliseconds 400
  Write-LogTail -Path $log -Position ([ref]$position)

  $exitCode = 1
  $raw = ''
  if (Test-Path $exitFile) {
    $raw = ("" + (Get-Content $exitFile -ErrorAction SilentlyContinue | Select-Object -First 1)).Trim()
    Remove-Item $exitFile -Force -ErrorAction SilentlyContinue
  }
  if ($raw -match '^\d+$') {
    $exitCode = [int]$raw
  } elseif ($null -ne $child.ExitCode) {
    $exitCode = [int]$child.ExitCode
  }

  if ($exitCode -ne 0 -and -not (Test-Path $exitFile) -and -not (Test-Path $log)) {
    Write-Host ''
    Write-Host 'UAC cancelado ou elevacao negada. Nenhum artefato foi alterado.' -ForegroundColor Red
    Write-Host 'Tente de novo: clique em Sim no prompt UAC do Windows.' -ForegroundColor Yellow
  }

  Write-Host ''
  Write-Host "Log completo: $log" -ForegroundColor DarkGray
  $script:deployExit = $exitCode
}

# ------------------------------------------------------------------- deploy

function Invoke-NpmStep {
  param(
    [string]$Label,
    [string[]]$NpmArgs
  )

  Write-Host ''
  Write-Host "$Label..." -ForegroundColor Cyan
  if ($paths.NpmCmd) {
    & $paths.NpmCmd @NpmArgs
  } else {
    npm @NpmArgs
  }
  if ($LASTEXITCODE -ne 0) {
    throw "$Label falhou (exit $LASTEXITCODE)."
  }
}

function Stop-ProcessById {
  param([int]$ProcessId, [string]$Label)

  if ($ProcessId -le 0 -or -not (Test-ProcessAlive -ProcessId $ProcessId)) { return }

  Write-Host "Encerrando $Label (PID $ProcessId)..." -ForegroundColor Yellow

  # taskkill via cmd: com $ErrorActionPreference = 'Stop' a stderr de executavel nativo
  # virava erro terminante e abortava o deploy antes de tentar as alternativas.
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'SilentlyContinue'
  try {
    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
    if (Test-ProcessAlive -ProcessId $ProcessId) {
      cmd /c "taskkill /F /PID $ProcessId" 2>$null | Out-Null
    }
  } finally {
    $ErrorActionPreference = $prevEap
  }

  for ($i = 0; $i -lt 20; $i++) {
    if (-not (Test-ProcessAlive -ProcessId $ProcessId)) { return }
    Start-Sleep -Milliseconds 300
  }

  throw "Nao foi possivel encerrar $Label (PID $ProcessId)."
}

function Invoke-DeployBody {
  Merge-StrayProdUploads -Paths $paths

  if ($plan.Backup) {
    Write-Host ''
    Write-Host 'Backup do banco cervejaria...' -ForegroundColor Cyan
    & "$PSScriptRoot\backup-db.ps1"
    if ($LASTEXITCODE -ne 0) { throw 'Backup falhou.' }
  }

  Ensure-ProdArtifactsBaseline -Paths $paths
  Initialize-ProdStaging -Paths $paths

  if ($plan.BuildFE) {
    Invoke-NpmStep -Label 'Build frontend (prod staging)' -NpmArgs @('run', 'build:prod', '--prefix', 'frontend')
    $stagingIndex = Join-Path $paths.ProdStagingDir 'frontend\index.html'
    if (-not (Test-Path $stagingIndex)) {
      throw 'staging frontend/index.html nao encontrado apos build:prod.'
    }
  }

  if ($plan.BuildBE) {
    Invoke-NpmStep -Label 'Build backend (tsc -> backend/dist)' -NpmArgs @('run', 'build:deploy', '--prefix', 'backend')
    if (-not (Test-Path $paths.DevApiEntry)) {
      throw 'backend/dist/index.js nao encontrado apos build.'
    }
    Stage-BackendArtifacts -Paths $paths
  } elseif (-not (Test-Path $paths.ProdApiEntry)) {
    throw 'backend prod-artifacts ausente. Rode deploy completo ou -BackendOnly primeiro.'
  }

  if ($plan.Migrate) {
    Invoke-NpmStep -Label 'Migrations (producao)' -NpmArgs @('run', 'db:migrate:prod')
  }

  if ($plan.Backfill) {
    Invoke-NpmStep -Label 'Backfill ClienteEstatisticas (producao)' -NpmArgs @('run', 'db:backfill-cliente-stats:prod', '--prefix', 'backend')
  }

  if ($plan.Publish) {
    Write-Host ''
    Write-Host 'Liberando artefatos (parando API e alert poller)...' -ForegroundColor Cyan
    foreach ($target in @(Get-DeployProcessTargets)) {
      Stop-ProcessById -ProcessId $target.ProcessId -Label $target.Label
    }
    Remove-Item $paths.ApiPidFile -Force -ErrorAction SilentlyContinue
    Remove-Item $paths.AlertPollerPidFile -Force -ErrorAction SilentlyContinue

    foreach ($port in @($paths.ApiPort, $paths.AlertPollerHealthPort)) {
      if ($port -and (Test-PortListening -Port $port)) {
        $stalePid = Get-PortListenerPid -Port $port
        throw "Porta $port continua em uso (PID $stalePid) apos encerrar os processos."
      }
    }
    Start-Sleep -Seconds 1

    Write-Host 'Publicando artefatos de producao...' -ForegroundColor Cyan
    Publish-ProdArtifactsSwap -Paths $paths -Frontend:$buildFrontend -Backend:$buildBackend
    Write-ProdManifest -Paths $paths -DeployMeta @{
      frontendOnly = [bool]$FrontendOnly
      backendOnly  = [bool]$BackendOnly
      skipBackup   = [bool]$SkipBackup
      skipMigrate  = [bool]$SkipMigrate
    }
  }

  $artifactErrors = Test-ProdArtifactsReady -Paths $paths
  if ($artifactErrors.Count -gt 0) {
    throw ($artifactErrors -join '; ')
  }

  Write-Host ''
  Write-Host 'Reiniciando API...' -ForegroundColor Cyan
  & "$PSScriptRoot\restart-api.ps1" -Quiet
  if ($LASTEXITCODE -ne 0) { throw 'Restart da API falhou.' }

  Write-Host ''
  Write-Host 'Smoke test...' -ForegroundColor Cyan
  $readyOk = Test-ApiHealthy -HealthUrl $paths.ReadyUrl -Retries 5
  $frontendOk = Test-FrontendHealthy -FrontendUrl $paths.FrontendUrl -Retries 3

  Write-Host "  /api/ready : $(if ($readyOk) { 'OK' } else { 'FALHOU' })" -ForegroundColor $(if ($readyOk) { 'Green' } else { 'Red' })
  Write-Host "  /          : $(if ($frontendOk) { 'OK' } else { 'FALHOU' })" -ForegroundColor $(if ($frontendOk) { 'Green' } else { 'Red' })

  if (-not $readyOk -or -not $frontendOk) {
    Write-Host ''
    Write-Host "Deploy concluido com falha no smoke test. Veja $($paths.ApiErrLog)" -ForegroundColor Red
    $script:deployExit = 1
    return
  }

  Write-Host ''
  Write-Host 'Deploy concluido com sucesso.' -ForegroundColor Green
  Write-Host "  Local:  http://127.0.0.1:$($paths.ApiPort)"
  Write-Host '  Publico: https://tap.quivercloud.com.br'
  $script:deployExit = 0
}

# --------------------------------------------------------------------- fluxo

$transcriptStarted = $false
if ($LogFile) {
  try {
    Start-Transcript -Path $LogFile -Force | Out-Null
    $transcriptStarted = $true
  } catch {
    # Sem transcript o deploy continua; o pai apenas nao vera o log em tempo real.
  }
}

$deployExit = 1
try {
  Write-Host ''
  Write-Host 'Quiver Tap - Deploy de producao' -ForegroundColor Cyan
  Write-Host '================================' -ForegroundColor Cyan
  Write-Host "Projeto: $($paths.ProjectRoot)"
  Write-Host "Artefatos: $($paths.ProdArtifactsDir)"
  Write-Host "API:     http://127.0.0.1:$($paths.ApiPort)"
  Write-Host "Publico: https://tap.quivercloud.com.br"
  Write-Host ''
  Write-Host 'Plano:' -ForegroundColor Cyan
  foreach ($step in $plan.Keys) {
    Write-Host "  $step : $(if ($plan[$step]) { 'SIM' } else { 'nao' })"
  }
  Write-Host ''

  $preflight = Invoke-DeployPreflight

  if (-not $preflight.Ok) {
    Write-Host 'Preflight bloqueou o deploy (nada foi alterado):' -ForegroundColor Red
    foreach ($blocker in $preflight.Blockers) {
      Write-Host "  - $blocker" -ForegroundColor Red
    }
    $deployExit = 1
  } elseif ($PreflightOnly) {
    Write-Host 'Preflight OK. Deploy pode rodar.' -ForegroundColor Green
    if ($preflight.NeedsElevation) {
      Write-Host 'O deploy pedira elevacao (UAC) para encerrar a API.' -ForegroundColor Yellow
    }
    $deployExit = 0
  } elseif ($DryRun) {
    Write-Host 'Dry-run: nenhuma acao executada.' -ForegroundColor Yellow
    if ($preflight.NeedsElevation) {
      Write-Host 'O deploy real pedira elevacao (UAC) para encerrar a API.' -ForegroundColor Yellow
    }
    Write-Host 'Para deploy real: npm run prod:deploy -- -Confirmed'
    $deployExit = 0
  } else {
    if (-not $Confirmed) {
      Write-Host 'ATENCAO: isto altera PRODUCAO (banco cervejaria, porta 3001).' -ForegroundColor Yellow
      $answer = Read-Host 'Digite DEPLOY para continuar'
      if ($answer -ne 'DEPLOY') {
        Write-Host 'Deploy cancelado.' -ForegroundColor Yellow
        $deployExit = 1
        throw [System.OperationCanceledException]::new('cancelado pelo usuario')
      }
      $Confirmed = $true
    }

    if ($preflight.NeedsElevation) {
      if ($NoElevate) {
        throw 'Sem permissao para encerrar a API e -NoElevate ativo. Rode em PowerShell como Administrador.'
      }
      Invoke-SelfElevatedDeploy
    } else {
      Set-DeployPause -Paths $paths -Reason 'prod:deploy'
      Invoke-DeployBody
    }
  }
} catch [System.OperationCanceledException] {
  $deployExit = 1
} catch {
  Write-Host ''
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host 'Deploy abortado. Verifique npm run prod:status' -ForegroundColor Yellow
  $deployExit = 1
} finally {
  Clear-DeployPause -Paths $paths

  # Watchdog de volta no ar mesmo em falha: se o deploy abortou, ele recupera a release anterior.
  if (-not $DryRun -and -not $PreflightOnly -and $Confirmed) {
    $watchdogPid = Get-PidFromFile -PidFile $watchdogPidFile
    if (-not (Test-ProcessAlive -ProcessId $watchdogPid)) {
      Write-Host ''
      Write-Host 'Reativando watchdog daemon...' -ForegroundColor Cyan
      & "$PSScriptRoot\start-watchdog-daemon.ps1" -Quiet
    }
  }

  if ($ExitCodeFile) {
    Set-Content -Path $ExitCodeFile -Value ([string]$deployExit) -Encoding ASCII
  }
  if ($transcriptStarted) {
    Stop-Transcript | Out-Null
  }
}

# Quando houve auto-elevacao, o processo filho ja imprimiu o status: nao repete aqui.
$ranLocally = ($null -ne $preflight) -and -not $preflight.NeedsElevation
if ($deployExit -eq 0 -and -not $DryRun -and -not $PreflightOnly -and $ranLocally) {
  Write-Host ''
  & "$PSScriptRoot\status.ps1"
}

exit $deployExit
