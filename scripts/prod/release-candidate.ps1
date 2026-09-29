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
  return @('frontend/index.html', 'backend/dist/index.js', 'backend/package.json', 'backend/package-lock.json', 'backend/prisma/schema.prisma')
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

function Test-ReleaseCandidate {
  param(
    [Parameter(Mandatory)][string]$CandidatePath,
    [Parameter(Mandatory)][string]$ExpectedReleaseSha,
    [switch]$ThrowOnError
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
    if (-not $manifest.files -or @($manifest.files).Count -eq 0) { $errors += 'candidate manifest sem checksums' }
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
    [Parameter(Mandatory)][string]$NpmCmd
  )
  $nodeVersion = Assert-CandidateSource -SourceWorktree $SourceWorktree -ExpectedReleaseSha $ExpectedReleaseSha -NodeExe $NodeExe
  if (-not (Test-Path -LiteralPath $NpmCmd -PathType Leaf)) { throw "NpmCmd ausente: $NpmCmd" }
  $npmVersion = (& $NodeExe $NpmCmd --version).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'npm nao executou com o Node informado' }
  $root = [System.IO.Path]::GetFullPath($CandidateRoot)
  $candidate = Join-Path $root $ExpectedReleaseSha
  if (Test-Path -LiteralPath $candidate) {
    $verified = Test-ReleaseCandidate -CandidatePath $candidate -ExpectedReleaseSha $ExpectedReleaseSha
    if ($verified.Ok) { return $verified }
    throw ('candidate existente diverge; preservado sem sobrescrever: ' + ($verified.Errors -join '; '))
  }
  New-Item -ItemType Directory -Force -Path $root | Out-Null
  $staging = Join-Path $root ('.preparing-' + $ExpectedReleaseSha + '-' + [guid]::NewGuid().ToString('N'))
  try {
    New-Item -ItemType Directory -Force -Path $staging | Out-Null
    $frontendOut = Join-Path $staging 'frontend'
    $env:RELEASE_SHA = $ExpectedReleaseSha; $env:VITE_RELEASE_SHA = $ExpectedReleaseSha
    Push-Location $SourceWorktree
    try {
      & $NodeExe $NpmCmd run build:deploy --prefix frontend -- --outDir $frontendOut
      if ($LASTEXITCODE -ne 0) { throw 'build frontend falhou' }
      & $NodeExe $NpmCmd run build:deploy --prefix backend
      if ($LASTEXITCODE -ne 0) { throw 'build backend falhou' }
    } finally { Pop-Location }
    New-Item -ItemType Directory -Force -Path (Join-Path $staging 'backend') | Out-Null
    Copy-Item -LiteralPath (Join-Path $SourceWorktree 'backend\dist') -Destination (Join-Path $staging 'backend\dist') -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $SourceWorktree 'backend\package.json') -Destination (Join-Path $staging 'backend\package.json') -Force
    Copy-Item -LiteralPath (Join-Path $SourceWorktree 'backend\package-lock.json') -Destination (Join-Path $staging 'backend\package-lock.json') -Force
    Copy-CandidateTree -Source (Join-Path $SourceWorktree 'backend\prisma') -Destination (Join-Path $staging 'backend\prisma')
    $manifest = [ordered]@{ format = $script:CandidateFormat; releaseSha = $ExpectedReleaseSha; createdAt = (Get-Date).ToUniversalTime().ToString('o'); nodeVersion = $nodeVersion; npmVersion = $npmVersion; artifacts = @('frontend', 'backend/dist', 'backend/package.json', 'backend/package-lock.json', 'backend/prisma'); files = @(Get-CandidateFileHashes $staging) }
    $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Get-CandidateManifestPath $staging) -Encoding UTF8
    Test-ReleaseCandidate -CandidatePath $staging -ExpectedReleaseSha $ExpectedReleaseSha -ThrowOnError | Out-Null
    Move-Item -LiteralPath $staging -Destination $candidate
    return (Test-ReleaseCandidate -CandidatePath $candidate -ExpectedReleaseSha $ExpectedReleaseSha -ThrowOnError)
  } finally { if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue } }
}
