# Executa um drill de restore em banco PostgreSQL temporario. Nunca restaura em PROD/DEV.

param(
  [Parameter(Mandatory = $true)]
  [string]$BackupFile,

  [Parameter(Mandatory = $true)]
  [string]$TargetDatabase,

  [switch]$KeepDatabase,

  [string]$ReportFile = ''
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"

$startedAt = (Get-Date).ToUniversalTime()
$container = 'cervejaria-db'
$containerDump = ''
$databaseRemoved = $false
$validation = [ordered]@{}

function Assert-SafeTargetDatabase {
  param([string]$Name)

  $blocked = @('cervejaria', 'cervejaria_dev')
  if ($blocked -contains $Name.ToLowerInvariant()) {
    throw "Banco destino bloqueado: $Name. O drill exige um banco temporario dedicado."
  }
  if ($Name -notmatch '^cervejaria_restore_drill_[0-9]{8}_[0-9]{6}$') {
    throw 'Nome do banco invalido. Use cervejaria_restore_drill_yyyyMMdd_HHmmss.'
  }
}

function Invoke-Docker {
  param([string[]]$Arguments, [string]$FailureMessage)

  & docker @Arguments
  if ($LASTEXITCODE -ne 0) { throw $FailureMessage }
}

function Invoke-PsqlScalar {
  param([string]$Database, [string]$Sql)

  # Encodar a consulta evita que o encaminhamento PowerShell -> docker.exe remova
  # aspas duplas de identificadores PostgreSQL com maiusculas.
  $encodedSql = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($Sql))
  $command = "echo $encodedSql | base64 -d | psql -X -q -t -A -v ON_ERROR_STOP=1 -U cervejaria -d $Database"
  $raw = & docker exec $container sh -c $command 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Consulta de validacao falhou: $($raw | Out-String)"
  }
  return ($raw | Out-String).Trim()
}

function ConvertTo-DrillDatabaseUrl {
  param([string]$ProductionUrl, [string]$DatabaseName)

  $uri = [System.Uri]$ProductionUrl
  $builder = [System.UriBuilder]::new($uri)
  $builder.Path = "/$DatabaseName"
  return $builder.Uri.AbsoluteUri
}

function Remove-DrillDatabase {
  param([string]$Name)

  $terminateSql = "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$Name' AND pid <> pg_backend_pid();"
  Invoke-Docker -Arguments @('exec', $container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'cervejaria', '-d', 'postgres', '-c', $terminateSql) -FailureMessage "Falha ao encerrar conexoes do banco temporario $Name."
  Invoke-Docker -Arguments @('exec', $container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'cervejaria', '-d', 'postgres', '-c', "DROP DATABASE IF EXISTS $Name;") -FailureMessage "Falha ao remover o banco temporario $Name."
}

