# Prepara e verifica candidates de release retidos. Nunca acessa prod-artifacts.

$script:CandidateManifestName = 'candidate-manifest.json'
$script:CandidateFormat = 'tap-quiver-release-candidate/v1'

function Assert-ReleaseSha {
  param([string]$ReleaseSha)
  if (-not $ReleaseSha -or $ReleaseSha -notmatch '^[a-f0-9]{40}$') {
    throw 'ExpectedReleaseSha deve ser um SHA Git completo, em minusculas (40 hex).'
  }
}

function Get-CandidateManifestPath {
  param([string]$CandidatePath)
  return Join-Path $CandidatePath $script:CandidateManifestName
}

function Get-CandidateRequiredFiles {
  return @(
    'frontend/index.html',
    'backend/dist/index.js',
    'backend/package.json',
    'backend/package-lock.json',
    'backend/prisma/schema.prisma',
    # start / start:deploy carregam a politica OTEL antes do EDOT (TAP-117).
    'backend/scripts/otel-resource-policy.mjs'
  )
}

function Copy-BackendRuntimeScripts {
  param(
    [Parameter(Mandatory)][string]$SourceBackend,
    [Parameter(Mandatory)][string]$DestinationBackend
  )
  $sourceScript = Join-Path $SourceBackend 'scripts\otel-resource-policy.mjs'
  if (-not (Test-Path -LiteralPath $sourceScript -PathType Leaf)) {
    throw "backend/scripts/otel-resource-policy.mjs ausente em $SourceBackend"
  }
  $destScripts = Join-Path $DestinationBackend 'scripts'
  New-Item -ItemType Directory -Force -Path $destScripts | Out-Null
  Copy-Item -LiteralPath $sourceScript -Destination (Join-Path $destScripts 'otel-resource-policy.mjs') -Force
}

