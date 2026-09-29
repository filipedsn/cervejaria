function Get-ValidatedRestoreDrillMigrationStatus {
  param(
    [Parameter(Mandatory = $true)]
    [string]$StatusOutput,

    [Parameter(Mandatory = $true)]
    [int]$ExitCode,

    [Parameter(Mandatory = $true)]
    [string[]]$MigrationsOnDisk,

    [Parameter(Mandatory = $true)]
    [string[]]$AppliedMigrations,

    [Parameter(Mandatory = $true)]
    [int]$FailedMigrations
  )

  if ($FailedMigrations -gt 0) {
    throw "O banco restaurado possui $FailedMigrations migration(s) sem conclusao nem rollback."
  }

  $diskNames = @($MigrationsOnDisk | Where-Object { $_ } | Sort-Object -Unique)
  $appliedNames = @($AppliedMigrations | Where-Object { $_ } | Sort-Object -Unique)
  $unknownApplied = @($appliedNames | Where-Object { $diskNames -notcontains $_ })
  if ($unknownApplied.Count -gt 0) {
    throw 'O historico restaurado contem migrations que nao existem no codigo candidato.'
  }

  $expectedPending = @($diskNames | Where-Object { $appliedNames -notcontains $_ })
  $marker = 'Following migrations have not yet been applied:'
  $hasPendingList = $StatusOutput.Contains($marker)

  if ($hasPendingList) {
    $pendingSection = ($StatusOutput -split [regex]::Escape($marker), 2)[1]
    $reportedPending = @(
      foreach ($line in ($pendingSection -split "`r?`n")) {
        $name = $line.Trim()
        if ($name -match '^\d{14}_[A-Za-z0-9_-]+$') { $name }
      }
    )
    $reportedPending = @($reportedPending | Sort-Object -Unique)

    if ($ExitCode -eq 0 -or $expectedPending.Count -eq 0 -or $reportedPending.Count -eq 0) {
      throw 'O migrate status informou migrations pendentes em um estado inesperado.'
    }
    if ($reportedPending.Count -ne $expectedPending.Count -or
      @($reportedPending | Where-Object { $expectedPending -notcontains $_ }).Count -gt 0) {
      throw 'As migrations pendentes informadas pelo Prisma nao correspondem exatamente ao codigo candidato.'
    }

    return [pscustomobject]@{
      State         = 'EXPECTED_PENDING'
      AppliedCount  = $appliedNames.Count
      PendingNames  = $expectedPending
      FailedCount   = $FailedMigrations
    }
  }

  if ($ExitCode -ne 0) {
    throw 'prisma migrate status falhou sem indicar somente migrations pendentes esperadas.'
  }
  if ($expectedPending.Count -gt 0) {
    throw 'O Prisma nao informou a lista completa de migrations pendentes esperadas.'
  }

  return [pscustomobject]@{
    State         = 'UP_TO_DATE'
    AppliedCount  = $appliedNames.Count
    PendingNames  = @()
    FailedCount   = $FailedMigrations
  }
}
