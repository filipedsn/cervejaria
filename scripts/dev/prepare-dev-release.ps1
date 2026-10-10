param(
  [Parameter(Mandatory = $true)][string]$ExpectedReleaseSha
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"
$paths = Get-DevPaths
. (Join-Path $paths.ProjectRoot 'scripts\prod\release-candidate.ps1')

if ($ExpectedReleaseSha -notmatch '^[a-f0-9]{40}$') { throw 'ExpectedReleaseSha must be a full lowercase Git SHA.' }
& git -C $paths.ProjectRoot cat-file -e "$ExpectedReleaseSha^{commit}"
if ($LASTEXITCODE -ne 0) { throw 'Expected release commit is unavailable in the canonical repository.' }

$nodeVersion = (& $paths.NodeExe --version).Trim()
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v24\.') { throw "Node 24 is required; observed $nodeVersion." }
$npmVersion = (& $paths.NpmCmd --version).Trim()
if ($LASTEXITCODE -ne 0) { throw 'npm did not run with the selected Node executable.' }

$candidateRoot = Join-Path $paths.ProjectRoot 'deploy\release-candidates'
$candidate = Join-Path $candidateRoot $ExpectedReleaseSha
$dependencyRoot = Join-Path $paths.ProjectRoot "deploy\dev-runtime-dependencies\$ExpectedReleaseSha"
$runtimeNodeModules = Join-Path $dependencyRoot 'backend\node_modules'

if (Test-Path -LiteralPath $candidate) {
  Test-ReleaseCandidate -CandidatePath $candidate -ExpectedReleaseSha $ExpectedReleaseSha -ThrowOnError | Out-Null
  if (-not (Test-Path -LiteralPath $runtimeNodeModules -PathType Container)) {
    throw 'Candidate exists but its isolated DEV runtime dependencies are missing; preserving the candidate.'
  }
  $runtimeFrontend = Join-Path $dependencyRoot 'frontend'
  if (-not (Test-Path -LiteralPath (Join-Path $runtimeFrontend 'node_modules\vite\bin\vite.js'))) {
    $patchId = [guid]::NewGuid().ToString('N')
    $frontendSourceRoot = Join-Path $paths.ProjectRoot "deploy\.dev-frontend-source-$patchId"
    $frontendSource = Join-Path $frontendSourceRoot 'frontend'
    $frontendDeps = Join-Path $paths.ProjectRoot "deploy\.dev-frontend-deps-$patchId"
    $frontendArchive = Join-Path $paths.ProjectRoot "deploy\.dev-frontend-$patchId.zip"
    try {
      New-Item -ItemType Directory -Force -Path $frontendSourceRoot, $frontendDeps | Out-Null
      & git -C $paths.ProjectRoot archive --format=zip "--output=$frontendArchive" $ExpectedReleaseSha frontend
      if ($LASTEXITCODE -ne 0) { throw 'Failed to export pinned frontend source blobs.' }
      & tar.exe -xf $frontendArchive -C $frontendSourceRoot
      if ($LASTEXITCODE -ne 0) { throw 'Failed to extract pinned frontend dependency inputs.' }
      $env:NODE_ENV = 'development'
      & $paths.NpmCmd ci --prefix $frontendSource --no-audit --no-fund
      if ($LASTEXITCODE -ne 0) { throw 'Pinned frontend runtime dependency install failed.' }
      Move-Item -LiteralPath (Join-Path $frontendSource 'node_modules') -Destination (Join-Path $frontendDeps 'node_modules')
      foreach ($name in @('package.json', 'package-lock.json', 'vite.config.ts')) {
        Copy-Item -LiteralPath (Join-Path $frontendSource $name) -Destination $frontendDeps
      }
      Move-Item -LiteralPath $frontendDeps -Destination $runtimeFrontend
      $dependencyManifestPath = Join-Path $dependencyRoot 'dependency-manifest.json'
      $dependencyManifest = Get-Content -LiteralPath $dependencyManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
      $dependencyManifest | Add-Member -NotePropertyName frontendPackageLockSha256 -NotePropertyValue ((Get-FileHash -LiteralPath (Join-Path $runtimeFrontend 'package-lock.json') -Algorithm SHA256).Hash.ToLowerInvariant()) -Force
      $dependencyManifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $dependencyManifestPath -Encoding UTF8
    } finally {
      if (Test-Path -LiteralPath $frontendArchive) { Remove-Item -LiteralPath $frontendArchive -Force -ErrorAction SilentlyContinue }
      if (Test-Path -LiteralPath $frontendSourceRoot) { Remove-Item -LiteralPath $frontendSourceRoot -Recurse -Force -ErrorAction SilentlyContinue }
      if (Test-Path -LiteralPath $frontendDeps) { Remove-Item -LiteralPath $frontendDeps -Recurse -Force -ErrorAction SilentlyContinue }
    }
  }
  Write-Output "DEV_CANDIDATE_READY=$candidate"
  Write-Output "DEV_FRONTEND_RUNTIME_DEPENDENCIES_READY=$runtimeFrontend"
  exit 0
}
if (Test-Path -LiteralPath $dependencyRoot) { throw 'DEV dependency destination already exists; preserving it.' }

$buildId = [guid]::NewGuid().ToString('N')
$inputRoot = Join-Path $paths.ProjectRoot "deploy\.dev-source-$buildId"
$staging = Join-Path $paths.ProjectRoot "deploy\.dev-candidate-staging-$buildId"
$archive = Join-Path $paths.ProjectRoot "deploy\.dev-source-$buildId.zip"
$dependencyStaging = Join-Path $paths.ProjectRoot "deploy\dev-runtime-dependencies\.preparing-$buildId"

try {
  New-Item -ItemType Directory -Force -Path $candidateRoot, $inputRoot, $staging, $dependencyStaging | Out-Null
  & git -C $paths.ProjectRoot archive --format=zip "--output=$archive" $ExpectedReleaseSha
  if ($LASTEXITCODE -ne 0) { throw 'Failed to export source blobs from the selected Git revision.' }
  & tar.exe -xf $archive -C $inputRoot
  if ($LASTEXITCODE -ne 0) { throw 'Failed to extract the selected Git source archive.' }
  Remove-Item -LiteralPath $archive -Force

  $sourceBackend = Join-Path $inputRoot 'backend'
  $sourceFrontend = Join-Path $inputRoot 'frontend'
  if (-not (Test-Path (Join-Path $sourceBackend 'package-lock.json')) -or -not (Test-Path (Join-Path $sourceFrontend 'package-lock.json'))) {
    throw 'The selected revision does not contain both locked package manifests.'
  }

  $env:NODE_ENV = 'development'
  $env:DATABASE_URL = 'postgresql://build:build@127.0.0.1:5434/cervejaria_dev'
  $env:RELEASE_SHA = $ExpectedReleaseSha
  $env:VITE_RELEASE_SHA = $ExpectedReleaseSha

  & $paths.NpmCmd ci --prefix $sourceBackend --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'Backend dependencies failed to install from the selected lockfile.' }
  & $paths.NpmCmd ci --prefix $sourceFrontend --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'Frontend dependencies failed to install from the selected lockfile.' }

  & $paths.NpmCmd run build:deploy --prefix $sourceBackend
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path (Join-Path $sourceBackend 'dist\index.js'))) { throw 'Pinned backend build failed.' }
  $frontendDist = Join-Path $staging 'frontend'
  & $paths.NpmCmd run build:deploy --prefix $sourceFrontend -- --outDir $frontendDist
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path (Join-Path $frontendDist 'index.html'))) { throw 'Pinned frontend build failed.' }

  $candidateBackend = Join-Path $staging 'backend'
  New-Item -ItemType Directory -Force -Path $candidateBackend | Out-Null
  Copy-Item -LiteralPath (Join-Path $sourceBackend 'dist') -Destination $candidateBackend -Recurse
  foreach ($name in @('package.json', 'package-lock.json')) {
    Copy-Item -LiteralPath (Join-Path $sourceBackend $name) -Destination $candidateBackend
  }
  Copy-Item -LiteralPath (Join-Path $sourceBackend 'prisma') -Destination $candidateBackend -Recurse

  $dependencyBackend = Join-Path $dependencyStaging 'backend'
  $dependencyFrontend = Join-Path $dependencyStaging 'frontend'
  New-Item -ItemType Directory -Force -Path $dependencyBackend, $dependencyFrontend | Out-Null
  Move-Item -LiteralPath (Join-Path $sourceBackend 'node_modules') -Destination (Join-Path $dependencyBackend 'node_modules')
  Move-Item -LiteralPath (Join-Path $sourceFrontend 'node_modules') -Destination (Join-Path $dependencyFrontend 'node_modules')
  foreach ($name in @('package.json', 'package-lock.json', 'vite.config.ts')) {
    Copy-Item -LiteralPath (Join-Path $sourceFrontend $name) -Destination $dependencyFrontend
  }
  $dependencyManifest = [ordered]@{
    releaseSha = $ExpectedReleaseSha
    nodeVersion = $nodeVersion
    npmVersion = $npmVersion
    backendPackageLockSha256 = (Get-FileHash -LiteralPath (Join-Path $candidateBackend 'package-lock.json') -Algorithm SHA256).Hash.ToLowerInvariant()
    frontendPackageLockSha256 = (Get-FileHash -LiteralPath (Join-Path $dependencyFrontend 'package-lock.json') -Algorithm SHA256).Hash.ToLowerInvariant()
    install = 'npm ci from selected revision lockfile'
  }
  $dependencyManifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $dependencyStaging 'dependency-manifest.json') -Encoding UTF8

  $manifest = [ordered]@{
    format = $script:CandidateFormat
    releaseSha = $ExpectedReleaseSha
    createdAt = [DateTime]::UtcNow.ToString('o')
    nodeVersion = $nodeVersion
    npmVersion = $npmVersion
    artifacts = @('frontend', 'backend/dist', 'backend/package.json', 'backend/package-lock.json', 'backend/prisma')
    files = @(Get-CandidateFileHashes $staging)
  }
  $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Get-CandidateManifestPath $staging) -Encoding UTF8
  Test-ReleaseCandidate -CandidatePath $staging -ExpectedReleaseSha $ExpectedReleaseSha -ThrowOnError | Out-Null

  Move-Item -LiteralPath $staging -Destination $candidate
  Move-Item -LiteralPath $dependencyStaging -Destination $dependencyRoot
  Test-ReleaseCandidate -CandidatePath $candidate -ExpectedReleaseSha $ExpectedReleaseSha -ThrowOnError | Out-Null
  Write-Output "DEV_CANDIDATE_READY=$candidate"
  Write-Output "DEV_RUNTIME_DEPENDENCIES_READY=$dependencyRoot"
} catch {
  if ((Test-Path -LiteralPath $candidate) -and -not (Test-Path -LiteralPath $runtimeNodeModules)) {
    Write-Warning 'Candidate was retained for diagnosis; do not publish until the dependency manifest is repaired.'
  }
  throw
} finally {
  if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $inputRoot) { Remove-Item -LiteralPath $inputRoot -Recurse -Force -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $dependencyStaging) { Remove-Item -LiteralPath $dependencyStaging -Recurse -Force -ErrorAction SilentlyContinue }
}
