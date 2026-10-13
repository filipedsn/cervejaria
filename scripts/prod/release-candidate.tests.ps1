$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\release-candidate.ps1"
. "$PSScriptRoot\publish-artifacts.ps1"

function New-TestCandidate {
  param([string]$Path, [string]$Sha = ('a' * 40))
  New-Item -ItemType Directory -Force -Path (Join-Path $Path 'frontend'), (Join-Path $Path 'backend\dist'), (Join-Path $Path 'backend\prisma\migrations\000000_test') | Out-Null
  Set-Content (Join-Path $Path 'frontend\index.html') '<html></html>' -NoNewline
  Set-Content (Join-Path $Path 'backend\dist\index.js') 'console.log("ok")' -NoNewline
  Set-Content (Join-Path $Path 'backend\package.json') '{}' -NoNewline
  Set-Content (Join-Path $Path 'backend\package-lock.json') '{}' -NoNewline
  Set-Content (Join-Path $Path 'backend\prisma\schema.prisma') 'generator client { provider = "prisma-client-js" }' -NoNewline
  $migrationPath = Join-Path $Path 'backend\prisma\migrations\000000_test\migration.sql'
  Set-Content $migrationPath 'SELECT 1;' -NoNewline
  $migrationSha = (Get-FileHash -LiteralPath $migrationPath -Algorithm SHA256).Hash.ToLowerInvariant()
  [ordered]@{ format = $script:CandidateFormat; releaseSha = $Sha; createdAt = '2026-01-01T00:00:00.0000000Z'; nodeVersion = 'v24.18.0'; npmVersion = '11.16.0'; artifacts = @(); migrationIntegrity = @([ordered]@{ path = 'backend/prisma/migrations/000000_test/migration.sql'; blob = ('a' * 40); gitBlobSha256 = $migrationSha; expectedLedgerSha256 = $migrationSha; packageSha256 = $migrationSha; materializedFrom = 'test-blob' }); files = @(Get-CandidateFileHashes $Path) } | ConvertTo-Json -Depth 6 | Set-Content (Get-CandidateManifestPath $Path) -Encoding UTF8
}

