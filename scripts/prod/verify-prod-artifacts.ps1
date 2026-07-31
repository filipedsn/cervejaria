# Verifica se o frontend servido em :3001 corresponde ao manifest de prod-artifacts.

param(
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"

try {
  $settings = Get-QuiverTapSettings
  $paths = Resolve-QuiverTapPaths -Settings $settings
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  exit 1
}

if (-not (Test-Path $paths.ProdManifest)) {
  Write-Host 'Manifest ausente. Rode npm run prod:deploy.' -ForegroundColor Red
  exit 1
}

$manifest = Get-Content -Path $paths.ProdManifest -Raw -Encoding UTF8 | ConvertFrom-Json
$issues = @()

try {
  $liveIndex = Invoke-WebRequest -Uri $paths.FrontendUrl -UseBasicParsing -TimeoutSec 10
  if ($liveIndex.StatusCode -ne 200) {
    $issues += "Frontend respondeu HTTP $($liveIndex.StatusCode)"
  } else {
    $html = $liveIndex.Content
    if ($manifest.frontend.indexHtml) {
      $localIndexPath = Join-Path $paths.ProdFrontendDist 'index.html'
      if (Test-Path $localIndexPath) {
        $localHash = (Get-FileHash -Path $localIndexPath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($localHash -ne $manifest.frontend.indexHtml) {
          $issues += 'index.html local difere do manifest (deploy incompleto?)'
        }
      }
    }

    foreach ($assetName in $manifest.frontend.assets.PSObject.Properties.Name) {
      if ($html -notmatch [regex]::Escape($assetName)) {
        $issues += "Bundle servido nao referencia $assetName do manifest"
      }
    }
  }
} catch {
  $issues += "Falha ao ler $($paths.FrontendUrl): $($_.Exception.Message)"
}

if ($issues.Count -eq 0) {
  if (-not $Quiet) {
    Write-Host 'Artefatos de producao alinhados com manifest.' -ForegroundColor Green
    Write-Host "  Manifest: $($paths.ProdManifest)"
    Write-Host "  gitSha:   $($manifest.gitSha)"
    Write-Host "  deployed: $($manifest.deployedAt)"
  }
  exit 0
}

Write-Host 'Drift detectado nos artefatos de producao:' -ForegroundColor Red
foreach ($issue in $issues) {
  Write-Host "  - $issue" -ForegroundColor Red
}
Write-Host 'Execute npm run prod:deploy apos validar em dev.' -ForegroundColor Yellow
exit 1
