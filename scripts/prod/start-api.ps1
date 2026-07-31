# Inicia a API de produção (deploy/prod-artifacts) em segundo plano.

param(
  [switch]$Force,
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_config.ps1"
. "$PSScriptRoot\publish-artifacts.ps1"

$settings = Get-QuiverTapSettings
$paths = Resolve-QuiverTapPaths -Settings $settings

if (Test-ApiHealthy -HealthUrl $paths.ReadyUrl) {
  if (-not $Force) {
    Write-Host "API ja esta no ar ($($paths.ReadyUrl))." -ForegroundColor Green
    exit 0
  }
  if (-not $Quiet) {
    Write-Host 'Forcando novo start da API (ignorando health check)...' -ForegroundColor Yellow
  }
}

if (-not (Test-Path $paths.ProdApiEntry)) {
  Ensure-ProdArtifactsBaseline -Paths $paths
}
if (-not (Test-Path $paths.ProdApiEntry)) {
  Write-Host ('ProdApiEntry ausente: ' + $paths.ProdApiEntry) -ForegroundColor Red
  Write-Host 'Artefatos de producao ausentes. Execute: npm run prod:deploy' -ForegroundColor Red
  exit 1
}

try {
  Install-ProdBackendRuntimeLinks -Paths $paths
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  exit 1
}

$artifactErrors = Test-ProdArtifactsReady -Paths $paths
if ($artifactErrors.Count -gt 0) {
  foreach ($err in $artifactErrors) {
    Write-Host $err -ForegroundColor Red
  }
  Write-Host 'Artefatos de producao incompletos. Execute: npm run prod:deploy' -ForegroundColor Red
  exit 1
}

if (Test-Path $paths.ApiPidFile) {
  $oldPid = [int](Get-Content $paths.ApiPidFile -ErrorAction SilentlyContinue)
  if (Test-ProcessAlive -ProcessId $oldPid) {
    if ($Force) {
      if (-not $Quiet) {
        Write-Host "Forcando parada da API PID $oldPid..." -ForegroundColor Yellow
      }
      Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
      Start-Sleep -Seconds 1
    } else {
      Write-Host "Processo API PID $oldPid ainda ativo; aguardando health..." -ForegroundColor Yellow
      Start-Sleep -Seconds 2
      if (Test-ApiHealthy -HealthUrl $paths.ReadyUrl) { exit 0 }
      Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
    }
  }
}

if (Test-PortListening -Port $paths.ApiPort) {
  if ($Force) {
    Write-WatchdogLog -Paths $paths -Message "Forcando liberacao da porta $($paths.ApiPort)."
  } else {
    Write-WatchdogLog -Paths $paths -Message "Porta $($paths.ApiPort) em uso sem health OK - tentando liberar."
  }
  $conns = Get-NetTCPConnection -LocalPort $paths.ApiPort -State Listen -ErrorAction SilentlyContinue
  foreach ($c in $conns) {
    if ($c.OwningProcess) {
      Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
    }
  }
  Start-Sleep -Seconds 1
}

$nodeDir = Split-Path $paths.NodeExe -Parent
$env:Path = "$nodeDir;$env:Path"
$env:NODE_ENV = 'production'
$env:FRONTEND_DIST = $paths.ProdFrontendDist
Import-BackendEnvFile -BackendDir $paths.BackendDir -Environment production

$proc = Start-Process `
  -FilePath $paths.NodeExe `
  -ArgumentList @('--import', '@elastic/opentelemetry-node', $paths.ProdApiEntry) `
  -WorkingDirectory $paths.BackendDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput $paths.ApiLog `
  -RedirectStandardError $paths.ApiErrLog `
  -PassThru

Set-Content -Path $paths.ApiPidFile -Value $proc.Id -Encoding ASCII
Write-WatchdogLog -Paths $paths -Message "API iniciada PID $($proc.Id)."

$deadline = (Get-Date).AddSeconds(30)
do {
  Start-Sleep -Seconds 1
  if (Test-ApiHealthy -HealthUrl $paths.ReadyUrl) {
    $listenerPid = Get-PortListenerPid -Port $paths.ApiPort
    if ($listenerPid -and $listenerPid -ne $proc.Id) {
      Write-Host "ERRO: porta $($paths.ApiPort) pertence ao PID $listenerPid, nao ao PID $($proc.Id) iniciado agora." -ForegroundColor Red
      Write-Host 'Encerre o processo antigo (Gerenciador de Tarefas ou taskkill /F /PID ...) e rode npm run prod:restart.' -ForegroundColor Yellow
      exit 1
    }
    Write-Host "API no ar: $($paths.ReadyUrl) (PID $($proc.Id))" -ForegroundColor Green
    exit 0
  }
} while ((Get-Date) -lt $deadline)

Write-Host "API subiu mas health check falhou. Veja $($paths.ApiErrLog)" -ForegroundColor Red
exit 1
