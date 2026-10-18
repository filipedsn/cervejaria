# Gate de origem da release: producao so publica o commit atual de origin/main,
# com arquivos rastreados limpos e o workflow CI concluido com sucesso nesse SHA.
# Git e gh sao injetaveis para que os testes nao dependam de rede nem do repositorio real.

function Get-ReleaseGateResult {
  param(
    [Parameter(Mandatory)][string]$ProjectRoot,
    [string]$Branch = 'main',
    [string]$Workflow = 'CI',
    [scriptblock]$Git = { & git @args },
    [scriptblock]$Gh = { & gh @args }
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

  $runsJson = & $Gh run list --workflow $Workflow --commit $sha --limit 20 --json 'status,conclusion,event,headBranch,url' 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $runsJson) {
    $blockers.Add("Nao foi possivel consultar o workflow $Workflow no GitHub (gh instalado e autenticado?).")
  } else {
    # PowerShell 5.1 emite o array JSON como um unico objeto; o pipeline o desmonta.
    $runs = @((($runsJson -join "`n") | ConvertFrom-Json) | ForEach-Object { $_ })
    $succeeded = @($runs | Where-Object { $_.status -eq 'completed' -and $_.conclusion -eq 'success' })
    $running = @($runs | Where-Object { $_.status -ne 'completed' })
    if ($succeeded.Count -eq 0) {
      if ($running.Count -gt 0) {
        $blockers.Add("Workflow $Workflow ainda em execucao para $($sha.Substring(0, 8)). Aguarde terminar verde.")
      } elseif ($runs.Count -gt 0) {
        $blockers.Add("Workflow $Workflow nao passou para $($sha.Substring(0, 8)): $($runs[0].url)")
      } else {
        $blockers.Add("Nenhuma execucao do workflow $Workflow encontrada para $($sha.Substring(0, 8)).")
      }
    }
  }

  return [pscustomobject]@{
    Ok       = ($blockers.Count -eq 0)
    Sha      = $sha
    Blockers = $blockers
  }
}
