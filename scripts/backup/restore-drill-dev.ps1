param([Parameter(Mandatory=$true)][string]$BackupFile,[string]$ProofFile='')
$ErrorActionPreference='Stop'
$container='cervejaria-db-dev'
$name='cervejaria_restore_drill_dev_{0}' -f (Get-Date -Format 'yyyyMMdd_HHmmss')
$resolved=(Resolve-Path -LiteralPath $BackupFile).Path
$backupSha256=(Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash.ToLowerInvariant()
$repoRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $PSScriptRoot 'restore-drill-dev.helpers.ps1')
$remote="/tmp/$([IO.Path]::GetFileName($resolved))"
try {
  if ((Get-Item $resolved).Length -le 0) { throw 'Backup vazio.' }
  if ($ProofFile -and (Test-Path -LiteralPath $ProofFile)) { throw 'A prova de restore já existe; inspecione-a antes de substituí-la.' }
  docker exec $container psql -X -v ON_ERROR_STOP=1 -U cervejaria -d postgres -c "CREATE DATABASE $name OWNER cervejaria;"
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao criar banco temporario.' }
  docker cp $resolved "${container}:$remote"
  docker exec $container psql -X -v ON_ERROR_STOP=1 -U cervejaria -d $name -f $remote
  if ($LASTEXITCODE -ne 0) { throw 'Restore falhou.' }
  $check = docker exec $container psql -X -q -t -A -v ON_ERROR_STOP=1 -U cervejaria -d $name -c "SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema='public') > 0 AND (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL) >= 0;"
  if ($LASTEXITCODE -ne 0 -or (($check | Out-String).Trim() -ne 't')) { throw 'Validacao de schema falhou.' }
  $ledgerText = docker exec $container psql -X -q -t -A -F '|' -v ON_ERROR_STOP=1 -U cervejaria -d $name -c "SELECT migration_name, checksum, (finished_at IS NOT NULL), (rolled_back_at IS NOT NULL) FROM public._prisma_migrations ORDER BY migration_name;"
  if ($LASTEXITCODE -ne 0) { throw 'Consulta do ledger de migrations falhou.' }
  $ledgerRows = @($ledgerText | ForEach-Object { ($_ | Out-String).Trim() } | Where-Object { $_ } | ForEach-Object {
    $parts = $_ -split '\|', 4
    if ($parts.Count -ne 4) { throw 'Formato inesperado no ledger de migrations restaurado.' }
    [pscustomobject]@{ migration_name=$parts[0]; checksum=$parts[1]; finished=($parts[2] -eq 't'); rolled_back=($parts[3] -eq 't') }
  })
  $revision=(git -C $repoRoot rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Git revision lookup failed.' }
  $ledgerValidation=Invoke-DevMigrationLedgerValidation -RepositoryPath $repoRoot -Revision $revision -LedgerRows $ledgerRows
  $probeOutput = & node (Join-Path $repoRoot 'backend\scripts\pdv-unico-dev-cutover-restore-probe.mjs') "--database=$name" "--revision=$revision" --through=20261004150000_pdv_finance_session_link
  $probeExit=$LASTEXITCODE
  $probeLine=@($probeOutput | ForEach-Object { $_.ToString() } | Where-Object { $_.Trim() } | Select-Object -Last 1)
  if (-not $probeLine) { throw "Prisma migration application probe produced no JSON result (exit $probeExit)." }
  $applicationProbe=$probeLine[0] | ConvertFrom-Json
  if ($probeExit -ne 0 -or $applicationProbe.status -ne 'PASS') { throw "Prisma migration application probe blocked: $($applicationProbe | ConvertTo-Json -Depth 8 -Compress)" }
  $proof = [ordered]@{
    status='PASS'; sourceEnvironment='development'; sourceDatabase='cervejaria_dev'; backupSha256=$backupSha256
    recoveryDatabase=$name; schemaValidation='PASS'; migrationLedgerValidation='PASS'; migrationApplicationValidation='PASS'
    migrationAppliedCount=$ledgerValidation.appliedCount; migrationLedgerRowCount=$ledgerValidation.ledgerRowCount
    checksumMatches=$ledgerValidation.checksumMatches; applicationProbe=$applicationProbe; reviewedRevision=$revision
    completedAtUtc=[DateTime]::UtcNow.ToString('o')
  }
  if ($ProofFile) {
    $proofPath=[IO.Path]::GetFullPath($ProofFile)
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $proofPath) | Out-Null
    [IO.File]::WriteAllText($proofPath, ($proof | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    $proof['proofFile']=$proofPath
  }
  $proof | ConvertTo-Json -Compress
} finally {
  docker exec $container rm -f $remote 2>$null | Out-Null
  docker exec $container psql -X -v ON_ERROR_STOP=1 -U cervejaria -d postgres -c "DROP DATABASE IF EXISTS $name;" 2>$null | Out-Null
}
