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
    Install-ProdBackendRuntimeLinks -Paths $Paths
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

function Install-ProdBackendRuntimeLinks {
  param([hashtable]$Paths)

  $prodBackendRoot = Join-Path $Paths.ProdArtifactsDir 'backend'
  $nodeModulesLink = Join-Path $prodBackendRoot 'node_modules'
  $sourceNodeModules = Join-Path $Paths.BackendDir 'node_modules'
  $packageJsonDest = Join-Path $prodBackendRoot 'package.json'
  $packageJsonSrc = Join-Path $Paths.BackendDir 'package.json'

  if (-not (Test-Path $sourceNodeModules)) {
    throw 'backend/node_modules ausente. Rode npm install --prefix backend.'
  }
  if (-not (Test-Path $packageJsonSrc)) {
    throw 'backend/package.json ausente.'
  }

  New-Item -ItemType Directory -Force -Path $prodBackendRoot | Out-Null

  if (Test-Path $nodeModulesLink) {
    $item = Get-Item -LiteralPath $nodeModulesLink -Force
    if ($item.LinkType -eq 'Junction') {
      $target = ($item.Target | Select-Object -First 1)
      if ($target -and ((Resolve-Path -LiteralPath $target).Path -eq (Resolve-Path -LiteralPath $sourceNodeModules).Path)) {
        Copy-Item -Path $packageJsonSrc -Destination $packageJsonDest -Force
        return
      }
    }
    Remove-Item -Path $nodeModulesLink -Recurse -Force
  }

  New-Item -ItemType Junction -Path $nodeModulesLink -Target $sourceNodeModules -Force | Out-Null
  Copy-Item -Path $packageJsonSrc -Destination $packageJsonDest -Force
}

function Stage-BackendArtifacts {
  param([hashtable]$Paths)

  if (-not (Test-Path $Paths.DevApiEntry)) {
    throw 'backend/dist/index.js ausente. Build do backend falhou ou nao foi executado.'
  }

  $stagingBackend = Join-Path $Paths.ProdStagingDir 'backend\dist'
  Copy-Item -Path (Join-Path (Split-Path $Paths.DevApiEntry -Parent) '*') -Destination $stagingBackend -Recurse -Force
}

function Publish-ProdArtifactsSwap {
  param(
    [hashtable]$Paths,
    [switch]$Frontend,
    [switch]$Backend
  )

  $stagingFrontend = Join-Path $Paths.ProdStagingDir 'frontend'
  $stagingBackend = Join-Path $Paths.ProdStagingDir 'backend'

  if ($Frontend) {
    if (-not (Test-Path (Join-Path $stagingFrontend 'index.html'))) {
      throw 'Staging frontend/index.html ausente.'
    }
    if (Test-Path $Paths.ProdFrontendDist) {
      Remove-Item -Path $Paths.ProdFrontendDist -Recurse -Force
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
      Remove-Item -Path $liveBackendRoot -Recurse -Force
    }
    Move-Item -Path $stagingBackend -Destination $liveBackendRoot
    Install-ProdBackendRuntimeLinks -Paths $Paths
  }

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
  $prodNodeModules = Join-Path $Paths.ProdArtifactsDir 'backend\node_modules'
  if (-not (Test-Path $prodNodeModules)) {
    $errors += 'Prod backend node_modules ausente (junction): ' + $prodNodeModules
  }
  if ($Paths.ServeFrontendFromApi -and -not (Test-Path (Join-Path $Paths.ProdFrontendDist 'index.html'))) {
    $errors += 'ProdFrontendDist/index.html ausente: ' + $Paths.ProdFrontendDist
  }
  return $errors
}
