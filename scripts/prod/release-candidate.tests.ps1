$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\release-candidate.ps1"
. "$PSScriptRoot\publish-artifacts.ps1"

function New-TestCandidate {
  param([string]$Path, [string]$Sha = ('a' * 40))
  New-Item -ItemType Directory -Force -Path (Join-Path $Path 'frontend'), (Join-Path $Path 'backend\dist'), (Join-Path $Path 'backend\prisma') | Out-Null
  Set-Content (Join-Path $Path 'frontend\index.html') '<html></html>' -NoNewline
  Set-Content (Join-Path $Path 'backend\dist\index.js') 'console.log("ok")' -NoNewline
  Set-Content (Join-Path $Path 'backend\package.json') '{}' -NoNewline
  Set-Content (Join-Path $Path 'backend\package-lock.json') '{}' -NoNewline
  Set-Content (Join-Path $Path 'backend\prisma\schema.prisma') 'generator client { provider = "prisma-client-js" }' -NoNewline
  [ordered]@{ format = $script:CandidateFormat; releaseSha = $Sha; createdAt = '2026-01-01T00:00:00.0000000Z'; nodeVersion = 'v24.18.0'; npmVersion = '11.16.0'; artifacts = @(); files = @(Get-CandidateFileHashes $Path) } | ConvertTo-Json -Depth 6 | Set-Content (Get-CandidateManifestPath $Path) -Encoding UTF8
}

Describe 'Retained release candidate contract' {
  BeforeEach { $script:sha = 'a' * 40; $script:candidate = Join-Path $TestDrive 'candidate'; Remove-Item -LiteralPath $script:candidate -Recurse -Force -ErrorAction SilentlyContinue; New-TestCandidate $script:candidate $script:sha }
  It 'verifies a complete immutable candidate' { (Test-ReleaseCandidate $candidate $sha).Ok | Should Be $true }
  It 'fails closed for manifest SHA mismatch' { (Test-ReleaseCandidate $candidate ('b' * 40)).Ok | Should Be $false }
  It 'detects a modification after preparation' { Add-Content (Join-Path $candidate 'backend\dist\index.js') 'changed'; (Test-ReleaseCandidate $candidate $sha).Ok | Should Be $false }
  It 'fails for a missing required artifact' { Remove-Item (Join-Path $candidate 'frontend\index.html'); (Test-ReleaseCandidate $candidate $sha).Ok | Should Be $false }
  It 'fails for obvious secret files' { Set-Content (Join-Path $candidate '.env') 'JWT_SECRET=secret-value'; (Test-ReleaseCandidate $candidate $sha).Ok | Should Be $false }
  It 'rejects an invalid expected SHA' { { Test-ReleaseCandidate $candidate 'short' -ThrowOnError } | Should Throw }
  It 'allows active SHA different before a simulated candidate publish' {
    $paths = @{ ProdStagingDir = (Join-Path $TestDrive 'swap\.staging') }
    Stage-ReleaseCandidateArtifacts -Paths $paths -CandidatePath $candidate -ExpectedReleaseSha $sha
    Test-Path (Join-Path $paths.ProdStagingDir 'frontend\index.html') | Should Be $true
  }
  It 'refuses a candidate SHA different from the requested publish SHA' {
    $paths = @{ ProdStagingDir = (Join-Path $TestDrive 'swap\.staging') }
    { Stage-ReleaseCandidateArtifacts -Paths $paths -CandidatePath $candidate -ExpectedReleaseSha ('b' * 40) } | Should Throw
  }
  It 'fails closed when source HEAD differs from the expected SHA' {
    $source = Join-Path $TestDrive 'source-head'; New-Item -ItemType Directory -Path $source | Out-Null
    Push-Location $source
    try { git init -q; git config user.email test@example.invalid; git config user.name test; Set-Content tracked.txt ok; git add tracked.txt; git commit -qm init; $actual = (git rev-parse HEAD).Trim() } finally { Pop-Location }
    { Assert-CandidateSource -SourceWorktree $source -ExpectedReleaseSha ('b' * 40) -NodeExe $env:RELEASE_CANDIDATE_TEST_NODE } | Should Throw
  }
  It 'fails closed for dirty tracked source' {
    $source = Join-Path $TestDrive 'source-dirty'; New-Item -ItemType Directory -Path $source | Out-Null
    Push-Location $source
    try { git init -q; git config user.email test@example.invalid; git config user.name test; Set-Content tracked.txt ok; git add tracked.txt; git commit -qm init; $actual = (git rev-parse HEAD).Trim(); Set-Content tracked.txt dirty } finally { Pop-Location }
    { Assert-CandidateSource -SourceWorktree $source -ExpectedReleaseSha $actual -NodeExe $env:RELEASE_CANDIDATE_TEST_NODE } | Should Throw
  }
  It 'fails closed for a non-Node-24 executable' {
    { Assert-CandidateSource -SourceWorktree $TestDrive -ExpectedReleaseSha $sha -NodeExe $PSHOME\powershell.exe } | Should Throw
  }
}
