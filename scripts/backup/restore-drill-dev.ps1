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
  docker exec $container psql -X -v ON_ERROR_STOP=1 -U cervejaria -d postgres -c "CREATE DATABASE $name OWNER cervejaria;"
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao criar banco temporario.' }
  docker cp $resolved "${container}:$remote"
  docker exec $container psql -X -v ON_ERROR_STOP=1 -U cervejaria -d $name -f $remote
  if ($LASTEXITCODE -ne 0) { throw 'Restore falhou.' }
  $check = docker exec $container psql -X -q -t -A -v ON_ERROR_STOP=1 -U cervejaria -d $name -c "SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema='public') > 0 AND (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL) >= 0;"
  if ($LASTEXITCODE -ne 0 -or (($check | Out-String).Trim() -ne 't')) { throw 'Validacao de schema falhou.' }
  $known = @{}
  $migrationRoot = Join-Path $repoRoot 'backend\prisma\migrations'
  $migrationNames = @(Get-ChildItem -LiteralPath $migrationRoot -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'migration.sql') } | Sort-Object Name | ForEach-Object { $_.Name })
  $trackedGitPaths = @(git -C $repoRoot ls-tree -r --name-only HEAD -- backend/prisma/migrations)
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao consultar migrations versionadas no Git HEAD.' }
  $trackedMigrationPathSet = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  foreach ($trackedGitPath in $trackedGitPaths) { [void]$trackedMigrationPathSet.Add($trackedGitPath) }
  $trackedMigrationNames = @()
  foreach ($migration in $migrationNames) {
    $migrationFile = Join-Path $migrationRoot "$migration\migration.sql"
    $gitPath = "backend/prisma/migrations/$migration/migration.sql"
    if (-not $trackedMigrationPathSet.Contains($gitPath)) { continue }
    $reviewedBlob = git -C $repoRoot rev-parse "HEAD:$gitPath"
    if ($LASTEXITCODE -ne 0) { throw "Git revision has no reviewed migration blob: $gitPath" }
    $workingBlob = git -C $repoRoot hash-object "--path=$gitPath" -- $migrationFile
    if ($LASTEXITCODE -ne 0 -or $workingBlob -ne $reviewedBlob) { throw "Migration file differs from current Git HEAD; restore drill stopped: $gitPath" }
    $known[$migration] = Get-GitBlobSha256 -RepositoryPath $repoRoot -BlobObjectId $reviewedBlob
    $trackedMigrationNames += $migration
  }
  $ledgerText = docker exec $container psql -X -q -t -A -F '|' -v ON_ERROR_STOP=1 -U cervejaria -d $name -c "SELECT migration_name, checksum, (finished_at IS NOT NULL), (rolled_back_at IS NOT NULL) FROM public._prisma_migrations ORDER BY migration_name;"
  if ($LASTEXITCODE -ne 0) { throw 'Consulta do ledger de migrations falhou.' }
  $applied = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  $ledgerRows = @($ledgerText | ForEach-Object { ($_ | Out-String).Trim() } | Where-Object { $_ } | ForEach-Object {
    $parts = $_ -split '\|', 4
    if ($parts.Count -ne 4) { throw 'Formato inesperado no ledger de migrations restaurado.' }
    $migration = $parts[0]
    if (-not $known.ContainsKey($migration)) { throw "Migration desconhecida no backup restaurado: $migration" }
    if ($parts[1].ToLowerInvariant() -ne $known[$migration]) { throw "Checksum divergente no backup restaurado: $migration" }
    if ($parts[2] -ne 't' -and $parts[3] -ne 't') { throw "Migration falhada ou incompleta no backup restaurado: $migration" }
    if ($parts[2] -eq 't' -and $parts[3] -ne 't') { [void]$applied.Add($migration) }
    [pscustomobject]@{ name=$migration; finished=($parts[2] -eq 't'); rolledBack=($parts[3] -eq 't') }
  })
  $gap=$false
  foreach ($migration in $trackedMigrationNames) {
    if (-not $applied.Contains($migration)) { $gap=$true }
    elseif ($gap) { throw "Ledger de migrations fora de ordem antes de $migration." }
  }
  $proof = [ordered]@{
    status='PASS'; sourceEnvironment='development'; sourceDatabase='cervejaria_dev'; backupSha256=$backupSha256
    recoveryDatabase=$name; schemaValidation='PASS'; migrationLedgerValidation='PASS'
    migrationAppliedCount=$applied.Count; migrationLedgerRowCount=$ledgerRows.Count; completedAtUtc=[DateTime]::UtcNow.ToString('o')
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