try {
  Assert-SafeTargetDatabase -Name $TargetDatabase

  $resolvedBackup = (Resolve-Path -LiteralPath $BackupFile -ErrorAction Stop).Path
  $backupItem = Get-Item -LiteralPath $resolvedBackup
  if ($backupItem.Length -le 0) { throw 'Arquivo de backup vazio.' }
  $header = Get-Content -LiteralPath $resolvedBackup -TotalCount 8 -Encoding UTF8 | Out-String
  if ($header -notmatch 'PostgreSQL database dump') {
    throw 'Formato nao suportado por este drill: esperado dump SQL texto do pg_dump. Use pg_restore para formato custom/tar.'
  }

  $settings = Get-QuiverTapSettings
  $paths = Resolve-QuiverTapPaths -Settings $settings
  Import-BackendEnvFile -BackendDir $paths.BackendDir -Environment production
  $drillDatabaseUrl = ConvertTo-DrillDatabaseUrl -ProductionUrl $env:DATABASE_URL -DatabaseName $TargetDatabase
  $applicationDbUser = [System.Uri]$env:DATABASE_URL
  $applicationDbUser = [System.Uri]::UnescapeDataString($applicationDbUser.UserInfo.Split(':')[0])
  if ($applicationDbUser -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
    throw 'Nome do papel da aplicacao invalido para o drill.'
  }

  $running = & docker ps --filter "name=^/$container$" --filter 'status=running' --format '{{.Names}}' 2>$null
  if ($LASTEXITCODE -ne 0 -or $running -ne $container) {
    throw "Container $container nao esta rodando."
  }

  # O dump precisa pertencer ao mesmo papel usado pela API; caso contrario um restore
  # aparentemente valido pode falhar ao primeiro acesso do Prisma.
  $roleReady = & docker exec $container psql -X -q -t -A -U $applicationDbUser -d postgres -c 'SELECT 1;' 2>$null
  if ($LASTEXITCODE -ne 0 -or ($roleReady | Out-String).Trim() -ne '1') {
    throw 'O papel de banco da API nao conseguiu conectar ao PostgreSQL; interrompendo antes de criar o banco temporario.'
  }

  $exists = Invoke-PsqlScalar -Database 'postgres' -Sql "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = '$TargetDatabase');"
  if ($exists -ne 'f') { throw "Banco temporario ja existe: $TargetDatabase. Escolha outro timestamp; o script nao reutiliza bancos." }

  Invoke-Docker -Arguments @('exec', $container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'cervejaria', '-d', 'postgres', '-c', "CREATE DATABASE $TargetDatabase OWNER $applicationDbUser;") -FailureMessage 'Falha ao criar o banco temporario.'

  $containerDump = "/tmp/$([System.IO.Path]::GetFileName($resolvedBackup))"
  Invoke-Docker -Arguments @('cp', $resolvedBackup, "${container}:$containerDump") -FailureMessage 'Falha ao copiar o backup para o container PostgreSQL.'

  $restoreStartedAt = (Get-Date).ToUniversalTime()
  Invoke-Docker -Arguments @('exec', $container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', $applicationDbUser, '-d', $TargetDatabase, '-f', $containerDump) -FailureMessage 'Restore falhou. O banco temporario foi preservado para diagnostico; nao houve alteracao em PROD.'
  $restoreFinishedAt = (Get-Date).ToUniversalTime()

  $validation.connection = (Invoke-PsqlScalar -Database $TargetDatabase -Sql 'SELECT 1;') -eq '1'
  $schemas = Invoke-PsqlScalar -Database $TargetDatabase -Sql "SELECT string_agg(schema_name, ',') FROM information_schema.schemata WHERE schema_name IN ('public', 'quiosque');"
  $validation.schemas = $schemas
  if ($schemas -notmatch 'public' -or $schemas -notmatch 'quiosque') { throw "Schemas esperados ausentes: $schemas" }

  $validation.migrationsRestored = [int](Invoke-PsqlScalar -Database $TargetDatabase -Sql 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;')
  $expectedMigrations = (Get-ChildItem (Join-Path $PSScriptRoot '..\..\backend\prisma\migrations') -Directory).Count
  $validation.migrationsExpected = $expectedMigrations

  $tables = [ordered]@{
    Cervejaria = @{ schema = 'public'; table = 'Cervejaria' }
    Usuario = @{ schema = 'public'; table = 'Usuario' }
    Evento = @{ schema = 'public'; table = 'Evento' }
    Comanda = @{ schema = 'public'; table = 'Comanda' }
    Cliente = @{ schema = 'public'; table = 'Cliente' }
    Produto = @{ schema = 'public'; table = 'Produto' }
    SessaoCaixaQuiosque = @{ schema = 'quiosque'; table = 'SessaoCaixaQuiosque' }
  }
  $validation.tables = [ordered]@{}
  foreach ($entry in $tables.GetEnumerator()) {
    $schema = $entry.Value.schema
    $table = $entry.Value.table
    $present = Invoke-PsqlScalar -Database $TargetDatabase -Sql "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '$schema' AND table_name = '$table');"
    $validation.tables[$entry.Key] = ($present -eq 't')
    if ($present -ne 't') { throw "Tabela principal ausente: $($entry.Key)" }
  }

  $validation.counts = [ordered]@{
    cervejarias = [int](Invoke-PsqlScalar -Database $TargetDatabase -Sql 'SELECT count(*) FROM "Cervejaria";')
    usuarios = [int](Invoke-PsqlScalar -Database $TargetDatabase -Sql 'SELECT count(*) FROM "Usuario";')
    eventos = [int](Invoke-PsqlScalar -Database $TargetDatabase -Sql 'SELECT count(*) FROM "Evento";')
    comandas = [int](Invoke-PsqlScalar -Database $TargetDatabase -Sql 'SELECT count(*) FROM "Comanda";')
    clientes = [int](Invoke-PsqlScalar -Database $TargetDatabase -Sql 'SELECT count(*) FROM "Cliente";')
    produtos = [int](Invoke-PsqlScalar -Database $TargetDatabase -Sql 'SELECT count(*) FROM "Produto";')
    sessoesCaixa = [int](Invoke-PsqlScalar -Database $TargetDatabase -Sql 'SELECT count(*) FROM quiosque."SessaoCaixaQuiosque";')
  }

  $env:DATABASE_URL = $drillDatabaseUrl
  Push-Location $paths.BackendDir
  try {
    & npx.cmd prisma migrate status
    if ($LASTEXITCODE -ne 0) { throw 'prisma migrate status falhou no banco restaurado.' }
    & npx.cmd prisma validate
    if ($LASTEXITCODE -ne 0) { throw 'prisma validate falhou.' }
  } finally {
    Pop-Location
  }

  if (-not $KeepDatabase) {
    Remove-DrillDatabase -Name $TargetDatabase
    $databaseRemoved = $true
  }

  $finishedAt = (Get-Date).ToUniversalTime()
  $report = [ordered]@{
    result = 'PASS'
    backup = [ordered]@{
      file = (Split-Path $resolvedBackup -Leaf)
      sha256 = (Get-FileHash -LiteralPath $resolvedBackup -Algorithm SHA256).Hash
      bytes = $backupItem.Length
      modifiedAtUtc = $backupItem.LastWriteTimeUtc.ToString('o')
      format = 'plain SQL (pg_dump)'
    }
    targetDatabase = $TargetDatabase
    startedAtUtc = $startedAt.ToString('o')
    restoreStartedAtUtc = $restoreStartedAt.ToString('o')
    restoreFinishedAtUtc = $restoreFinishedAt.ToString('o')
    restoreDurationSeconds = [math]::Round(($restoreFinishedAt - $restoreStartedAt).TotalSeconds, 3)
    totalDurationSeconds = [math]::Round(($finishedAt - $startedAt).TotalSeconds, 3)
    validation = $validation
    apiTemporaryTested = $false
    databaseRemoved = $databaseRemoved
  }
  if (-not $ReportFile) {
    $ReportFile = Join-Path $paths.ProjectRoot "deploy\restore-drills\restore-drill-$($startedAt.ToString('yyyyMMdd-HHmmss')).json"
  }
  $reportDir = Split-Path $ReportFile -Parent
  New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
  $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReportFile -Encoding UTF8

  Write-Host "RESTORE DRILL PASS: $TargetDatabase" -ForegroundColor Green
  Write-Host "Restore: $($report.restoreDurationSeconds)s | Relatorio: $ReportFile" -ForegroundColor Green
} finally {
  if ($containerDump) { & docker exec $container rm -f $containerDump 2>$null | Out-Null }
}
