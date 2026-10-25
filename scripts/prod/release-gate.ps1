# Gate de origem da release: producao so publica o commit atual de origin/main,
# com arquivos rastreados limpos e atestado local de `npm run ci` para esse SHA.
# GitHub Actions build-and-unit e obrigatorio para merge em main. Este atestado local
# protege apenas o fluxo Windows legado; nao substitui o check remoto.
# Git e leitura do atestado sao injetaveis para que os testes nao dependam de rede.

function Get-LocalCiAttestationPath {
  param([Parameter(Mandatory)][string]$ProjectRoot)
  return (Join-Path $ProjectRoot 'deploy\.local-ci-attestation.json')
}

function Read-LocalCiAttestation {
  param(
    [Parameter(Mandatory)][string]$ProjectRoot,
    [string]$Path = ''
  )
  $file = if ($Path) { $Path } else { Get-LocalCiAttestationPath -ProjectRoot $ProjectRoot }
  if (-not (Test-Path -LiteralPath $file)) {
    return $null
  }
  try {
    $raw = Get-Content -LiteralPath $file -Raw -ErrorAction Stop
    # Set-Content UTF8 no PS 5.1 pode gravar BOM.
    $raw = $raw -replace '^\uFEFF', ''
    return ($raw | ConvertFrom-Json)
  } catch {
    return $null
  }
}

function Get-ReleaseGateResult {
  param(
    [Parameter(Mandatory)][string]$ProjectRoot,
    [string]$Branch = 'main',
    [scriptblock]$Git = { & git @args },
    [scriptblock]$ReadAttestation = $null
  )

  $blockers = New-Object 'System.Collections.Generic.List[string]'
  $sha = $null

  $head = @(& $Git -C $ProjectRoot rev-parse HEAD 2>$null)
  if ($LASTEXITCODE -ne 0 -or $head.Count -eq 0) {
    $blockers.Add("Nao foi possivel ler o commit atual em $ProjectRoot.")
    return [pscustomobject]@{ Ok = $false; Sha = $null; Blockers = $blockers }
  }
  $sha = ([string]$head[-1]).Trim().ToLowerInvariant()

  $dirty = @(& $Git -C $ProjectRoot status --porcelain --untracked-files=no 2>$null)
  if ($LASTEXITCODE -ne 0) {
    $blockers.Add('Nao foi possivel ler o git status da pasta do projeto.')
  } elseif ($dirty.Count -gt 0) {
    $blockers.Add("Ha $($dirty.Count) arquivo(s) rastreado(s) alterado(s) sem commit. Deploy so publica commit limpo.")
  }

  # O tsc do backend e o Vite empacotam arquivos destas pastas mesmo sem commit.
  $loose = @(& $Git -C $ProjectRoot status --porcelain --untracked-files=all -- frontend/src frontend/public backend/src backend/prisma 2>$null |
    Where-Object { $_ -like '`?`?*' })
  if ($LASTEXITCODE -eq 0 -and $loose.Count -gt 0) {
    $blockers.Add("Ha $($loose.Count) arquivo(s) sem commit em pastas que entram no build (ex.: $($loose[0].Substring(3))).")
  }

  & $Git -C $ProjectRoot fetch --quiet origin $Branch 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) {
    $blockers.Add("git fetch origin $Branch falhou; sem confirmar origin/$Branch nao ha deploy.")
  } else {
    $remote = @(& $Git -C $ProjectRoot rev-parse "origin/$Branch" 2>$null)
    $remoteSha = if ($remote.Count -gt 0) { ([string]$remote[-1]).Trim().ToLowerInvariant() } else { '' }
    if ($LASTEXITCODE -ne 0 -or -not $remoteSha) {
      $blockers.Add("Nao foi possivel ler origin/$Branch.")
    } elseif ($remoteSha -ne $sha) {
      $blockers.Add("HEAD $($sha.Substring(0, 8)) difere de origin/$Branch $($remoteSha.Substring(0, 8)). Faca merge do PR e git pull em $Branch antes do deploy.")
    }
  }

  $attest = if ($ReadAttestation) {
    & $ReadAttestation $ProjectRoot $sha
  } else {
    Read-LocalCiAttestation -ProjectRoot $ProjectRoot
  }

  if (-not $attest) {
    $blockers.Add("Sem atestado de CI local para $($sha.Substring(0, 8)). Rode ``npm run ci`` neste commit antes do deploy.")
  } else {
    $attestSha = ([string]($attest.sha)).Trim().ToLowerInvariant()
    $attestOk = $false
    if ($null -ne $attest.ok) {
      $attestOk = [bool]$attest.ok
    } elseif ($null -ne $attest.passed) {
      $attestOk = [bool]$attest.passed
    }
    if (-not $attestOk) {
      $blockers.Add("Atestado de CI local existe mas nao marca sucesso para $($sha.Substring(0, 8)). Rode ``npm run ci`` de novo.")
    } elseif (-not $attestSha) {
      $blockers.Add('Atestado de CI local esta invalido (sem sha). Rode ``npm run ci`` de novo.')
    } elseif ($attestSha -ne $sha) {
      $shortAttest = if ($attestSha.Length -ge 8) { $attestSha.Substring(0, 8) } else { $attestSha }
      $blockers.Add("Atestado de CI local e do commit $shortAttest, nao de $($sha.Substring(0, 8)). Rode ``npm run ci`` neste HEAD.")
    }
  }

  return [pscustomobject]@{
    Ok       = ($blockers.Count -eq 0)
    Sha      = $sha
    Blockers = $blockers
  }
}
