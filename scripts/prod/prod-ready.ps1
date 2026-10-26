# Verificacoes de prontidao para deploy (somente leitura).
# Legado do PC como producao; o estado da entrega fica no ops-panel (npm run ops:open).

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"

function Test-DockerContainerRunning {
  param([string]$Name)
  try {
    $found = & docker ps --filter "name=$Name" --filter 'status=running' --format '{{.Names}}' 2>$null
  } catch {
    return $false
  }
  return [bool]($found -match [regex]::Escape($Name))
}

$settings = Get-QuiverTapSettings
$paths = Resolve-QuiverTapPaths -Settings $settings
Set-Location $paths.ProjectRoot

Write-Host ''
Write-Host 'Quiver Tap - Prontidao para deploy' -ForegroundColor Cyan
Write-Host '===================================' -ForegroundColor Cyan
Write-Host ''

$blockers = 0

Write-Host '[1/3] Git sincronizado' -ForegroundColor Cyan
$branch = (git rev-parse --abbrev-ref HEAD 2>$null).Trim()
$fetchOut = git fetch origin main --quiet 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host "  AVISO: git fetch falhou: $fetchOut" -ForegroundColor Yellow
}

$dirtyPreSync = git status --porcelain
$behind = [int](git rev-list --count HEAD..origin/main 2>$null)
$ahead = [int](git rev-list --count origin/main..HEAD 2>$null)
git merge-base --is-ancestor HEAD origin/main 2>$null | Out-Null
$ancestorOk = ($LASTEXITCODE -eq 0)

$shouldSync = (-not $dirtyPreSync) -and (
  ($branch -ne 'main') -or ($behind -gt 0) -or (-not $ancestorOk)
) -and -not ($branch -eq 'main' -and $ahead -gt 0)

if ($shouldSync) {
  $prevBranch = $branch
  if ($branch -ne 'main') {
    Write-Host "  Auto-sync: checkout main (era $prevBranch)..." -ForegroundColor Cyan
    git checkout main 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }
    if ($LASTEXITCODE -ne 0) {
      Write-Host '  BLOQUEIO: git checkout main falhou.' -ForegroundColor Red
      $blockers++
    }
  }
  if ($blockers -eq 0) {
    Write-Host '  Auto-sync: git pull --ff-only origin main...' -ForegroundColor Cyan
    git pull --ff-only origin main 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }
    if ($LASTEXITCODE -ne 0) {
      Write-Host '  BLOQUEIO: git pull --ff-only falhou. Resolva manualmente.' -ForegroundColor Red
      $blockers++
    } else {
      $branch = (git rev-parse --abbrev-ref HEAD 2>$null).Trim()
      $behind = [int](git rev-list --count HEAD..origin/main 2>$null)
      $ahead = [int](git rev-list --count origin/main..HEAD 2>$null)
      git merge-base --is-ancestor HEAD origin/main 2>$null | Out-Null
      $ancestorOk = ($LASTEXITCODE -eq 0)
      if ($prevBranch -ne 'main') {
        Write-Host "  OK - sincronizado automaticamente ($prevBranch -> main, $((git rev-parse --short HEAD).Trim()))" -ForegroundColor Green
      } else {
        Write-Host "  OK - main atualizada ($((git rev-parse --short HEAD).Trim()))" -ForegroundColor Green
      }
    }
  }
}

if ($blockers -eq 0) {
  if ($branch -ne 'main') {
    Write-Host "  BLOQUEIO: branch atual e '$branch', esperado main." -ForegroundColor Red
    $blockers++
  } elseif ($behind -gt 0) {
    Write-Host "  BLOQUEIO: faltam $behind commit(s) apos auto-sync." -ForegroundColor Red
    $blockers++
  } elseif (-not $ancestorOk) {
    Write-Host '  BLOQUEIO: HEAD nao esta em origin/main (merge o PR no GitHub).' -ForegroundColor Red
    $blockers++
  } elseif ($ahead -gt 0) {
    Write-Host "  AVISO: local esta $ahead commit(s) a frente de origin/main." -ForegroundColor Yellow
  } else {
    Write-Host "  OK - main alinhada com origin/main ($((git rev-parse --short HEAD).Trim()))" -ForegroundColor Green
  }
}

Write-Host ''
Write-Host '[2/3] Working tree' -ForegroundColor Cyan
$dirty = git status --porcelain
if ($dirty) {
  Write-Host '  BLOQUEIO: arquivos sujos (apague, commite ou ignore):' -ForegroundColor Red
  $dirty | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
  $blockers++
} else {
  Write-Host '  OK - working tree limpa' -ForegroundColor Green
}

Write-Host ''
Write-Host '[3/3] Ambiente' -ForegroundColor Cyan
if (Test-DockerContainerRunning -Name 'cervejaria-db') {
  Write-Host '  OK - container cervejaria-db rodando' -ForegroundColor Green
} else {
  Write-Host '  BLOQUEIO: container cervejaria-db parado' -ForegroundColor Red
  $blockers++
}

$logosDir = Join-Path $paths.ProdUploadsDir 'logos'
if (Test-Path $logosDir) {
  $logoCount = (Get-ChildItem $logosDir -Filter '*.webp' -ErrorAction SilentlyContinue).Count
  Write-Host "  OK - uploads em backend/uploads-prod ($logoCount logo(s))" -ForegroundColor Green
} else {
  Write-Host '  AVISO: pasta backend/uploads-prod/logos ainda nao existe' -ForegroundColor Yellow
}

Write-Host ''
if ($blockers -gt 0) {
  Write-Host "Prontidao: $blockers bloqueio(s)." -ForegroundColor Red
  exit 1
}

Write-Host 'Prontidao: OK. O deploy publico e feito pela esteira Deploy PRD (VPS); acompanhe em npm run ops:open.' -ForegroundColor Green
exit 0
