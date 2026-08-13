# Publica builds em deploy/prod-artifacts (isolado de frontend/dist e backend/dist locais).

. "$PSScriptRoot\_config.ps1"

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

  Get-ChildItem -Path $Directory -Recurse -File | ForEach-Object {
    $relative = $_.FullName.Substring($Directory.Length).TrimStart('\', '/')
    $hash = (Get-FileHash -Path $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $hashes[$relative] = $hash
  }
  return $hashes
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

function Assert-ProdDatabaseSchemaSync {
  param([hashtable]$Paths)

  if (-not (Test-Path (Join-Path $Paths.ProdBackendPrisma 'schema.prisma'))) {
    throw 'Schema Prisma de producao ausente em prod-artifacts/backend/prisma. Execute: npm run prod:materialize-runtime ou prod:deploy.'
  }

  $runWithEnv = Join-Path $Paths.BackendDir 'scripts\run-with-env.mjs'
  if (-not (Test-Path $runWithEnv)) {
    throw "Script de ambiente ausente: $runWithEnv"
  }

  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  Push-Location $Paths.ProdBackendRoot
  try {
    $output = & $Paths.NodeExe $runWithEnv production npx prisma migrate status 2>&1
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
    gitSha     = Get-GitSha -ProjectRoot $Paths.ProjectRoot
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
