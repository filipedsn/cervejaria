$ErrorActionPreference = 'Stop'

$deployScript = Join-Path $PSScriptRoot 'deploy.ps1'
$configScript = Join-Path $PSScriptRoot '_config.ps1'
$clearRecoveryScript = Join-Path $PSScriptRoot 'clear-deploy-recovery.ps1'
$rollbackScript = Join-Path $PSScriptRoot 'rollback.ps1'
$deploySource = Get-Content $deployScript -Raw
$clearRecoverySource = Get-Content $clearRecoveryScript -Raw
$rollbackSource = Get-Content $rollbackScript -Raw

# As funcoes de pausa nao executam deploy nem acessam banco quando carregadas.
. $configScript

Describe 'Contrato seguro do deploy de producao' {
  It 'tem sintaxe PowerShell valida sem executar deploy ou recovery' {
    foreach ($source in @($deploySource, $clearRecoverySource, $rollbackSource)) {
      $tokens = $null
      $errors = $null
      [void][System.Management.Automation.Language.Parser]::ParseInput(
        $source,
        [ref]$tokens,
        [ref]$errors
      )
      $errors.Count | Should Be 0
    }
  }

  It 'valida backup e staging antes de parar consumidores do banco' {
    $bodyStart = $deploySource.IndexOf('function Invoke-DeployBody')
    $backup = $deploySource.IndexOf('& "$PSScriptRoot\backup-db.ps1"', $bodyStart)
    $stageBackend = $deploySource.IndexOf('Stage-BackendArtifacts -Paths $paths', $bodyStart)
    $stop = $deploySource.IndexOf('Stop-ProductionDatabaseConsumers', $bodyStart)

    $backup | Should BeGreaterThan $bodyStart
    $stageBackend | Should BeGreaterThan $backup
    $stop | Should BeGreaterThan $stageBackend
  }

  It 'para consumidores antes de iniciar migration e so publica depois dela' {
    $bodyStart = $deploySource.IndexOf('function Invoke-DeployBody')
    $stop = $deploySource.IndexOf('Stop-ProductionDatabaseConsumers', $bodyStart)
    $migrationStarted = $deploySource.IndexOf('$script:databaseTransitionStarted = $true', $bodyStart)
    $migrate = $deploySource.IndexOf("Invoke-NpmStep -Label 'Migrations (producao)'", $bodyStart)
    $publish = $deploySource.IndexOf('Publish-ProdArtifactsSwap -Paths $paths', $bodyStart)

    $migrationStarted | Should BeGreaterThan $stop
    $migrate | Should BeGreaterThan $migrationStarted
    $publish | Should BeGreaterThan $migrate
  }

  It 'mantem o deploy.pause apos falha iniciada na transicao de banco' {
    $runtimeDir = Join-Path $TestDrive 'runtime'
    New-Item -ItemType Directory -Path $runtimeDir | Out-Null
    $paths = @{ RuntimeDir = $runtimeDir }

    Set-DeployPause -Paths $paths -Reason 'falha de teste' -ManualInterventionRequired
    $pauseFile = Get-DeployPauseFile -Paths $paths
    $data = Get-Content $pauseFile -Raw | ConvertFrom-Json
    $data.pid = 999999
    $data | ConvertTo-Json -Compress | Set-Content -Path $pauseFile -Encoding UTF8

    (Test-DeployPaused -Paths $paths -MaxAgeMinutes 0) | Should Be $true
    Clear-DeployPause -Paths $paths
  }

  It 'declara bloqueio manual e nao introduz rollback automatico de banco' {
    $deploySource | Should Match 'PRODUCAO EM ESTADO DE RECUPERACAO MANUAL'
    $deploySource | Should Match 'Write-DeployRecoveryState'
    $deploySource | Should Match 'ManualInterventionRequired'
    $deploySource | Should Not Match 'migrate reset|pg_restore|psql.*restore'
  }

  It 'registra fases suficientes somente apos transicao de banco' {
    foreach ($phase in @('PRE_MIGRATION', 'MIGRATION_STARTED', 'MIGRATION_COMPLETED', 'BACKFILL_STARTED', 'BACKFILL_COMPLETED', 'SWAP_STARTED', 'SWAP_COMPLETED', 'START_FAILED', 'SMOKE_FAILED')) {
      $deploySource | Should Match $phase
    }
    $deploySource | Should Match '\$manualInterventionRequired = \$script:databaseTransitionStarted -and \$deployExit -ne 0'
  }

  It 'exige confirmacao explicita para liberar recovery sem iniciar a API' {
    $clearRecoverySource | Should Match 'LIBERAR-WATCHDOG-APOS-VALIDACAO'
    $clearRecoverySource | Should Match 'Remove-Item \$recoveryFile'
    $clearRecoverySource | Should Not Match 'start-api\.ps1|restart-api\.ps1|pg_restore|prisma migrate'
  }

  It 'mantem ledger atomico, limitado e sem sobrescrever arquivo corrompido' {
    $runtimeDir = Join-Path $TestDrive 'runtime'
    $paths = @{ RuntimeDir = $runtimeDir }
    1..52 | ForEach-Object {
      Add-ReleaseHistoryEvent -Paths $paths -Event @{ id = "deploy-$_"; type = 'DEPLOY'; result = 'SUCCESS' } | Should Be $true
    }
    $history = Get-Content (Get-ReleaseHistoryFile -Paths $paths) -Raw | ConvertFrom-Json
    $history.events.Count | Should Be 50
    $history.events[0].id | Should Be 'deploy-3'

    Set-Content (Get-ReleaseHistoryFile -Paths $paths) -Value '{invalido' -Encoding UTF8
    Add-ReleaseHistoryEvent -Paths $paths -Event @{ id = 'nao-gravar'; type = 'DEPLOY' } | Should Be $false
    (Get-Content (Get-ReleaseHistoryFile -Paths $paths) -Raw) | Should Match 'invalido'
  }

  It 'integra eventos de deploy sem alterar o contrato de recovery' {
    $deploySource | Should Match 'Write-DeployLedgerEvent'
    $deploySource | Should Match "'RECOVERY_REQUIRED'"
    $deploySource | Should Match 'Write-DeployRecoveryState'
  }

  It 'integra rollback com origem, destino, duracao e smoke no ledger' {
    $rollbackSource | Should Match 'Add-ReleaseHistoryEvent'
    $rollbackSource | Should Match 'removedGitSha'
    $rollbackSource | Should Match 'restoredGitSha'
    $rollbackSource | Should Match 'durationSeconds'
    $rollbackSource | Should Match 'rollbackSmoke'
  }
}
