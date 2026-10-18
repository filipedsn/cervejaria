param([Parameter(Mandatory)][string]$CandidatePath, [Parameter(Mandatory)][string]$ExpectedReleaseSha)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\release-candidate.ps1"
$result = Test-ReleaseCandidate @PSBoundParameters -ThrowOnError -RequireMigrationIntegrity
Write-Host "CANDIDATE_MANIFEST_PATH=$($result.ManifestPath)"
Write-Host 'CANDIDATE_CHECKSUM_RESULT=PASS'
Write-Host 'CANDIDATE_SECRET_SCAN=PASS'
Write-Host 'CANDIDATE_ARTIFACT_READY=YES' -ForegroundColor Green