function Get-CandidateFileHashes {
  param([string]$CandidatePath)
  $items = @()
  Get-ChildItem -LiteralPath $CandidatePath -Recurse -File | Where-Object {
    $_.Name -ne $script:CandidateManifestName
  } | Sort-Object FullName | ForEach-Object {
    $relative = $_.FullName.Substring($CandidatePath.Length).TrimStart('\', '/') -replace '\\', '/'
    $items += [ordered]@{
      path = $relative
      sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
  }
  return @($items)
}

function Test-CandidateSecrets {
  param([string]$CandidatePath)
  $findings = @()
  Get-ChildItem -LiteralPath $CandidatePath -Recurse -Force | ForEach-Object {
    $relative = $_.FullName.Substring($CandidatePath.Length).TrimStart('\', '/')
    if ($_.Name -match '^\.env($|\.)' -or $_.Extension -in @('.pem', '.key', '.pfx', '.p12')) {
      $findings += "arquivo proibido: $relative"
    }
  }
  Get-ChildItem -LiteralPath $CandidatePath -Recurse -File | ForEach-Object {
    if ($_.Length -gt 5MB -or $_.Extension -notin @('.json', '.js', '.mjs', '.cjs', '.txt')) { return }
    $content = Get-Content -LiteralPath $_.FullName -Raw -ErrorAction SilentlyContinue
    if ($content -match '(?im)^\s*(?:export\s+)?(?:const\s+)?(?:[A-Z0-9_]*?(?:API[_-]?KEY|PASSWORD|JWT[_-]?SECRET|PRIVATE[_-]?KEY|ELASTIC[_-]?CREDENTIAL)[A-Z0-9_]*)\s*[:=]\s*["''][^"'']{8,}["'']') {
      $relative = $_.FullName.Substring($CandidatePath.Length).TrimStart('\', '/')
      $findings += "padrao de segredo: $relative"
    }
  }
  return @($findings)
}

function Copy-CandidateTree {
  param([string]$Source, [string]$Destination)
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  & robocopy $Source $Destination /E /COPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -gt 7) { throw "falha ao copiar artifact candidate: $Source" }
}

function Get-ByteSha256 {
  param([byte[]]$Bytes)
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try { return [System.BitConverter]::ToString($sha256.ComputeHash($Bytes)).Replace('-', '').ToLowerInvariant() } finally { $sha256.Dispose() }
}

function Set-CandidateMigrationBytes {
  param([byte[]]$BlobBytes, [string]$Destination, [string]$ExpectedLedgerSha256)
  $blobSha = Get-ByteSha256 $BlobBytes
  if ($ExpectedLedgerSha256 -and $ExpectedLedgerSha256 -notmatch '^[a-f0-9]{64}$') { throw 'Expected migration checksum is invalid.' }
  if ($ExpectedLedgerSha256) {
    if (-not (Test-Path -LiteralPath $Destination -PathType Leaf)) { throw 'Applied migration package bytes are missing.' }
    $currentSha = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($currentSha -eq $ExpectedLedgerSha256) { return $currentSha }
    if ($blobSha -ne $ExpectedLedgerSha256) { throw "Neither existing package nor Git blob matches the source migration checksum (package=$currentSha blob=$blobSha ledger=$ExpectedLedgerSha256)." }
  }
  [System.IO.File]::WriteAllBytes($Destination, $BlobBytes)
  $packagedSha = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($packagedSha -ne $blobSha) { throw 'Exact Git migration bytes changed while being written to the candidate package.' }
  if ($ExpectedLedgerSha256 -and $packagedSha -ne $ExpectedLedgerSha256) { throw 'Applied migration bytes do not match their source ledger.' }
  return $packagedSha
}

function Copy-GitMigrationBlobs {
  param([string]$SourceWorktree, [string]$ExpectedReleaseSha, [string]$CandidatePrismaPath, [string]$MigrationLedgerPath, [string]$GitRepositoryRoot = '')
  if (-not $GitRepositoryRoot) { $GitRepositoryRoot = $SourceWorktree }
  if (-not (Test-Path -LiteralPath $MigrationLedgerPath -PathType Leaf)) { throw 'MigrationLedgerPath must identify the sanitized ledger from the rehearsal source.' }
  $expectedChecksums = @{}
  foreach ($line in (Get-Content -LiteralPath $MigrationLedgerPath -Encoding UTF8)) {
    $fields = $line -split '\|'
    if ($fields.Count -ge 4 -and $fields[2] -eq 't' -and $fields[3] -eq 'f' -and $fields[0] -match '^\d{14}_.+$' -and $fields[1] -match '^[a-f0-9]{64}$') { $expectedChecksums[$fields[0]] = $fields[1] }
  }
  if ($expectedChecksums.Count -eq 0) { throw 'The sanitized migration ledger has no completed migrations.' }
  $migrationRoot = Join-Path $CandidatePrismaPath 'migrations'
  $integrity = @()
  foreach ($sourceFile in (Get-ChildItem -LiteralPath (Join-Path $SourceWorktree 'backend\prisma\migrations') -Filter 'migration.sql' -File -Recurse | Sort-Object FullName)) {
    $relative = $sourceFile.FullName.Substring((Join-Path $SourceWorktree 'backend\prisma\migrations').Length).TrimStart('\', '/') -replace '\\', '/'
    $gitPath = "backend/prisma/migrations/$relative"
    $blob = (& git -C $GitRepositoryRoot rev-parse "$ExpectedReleaseSha`:$gitPath").Trim().ToLowerInvariant()
    if ($LASTEXITCODE -ne 0 -or $blob -notmatch '^[a-f0-9]{40}$') { throw "Git migration blob unavailable: $gitPath" }

    $destination = Join-Path $migrationRoot ($relative -replace '/', '\')
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
    $start = [System.Diagnostics.ProcessStartInfo]::new()
    $start.FileName = 'git'
    $start.Arguments = "-C `"$GitRepositoryRoot`" cat-file blob $blob"
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $start
    if (-not $process.Start()) { throw "Could not read Git migration blob: $gitPath" }
    $blobBuffer = New-Object System.IO.MemoryStream
    $process.StandardOutput.BaseStream.CopyTo($blobBuffer)
    $errorText = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw "Git migration blob read failed: $gitPath ($errorText)" }
    $blobBytes = $blobBuffer.ToArray()
    $blobBuffer.Dispose()
    $sourceSha = Get-ByteSha256 $blobBytes
    $migrationName = Split-Path -Parent $relative
    $expectedSha = $expectedChecksums[$migrationName]
    $materializedFrom = 'candidate-package-preserved'
    $packageSha = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
    $packageSha = Set-CandidateMigrationBytes -BlobBytes $blobBytes -Destination $destination -ExpectedLedgerSha256 $expectedSha
    if ($packageSha -eq $sourceSha) { $materializedFrom = "git-blob:$blob" }
    if ($expectedSha -and $packageSha -ne $expectedSha) { throw "Packaged migration does not match the source ledger: $migrationName" }
    $integrity += [ordered]@{ path = "backend/prisma/migrations/$relative"; blob = $blob; gitBlobSha256 = $sourceSha; expectedLedgerSha256 = $expectedSha; packageSha256 = $packageSha; materializedFrom = $materializedFrom }
  }
  if ($integrity.Count -eq 0 -or $expectedChecksums.Count -gt $integrity.Count) { throw 'Migration SQL integrity inventory is incomplete.' }
  return @($integrity)
}

function Assert-CandidateGitSnapshot {
  param([string]$RepositoryPath, [string]$SnapshotPath, [string]$InventoryPath, [string]$ExpectedReleaseSha, [string]$ExpectedTree)
  Assert-ReleaseSha $ExpectedReleaseSha
  if (-not (Test-Path -LiteralPath $SnapshotPath -PathType Container)) { throw 'Git source snapshot ausente' }
  if (Test-Path -LiteralPath (Join-Path $SnapshotPath '.git')) { throw 'Git source snapshot nao pode conter .git' }
  $commit = (& git -C $RepositoryPath rev-parse "$ExpectedReleaseSha^{commit}").Trim().ToLowerInvariant()
  if ($LASTEXITCODE -ne 0 -or $commit -ne $ExpectedReleaseSha) { throw 'commit source diverge da identidade fixada' }
  $tree = (& git -C $RepositoryPath rev-parse "$ExpectedReleaseSha^{tree}").Trim().ToLowerInvariant()
  if ($LASTEXITCODE -ne 0 -or $tree -ne $ExpectedTree) { throw 'tree source diverge da identidade fixada' }
  $inventory = Get-Content -LiteralPath $InventoryPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($inventory.commit -ne $ExpectedReleaseSha -or $inventory.tree -ne $ExpectedTree -or @($inventory.files).Count -ne $inventory.materializedBlobCount) { throw 'inventario snapshot nao corresponde ao commit/tree fixados' }
  $declared = @{}
  foreach ($file in @($inventory.files)) {
    if ($file.path -match '(^|/)\.git(/|$)' -or $file.path -match '(^|/)\.\.?(/|$)' -or $file.sha256 -notmatch '^[a-f0-9]{64}$' -or $file.blob -notmatch '^[a-f0-9]{40}$') { throw "entrada invalida no inventario snapshot: $($file.path)" }
    $declared[$file.path] = $file.sha256
    $path = Join-Path $SnapshotPath ($file.path -replace '/', '\')
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "blob materializado ausente: $($file.path)" }
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) { throw "blob materializado foi alterado: $($file.path)" }
  }
  $actual = @(Get-ChildItem -LiteralPath $SnapshotPath -Recurse -File | ForEach-Object { $_.FullName.Substring($SnapshotPath.Length).TrimStart('\', '/') -replace '\\', '/' })
  if ($actual.Count -ne $declared.Count) { throw 'snapshot possui arquivos extras ou ausentes em relacao aos blobs fixados' }
  foreach ($path in $actual) { if (-not $declared.ContainsKey($path)) { throw "arquivo extra no snapshot: $path" } }
  return $inventory
}

function Assert-SnapshotDependencyBoundary {
  param([string]$SnapshotPath)
  foreach ($project in @('frontend', 'backend')) {
    $packagePath = Join-Path $SnapshotPath "$project\package.json"
    $lockPath = Join-Path $SnapshotPath "$project\package-lock.json"
    if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf) -or -not (Test-Path -LiteralPath $lockPath -PathType Leaf)) { throw "package/lockfile ausente no snapshot: $project" }
    $package = Get-Content -LiteralPath $packagePath -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($section in @('dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies')) {
      $deps = $package.$section
      if ($deps) { foreach ($property in $deps.PSObject.Properties) { if ([string]$property.Value -match '^(file:|link:|workspace:)') { throw "dependencia fora do snapshot nao permitida: $project/$($property.Name)=$($property.Value)" } } }
    }
    # npm lockfiles use an empty root package key, unsupported by PS 5.1 ConvertFrom-Json.
    Add-Type -AssemblyName System.Web.Extensions
    $lockParser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
    $lockParser.MaxJsonLength = 16777216
    $lock = $lockParser.DeserializeObject((Get-Content -LiteralPath $lockPath -Raw -Encoding UTF8))
    if (-not $lock.ContainsKey('packages')) { throw "lockfile packages ausente: $project" }
    foreach ($packageName in $lock['packages'].Keys) {
      $lockPackage = $lock['packages'][$packageName]
      if ($lockPackage['link'] -or ([string]$lockPackage['resolved'] -match '^(file:|link:)')) { throw "lockfile referencia dependencia local: $project/$packageName" }
    }
  }
}

function Get-LedgerAppliedChecksums {
  param([string]$MigrationLedgerPath)
  $expected = @{}
  foreach ($line in (Get-Content -LiteralPath $MigrationLedgerPath -Encoding UTF8)) {
    $fields = $line -split '\|'
    if ($fields.Count -ge 4 -and $fields[2] -eq 't' -and $fields[3] -eq 'f' -and $fields[0] -match '^\d{14}_.+$' -and $fields[1] -match '^[a-f0-9]{64}$') { $expected[$fields[0]] = $fields[1] }
  }
  if ($expected.Count -eq 0) { throw 'ledger nao contem migrations aplicadas validas' }
  return $expected
}

function Assert-MigrationLedgerIdentity {
  param([string]$MigrationLedgerPath, [string]$ExpectedMigrationLedgerSha256)
  if ($ExpectedMigrationLedgerSha256 -notmatch '^[a-f0-9]{64}$' -or -not (Test-Path -LiteralPath $MigrationLedgerPath -PathType Leaf)) { throw 'ledger explicito ou SHA-256 invalido' }
  $actual = (Get-FileHash -LiteralPath $MigrationLedgerPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $ExpectedMigrationLedgerSha256) { throw 'hash do ledger diverge da identidade explicitamente aprovada' }
  return $actual
}

function Copy-LedgerMatchingArchivedMigrationBytes {
  param([string]$ArchivedCandidatePath, [string]$ExpectedArchivedManifestSha256, [string]$CandidatePrismaPath, [string]$MigrationLedgerPath)
  $manifestPath = Get-CandidateManifestPath $ArchivedCandidatePath
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'manifesto do pacote historico ausente' }
  $manifestHash = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($manifestHash -ne $ExpectedArchivedManifestSha256) { throw 'hash do manifesto historico diverge do valor autorizado' }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($manifest.releaseSha -ne '956f3a64e67fc3016a177426364f625c2682212d' -or -not $manifest.files) { throw 'pacote historico nao e a fonte arquivada autorizada' }
  foreach ($item in @($manifest.files)) {
    $source = Join-Path $ArchivedCandidatePath ($item.path -replace '/', '\')
    if (-not (Test-Path -LiteralPath $source -PathType Leaf) -or (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $item.sha256) { throw "arquivo do pacote historico diverge do manifesto: $($item.path)" }
  }
  $expected = Get-LedgerAppliedChecksums $MigrationLedgerPath
  $copied = @()
  foreach ($name in $expected.Keys) {
    $relative = "backend\prisma\migrations\$name\migration.sql"
    $source = Join-Path $ArchivedCandidatePath $relative
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { continue }
    $sha = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($sha -ne $expected[$name]) { continue }
    $destination = Join-Path $CandidatePrismaPath ("migrations\$name\migration.sql")
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Force
    $copied += $name
  }
  return @($copied)
}

function Invoke-ReleaseCandidatePrepareFromGitSnapshot {
  param(
    [Parameter(Mandatory)][string]$RepositoryPath,
    [Parameter(Mandatory)][string]$ExpectedReleaseSha,
    [Parameter(Mandatory)][string]$ExpectedTree,
    [Parameter(Mandatory)][string]$CandidateRoot,
    [Parameter(Mandatory)][string]$SnapshotInventoryPath,
    [Parameter(Mandatory)][string]$NodeExe,
    [Parameter(Mandatory)][string]$NpmCmd,
    [Parameter(Mandatory)][string]$MigrationLedgerPath,
    [Parameter(Mandatory)][string]$ExpectedMigrationLedgerSha256,
    [Parameter(Mandatory)][string]$ArchivedCandidatePath,
    [Parameter(Mandatory)][string]$ExpectedArchivedManifestSha256
  )
  Assert-ReleaseSha $ExpectedReleaseSha
  if ($ExpectedTree -notmatch '^[a-f0-9]{40}$') { throw 'ExpectedTree deve ser um tree Git completo.' }
  if (-not (Test-Path -LiteralPath $MigrationLedgerPath -PathType Leaf)) { throw 'MigrationLedgerPath explicito ausente' }
  $ledgerSha = Assert-MigrationLedgerIdentity -MigrationLedgerPath $MigrationLedgerPath -ExpectedMigrationLedgerSha256 $ExpectedMigrationLedgerSha256
  $commit = (& git -C $RepositoryPath rev-parse "$ExpectedReleaseSha^{commit}").Trim().ToLowerInvariant()
  $tree = (& git -C $RepositoryPath rev-parse "$ExpectedReleaseSha^{tree}").Trim().ToLowerInvariant()
  if ($LASTEXITCODE -ne 0 -or $commit -ne $ExpectedReleaseSha -or $tree -ne $ExpectedTree) { throw 'nao foi possivel fixar commit/tree antes do build' }
  if (-not (Test-Path -LiteralPath $NodeExe -PathType Leaf) -or -not (Test-Path -LiteralPath $NpmCmd -PathType Leaf)) { throw 'Node/npm executaveis ausentes' }
  $nodeVersion = ([string](& $NodeExe --version)).Trim()
  if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v24\.') { throw "Node major deve ser 24; observado $nodeVersion" }
  $npmVersion = ([string](& $NodeExe $NpmCmd --version)).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'npm nao executou com Node informado' }
  $root = [System.IO.Path]::GetFullPath($CandidateRoot)
  New-Item -ItemType Directory -Force -Path $root | Out-Null
  $candidate = Join-Path $root $ExpectedReleaseSha
  if (Test-Path -LiteralPath $candidate) {
    $verified = Test-ReleaseCandidate -CandidatePath $candidate -ExpectedReleaseSha $ExpectedReleaseSha -RequireMigrationIntegrity
    if ($verified.Ok) { return $verified }
    throw ('candidate existente diverge; preservado sem sobrescrever: ' + ($verified.Errors -join '; '))
  }
  $token = [guid]::NewGuid().ToString('N')
  $snapshot = Join-Path $root ('.s-' + $token.Substring(0, 16))
  $staging = Join-Path $root ('.p-' + $token.Substring(0, 16))
  $oldRelease = $env:RELEASE_SHA; $oldViteRelease = $env:VITE_RELEASE_SHA
  try {
    New-Item -ItemType Directory -Force -Path $snapshot, $staging | Out-Null
    $materializer = Join-Path $PSScriptRoot 'materialize-release-source-snapshot.mjs'
    & $NodeExe $materializer $RepositoryPath $ExpectedReleaseSha $ExpectedTree $snapshot $SnapshotInventoryPath
    if ($LASTEXITCODE -ne 0) { throw 'materializacao de blobs Git falhou' }
    $inventory = Assert-CandidateGitSnapshot -RepositoryPath $RepositoryPath -SnapshotPath $snapshot -InventoryPath $SnapshotInventoryPath -ExpectedReleaseSha $ExpectedReleaseSha -ExpectedTree $ExpectedTree
    Assert-SnapshotDependencyBoundary $snapshot
    foreach ($project in @('frontend', 'backend')) {
      Push-Location (Join-Path $snapshot $project)
      try { & $NodeExe $NpmCmd ci --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw "npm ci falhou em $project" } }
      finally { Pop-Location }
    }
    Assert-SnapshotDependencyBoundary $snapshot
    $env:RELEASE_SHA = $ExpectedReleaseSha; $env:VITE_RELEASE_SHA = $ExpectedReleaseSha
    $frontendOut = Join-Path $staging 'frontend'
    # NODE_ENV herdado do shell (ex.: development) faz o Vite emitir a build de desenvolvimento do React.
    $previousNodeEnv = $env:NODE_ENV
    $env:NODE_ENV = 'production'
    Push-Location $snapshot
    try {
      & $NodeExe $NpmCmd run build:deploy --prefix frontend -- --outDir $frontendOut
      if ($LASTEXITCODE -ne 0) { throw 'build frontend do snapshot falhou' }
      & $NodeExe $NpmCmd run build:deploy --prefix backend
      if ($LASTEXITCODE -ne 0) { throw 'build backend do snapshot falhou' }
    } finally { Pop-Location; $env:NODE_ENV = $previousNodeEnv }
    New-Item -ItemType Directory -Force -Path (Join-Path $staging 'backend') | Out-Null
    Copy-Item -LiteralPath (Join-Path $snapshot 'backend\dist') -Destination (Join-Path $staging 'backend\dist') -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $snapshot 'backend\package.json') -Destination (Join-Path $staging 'backend\package.json') -Force
    Copy-Item -LiteralPath (Join-Path $snapshot 'backend\package-lock.json') -Destination (Join-Path $staging 'backend\package-lock.json') -Force
    Copy-BackendRuntimeScripts -SourceBackend (Join-Path $snapshot 'backend') -DestinationBackend (Join-Path $staging 'backend')
    Copy-CandidateTree -Source (Join-Path $snapshot 'backend\prisma') -Destination (Join-Path $staging 'backend\prisma')
    $seeded = Copy-LedgerMatchingArchivedMigrationBytes -ArchivedCandidatePath $ArchivedCandidatePath -ExpectedArchivedManifestSha256 $ExpectedArchivedManifestSha256 -CandidatePrismaPath (Join-Path $staging 'backend\prisma') -MigrationLedgerPath $MigrationLedgerPath
    $migrationIntegrity = Copy-GitMigrationBlobs -SourceWorktree $snapshot -GitRepositoryRoot $RepositoryPath -ExpectedReleaseSha $ExpectedReleaseSha -CandidatePrismaPath (Join-Path $staging 'backend\prisma') -MigrationLedgerPath $MigrationLedgerPath
    $inventoryPackagePath = Join-Path $staging 'source-snapshot-inventory.json'
    Copy-Item -LiteralPath $SnapshotInventoryPath -Destination $inventoryPackagePath -Force
    $inventorySha = (Get-FileHash -LiteralPath $inventoryPackagePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $manifest = [ordered]@{ format = $script:CandidateFormat; releaseSha = $ExpectedReleaseSha; releaseTree = $ExpectedTree; createdAt = (Get-Date).ToUniversalTime().ToString('o'); nodeVersion = $nodeVersion; npmVersion = $npmVersion; artifacts = @('frontend', 'backend/dist', 'backend/package.json', 'backend/package-lock.json', 'backend/scripts/otel-resource-policy.mjs', 'backend/prisma', 'source-snapshot-inventory.json'); sourceSnapshot = [ordered]@{ commit = $ExpectedReleaseSha; tree = $ExpectedTree; materializedBlobCount = $inventory.materializedBlobCount; inventoryPath = 'source-snapshot-inventory.json'; inventorySha256 = $inventorySha }; migrationLedger = [ordered]@{ path = [System.IO.Path]::GetFileName($MigrationLedgerPath); sha256 = $ledgerSha }; preservedArchivedMigrations = @($seeded); migrationIntegrity = $migrationIntegrity; files = @(Get-CandidateFileHashes $staging) }
    $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Get-CandidateManifestPath $staging) -Encoding UTF8
    Test-ReleaseCandidate -CandidatePath $staging -ExpectedReleaseSha $ExpectedReleaseSha -ThrowOnError -RequireMigrationIntegrity | Out-Null
    Move-Item -LiteralPath $staging -Destination $candidate
    return (Test-ReleaseCandidate -CandidatePath $candidate -ExpectedReleaseSha $ExpectedReleaseSha -ThrowOnError -RequireMigrationIntegrity)
  } finally {
    $env:RELEASE_SHA = $oldRelease; $env:VITE_RELEASE_SHA = $oldViteRelease
    if (Test-Path -LiteralPath $snapshot) { Remove-Item -LiteralPath $snapshot -Recurse -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $SnapshotInventoryPath) { Remove-Item -LiteralPath $SnapshotInventoryPath -Force -ErrorAction SilentlyContinue }
  }
}

function Test-ReleaseCandidate {
  param(
    [Parameter(Mandatory)][string]$CandidatePath,
    [Parameter(Mandatory)][string]$ExpectedReleaseSha,
    [switch]$ThrowOnError,
    [switch]$RequireMigrationIntegrity
  )
  Assert-ReleaseSha $ExpectedReleaseSha
  $errors = @()
  if (-not (Test-Path -LiteralPath $CandidatePath -PathType Container)) { $errors += 'candidate directory ausente' }
  $manifestPath = Get-CandidateManifestPath $CandidatePath
  $manifest = $null
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    $errors += 'candidate manifest ausente'
  } else {
    try { $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $errors += 'candidate manifest invalido' }
  }
  if ($manifest) {
    if ($manifest.format -ne $script:CandidateFormat) { $errors += 'candidate manifest format invalido' }
    if ($manifest.releaseSha -ne $ExpectedReleaseSha) { $errors += 'candidate manifest SHA diverge do SHA esperado' }
    if ($manifest.sourceSnapshot) {
      $inventoryPath = Join-Path $CandidatePath ([string]$manifest.sourceSnapshot.inventoryPath)
      if (-not (Test-Path -LiteralPath $inventoryPath -PathType Leaf)) { $errors += 'source snapshot inventory ausente' }
      elseif ((Get-FileHash -LiteralPath $inventoryPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.sourceSnapshot.inventorySha256) { $errors += 'source snapshot inventory diverge do manifest' }
      else {
        try {
          $sourceInventory = Get-Content -LiteralPath $inventoryPath -Raw -Encoding UTF8 | ConvertFrom-Json
          if ($sourceInventory.commit -ne $ExpectedReleaseSha -or $sourceInventory.tree -ne $manifest.releaseTree -or $sourceInventory.materializedBlobCount -ne @($sourceInventory.files).Count) { $errors += 'source snapshot identity diverge do manifest' }
        } catch { $errors += 'source snapshot inventory invalido' }
      }
    }
    if (-not $manifest.files -or @($manifest.files).Count -eq 0) { $errors += 'candidate manifest sem checksums' }
    if (-not $manifest.migrationIntegrity -or @($manifest.migrationIntegrity).Count -eq 0) {
      if ($RequireMigrationIntegrity) { $errors += 'candidate manifest sem integridade dos blobs SQL de migrations' }
    } else {
      $migrationPaths = @{}
      foreach ($migration in @($manifest.migrationIntegrity)) {
        if (-not $migration.path -or $migration.path -notmatch '^backend/prisma/migrations/.+/migration\.sql$' -or $migration.gitBlobSha256 -notmatch '^[a-f0-9]{64}$' -or $migration.packageSha256 -notmatch '^[a-f0-9]{64}$' -or ($migration.expectedLedgerSha256 -and $migration.packageSha256 -ne $migration.expectedLedgerSha256) -or (-not $migration.expectedLedgerSha256 -and $migration.packageSha256 -ne $migration.gitBlobSha256)) { $errors += 'registro de integridade de migration invalido'; continue }
        if ($migrationPaths.ContainsKey($migration.path)) { $errors += "migration duplicada no manifest: $($migration.path)"; continue }
        $migrationPaths[$migration.path] = $true
        $migrationPath = Join-Path $CandidatePath ($migration.path -replace '/', '\')
        if (-not (Test-Path -LiteralPath $migrationPath -PathType Leaf)) { $errors += "migration ausente: $($migration.path)"; continue }
        $actualMigrationSha = (Get-FileHash -LiteralPath $migrationPath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actualMigrationSha -ne $migration.packageSha256) { $errors += "SQL de migration diverge do manifest: $($migration.path)" }
      }
      $actualMigrationPaths = @(Get-ChildItem -LiteralPath (Join-Path $CandidatePath 'backend\prisma\migrations') -Filter 'migration.sql' -File -Recurse | ForEach-Object { $_.FullName.Substring($CandidatePath.Length).TrimStart('\', '/') -replace '\\', '/' })
      if ($actualMigrationPaths.Count -ne $migrationPaths.Count -or @($actualMigrationPaths | Where-Object { -not $migrationPaths.ContainsKey($_) }).Count -gt 0) { $errors += 'inventario de migrations diverge do candidate package' }
    }
  }
  foreach ($required in Get-CandidateRequiredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $CandidatePath $required) -PathType Leaf)) { $errors += "artifact obrigatorio ausente: $required" }
  }
  if ($manifest -and $manifest.files) {
    $actual = @{}
    foreach ($file in Get-CandidateFileHashes $CandidatePath) { $actual[$file.path] = $file.sha256 }
    $declared = @{}
    foreach ($file in @($manifest.files)) {
      if (-not $file.path -or -not $file.sha256 -or $file.sha256 -notmatch '^[a-f0-9]{64}$') { $errors += 'checksum declarado invalido'; continue }
      $declared[$file.path] = $file.sha256
    }
    if ($actual.Count -ne $declared.Count) { $errors += 'lista de arquivos diverge do manifest' }
    foreach ($path in $declared.Keys) { if (-not $actual.ContainsKey($path) -or $actual[$path] -ne $declared[$path]) { $errors += "checksum diverge: $path" } }
  }
  $secretFindings = if (Test-Path -LiteralPath $CandidatePath) { Test-CandidateSecrets $CandidatePath } else { @() }
  $errors += $secretFindings
  $result = [pscustomobject]@{ Ok = ($errors.Count -eq 0); Errors = @($errors); Manifest = $manifest; ManifestPath = $manifestPath; CandidatePath = $CandidatePath }
  if ($ThrowOnError -and -not $result.Ok) { throw ('CANDIDATE_ARTIFACT_READY=NO: ' + ($errors -join '; ')) }
  return $result
}

function Assert-CandidateSource {
  param([string]$SourceWorktree, [string]$ExpectedReleaseSha, [string]$NodeExe)
  Assert-ReleaseSha $ExpectedReleaseSha
  if (-not (Test-Path -LiteralPath $SourceWorktree -PathType Container)) { throw 'source worktree ausente' }
  if (-not (Test-Path -LiteralPath $NodeExe -PathType Leaf)) { throw "NodeExe ausente: $NodeExe" }
  $version = [string](& $NodeExe --version 2>$null | Select-Object -Last 1)
  $version = $version.Trim()
  if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v24\.') { throw "Node major deve ser 24; observado $version" }
  $head = (& git -C $SourceWorktree rev-parse HEAD).Trim().ToLowerInvariant()
  if ($LASTEXITCODE -ne 0 -or $head -ne $ExpectedReleaseSha) { throw "source HEAD diverge do expected RELEASE_SHA ($head)" }
  $dirty = @(& git -C $SourceWorktree status --porcelain --untracked-files=no)
  if ($LASTEXITCODE -ne 0 -or $dirty.Count -gt 0) { throw 'source worktree possui arquivos tracked modificados' }
  return $version
}

function Invoke-ReleaseCandidatePrepare {
  param(
    [Parameter(Mandatory)][string]$SourceWorktree,
    [Parameter(Mandatory)][string]$ExpectedReleaseSha,
    [Parameter(Mandatory)][string]$CandidateRoot,
    [Parameter(Mandatory)][string]$NodeExe,
    [Parameter(Mandatory)][string]$NpmCmd,
    [Parameter(Mandatory)][string]$MigrationLedgerPath
  )
  $nodeVersion = Assert-CandidateSource -SourceWorktree $SourceWorktree -ExpectedReleaseSha $ExpectedReleaseSha -NodeExe $NodeExe
  if (-not (Test-Path -LiteralPath $NpmCmd -PathType Leaf)) { throw "NpmCmd ausente: $NpmCmd" }
  $npmVersion = (& $NodeExe $NpmCmd --version).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'npm nao executou com o Node informado' }
  $root = [System.IO.Path]::GetFullPath($CandidateRoot)
  $candidate = Join-Path $root $ExpectedReleaseSha
  if (Test-Path -LiteralPath $candidate) {
    $verified = Test-ReleaseCandidate -CandidatePath $candidate -ExpectedReleaseSha $ExpectedReleaseSha -RequireMigrationIntegrity
    if ($verified.Ok) { return $verified }
    throw ('candidate existente diverge; preservado sem sobrescrever: ' + ($verified.Errors -join '; '))
  }
  New-Item -ItemType Directory -Force -Path $root | Out-Null
  $staging = Join-Path $root ('.preparing-' + $ExpectedReleaseSha + '-' + [guid]::NewGuid().ToString('N'))
  try {
    New-Item -ItemType Directory -Force -Path $staging | Out-Null
    $frontendOut = Join-Path $staging 'frontend'
    $env:RELEASE_SHA = $ExpectedReleaseSha; $env:VITE_RELEASE_SHA = $ExpectedReleaseSha
    # NODE_ENV herdado do shell (ex.: development) faz o Vite emitir a build de desenvolvimento do React.
    $previousNodeEnv = $env:NODE_ENV
    $env:NODE_ENV = 'production'
    Push-Location $SourceWorktree
    try {
      & $NodeExe $NpmCmd run build:deploy --prefix frontend -- --outDir $frontendOut
      if ($LASTEXITCODE -ne 0) { throw 'build frontend falhou' }
      & $NodeExe $NpmCmd run build:deploy --prefix backend
      if ($LASTEXITCODE -ne 0) { throw 'build backend falhou' }
    } finally { Pop-Location; $env:NODE_ENV = $previousNodeEnv }
    New-Item -ItemType Directory -Force -Path (Join-Path $staging 'backend') | Out-Null
    Copy-Item -LiteralPath (Join-Path $SourceWorktree 'backend\dist') -Destination (Join-Path $staging 'backend\dist') -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $SourceWorktree 'backend\package.json') -Destination (Join-Path $staging 'backend\package.json') -Force
    Copy-Item -LiteralPath (Join-Path $SourceWorktree 'backend\package-lock.json') -Destination (Join-Path $staging 'backend\package-lock.json') -Force
    Copy-BackendRuntimeScripts -SourceBackend (Join-Path $SourceWorktree 'backend') -DestinationBackend (Join-Path $staging 'backend')
    Copy-CandidateTree -Source (Join-Path $SourceWorktree 'backend\prisma') -Destination (Join-Path $staging 'backend\prisma')
    $migrationIntegrity = Copy-GitMigrationBlobs -SourceWorktree $SourceWorktree -ExpectedReleaseSha $ExpectedReleaseSha -CandidatePrismaPath (Join-Path $staging 'backend\prisma') -MigrationLedgerPath $MigrationLedgerPath
    $manifest = [ordered]@{ format = $script:CandidateFormat; releaseSha = $ExpectedReleaseSha; createdAt = (Get-Date).ToUniversalTime().ToString('o'); nodeVersion = $nodeVersion; npmVersion = $npmVersion; artifacts = @('frontend', 'backend/dist', 'backend/package.json', 'backend/package-lock.json', 'backend/scripts/otel-resource-policy.mjs', 'backend/prisma'); migrationIntegrity = $migrationIntegrity; files = @(Get-CandidateFileHashes $staging) }
    $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Get-CandidateManifestPath $staging) -Encoding UTF8
    Test-ReleaseCandidate -CandidatePath $staging -ExpectedReleaseSha $ExpectedReleaseSha -ThrowOnError -RequireMigrationIntegrity | Out-Null
    Move-Item -LiteralPath $staging -Destination $candidate
    return (Test-ReleaseCandidate -CandidatePath $candidate -ExpectedReleaseSha $ExpectedReleaseSha -ThrowOnError -RequireMigrationIntegrity)
  } finally { if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue } }
}
