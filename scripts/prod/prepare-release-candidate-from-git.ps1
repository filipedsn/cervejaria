param(
  [Parameter(Mandatory)][string]$RepositoryPath,
  [Parameter(Mandatory)][string]$ExpectedReleaseSha,
  [Parameter(Mandatory)][string]$ExpectedTree,
  [Parameter(Mandatory)][string]$CandidateRoot,
  [Parameter(Mandatory)][string]$MigrationLedgerPath,
  [Parameter(Mandatory)][string]$ExpectedMigrationLedgerSha256,
  [Parameter(Mandatory)][string]$ArchivedCandidatePath,
  [Parameter(Mandatory)][string]$ExpectedArchivedManifestSha256,
  [string]$NodeExe = '',
  [string]$NpmCmd = ''
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\release-candidate.ps1"
Assert-ReleaseSha $ExpectedReleaseSha
if ($ExpectedTree -notmatch '^[a-f0-9]{40}$') { throw 'ExpectedTree deve ser um tree Git completo.' }
if ($ExpectedMigrationLedgerSha256 -notmatch '^[a-f0-9]{64}$') { throw 'ExpectedMigrationLedgerSha256 deve identificar o ledger por SHA-256.' }
if ($ExpectedArchivedManifestSha256 -notmatch '^[a-f0-9]{64}$') { throw 'ExpectedArchivedManifestSha256 deve identificar o manifesto historico por SHA-256.' }
$repo = [System.IO.Path]::GetFullPath($RepositoryPath)
$commit = (& git -C $repo rev-parse "$ExpectedReleaseSha^{commit}").Trim().ToLowerInvariant()
$tree = (& git -C $repo rev-parse "$ExpectedReleaseSha^{tree}").Trim().ToLowerInvariant()
if ($LASTEXITCODE -ne 0 -or $commit -ne $ExpectedReleaseSha -or $tree -ne $ExpectedTree) { throw 'SHA/tree solicitados nao existem exatamente no repositorio' }
foreach ($relative in @('scripts/prod/materialize-release-source-snapshot.mjs', 'backend/scripts/pdv-unico-git-snapshot.mjs')) {
  $localPath = Join-Path $repo ($relative -replace '/', '\')
  $expectedBlob = (& git -C $repo rev-parse "$ExpectedReleaseSha`:$relative").Trim().ToLowerInvariant()
  $localBlob = (& git -C $repo hash-object --path="$relative" $localPath).Trim().ToLowerInvariant()
  if ($LASTEXITCODE -ne 0 -or -not $expectedBlob -or $localBlob -ne $expectedBlob) { throw "materializador precisa corresponder ao blob Git fixado: $relative" }
}
if (-not $NodeExe) { $NodeExe = (Get-Command node.exe -ErrorAction Stop).Source }
if (-not $NpmCmd) { $NpmCmd = Join-Path (Split-Path $NodeExe -Parent) 'node_modules\npm\bin\npm-cli.js' }
$root = [System.IO.Path]::GetFullPath($CandidateRoot)
$inventory = Join-Path $root ('.source-inventory-' + $ExpectedReleaseSha + '-' + [guid]::NewGuid().ToString('N') + '.json')
$result = Invoke-ReleaseCandidatePrepareFromGitSnapshot -RepositoryPath $repo -ExpectedReleaseSha $ExpectedReleaseSha -ExpectedTree $ExpectedTree -CandidateRoot $root -SnapshotInventoryPath $inventory -NodeExe $NodeExe -NpmCmd $NpmCmd -MigrationLedgerPath $MigrationLedgerPath -ExpectedMigrationLedgerSha256 $ExpectedMigrationLedgerSha256 -ArchivedCandidatePath $ArchivedCandidatePath -ExpectedArchivedManifestSha256 $ExpectedArchivedManifestSha256
Write-Host "CANDIDATE_PATH=$($result.CandidatePath)"
Write-Host "CANDIDATE_MANIFEST_PATH=$($result.ManifestPath)"
Write-Host "CANDIDATE_ARTIFACT_READY=YES" -ForegroundColor Green
