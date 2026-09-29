$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'restore-drill-migration-status.ps1')

$migrationNames = @(
  '20260924120000_expand_canonical_product',
  '20260924183000_canonical_product_runtime',
  '20260928150000_first_access_operational_setup'
)
$pendingOutput = @'
Datasource "db": PostgreSQL database

3 migrations found in prisma/migrations
Following migrations have not yet been applied:
20260924183000_canonical_product_runtime
20260928150000_first_access_operational_setup

To apply migrations in development run prisma migrate dev.
'@

Describe 'Restore drill migration history' {
  It 'aceita somente a lista exata de migrations futuras no dump pre-cutover' {
    $state = Get-ValidatedRestoreDrillMigrationStatus `
      -StatusOutput $pendingOutput `
      -ExitCode 1 `
      -MigrationsOnDisk $migrationNames `
      -AppliedMigrations @('20260924120000_expand_canonical_product') `
      -FailedMigrations 0

    $state.State | Should Be 'EXPECTED_PENDING'
    $state.AppliedCount | Should Be 1
    $state.PendingNames.Count | Should Be 2
  }

  It 'aceita banco no nivel da versao quando todas as migrations estao aplicadas' {
    $state = Get-ValidatedRestoreDrillMigrationStatus `
      -StatusOutput 'All migrations have been successfully applied.' `
      -ExitCode 0 `
      -MigrationsOnDisk $migrationNames `
      -AppliedMigrations $migrationNames `
      -FailedMigrations 0

    $state.State | Should Be 'UP_TO_DATE'
    $state.PendingNames.Count | Should Be 0
  }

  It 'rejeita lista pendente diferente do candidato' {
    {
      Get-ValidatedRestoreDrillMigrationStatus `
        -StatusOutput ($pendingOutput -replace '20260928150000_first_access_operational_setup', '20260927150000_removed_migration') `
        -ExitCode 1 `
        -MigrationsOnDisk $migrationNames `
        -AppliedMigrations @('20260924120000_expand_canonical_product') `
        -FailedMigrations 0
    } | Should Throw
  }

  It 'rejeita historico desconhecido e migration incompleta' {
    {
      Get-ValidatedRestoreDrillMigrationStatus `
        -StatusOutput $pendingOutput `
        -ExitCode 1 `
        -MigrationsOnDisk $migrationNames `
        -AppliedMigrations @('migration_fora_do_candidato') `
        -FailedMigrations 0
    } | Should Throw

    {
      Get-ValidatedRestoreDrillMigrationStatus `
        -StatusOutput $pendingOutput `
        -ExitCode 1 `
        -MigrationsOnDisk $migrationNames `
        -AppliedMigrations @('20260924120000_expand_canonical_product') `
        -FailedMigrations 1
    } | Should Throw
  }

  It 'rejeita status de erro sem lista exata de migrations pendentes' {
    {
      Get-ValidatedRestoreDrillMigrationStatus `
        -StatusOutput 'Error: schema drift detected.' `
        -ExitCode 1 `
        -MigrationsOnDisk $migrationNames `
        -AppliedMigrations @('20260924120000_expand_canonical_product') `
        -FailedMigrations 0
    } | Should Throw
  }

  It 'mantem o script do drill sintaticamente valido' {
    $source = Get-Content (Join-Path $PSScriptRoot 'restore-drill.ps1') -Raw
    $tokens = $null
    $errors = $null
    [void][System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)
    $errors.Count | Should Be 0
  }
}
