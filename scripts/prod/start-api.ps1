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

# Carrega o ambiente antes da verificacao de dependencia. O artefato publicado e
# propositalmente sem segredos; as variaveis vivem em backend/.env.production.
try {
  Import-BackendEnvFile -BackendDir $paths.BackendDir -Environment production
} catch {
  Write-WatchdogLog -Paths $paths -Message "Falha ao carregar ambiente de producao: $($_.Exception.Message)"
  Write-Host $_.Exception.Message -ForegroundColor Red
  exit 1
}

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
  if (-not (Wait-ProdDatabaseReachable -Paths $paths)) {
    Write-Host 'Banco de producao ainda indisponivel; nova tentativa sera feita pelo watchdog.' -ForegroundColor Yellow
    exit 1
  }
  Ensure-ProdBackendRuntime -Paths $paths -Quiet:$Quiet
  Assert-ProdDatabaseSchemaSync -Paths $paths
} catch {
  Write-WatchdogLog -Paths $paths -Message "Preflight da API falhou: $($_.Exception.Message)"
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

$apiIdentity = Test-ManagedPidFile -PidFile $paths.ApiPidFile -ExpectedProcessNames @('node.exe') -CommandLinePatterns @('index.js')
if ($apiIdentity.State -eq 'VALID') {
  if (-not $Quiet) { Write-Host "API gerenciada PID $($apiIdentity.ProcessId) sem health; reiniciando." -ForegroundColor Yellow }
  Stop-ManagedPidFile -PidFile $paths.ApiPidFile -ExpectedProcessNames @('node.exe') -CommandLinePatterns @('index.js') -Label 'API' | Out-Null
  Start-Sleep -Seconds 1
} elseif ($apiIdentity.State -ne 'MISSING') {
  Clear-InvalidManagedPidFile -Identity $apiIdentity -PidFile $paths.ApiPidFile | Out-Null
}

if (Test-PortListening -Port $paths.ApiPort) {
  if ($Force) {
    Write-WatchdogLog -Paths $paths -Message "Forcando liberacao da porta $($paths.ApiPort)."
  } else {
    Write-WatchdogLog -Paths $paths -Message "Porta $($paths.ApiPort) em uso sem health OK - tentando liberar."
  }
  $listenerPid = Get-PortListenerPid -Port $paths.ApiPort
  $listener = if ($listenerPid) { Get-CimInstance Win32_Process -Filter "ProcessId=$listenerPid" -ErrorAction SilentlyContinue } else { $null }
  if ($listener -and $listener.Name -ieq 'node.exe' -and $listener.CommandLine -like '*index.js*') {
    Stop-Process -Id $listenerPid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
  } else {
    Write-Host "Porta $($paths.ApiPort) ocupada por processo nao identificado; ele nao sera encerrado." -ForegroundColor Red
    exit 1
  }
}

$nodeDir = Split-Path $paths.NodeExe -Parent
$env:Path = "$nodeDir;$env:Path"
$env:NODE_ENV = 'production'
$env:FRONTEND_DIST = $paths.ProdFrontendDist
# O manifest e o artefato publicado sao a fonte de verdade do processo em execucao.
# Manifest ausente/corrompido e fail-safe: a API continua com release "unknown".
$env:RELEASE_SHA = 'unknown'
if (Test-Path $paths.ProdManifest) {
  try {
    $manifest = Get-Content -Path $paths.ProdManifest -Raw -Encoding UTF8 | ConvertFrom-Json
    $candidate = if ($manifest.gitSha) { ([string]$manifest.gitSha).Trim().ToLowerInvariant() } else { '' }
    if ($candidate -match '^[a-f0-9]{7,40}$') { $env:RELEASE_SHA = $candidate }
  } catch {
    # A telemetria nao bloqueia startup quando metadata de release esta indisponivel.
  }
}
Set-ProdUploadsEnv -Paths $paths

$proc = Start-Process `
  -FilePath $paths.NodeExe `
  -ArgumentList @('--import', '@elastic/opentelemetry-node', $paths.ProdApiEntry) `
  -WorkingDirectory $paths.ProdBackendRoot `
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
