param([Parameter(Mandatory)][string]$SourceWorktree, [Parameter(Mandatory)][string]$ExpectedReleaseSha, [Parameter(Mandatory)][string]$CandidateRoot, [string]$NodeExe = 'C:\Users\Papai\Documents\Desenvolvimento\.toolchains\node20-v20.20.2\node-v20.20.2-win-x64\node.exe', [string]$NpmCmd = 'C:\Users\Papai\Documents\Desenvolvimento\.toolchains\node20-v20.20.2\node-v20.20.2-win-x64\node_modules\npm\bin\npm-cli.js')
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\release-candidate.ps1"
$result = Invoke-ReleaseCandidatePrepare -SourceWorktree $SourceWorktree -ExpectedReleaseSha $ExpectedReleaseSha -CandidateRoot $CandidateRoot -NodeExe $NodeExe -NpmCmd $NpmCmd
Write-Host "CANDIDATE_PATH=$($result.CandidatePath)"
Write-Host "CANDIDATE_MANIFEST_PATH=$($result.ManifestPath)"
Write-Host 'CANDIDATE_ARTIFACT_READY=YES' -ForegroundColor Green
