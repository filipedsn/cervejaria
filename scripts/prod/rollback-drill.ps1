# Proves that the currently published production release can start on a restored
# pre-cutover database, without binding public ports or touching production data.
param(
  [Parameter(Mandatory = $true)] [string]$BackupFile,
  [Parameter(Mandatory = $true)] [string]$TargetDatabase,
  [int]$Port = 3311,
  [string]$ReportFile = ''
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"

function Invoke-RollbackDrillSql {
  param([string]$Database, [string]$Sql)
  $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Sql))
  $command = "echo $encoded | base64 -d | psql -X -q -t -A -v ON_ERROR_STOP=1 -U cervejaria -d $Database"
  $output = & docker exec cervejaria-db sh -c $command 2>&1
  if ($LASTEXITCODE -ne 0) { throw "SQL de validacao falhou no drill: $($output | Out-String)" }
  return ($output | Out-String).Trim()
}

function Remove-RollbackDrillDatabase {
  param([string]$Name)
  $owner = Invoke-RollbackDrillSql -Database postgres -Sql "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = '$Name';"
  if (-not $owner) { return }
  if ($owner -ne 'cervejaria') { throw "Owner inesperado no banco temporario $Name; preservado para inspecao." }
  & docker exec cervejaria-db psql -X -v ON_ERROR_STOP=1 -U cervejaria -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$Name' AND pid <> pg_backend_pid();" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Falha ao encerrar conexoes do banco temporario $Name." }
  & docker exec cervejaria-db psql -X -v ON_ERROR_STOP=1 -U cervejaria -d postgres -c "DROP DATABASE $Name;" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Falha ao remover banco temporario $Name." }
}

if ($TargetDatabase -notmatch '^cervejaria_restore_drill_[0-9]{8}_[0-9]{6}$') {
  throw 'TargetDatabase deve usar o formato cervejaria_restore_drill_yyyyMMdd_HHmmss.'
}
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Porta de drill invalida.' }
if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
  throw "Porta $Port ja esta em uso; nenhum processo sera encerrado."
}

$settings = Get-QuiverTapSettings
$paths = Resolve-QuiverTapPaths -Settings $settings
$startedAt = (Get-Date).ToUniversalTime()
$proc = $null
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "quiver-rollback-drill-$TargetDatabase"
$databaseCreated = $false
$healthPassed = $false
$releaseSha = ''

try {
  if (Test-Path $tempRoot) { throw "Diretorio temporario ja existe: $tempRoot" }
  New-Item -ItemType Directory -Path $tempRoot | Out-Null

  & "$PSScriptRoot\restore-drill.ps1" -BackupFile $BackupFile -TargetDatabase $TargetDatabase -KeepDatabase
  if ($LASTEXITCODE -ne 0) { throw 'Restore drill falhou.' }
  $databaseCreated = $true

  $artifactRoot = Join-Path $paths.ProjectRoot 'deploy\backups-production\cutover-predeploy-20260929\previous-prod-artifacts'
  $backendRoot = Join-Path $artifactRoot 'backend'
  $entry = Join-Path $backendRoot 'dist\index.js'
  $frontend = Join-Path $artifactRoot 'frontend'
  if (-not (Test-Path $entry) -or -not (Test-Path $frontend)) { throw 'Pacote da release anterior nao esta completo no backup local.' }

  Import-BackendEnvFile -BackendDir $paths.BackendDir -Environment production
  $dbUri = [UriBuilder]::new([Uri]$env:DATABASE_URL)
  $dbUri.Path = "/$TargetDatabase"
  $env:DATABASE_URL = $dbUri.Uri.AbsoluteUri
  $env:NODE_ENV = 'production'
  $env:HOST = '127.0.0.1'
  $env:PORT = [string]$Port
  $env:FRONTEND_DIST = $frontend
  $env:UPLOADS_DIR = Join-Path $tempRoot 'uploads'
  $env:KIBANA_ALERT_POLL_IN_API = 'false'
  $env:OTEL_SDK_DISABLED = 'true'

  $manifestPath = Join-Path $artifactRoot 'manifest.json'
  if (Test-Path $manifestPath) {
    $manifest = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $releaseSha = [string]$manifest.gitSha
  }
  if ($releaseSha -notmatch '^[a-f0-9]{40}$') { throw 'Manifest da release anterior ausente ou invalido.' }
  $env:RELEASE_SHA = $releaseSha

  $stdout = Join-Path $tempRoot 'api.stdout.log'
  $stderr = Join-Path $tempRoot 'api.stderr.log'
  $node = if ($settings.NodeExe) { $settings.NodeExe } else { (Get-Command node.exe).Source }
  $proc = Start-Process -FilePath $node -ArgumentList @($entry) -WorkingDirectory $backendRoot `
    -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru

  $healthUrl = "http://127.0.0.1:$Port/api/ready"
  $deadline = (Get-Date).AddSeconds(40)
  do {
    Start-Sleep -Milliseconds 500
    if ($proc.HasExited) { throw "Release anterior encerrou durante startup (exit $($proc.ExitCode)); logs mantidos em $tempRoot." }
    try {
      $response = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
      if ($response.status -eq 'ready') { $healthPassed = $true; break }
    } catch { }
  } while ((Get-Date) -lt $deadline)
  if (-not $healthPassed) { throw "Release anterior nao ficou ready em 40s; logs mantidos em $tempRoot." }

  $tables = Invoke-RollbackDrillSql -Database $TargetDatabase -Sql 'SELECT count(*) FROM "Cervejaria";'
  if ([int]$tables -lt 1) { throw 'Health passou, mas banco restaurado nao possui empresas.' }
} finally {
  if ($proc -and -not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    $proc.WaitForExit(10000) | Out-Null
  }
  if ($databaseCreated) {
    Remove-RollbackDrillDatabase -Name $TargetDatabase
  }
  if ($healthPassed -and (Test-Path $tempRoot)) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
}

$finishedAt = (Get-Date).ToUniversalTime()
$report = [ordered]@{
  result = if ($healthPassed) { 'PASS' } else { 'FAIL' }
  testedReleaseSha = $releaseSha
  database = $TargetDatabase
  host = '127.0.0.1'
  port = $Port
  endpoint = "http://127.0.0.1:$Port/api/ready"
  readinessPassed = $healthPassed
  startedAtUtc = $startedAt.ToString('o')
  finishedAtUtc = $finishedAt.ToString('o')
  durationSeconds = [math]::Round(($finishedAt - $startedAt).TotalSeconds, 3)
  productionDatabaseTouched = $false
  databaseRemoved = $true
}
if (-not $ReportFile) {
  $ReportFile = Join-Path $paths.ProjectRoot "deploy\restore-drills\rollback-drill-$($startedAt.ToString('yyyyMMdd-HHmmss')).json"
}
New-Item -ItemType Directory -Force -Path (Split-Path $ReportFile -Parent) | Out-Null
$report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ReportFile -Encoding UTF8
Write-Host "ROLLBACK DRILL $($report.result): release $releaseSha; ready=$healthPassed; relatorio=$ReportFile"