Describe 'Retained release candidate contract' {
  BeforeEach { $script:sha = 'a' * 40; $script:candidate = Join-Path $TestDrive 'candidate'; Remove-Item -LiteralPath $script:candidate -Recurse -Force -ErrorAction SilentlyContinue; New-TestCandidate $script:candidate $script:sha }
  It 'verifies a complete immutable candidate' { (Test-ReleaseCandidate $candidate $sha).Ok | Should Be $true }
  It 'fails closed for manifest SHA mismatch' { (Test-ReleaseCandidate $candidate ('b' * 40)).Ok | Should Be $false }
  It 'detects a modification after preparation' { Add-Content (Join-Path $candidate 'backend\dist\index.js') 'changed'; (Test-ReleaseCandidate $candidate $sha).Ok | Should Be $false }
  It 'fails closed when migration integrity is missing' { $manifest = Get-Content (Get-CandidateManifestPath $candidate) -Raw -Encoding UTF8 | ConvertFrom-Json; $manifest.PSObject.Properties.Remove('migrationIntegrity'); $manifest | ConvertTo-Json -Depth 6 | Set-Content (Get-CandidateManifestPath $candidate) -Encoding UTF8; (Test-ReleaseCandidate $candidate $sha -RequireMigrationIntegrity).Ok | Should Be $false }
  It 'fails closed when a packaged migration diverges from its recorded source ledger' { $manifest = Get-Content (Get-CandidateManifestPath $candidate) -Raw -Encoding UTF8 | ConvertFrom-Json; $manifest.migrationIntegrity[0].expectedLedgerSha256 = 'b' * 64; $manifest | ConvertTo-Json -Depth 6 | Set-Content (Get-CandidateManifestPath $candidate) -Encoding UTF8; (Test-ReleaseCandidate $candidate $sha).Ok | Should Be $false }
  It 'preserves exact Git bytes and SHA-256 for LF, CRLF, and BOM variants' {
    $utf8 = [System.Text.UTF8Encoding]::new($false)
    $cases = @(
      @{ name = 'lf-no-bom'; bytes = $utf8.GetBytes("SELECT 1;`n") },
      @{ name = 'crlf-no-bom'; bytes = $utf8.GetBytes("SELECT 1;`r`n") },
      @{ name = 'lf-bom'; bytes = [byte[]](@(0xEF, 0xBB, 0xBF) + @($utf8.GetBytes("SELECT 1;`n"))) },
      @{ name = 'crlf-bom'; bytes = [byte[]](@(0xEF, 0xBB, 0xBF) + @($utf8.GetBytes("SELECT 1;`r`n"))) }
    )
    foreach ($case in $cases) {
      $destination = Join-Path $candidate ("backend\prisma\migrations\000000_test\$($case.name).sql")
      $expected = Get-ByteSha256 $case.bytes
      [System.IO.File]::WriteAllBytes($destination, $utf8.GetBytes('package bytes differ'))
      (Set-CandidateMigrationBytes -BlobBytes $case.bytes -Destination $destination) | Should Be $expected
      [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($destination)) | Should Be ([Convert]::ToBase64String($case.bytes))
      (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() | Should Be $expected
    }
  }
  It 'refuses to replace a migration when exact Git bytes do not match the source ledger' {
    $destination = Join-Path $candidate 'backend\prisma\migrations\000000_test\migration.sql'
    { Set-CandidateMigrationBytes -BlobBytes ([System.Text.Encoding]::UTF8.GetBytes("SELECT 2;`n")) -Destination $destination -ExpectedLedgerSha256 ('b' * 64) } | Should Throw
  }
  It 'preserves a package already matching the source ledger when Git bytes differ' {
    $destination = Join-Path $candidate 'backend\prisma\migrations\000000_test\migration.sql'
    $ledgerBytes = [System.Text.Encoding]::UTF8.GetBytes("SELECT 1;`r`n")
    $gitBytes = [System.Text.Encoding]::UTF8.GetBytes("SELECT 1;`n")
    $expected = Get-ByteSha256 $ledgerBytes
    [System.IO.File]::WriteAllBytes($destination, $ledgerBytes)
    (Set-CandidateMigrationBytes -BlobBytes $gitBytes -Destination $destination -ExpectedLedgerSha256 $expected) | Should Be $expected
    [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($destination)) | Should Be ([Convert]::ToBase64String($ledgerBytes))
  }
  It 'copies exact Git bytes when the source ledger requires those bytes' {
    $destination = Join-Path $candidate 'backend\prisma\migrations\000000_test\migration.sql'
    $gitBytes = [System.Text.Encoding]::UTF8.GetBytes("SELECT 1;`n")
    $expected = Get-ByteSha256 $gitBytes
    [System.IO.File]::WriteAllBytes($destination, [System.Text.Encoding]::UTF8.GetBytes("SELECT 1;`r`n"))
    (Set-CandidateMigrationBytes -BlobBytes $gitBytes -Destination $destination -ExpectedLedgerSha256 $expected) | Should Be $expected
    [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($destination)) | Should Be ([Convert]::ToBase64String($gitBytes))
  }
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

Describe 'Git source snapshot contract' {
  BeforeEach {
    $script:repo = Join-Path $TestDrive 'snapshot-repository'
    $script:snapshot = Join-Path $TestDrive 'materialized-source'
    $script:inventoryPath = Join-Path $TestDrive 'source-inventory.json'
    New-Item -ItemType Directory -Force -Path (Join-Path $repo 'backend\prisma\migrations\000000_test') | Out-Null
    Push-Location $repo
    try {
      git init -q
      git config user.email snapshot-test@example.invalid
      git config user.name 'Snapshot Test'
      Set-Content (Join-Path $repo 'backend\prisma\migrations\000000_test\migration.sql') 'SELECT 1;' -NoNewline
      Set-Content (Join-Path $repo 'backend\package.json') '{"dependencies":{}}' -NoNewline
      Set-Content (Join-Path $repo 'backend\package-lock.json') '{"lockfileVersion":3,"packages":{"":{"dependencies":{}}}}' -NoNewline
      git add .
      git commit -qm initial
      $script:release = (git rev-parse HEAD).Trim()
      $script:tree = (git rev-parse 'HEAD^{tree}').Trim()
    } finally { Pop-Location }
    New-Item -ItemType Directory -Force -Path $snapshot | Out-Null
    $migration = Join-Path $snapshot 'backend\prisma\migrations\000000_test\migration.sql'
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $migration) | Out-Null
    Copy-Item (Join-Path $repo 'backend\prisma\migrations\000000_test\migration.sql') $migration
    $blob = (git -C $repo rev-parse "$release`:backend/prisma/migrations/000000_test/migration.sql").Trim()
    $fileSha = (Get-FileHash $migration -Algorithm SHA256).Hash.ToLowerInvariant()
    [ordered]@{ format = 'tap-quiver-git-source-snapshot/v1'; commit = $release; tree = $tree; materializedBlobCount = 1; files = @([ordered]@{ path = 'backend/prisma/migrations/000000_test/migration.sql'; mode = '100644'; blob = $blob; size = (Get-Item $migration).Length; sha256 = $fileSha }) } | ConvertTo-Json -Depth 5 | Set-Content $inventoryPath -Encoding UTF8
  }
  It 'accepts the pinned snapshot without .git even when repository HEAD and worktree differ' {
    Push-Location $repo
    try { Set-Content tracked-unrelated.txt dirty; git add tracked-unrelated.txt; git commit -qm 'advance local HEAD' } finally { Pop-Location }
    (Assert-CandidateGitSnapshot -RepositoryPath $repo -SnapshotPath $snapshot -InventoryPath $inventoryPath -ExpectedReleaseSha $release -ExpectedTree $tree).commit | Should Be $release
    Test-Path (Join-Path $snapshot '.git') | Should Be $false
  }
  It 'rejects a materialized blob changed after inventory creation' {
    Add-Content (Join-Path $snapshot 'backend\prisma\migrations\000000_test\migration.sql') 'SELECT 2;'
    { Assert-CandidateGitSnapshot -RepositoryPath $repo -SnapshotPath $snapshot -InventoryPath $inventoryPath -ExpectedReleaseSha $release -ExpectedTree $tree } | Should Throw
  }
  It 'rejects an extra untracked operational source file' {
    Set-Content (Join-Path $snapshot 'backend\operational-extra.js') 'module.exports = 1'
    { Assert-CandidateGitSnapshot -RepositoryPath $repo -SnapshotPath $snapshot -InventoryPath $inventoryPath -ExpectedReleaseSha $release -ExpectedTree $tree } | Should Throw
  }
  It 'rejects local dependency references outside the snapshot' {
    $package = Join-Path $snapshot 'backend\package.json'
    Set-Content $package '{"dependencies":{"local-tool":"file:../../outside"}}' -NoNewline
    { Assert-SnapshotDependencyBoundary -SnapshotPath $snapshot } | Should Throw
  }
  It 'rejects a ledger whose bytes do not match the explicit hash' {
    $ledger = Join-Path $TestDrive 'ledger.txt'; Set-Content $ledger 'wrong-ledger' -NoNewline
    { Assert-MigrationLedgerIdentity -MigrationLedgerPath $ledger -ExpectedMigrationLedgerSha256 ('0' * 64) } | Should Throw
  }
}
