param([Parameter(Mandatory)][string]$SourceWorktree, [Parameter(Mandatory)][string]$ExpectedReleaseSha, [Parameter(Mandatory)][string]$CandidateRoot, [Parameter(Mandatory)][string]$MigrationLedgerPath, [string]$NodeExe = '', [string]$NpmCmd = '')
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\release-candidate.ps1"
if (-not $NodeExe) { $NodeExe = (Get-Command node.exe -ErrorAction Stop).Source }
if (-not $NpmCmd) { $NpmCmd = Join-Path (Split-Path $NodeExe -Parent) 'node_modules\npm\bin\npm-cli.js' }
$result = Invoke-ReleaseCandidatePrepare -SourceWorktree $SourceWorktree -ExpectedReleaseSha $ExpectedReleaseSha -CandidateRoot $CandidateRoot -NodeExe $NodeExe -NpmCmd $NpmCmd -MigrationLedgerPath $MigrationLedgerPath
Write-Host "CANDIDATE_PATH=$($result.CandidatePath)"
Write-Host "CANDIDATE_MANIFEST_PATH=$($result.ManifestPath)"
Write-Host 'CANDIDATE_ARTIFACT_READY=YES' -ForegroundColor Green
