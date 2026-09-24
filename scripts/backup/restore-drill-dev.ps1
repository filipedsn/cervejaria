param([Parameter(Mandatory=$true)][string]$BackupFile)
$ErrorActionPreference='Stop'
$container='cervejaria-db-dev'
$name='cervejaria_restore_drill_dev_{0}' -f (Get-Date -Format 'yyyyMMdd_HHmmss')
$resolved=(Resolve-Path -LiteralPath $BackupFile).Path
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
  [pscustomobject]@{ result='PASS'; targetDatabase=$name; backup=(Split-Path $resolved -Leaf); databaseRemoved=$true } | ConvertTo-Json -Compress
} finally {
  docker exec $container rm -f $remote 2>$null | Out-Null
  docker exec $container psql -X -v ON_ERROR_STOP=1 -U cervejaria -d postgres -c "DROP DATABASE IF EXISTS $name;" 2>$null | Out-Null
}
