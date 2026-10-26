# Copia o banco de PRD para o ambiente de testes (DEV) - TAP-129.
# Fluxo: backup na hora pela chave SSH restrita (forced command quiver-tap-prd-dump,
# so pg_dump para o stdout) -> confere o arquivo -> backup do banco DEV atual ->
# desliga o DEV -> recria cervejaria_dev e restaura -> desliga e-mail, push e links
# de PRD na copia -> migrations do codigo DEV -> liga o DEV -> apaga o arquivo de PRD.
# Nunca escreve no banco de PRD; o DEV continua sem conexao com o VPS. Se a
# restauracao falhar, o banco DEV volta ao backup feito no inicio.

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"
# PS 5.1 transforma stderr de comando nativo em erro fatal com 'Stop'; daqui em
# diante cada passo confere $LASTEXITCODE.
$ErrorActionPreference = 'Continue'
$OutputEncoding = [Text.UTF8Encoding]::new($false)

$paths = Get-DevPaths
$container = 'cervejaria-db-dev'
$database = 'cervejaria_dev'
$sshHost = if ($env:OPS_PRD_DUMP_SSH_HOST) { $env:OPS_PRD_DUMP_SSH_HOST } else { 'quiver-vps-dump' }
$backupDir = Join-Path $env:LOCALAPPDATA 'QuiverTap\dev-backups'
# Depois da primeira copia o backup do DEV tambem tem dados de clientes: guarda so o ultimo.
$keepBackups = 1
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$prdFile = Join-Path $env:TEMP "quiver-tap-prd-$stamp.dump"
$sshErr = Join-Path $env:TEMP "quiver-tap-prd-$stamp.err"
$devBackup = Join-Path $backupDir "dev-antes-copia-prd-$stamp.dump"
$prdInContainer = '/tmp/prd-copy.dump'
$devInContainer = '/tmp/dev-before.dump'

function Remove-PrdCopy {
  Remove-Item -LiteralPath $prdFile, $sshErr -Force -ErrorAction SilentlyContinue
  & docker exec $container rm -f $prdInContainer $devInContainer 2>$null | Out-Null
}

function Fail([string]$Message) {
  Remove-PrdCopy
  Write-DevLog -Paths $paths -Message "copy-prd-to-dev: $Message"
  [Console]::Error.WriteLine($Message)
  exit 1
}

# SQL vai pelo stdin: evita o PS 5.1 quebrar aspas de identificadores.
function Invoke-Sql([string]$Sql, [string]$Db = $database) {
  $out = $Sql | & docker exec -i $container sh -c "psql -q -v ON_ERROR_STOP=1 -At -U `$POSTGRES_USER -d $Db" 2>&1
  return @{ Code = $LASTEXITCODE; Out = ($out | ForEach-Object { "$_" }) }
}

function Reset-Database {
  $r = Invoke-Sql "DROP DATABASE IF EXISTS $database WITH (FORCE);`nCREATE DATABASE $database;" 'postgres'
  return $r.Code -eq 0
}

function Restore-Archive([string]$PathInContainer) {
  $out = & docker exec $container sh -c "pg_restore -U `$POSTGRES_USER -d $database --no-owner --no-acl $PathInContainer" 2>&1
  return @{ Code = $LASTEXITCODE; Out = ($out | ForEach-Object { "$_" }) }
}

function Undo-Restore([string]$Reason) {
  $back = $false
  if (Reset-Database) {
    & docker cp $devBackup "${container}:$devInContainer" 2>$null | Out-Null
    $back = ($LASTEXITCODE -eq 0) -and ((Restore-Archive $devInContainer).Code -eq 0)
  }
  & (Join-Path $PSScriptRoot 'supervisor.ps1') | Out-Null
  if ($back) { Fail "$Reason O banco de testes voltou ao estado anterior." }
  Fail "$Reason Não foi possível voltar o banco de testes sozinho; o backup está em $devBackup."
}

# 1. Pre-condicoes
$running = (& docker inspect -f '{{.State.Running}}' $container 2>$null) -join ''
if ($running -ne 'true') { Fail 'O banco do ambiente de testes (Docker) está desligado; ligue o ambiente de testes antes.' }

# 2. Backup de PRD na hora (o forced command ignora o comando pedido)
& cmd /c "ssh -T -q -o BatchMode=yes -o ConnectTimeout=10 $sshHost > `"$prdFile`" 2> `"$sshErr`""
$sshCode = $LASTEXITCODE
if ($sshCode -eq 75) { Fail 'Há uma publicação em andamento no servidor; tente de novo em alguns minutos.' }
if ($sshCode -ne 0) {
  $why = (Get-Content -LiteralPath $sshErr -ErrorAction SilentlyContinue | Select-Object -First 1) -join ''
  Fail "Não foi possível copiar o banco do site (ssh $sshCode). $why"
}
$size = (Get-Item -LiteralPath $prdFile).Length
$header = if ($size -ge 5) { [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($prdFile), 0, 5) } else { '' }
if ($header -ne 'PGDMP') { Fail 'O arquivo recebido do site não é um backup válido.' }

