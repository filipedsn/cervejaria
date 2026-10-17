# Publica builds em deploy/prod-artifacts (isolado de frontend/dist e backend/dist locais).

. "$PSScriptRoot\_config.ps1"
. "$PSScriptRoot\release-candidate.ps1"

function Get-GitSha {
  param([string]$ProjectRoot)

  try {
    Push-Location $ProjectRoot
    $sha = (git rev-parse --short HEAD 2>$null)
    Pop-Location
    if ($sha) { return $sha.Trim() }
  } catch {
    Pop-Location -ErrorAction SilentlyContinue
  }
  return 'unknown'
}

function Get-DirectoryFileHashes {
  param([string]$Directory)

  $hashes = @{}
  if (-not (Test-Path $Directory)) { return $hashes }
  $basePath = [System.IO.Path]::GetFullPath($Directory).TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
  $transientPrismaCache = [System.IO.Path]::GetFullPath((Join-Path $basePath '@prisma\engines\node_modules\.cache\prisma\master'))
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $pending = [System.Collections.Generic.Stack[string]]::new()
    $pending.Push($basePath)
    while ($pending.Count -gt 0) {
      $currentDirectory = $pending.Pop()
      foreach ($childDirectory in [System.IO.Directory]::GetDirectories($currentDirectory)) {
        if (([System.IO.File]::GetAttributes($childDirectory) -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
          throw 'Dependency inventory encountered a linked directory.'
        }
        $pending.Push($childDirectory)
      }
      foreach ($filePath in [System.IO.Directory]::GetFiles($currentDirectory)) {
        $fullPath = [System.IO.Path]::GetFullPath($filePath)
        if (-not $fullPath.StartsWith($basePath, [System.StringComparison]::OrdinalIgnoreCase)) {
          throw 'Dependency inventory encountered a file outside its root.'
        }
        if ($fullPath.StartsWith($transientPrismaCache + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
          continue
        }
        if (([System.IO.File]::GetAttributes($fullPath) -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
          throw 'Dependency inventory encountered a linked file.'
        }
        $relative = $fullPath.Substring($basePath.Length)
        $stream = [System.IO.File]::OpenRead($fullPath)
        try { $hash = [System.BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
        finally { $stream.Dispose() }
        $hashes[$relative] = $hash
      }
    }
  } finally {
    $sha.Dispose()
  }
  return ,$hashes
}

function Ensure-ProdArtifactsBaseline {
  param([hashtable]$Paths)

  $liveFrontend = Join-Path $Paths.ProdFrontendDist 'index.html'
  if (Test-Path $liveFrontend) { return }

  $legacyFrontend = Join-Path $Paths.DevFrontendDist 'index.html'
  if (-not (Test-Path $legacyFrontend)) {
    throw 'Nenhum frontend publicado. Rode deploy completo com build do frontend.'
  }

  Write-Host 'Migracao: copiando frontend/dist legado para prod-artifacts...' -ForegroundColor Yellow
  New-Item -ItemType Directory -Force -Path $Paths.ProdFrontendDist | Out-Null
  Copy-Item -Path (Join-Path $Paths.DevFrontendDist '*') -Destination $Paths.ProdFrontendDist -Recurse -Force

  $legacyBackend = $Paths.DevApiEntry
  if (Test-Path $legacyBackend) {
    New-Item -ItemType Directory -Force -Path $Paths.ProdBackendDist | Out-Null
    Copy-Item -Path (Join-Path (Split-Path $legacyBackend -Parent) '*') -Destination $Paths.ProdBackendDist -Recurse -Force
    Install-ProdBackendRuntime -Paths $Paths
  }
}

function Initialize-ProdStaging {
  param([hashtable]$Paths)

  if (Test-Path $Paths.ProdStagingDir) {
    Remove-Item -Path $Paths.ProdStagingDir -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path (Join-Path $Paths.ProdStagingDir 'frontend') | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $Paths.ProdStagingDir 'backend\dist') | Out-Null
}

function Copy-ProdPrismaSchema {
  param([hashtable]$Paths)

  $sourcePrisma = Join-Path $Paths.BackendDir 'prisma'
  if (-not (Test-Path $sourcePrisma)) {
    throw 'backend/prisma ausente.'
  }

  New-Item -ItemType Directory -Force -Path $Paths.ProdBackendRoot | Out-Null
  if (Test-Path $Paths.ProdBackendPrisma) {
    Remove-Item -Path $Paths.ProdBackendPrisma -Recurse -Force
  }
  Copy-Item -Path $sourcePrisma -Destination $Paths.ProdBackendPrisma -Recurse -Force
}

function Test-ProdNodeModulesLinkedToDev {
  param([hashtable]$Paths)

  if (-not (Test-Path $Paths.ProdBackendNodeModules)) { return $false }

  $item = Get-Item -LiteralPath $Paths.ProdBackendNodeModules -Force
  if ($item.LinkType -ne 'Junction') { return $false }

  $target = ($item.Target | Select-Object -First 1)
  if (-not $target) { return $false }

  $devNodeModules = Join-Path $Paths.BackendDir 'node_modules'
  if (-not (Test-Path $devNodeModules)) { return $false }

  return (Resolve-Path -LiteralPath $target).Path -eq (Resolve-Path -LiteralPath $devNodeModules).Path
}

function Invoke-ProdBackendNpm {
  param(
    [hashtable]$Paths,
    [string[]]$NpmArgs
  )

  if ($Paths.NpmCmd) {
    & $Paths.NpmCmd @NpmArgs
  } else {
    npm @NpmArgs
  }
  if ($LASTEXITCODE -ne 0) {
    throw "Comando npm falhou (exit $LASTEXITCODE): npm $($NpmArgs -join ' ')"
  }
}

function Install-ProdBackendRuntime {
  param(
    [hashtable]$Paths,
    [switch]$ForceRefresh,
    [switch]$RefreshPrismaSchema
  )

  $packageJsonSrc = Join-Path $Paths.BackendDir 'package.json'
  $packageLockSrc = Join-Path $Paths.BackendDir 'package-lock.json'
  if (-not (Test-Path $packageJsonSrc)) {
    throw 'backend/package.json ausente.'
  }
  if (-not (Test-Path $packageLockSrc)) {
    throw 'backend/package-lock.json ausente. Rode npm install --prefix backend.'
  }

  New-Item -ItemType Directory -Force -Path $Paths.ProdBackendRoot | Out-Null
  Copy-Item -Path $packageJsonSrc -Destination (Join-Path $Paths.ProdBackendRoot 'package.json') -Force
  Copy-Item -Path $packageLockSrc -Destination (Join-Path $Paths.ProdBackendRoot 'package-lock.json') -Force

  if ($RefreshPrismaSchema -or -not (Test-Path (Join-Path $Paths.ProdBackendPrisma 'schema.prisma'))) {
    Copy-ProdPrismaSchema -Paths $Paths
  }

  $linkedToDev = Test-ProdNodeModulesLinkedToDev -Paths $Paths
  $prismaClient = Join-Path $Paths.ProdBackendNodeModules '.prisma\client\index.js'
  $needsInstall = $ForceRefresh -or $linkedToDev -or -not (Test-Path $prismaClient)

  if ($linkedToDev -or ($ForceRefresh -and (Test-Path $Paths.ProdBackendNodeModules))) {
    Remove-Item -Path $Paths.ProdBackendNodeModules -Recurse -Force
  }

  Push-Location $Paths.ProdBackendRoot
  try {
    if ($needsInstall) {
      Invoke-ProdBackendNpm -Paths $Paths -NpmArgs @('ci', '--omit=dev')
    }

    Invoke-ProdBackendNpm -Paths $Paths -NpmArgs @('exec', 'prisma', 'generate')
  } finally {
    Pop-Location
  }

  $runtimeManifest = [ordered]@{
    materializedAt = (Get-Date).ToUniversalTime().ToString('o')
    prismaSchema   = if (Test-Path (Join-Path $Paths.ProdBackendPrisma 'schema.prisma')) {
      (Get-FileHash -Path (Join-Path $Paths.ProdBackendPrisma 'schema.prisma') -Algorithm SHA256).Hash.ToLowerInvariant()
    } else { $null }
    isolatedNodeModules = -not (Test-ProdNodeModulesLinkedToDev -Paths $Paths)
  }
  $runtimeManifest | ConvertTo-Json -Depth 4 | Set-Content -Path (Join-Path $Paths.ProdBackendRoot '.runtime-manifest.json') -Encoding UTF8
}

function Ensure-ProdBackendRuntime {
  param(
    [hashtable]$Paths,
    [switch]$Quiet
  )

  $linkedToDev = Test-ProdNodeModulesLinkedToDev -Paths $Paths
  $missingRuntime = -not (Test-Path (Join-Path $Paths.ProdBackendNodeModules '.prisma\client\index.js'))

  if ($linkedToDev -or $missingRuntime) {
    if (-not $Quiet) {
      $reason = if ($linkedToDev) { 'node_modules apontava para o dev' } else { 'runtime de producao ausente' }
      Write-Host "Materializando runtime isolado de producao ($reason)..." -ForegroundColor Yellow
    }
    Install-ProdBackendRuntime -Paths $Paths -ForceRefresh:$linkedToDev -RefreshPrismaSchema:(-not (Test-Path (Join-Path $Paths.ProdBackendPrisma 'schema.prisma')))
  }
}

function Get-ProdNodeModulesInventorySha256 {
  param([Parameter(Mandatory)][string]$Directory)

  $hashes = Get-DirectoryFileHashes -Directory $Directory
  $rows = @($hashes.Keys | Sort-Object | ForEach-Object { [ordered]@{ path = $_; sha256 = $hashes[$_] } })
  $json = ConvertTo-Json -InputObject $rows -Depth 4 -Compress
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { return [System.BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant() }
  finally { $sha.Dispose() }
}

function Test-ProdBackendRuntimeForCandidate {
  param(
    [Parameter(Mandatory)][hashtable]$Paths,
    [Parameter(Mandatory)][string]$CandidatePath,
    [Parameter(Mandatory)][string]$ExpectedReleaseSha,
    [Parameter(Mandatory)][string]$ExpectedManifestSha256
  )

  $runtimeManifestPath = Join-Path $Paths.ProdBackendRoot '.runtime-manifest.json'
  if (-not (Test-Path -LiteralPath $runtimeManifestPath -PathType Leaf)) { return $false }
  try { $runtime = Get-Content -LiteralPath $runtimeManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json }
  catch { return $false }
  if ($runtime.candidateSha -ne $ExpectedReleaseSha -or $runtime.candidateManifestSha256 -ne $ExpectedManifestSha256) { return $false }

  $candidateManifest = Get-Content -LiteralPath (Join-Path $CandidatePath 'candidate-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($item in @($candidateManifest.files)) {
    if ($item.path -like 'backend/*') {
      $liveFile = Join-Path $Paths.ProdBackendRoot ($item.path.Substring('backend/'.Length) -replace '/', '\')
    } elseif ($item.path -like 'frontend/*') {
      $liveFile = Join-Path $Paths.ProdFrontendDist ($item.path.Substring('frontend/'.Length) -replace '/', '\')
    } elseif ($item.path -eq 'source-snapshot-inventory.json') {
      continue
    } else { return $false }
    if (-not (Test-Path -LiteralPath $liveFile -PathType Leaf)) { return $false }
    if ((Get-FileHash -LiteralPath $liveFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $item.sha256) { return $false }
  }
  $candidateBackend = Join-Path $CandidatePath 'backend'
  $candidateFiles = @{
    packageJson = Join-Path $candidateBackend 'package.json'
    packageLock = Join-Path $candidateBackend 'package-lock.json'
    prismaSchema = Join-Path $candidateBackend 'prisma/schema.prisma'
  }
  $liveFiles = @{
    packageJson = Join-Path $Paths.ProdBackendRoot 'package.json'
    packageLock = Join-Path $Paths.ProdBackendRoot 'package-lock.json'
    prismaSchema = Join-Path $Paths.ProdBackendPrisma 'schema.prisma'
  }
  foreach ($key in $candidateFiles.Keys) {
    if (-not (Test-Path -LiteralPath $liveFiles[$key] -PathType Leaf)) { return $false }
    $expected = (Get-FileHash -LiteralPath $candidateFiles[$key] -Algorithm SHA256).Hash.ToLowerInvariant()
    $actual = (Get-FileHash -LiteralPath $liveFiles[$key] -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) { return $false }
  }
  if (-not (Test-Path -LiteralPath (Join-Path $Paths.ProdBackendNodeModules '.prisma/client/index.js') -PathType Leaf)) { return $false }
  $livePackageSha = (Get-FileHash -LiteralPath $liveFiles.packageJson -Algorithm SHA256).Hash.ToLowerInvariant()
  $liveLockSha = (Get-FileHash -LiteralPath $liveFiles.packageLock -Algorithm SHA256).Hash.ToLowerInvariant()
  $liveSchemaSha = (Get-FileHash -LiteralPath $liveFiles.prismaSchema -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($runtime.packageJsonSha256 -ne $livePackageSha) { return $false }
  if ($runtime.packageLockSha256 -ne $liveLockSha) { return $false }
  if ($runtime.prismaSchemaSha256 -ne $liveSchemaSha) { return $false }
  return ((Get-ProdNodeModulesInventorySha256 -Directory $Paths.ProdBackendNodeModules) -eq $runtime.nodeModulesInventorySha256)
}

function Install-ProdBackendRuntimeFromCandidate {
  param(
    [Parameter(Mandatory)][hashtable]$Paths,
    [Parameter(Mandatory)][string]$CandidatePath,
    [Parameter(Mandatory)][string]$ExpectedReleaseSha,
    [Parameter(Mandatory)][string]$ExpectedManifestSha256
  )

  $verified = Test-ReleaseCandidate -CandidatePath $CandidatePath -ExpectedReleaseSha $ExpectedReleaseSha -RequireMigrationIntegrity -ThrowOnError
  $manifestPath = Join-Path $CandidatePath 'candidate-manifest.json'
  $manifestHash = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($manifestHash -ne $ExpectedManifestSha256) { throw 'Retained candidate manifest does not match its external SHA-256.' }
  $candidateManifest = $verified.Manifest
  if ($candidateManifest.releaseSha -ne $ExpectedReleaseSha -or $candidateManifest.sourceSnapshot.commit -ne $ExpectedReleaseSha) {
    throw 'Retained candidate source identity does not match the approved application SHA.'
  }
  $expectedBackend = [System.IO.Path]::GetFullPath((Join-Path $CandidatePath 'backend'))
  if ([System.IO.Path]::GetFullPath($Paths.BackendDir) -ne $expectedBackend) {
    throw 'Production runtime package source must be the backend directory inside the retained candidate.'
  }
  if (-not (Test-ProdBackendRuntimeForCandidate -Paths $Paths -CandidatePath $CandidatePath -ExpectedReleaseSha $ExpectedReleaseSha -ExpectedManifestSha256 $ExpectedManifestSha256)) {
    foreach ($item in @($candidateManifest.files)) {
      if ($item.path -like 'backend/*') {
        $liveFile = Join-Path $Paths.ProdBackendRoot ($item.path.Substring('backend/'.Length) -replace '/', '\')
      } elseif ($item.path -like 'frontend/*') {
        $liveFile = Join-Path $Paths.ProdFrontendDist ($item.path.Substring('frontend/'.Length) -replace '/', '\')
      } elseif ($item.path -eq 'source-snapshot-inventory.json') { continue }
      else { throw 'Retained candidate contains an unsupported published file path.' }
      if (-not (Test-Path -LiteralPath $liveFile -PathType Leaf)) {
        throw "Published production file is missing: $($item.path)"
      }
      $liveSha = (Get-FileHash -LiteralPath $liveFile -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($liveSha -ne $item.sha256) {
        throw "Published production file differs from the retained candidate: $($item.path)"
      }
    }
  }
  if (Test-ProdBackendRuntimeForCandidate -Paths $Paths -CandidatePath $CandidatePath -ExpectedReleaseSha $ExpectedReleaseSha -ExpectedManifestSha256 $ExpectedManifestSha256) {
    return [pscustomobject]@{ status='PASS'; installed=$false; candidateSha=$ExpectedReleaseSha; manifestSha256=$ExpectedManifestSha256; runtimeManifest=(Join-Path $Paths.ProdBackendRoot '.runtime-manifest.json') }
  }

  $candidateBackend = Join-Path $CandidatePath 'backend'
  $candidateFiles = @{
    packageJson = Join-Path $candidateBackend 'package.json'
    packageLock = Join-Path $candidateBackend 'package-lock.json'
    prismaSchema = Join-Path $candidateBackend 'prisma/schema.prisma'
  }
  foreach ($file in $candidateFiles.Values) { if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw 'Retained candidate is missing a required runtime package file.' } }
  foreach ($pair in @(
    @((Join-Path $Paths.ProdBackendRoot 'package.json'), $candidateFiles.packageJson),
    @((Join-Path $Paths.ProdBackendRoot 'package-lock.json'), $candidateFiles.packageLock),
    @((Join-Path $Paths.ProdBackendPrisma 'schema.prisma'), $candidateFiles.prismaSchema)
  )) {
    if (-not (Test-Path -LiteralPath $pair[0] -PathType Leaf)) { throw 'Published candidate is missing package, lockfile, or Prisma schema.' }
    $expected = (Get-FileHash -LiteralPath $pair[1] -Algorithm SHA256).Hash.ToLowerInvariant()
    $actual = (Get-FileHash -LiteralPath $pair[0] -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) { throw 'Published package, lockfile, or Prisma schema differs from the retained candidate.' }
  }

  if (Test-Path -LiteralPath $Paths.ProdBackendNodeModules) {
    $nodeModulesItem = Get-Item -LiteralPath $Paths.ProdBackendNodeModules -Force
    if (($nodeModulesItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw 'Refusing to run npm ci against a linked production node_modules directory.'
    }
    # npm ci removes and recreates a normal node_modules directory itself.
    # Avoid a separate recursive delete that can race transient Prisma engine cache files.
  }
  Push-Location $Paths.ProdBackendRoot
  try {
    Invoke-ProdBackendNpm -Paths $Paths -NpmArgs @('ci', '--include=dev', '--no-audit', '--no-fund')
    Invoke-ProdBackendNpm -Paths $Paths -NpmArgs @('exec', '--', 'prisma', 'generate', '--schema', (Join-Path $Paths.ProdBackendPrisma 'schema.prisma'))
  } finally { Pop-Location }

  foreach ($pair in @(
    @((Join-Path $Paths.ProdBackendRoot 'package.json'), $candidateFiles.packageJson),
    @((Join-Path $Paths.ProdBackendRoot 'package-lock.json'), $candidateFiles.packageLock),
    @((Join-Path $Paths.ProdBackendPrisma 'schema.prisma'), $candidateFiles.prismaSchema)
  )) {
    $expected = (Get-FileHash -LiteralPath $pair[1] -Algorithm SHA256).Hash.ToLowerInvariant()
    $actual = (Get-FileHash -LiteralPath $pair[0] -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) { throw 'Pinned dependency materialization changed an approved candidate file.' }
  }
  $clientFile = Join-Path $Paths.ProdBackendNodeModules '.prisma/client/index.js'
  if (-not (Test-Path -LiteralPath $clientFile -PathType Leaf)) { throw 'Pinned dependency materialization did not generate the Prisma Client.' }
  $packageSha = (Get-FileHash -LiteralPath (Join-Path $Paths.ProdBackendRoot 'package.json') -Algorithm SHA256).Hash.ToLowerInvariant()
  $lockSha = (Get-FileHash -LiteralPath (Join-Path $Paths.ProdBackendRoot 'package-lock.json') -Algorithm SHA256).Hash.ToLowerInvariant()
  $schemaSha = (Get-FileHash -LiteralPath (Join-Path $Paths.ProdBackendPrisma 'schema.prisma') -Algorithm SHA256).Hash.ToLowerInvariant()
  $inventorySha = Get-ProdNodeModulesInventorySha256 -Directory $Paths.ProdBackendNodeModules
  $runtimeManifest = [ordered]@{
    materializedAt = [DateTime]::UtcNow.ToString('o')
    candidateSha = $ExpectedReleaseSha
    candidateManifestSha256 = $ExpectedManifestSha256
    packageJsonSha256 = $packageSha
    packageLockSha256 = $lockSha
    prismaSchemaSha256 = $schemaSha
    nodeModulesInventorySha256 = $inventorySha
    dependencyMaterialization = 'npm ci --include=dev from retained package lock; Prisma generated from retained schema'
    dependencyInventoryExclusions = @('@prisma/engines/node_modules/.cache/prisma/master/** (transient Prisma engine download cache)')
    isolatedNodeModules = $true
  }
  $runtimeManifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $Paths.ProdBackendRoot '.runtime-manifest.json') -Encoding UTF8
  if (-not (Test-ProdBackendRuntimeForCandidate -Paths $Paths -CandidatePath $CandidatePath -ExpectedReleaseSha $ExpectedReleaseSha -ExpectedManifestSha256 $ExpectedManifestSha256)) {
    throw 'Materialized production runtime does not match the retained candidate and dependency inventory.'
  }
  return [pscustomobject]@{ status='PASS'; installed=$true; candidateSha=$ExpectedReleaseSha; manifestSha256=$ExpectedManifestSha256; packageJsonSha256=$packageSha; packageLockSha256=$lockSha; prismaSchemaSha256=$schemaSha; nodeModulesInventorySha256=$inventorySha; runtimeManifest=(Join-Path $Paths.ProdBackendRoot '.runtime-manifest.json') }
}

function Assert-ProdDatabaseSchemaSync {
  param([hashtable]$Paths)

  if (-not (Test-Path (Join-Path $Paths.ProdBackendPrisma 'schema.prisma'))) {
    throw 'Schema Prisma de producao ausente em prod-artifacts/backend/prisma. Execute: npm run prod:materialize-runtime ou prod:deploy.'
  }

  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  Push-Location $Paths.ProdBackendRoot
  try {
    # start-api.ps1 imports and validates the production environment before
    # reaching this preflight. Execute Prisma from the published backend so
    # package resolution, schema and migrations are all release-scoped.
    $output = & $Paths.NpmCmd exec prisma migrate status 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    Pop-Location
    $ErrorActionPreference = $prevEap
  }

  if ($exitCode -ne 0) {
    $details = ($output | ForEach-Object { "$_" }) -join [Environment]::NewLine
    throw @"
Banco de producao desatualizado em relacao ao schema publicado em prod-artifacts.
$details
Execute: npm run db:migrate:prod
"@
  }
}

function Stage-BackendArtifacts {
  param([hashtable]$Paths)

  if (-not (Test-Path $Paths.DevApiEntry)) {
    throw 'backend/dist/index.js ausente. Build do backend falhou ou nao foi executado.'
  }

  $stagingBackend = Join-Path $Paths.ProdStagingDir 'backend\dist'
  Copy-Item -Path (Join-Path (Split-Path $Paths.DevApiEntry -Parent) '*') -Destination $stagingBackend -Recurse -Force
}

function Stage-ReleaseCandidateArtifacts {
  param(
    [hashtable]$Paths,
    [Parameter(Mandatory)][string]$CandidatePath,
    [Parameter(Mandatory)][string]$ExpectedReleaseSha
  )

  # O candidate e revalidado antes de tocar no staging do swap. Nenhum build e feito
  # aqui; o staging e apenas uma copia descartavel para a promocao atomica existente.
  Test-ReleaseCandidate -CandidatePath $CandidatePath -ExpectedReleaseSha $ExpectedReleaseSha -ThrowOnError | Out-Null
  Initialize-ProdStaging -Paths $Paths
  Copy-Item -Path (Join-Path $CandidatePath 'frontend\*') -Destination (Join-Path $Paths.ProdStagingDir 'frontend') -Recurse -Force
  Copy-Item -Path (Join-Path $CandidatePath 'backend\*') -Destination (Join-Path $Paths.ProdStagingDir 'backend') -Recurse -Force
}

function Publish-ReleaseCandidateArtifacts {
  param(
    [hashtable]$Paths,
    [Parameter(Mandatory)][string]$CandidatePath,
    [Parameter(Mandatory)][string]$ExpectedReleaseSha
  )

  Test-ReleaseCandidate -CandidatePath $CandidatePath -ExpectedReleaseSha $ExpectedReleaseSha -ThrowOnError | Out-Null
  Stage-ReleaseCandidateArtifacts -Paths $Paths -CandidatePath $CandidatePath -ExpectedReleaseSha $ExpectedReleaseSha
  Publish-ProdArtifactsSwap -Paths $Paths -Frontend -Backend
  Write-ProdManifest -Paths $Paths -GitSha $ExpectedReleaseSha -DeployMeta @{ source = 'retained-candidate'; candidateManifest = 'candidate-manifest.json' }
}

function Reset-ProdRollbackPoint {
  param([hashtable]$Paths)

  $previous = $Paths.ProdArtifactsPrevious
  if (Test-Path $previous) {
    Remove-Item -Path $previous -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $previous | Out-Null
  return $previous
}

function Write-ProdRollbackMeta {
  param(
    [string]$PreviousDir,
    [string[]]$Parts
  )

  $sourceManifest = Join-Path $PreviousDir 'manifest.json'
  $gitSha = 'unknown'
  $deployedAt = $null
  if (Test-Path $sourceManifest) {
    try {
      $json = Get-Content $sourceManifest -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($json.gitSha) { $gitSha = $json.gitSha }
      if ($json.deployedAt) { $deployedAt = $json.deployedAt }
    } catch {
      # manifest corrompido nao impede o rollback dos arquivos
    }
  }

  [ordered]@{
    savedAt          = (Get-Date).ToUniversalTime().ToString('o')
    gitSha           = $gitSha
    originalDeployAt = $deployedAt
    parts            = $Parts
  } | ConvertTo-Json -Depth 4 | Set-Content -Path (Join-Path $PreviousDir 'rollback-point.json') -Encoding UTF8
}

function Publish-ProdArtifactsSwap {
  param(
    [hashtable]$Paths,
    [switch]$Frontend,
    [switch]$Backend
  )

  $stagingFrontend = Join-Path $Paths.ProdStagingDir 'frontend'
  $stagingBackend = Join-Path $Paths.ProdStagingDir 'backend'

  # A release que esta no ar e movida para prod-artifacts.previous em vez de apagada.
  # Move e rename no mesmo volume: custa o mesmo que o Remove-Item anterior e habilita
  # o rollback.ps1. O node_modules vai junto, entao voltar nao exige npm ci.
  $previous = Reset-ProdRollbackPoint -Paths $Paths
  $savedParts = @()
  if (Test-Path $Paths.ProdManifest) {
    Copy-Item -Path $Paths.ProdManifest -Destination (Join-Path $previous 'manifest.json') -Force
  }

  if ($Frontend) {
    if (-not (Test-Path (Join-Path $stagingFrontend 'index.html'))) {
      throw 'Staging frontend/index.html ausente.'
    }
    if (Test-Path $Paths.ProdFrontendDist) {
      Move-Item -Path $Paths.ProdFrontendDist -Destination (Join-Path $previous 'frontend')
      $savedParts += 'frontend'
    }
    New-Item -ItemType Directory -Force -Path $Paths.ProdArtifactsDir | Out-Null
    Move-Item -Path $stagingFrontend -Destination $Paths.ProdFrontendDist
  }

  if ($Backend) {
    if (-not (Test-Path (Join-Path $stagingBackend 'dist\index.js'))) {
      throw 'Staging backend/dist/index.js ausente.'
    }
    $liveBackendRoot = Join-Path $Paths.ProdArtifactsDir 'backend'
    if (Test-Path $liveBackendRoot) {
      Move-Item -Path $liveBackendRoot -Destination (Join-Path $previous 'backend')
      $savedParts += 'backend'
    }
    Move-Item -Path $stagingBackend -Destination $liveBackendRoot
    Install-ProdBackendRuntime -Paths $Paths -RefreshPrismaSchema
  }

  Write-ProdRollbackMeta -PreviousDir $previous -Parts $savedParts

  if (Test-Path $Paths.ProdStagingDir) {
    Remove-Item -Path $Paths.ProdStagingDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Write-ProdManifest {
  param(
    [hashtable]$Paths,
    [string]$GitSha,
    [hashtable]$DeployMeta
  )

  $frontendAssets = @{}
  $assetsDir = Join-Path $Paths.ProdFrontendDist 'assets'
  if (Test-Path $assetsDir) {
    Get-ChildItem -Path $assetsDir -File | Where-Object {
      $_.Name -like 'index-*.js' -or $_.Name -like 'index-*.css'
    } | ForEach-Object {
      $frontendAssets[$_.Name] = (Get-FileHash -Path $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
  }

  $manifest = [ordered]@{
    deployedAt = (Get-Date).ToUniversalTime().ToString('o')
    gitSha     = if ($GitSha) { $GitSha } else { Get-GitSha -ProjectRoot $Paths.ProjectRoot }
    frontend   = [ordered]@{
      indexHtml = if (Test-Path (Join-Path $Paths.ProdFrontendDist 'index.html')) {
        (Get-FileHash -Path (Join-Path $Paths.ProdFrontendDist 'index.html') -Algorithm SHA256).Hash.ToLowerInvariant()
      } else { $null }
      assets    = $frontendAssets
    }
    backend    = [ordered]@{
      entry = if (Test-Path $Paths.ProdApiEntry) {
        (Get-FileHash -Path $Paths.ProdApiEntry -Algorithm SHA256).Hash.ToLowerInvariant()
      } else { $null }
    }
    deploy     = $DeployMeta
  }

  $manifest | ConvertTo-Json -Depth 6 | Set-Content -Path $Paths.ProdManifest -Encoding UTF8
}

function Test-ProdArtifactsReady {
  param([hashtable]$Paths)

  $errors = @()
  if (-not (Test-Path $Paths.ProdApiEntry)) {
    $errors += 'ProdApiEntry ausente: ' + $Paths.ProdApiEntry
  }
  $prismaClient = Join-Path $Paths.ProdBackendNodeModules '.prisma\client\index.js'
  if (-not (Test-Path $prismaClient)) {
    $errors += 'Prod backend Prisma Client ausente: ' + $prismaClient
  }
  if (Test-ProdNodeModulesLinkedToDev -Paths $Paths) {
    $errors += 'Prod backend node_modules ainda aponta para dev: ' + $Paths.ProdBackendNodeModules
  }
  $prodPrismaSchema = Join-Path $Paths.ProdBackendPrisma 'schema.prisma'
  if (-not (Test-Path $prodPrismaSchema)) {
    $errors += 'Prod backend prisma/schema.prisma ausente: ' + $prodPrismaSchema
  }
  if ($Paths.ServeFrontendFromApi -and -not (Test-Path (Join-Path $Paths.ProdFrontendDist 'index.html'))) {
    $errors += 'ProdFrontendDist/index.html ausente: ' + $Paths.ProdFrontendDist
  }
  return $errors
}