& docker cp $prdFile "${container}:$prdInContainer" 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'Não foi possível levar o backup para o banco de testes.' }
$tables = (& docker exec $container sh -c "pg_restore --list $prdInContainer | grep -c 'TABLE DATA'" 2>$null) -join ''
if (-not ($tables -match '^\d+$') -or [int]$tables -eq 0) { Fail 'O backup do site não tem tabelas; nada foi alterado.' }

# 3. Backup do banco DEV atual (fora do repositorio)
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
& docker exec $container sh -c "pg_dump -U `$POSTGRES_USER -d $database -Fc -f $devInContainer" 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'Não foi possível fazer o backup do banco de testes; nada foi alterado.' }
& docker cp "${container}:$devInContainer" $devBackup 2>$null | Out-Null
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $devBackup)) { Fail 'Não foi possível guardar o backup do banco de testes; nada foi alterado.' }
Get-ChildItem -LiteralPath $backupDir -Filter 'dev-antes-copia-prd-*.dump' | Sort-Object LastWriteTime -Descending |
  Select-Object -Skip $keepBackups | Remove-Item -Force -ErrorAction SilentlyContinue

# 4. Desliga o DEV (libera conexoes) e restaura
& (Join-Path $PSScriptRoot 'stop-dev.ps1') | Out-Null
if (-not (Reset-Database)) { Undo-Restore 'Falha ao recriar o banco de testes.' }
$restore = Restore-Archive $prdInContainer
if ($restore.Code -ne 0) {
  $tail = ($restore.Out | Select-Object -Last 2) -join ' '
  Undo-Restore "Falha ao restaurar a cópia do site: $tail"
}

# 5. A copia nao pode falar com clientes nem com a equipe: sem push, sem SMTP de
#    PRD e links de e-mail apontando para o DEV.
$neutralize = @'
DELETE FROM public."PushSubscription";
UPDATE public."SystemConfig"
   SET value = jsonb_set(jsonb_set(value::jsonb #- '{smtp,passEnc}', '{smtp,enabled}', 'false'::jsonb),
                         '{appUrl}', '"http://localhost:5202"'::jsonb),
       "updatedAt" = now()
 WHERE key = 'platform';
'@
$n = Invoke-Sql $neutralize
if ($n.Code -ne 0) { Undo-Restore "Falha ao desligar e-mail e notificações na cópia: $(($n.Out | Select-Object -Last 1) -join '')" }

# 6. Migrations do codigo DEV (run-with-env so aceita cervejaria_dev :5434)
$migrateLog = Join-Path $paths.LogDir 'copy-prd-migrate.log'
Push-Location $paths.BackendDir
try {
  & $paths.NodeExe scripts/run-with-env.mjs development npx prisma migrate deploy *> $migrateLog
  $migrateCode = $LASTEXITCODE
} finally {
  Pop-Location
}
if ($migrateCode -ne 0) {
  $tail = (Get-Content -LiteralPath $migrateLog -Tail 2 -ErrorAction SilentlyContinue) -join ' '
  Undo-Restore "Falha ao aplicar as mudanças de banco do ambiente de testes na cópia: $tail"
}

# 7. Conferencia, limpeza e religar
$stats = Invoke-Sql "ANALYZE;`nSELECT count(*) || ' ' || coalesce(sum(n_live_tup), 0) FROM pg_stat_user_tables;"
$counts = (($stats.Out | Select-Object -Last 1) -join '').Trim() -split ' '
Remove-PrdCopy
& (Join-Path $PSScriptRoot 'supervisor.ps1') | Out-Null
$started = $LASTEXITCODE -eq 0
Write-DevLog -Paths $paths -Message "copy-prd-to-dev: ok tables=$($counts[0]) rows=$($counts[1]) dev_backup=$devBackup"
$marker = @{ at = (Get-Date).ToUniversalTime().ToString('o'); tables = [int]$counts[0]; rows = [int64]$counts[1] } | ConvertTo-Json -Compress
[IO.File]::WriteAllText((Join-Path $backupDir 'last-prd-copy.json'), $marker)

Write-Output "PRD_COPY_OK tables=$($counts[0]) rows=$($counts[1]) prd_tables=$tables started=$started"
exit 0
