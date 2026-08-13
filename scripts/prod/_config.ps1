# Carrega deploy/production.settings.ps1

function Import-BackendEnvFile {
  param(
    [string]$BackendDir,
    [ValidateSet('development', 'production')]
    [string]$Environment = 'production'
  )

  $envFile = Join-Path $BackendDir ".env.$Environment"
  if (-not (Test-Path $envFile)) {
    throw "Arquivo de ambiente nao encontrado: $envFile"
  }

  Get-Content $envFile -Encoding UTF8 | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith('#')) { return }
    $eq = $line.IndexOf('=')
    if ($eq -lt 1) { return }
    $key = $line.Substring(0, $eq).Trim()
    $value = $line.Substring($eq + 1).Trim().Trim('"').Trim("'")
    if ($key) {
      Set-Item -Path "env:$key" -Value $value
    }
  }

  Assert-DatabaseEnvironment -Environment $Environment
}

function Import-ObservabilityEnvFile {
  param([string]$ProjectRoot = '')

  if (-not $ProjectRoot) {
    $ProjectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
  }

  $envFile = Join-Path $ProjectRoot 'deploy\observability\.env.observability'
  if (-not (Test-Path $envFile)) { return }

  Get-Content $envFile -Encoding UTF8 | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith('#')) { return }
    $eq = $line.IndexOf('=')
    if ($eq -lt 1) { return }
    $key = $line.Substring(0, $eq).Trim()
    $value = $line.Substring($eq + 1).Trim().Trim('"').Trim("'")
    if ($key -and $value) {
      Set-Item -Path "env:$key" -Value $value
    }
  }

  if (-not $env:KIBANA_ALERT_ES_API_KEY -and $env:ELASTIC_API_KEY_ALERT_POLLER) {
    $env:KIBANA_ALERT_ES_API_KEY = $env:ELASTIC_API_KEY_ALERT_POLLER
  }
  if (-not $env:KIBANA_ALERT_ES_USER -and $env:ELASTIC_USER) {
    $env:KIBANA_ALERT_ES_USER = $env:ELASTIC_USER
  }
  if (-not $env:KIBANA_ALERT_ES_PASSWORD -and $env:ELASTIC_PASSWORD) {
    $env:KIBANA_ALERT_ES_PASSWORD = $env:ELASTIC_PASSWORD
  }
  if (-not $env:KIBANA_ALERT_ES_URL -and $env:ELASTICSEARCH_URL) {
    $env:KIBANA_ALERT_ES_URL = $env:ELASTICSEARCH_URL
  }
}

function Assert-DatabaseEnvironment {
  param(
    [ValidateSet('development', 'production')]
    [string]$Environment
  )

  $url = $env:DATABASE_URL
  if (-not $url) {
    throw 'DATABASE_URL nao definida no arquivo de ambiente.'
  }

  if ($Environment -eq 'production') {
    if ($url -match 'cervejaria_dev') {
      throw 'PRODUCAO: DATABASE_URL aponta para cervejaria_dev. Corrija backend/.env.production.'
    }
    if ($url -match ':5434') {
      throw 'PRODUCAO: DATABASE_URL nao pode usar porta 5434 (container dev).'
    }
    if ($url -notmatch '/cervejaria(\?|$|")') {
      throw 'PRODUCAO: DATABASE_URL deve usar o banco cervejaria.'
    }
  } else {
    if ($url -notmatch 'cervejaria_dev') {
      throw 'DESENVOLVIMENTO: DATABASE_URL deve usar o banco cervejaria_dev.'
    }
    if ($url -match 'cervejaria_dev' -and $url -notmatch ':5434') {
      throw 'DESENVOLVIMENTO: DATABASE_URL deve usar porta 5434 (container dev isolado).'
    }
    if ($url -match '/cervejaria(\?|$|")' -and $url -notmatch 'cervejaria_dev') {
      throw 'DESENVOLVIMENTO: DATABASE_URL aponta para o banco de producao.'
    }
  }
}

function Get-QuiverTapSettings {
  $deployDir = Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'deploy'
  if (-not (Test-Path $deployDir)) {
    $deployDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..\deploy')).Path
  }

  $localFile = Join-Path $deployDir 'production.settings.psd1'
  $exampleFile = Join-Path $deployDir 'production.settings.psd1.example'

  $settingsFile = if (Test-Path $localFile) { $localFile } elseif (Test-Path $exampleFile) { $exampleFile } else { $null }
  if (-not $settingsFile) {
    throw 'Configure deploy/production.settings.psd1 (copie de production.settings.psd1.example).'
  }

  return Import-PowerShellDataFile -Path $settingsFile
}

function Resolve-QuiverTapPaths {
  param([hashtable]$Settings)

  $root = $Settings.ProjectRoot
  if (-not $root -or -not (Test-Path $root)) {
    throw "ProjectRoot invalido: $root"
  }

  $logDir = if ($Settings.LogDir) { $Settings.LogDir } else { Join-Path $root 'deploy\logs' }
  $runtimeDir = if ($Settings.RuntimeDir) { $Settings.RuntimeDir } else { Join-Path $root 'deploy\runtime' }

  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

  $nodeExe = $Settings.NodeExe
  if (-not $nodeExe) {
    $nodeExe = Join-Path ${env:ProgramFiles} 'nodejs\node.exe'
  }
  if (-not (Test-Path $nodeExe)) {
    $nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
  }
  if (-not $nodeExe) {
    throw 'Node.js nao encontrado. Instale Node 20+ ou defina NodeExe em production.settings.ps1.'
  }

  $apiPort = if ($Settings.ApiPort) { [int]$Settings.ApiPort } else { 3001 }
  $frontendPort = if ($Settings.FrontendPort) { [int]$Settings.FrontendPort } else { 5201 }
  $serveFrontendFromApi = if ($null -ne $Settings.ServeFrontendFromApi) { [bool]$Settings.ServeFrontendFromApi } else { $true }
  $healthPath = if ($Settings.HealthPath) { $Settings.HealthPath } else { '/api/health' }
  $readyPath = if ($Settings.ReadyPath) { $Settings.ReadyPath } else { '/api/ready' }
  $healthUrl = "http://127.0.0.1:${apiPort}${healthPath}"
  $readyUrl = "http://127.0.0.1:${apiPort}${readyPath}"
  $frontendUrl = if ($serveFrontendFromApi) {
    "http://127.0.0.1:${apiPort}/"
  } else {
    "http://127.0.0.1:${frontendPort}/"
  }

  $cfConfig = $Settings.CloudflaredConfig
  if (-not $cfConfig) {
    $cfConfig = Join-Path $env:USERPROFILE '.cloudflared\config.yml'
  }

  $prodArtifactsDir = if ($Settings.ProdArtifactsDir) {
    $Settings.ProdArtifactsDir
  } else {
    Join-Path $root 'deploy\prod-artifacts'
  }
  if (-not [System.IO.Path]::IsPathRooted($prodArtifactsDir)) {
    $prodArtifactsDir = Join-Path $root $prodArtifactsDir
  }
  $prodArtifactsDir = (Resolve-Path (New-Item -ItemType Directory -Force -Path $prodArtifactsDir)).Path
  $prodStagingDir = Join-Path $prodArtifactsDir '.staging'
  $prodFrontendDist = Join-Path $prodArtifactsDir 'frontend'
  $prodBackendRoot = Join-Path $prodArtifactsDir 'backend'
  $prodBackendDist = Join-Path $prodBackendRoot 'dist'
  $prodApiEntry = Join-Path $prodBackendDist 'index.js'
  $prodBackendPrisma = Join-Path $prodBackendRoot 'prisma'
  $prodBackendNodeModules = Join-Path $prodBackendRoot 'node_modules'
  $prodManifest = Join-Path $prodArtifactsDir 'manifest.json'
  # Release anterior, preservada a cada publicacao para permitir rollback em segundos.
  # Fica ao lado (nao dentro) de prod-artifacts para nao ser servida nem varrida pelo verify.
  $prodArtifactsPrevious = Join-Path (Split-Path $prodArtifactsDir -Parent) ((Split-Path $prodArtifactsDir -Leaf) + '.previous')

  @{
    ProjectRoot       = (Resolve-Path $root).Path
    BackendDir        = Join-Path $root 'backend'
    FrontendDir       = Join-Path $root 'frontend'
    DevFrontendDist   = Join-Path $root 'frontend\dist'
    DevApiEntry       = Join-Path $root 'backend\dist\index.js'
    ProdArtifactsDir  = $prodArtifactsDir
    ProdStagingDir    = $prodStagingDir
    ProdFrontendDist  = $prodFrontendDist
    ProdBackendRoot   = $prodBackendRoot
    ProdBackendDist   = $prodBackendDist
    ProdApiEntry      = $prodApiEntry
    ProdBackendPrisma = $prodBackendPrisma
    ProdBackendNodeModules = $prodBackendNodeModules
    ProdManifest      = $prodManifest
    ProdArtifactsPrevious = $prodArtifactsPrevious
    ApiEntry          = $prodApiEntry
    ApiPort           = $apiPort
    FrontendPort      = $frontendPort
    ServeFrontendFromApi = $serveFrontendFromApi
    HealthUrl         = $healthUrl
    ReadyUrl          = $readyUrl
    FrontendUrl       = $frontendUrl
    NodeExe           = $nodeExe
    NpmCmd            = if (Test-Path (Join-Path ${env:ProgramFiles} 'nodejs\npm.cmd')) {
      (Join-Path ${env:ProgramFiles} 'nodejs\npm.cmd')
    } else {
      (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
    }
    CloudflaredConfig = $cfConfig
    TunnelName        = if ($Settings.TunnelName) { $Settings.TunnelName } else { 'quiver-tap' }
    CloudflaredExe    = $Settings.CloudflaredExe
    LogDir            = $logDir
    RuntimeDir        = $runtimeDir
    ApiLog            = Join-Path $logDir 'api.log'
    ApiErrLog         = Join-Path $logDir 'api-error.log'
    FrontendLog       = Join-Path $logDir 'frontend.log'
    FrontendErrLog    = Join-Path $logDir 'frontend-error.log'
    TunnelLog         = Join-Path $logDir 'tunnel.log'
    TunnelErrLog      = Join-Path $logDir 'tunnel-error.log'
    WatchdogLog       = Join-Path $logDir 'watchdog.log'
    AlertPollerLog    = Join-Path $logDir 'alert-poller.log'
    AlertPollerErrLog = Join-Path $logDir 'alert-poller-error.log'
    ApiPidFile        = Join-Path $runtimeDir 'api.pid'
    AlertPollerPidFile = Join-Path $runtimeDir 'alert-poller.pid'
    AlertPollerHealthPort = 3098
    AlertPollerHealthUrl = 'http://127.0.0.1:3098/health'
    FrontendPidFile   = Join-Path $runtimeDir 'frontend.pid'
    TunnelPidFile     = Join-Path $runtimeDir 'tunnel.pid'
  }
}

function Find-CloudflaredExe {
  param([string]$Preferred = '')

  if ($Preferred -and (Test-Path $Preferred)) {
    return (Resolve-Path $Preferred).Path
  }

  $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }

  $candidates = @(
    (Join-Path ${env:ProgramFiles} 'cloudflared\cloudflared.exe')
    (Join-Path ${env:ProgramFiles(x86)} 'cloudflared\cloudflared.exe')
    (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\cloudflared.exe')
  )
  foreach ($p in $candidates) {
    if (Test-Path $p) { return (Resolve-Path $p).Path }
  }

  return $null
}

function Test-ApiHealthy {
  param(
    [string]$HealthUrl,
    [int]$Retries = 2
  )

  for ($i = 0; $i -lt $Retries; $i++) {
    try {
      $res = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 5
      if ($res.StatusCode -eq 200) { return $true }
    } catch {}
    if ($i -lt ($Retries - 1)) { Start-Sleep -Milliseconds 750 }
  }
  return $false
}

function Test-AlertPollerHealthy {
  param(
    [string]$HealthUrl = 'http://127.0.0.1:3098/health',
    [int]$Retries = 2
  )

  for ($i = 0; $i -lt $Retries; $i++) {
    try {
      $res = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 5
      if ($res.StatusCode -eq 200) { return $true }
    } catch {}
    if ($i -lt ($Retries - 1)) { Start-Sleep -Milliseconds 750 }
  }
  return $false
}

function Test-FrontendHealthy {
  param(
    [string]$FrontendUrl,
    [int]$Retries = 2
  )

  for ($i = 0; $i -lt $Retries; $i++) {
    try {
      $res = Invoke-WebRequest -Uri $FrontendUrl -UseBasicParsing -TimeoutSec 5
      if ($res.StatusCode -eq 200) { return $true }
    } catch {}
    if ($i -lt ($Retries - 1)) { Start-Sleep -Milliseconds 750 }
  }
  return $false
}

function Start-HiddenProcess {
  param(
    [string]$FilePath,
    [string[]]$ArgumentList = @(),
    [string]$WorkingDirectory = '',
    [string]$StdoutLog = '',
    [string]$StderrLog = ''
  )

  $params = @{
    FilePath         = $FilePath
    ArgumentList     = $ArgumentList
    WindowStyle      = 'Hidden'
    PassThru         = $true
  }
  if ($WorkingDirectory) { $params.WorkingDirectory = $WorkingDirectory }
  if ($StdoutLog) { $params.RedirectStandardOutput = $StdoutLog }
  if ($StderrLog) { $params.RedirectStandardError = $StderrLog }

  return Start-Process @params
}

function Start-HiddenNpm {
  param(
    [string]$NpmCmd,
    [string]$WorkingDirectory,
    [string[]]$NpmArgs,
    [string]$StdoutLog = '',
    [string]$StderrLog = ''
  )

  return Start-HiddenProcess `
    -FilePath $NpmCmd `
    -ArgumentList $NpmArgs `
    -WorkingDirectory $WorkingDirectory `
    -StdoutLog $StdoutLog `
    -StderrLog $StderrLog
}

function Test-ProcessAlive {
  param([int]$ProcessId)

  if (-not $ProcessId -or $ProcessId -le 0) { return $false }
  return $null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Test-PortListening {
  param([int]$Port)

  return $null -ne (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Get-PortListenerPid {
  param([int]$Port)

  $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($conn -and $conn.OwningProcess) { return [int]$conn.OwningProcess }
  return 0
}

function Stop-PortListener {
  param(
    [int]$Port,
    [switch]$Quiet
  )

  for ($attempt = 1; $attempt -le 5; $attempt++) {
    $listenerPid = Get-PortListenerPid -Port $Port
    if (-not $listenerPid) { return $true }

    if (-not $Quiet) {
      Write-Host "Encerrando listener na porta $Port (PID $listenerPid, tentativa $attempt/5)..." -ForegroundColor Yellow
    }

    # cmd /c evita que a stderr do taskkill vire erro terminante sob $ErrorActionPreference='Stop'.
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    try {
      Stop-Process -Id $listenerPid -Force -ErrorAction SilentlyContinue
      if (Test-ProcessAlive -ProcessId $listenerPid) {
        cmd /c "taskkill /F /PID $listenerPid" 2>$null | Out-Null
      }
    } catch {
    } finally {
      $ErrorActionPreference = $prevEap
    }
    Start-Sleep -Seconds 1
  }

  return -not (Test-PortListening -Port $Port)
}

function Test-CloudflaredRunning {
  if (Get-Service -Name 'Cloudflared' -ErrorAction SilentlyContinue) {
    $svc = Get-Service -Name 'Cloudflared'
    if ($svc.Status -eq 'Running') { return $true }
  }
  return $null -ne (Get-Process -Name 'cloudflared' -ErrorAction SilentlyContinue)
}

function Write-WatchdogLog {
  param(
    [hashtable]$Paths,
    [string]$Message
  )

  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  Add-Content -Path $Paths.WatchdogLog -Value $line -Encoding UTF8
}

function Get-PidFromFile {
  param([string]$PidFile)

  if (-not $PidFile -or -not (Test-Path $PidFile)) { return 0 }
  $raw = Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  $parsed = 0
  if ([int]::TryParse(("" + $raw).Trim(), [ref]$parsed)) { return $parsed }
  return 0
}

function Test-IsElevated {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Initialize-QuiverTapWin32 {
  if ('QuiverTap.Win32' -as [type]) { return }
  Add-Type -Namespace 'QuiverTap' -Name 'Win32' -MemberDefinition @'
[DllImport("kernel32.dll", SetLastError = true)]
public static extern IntPtr OpenProcess(uint desiredAccess, bool inheritHandle, uint processId);

[DllImport("kernel32.dll", SetLastError = true)]
public static extern bool CloseHandle(IntPtr handle);
'@
}

# Processo elevado nao expone CommandLine nem Path para um shell de integridade media.
# Ler esses campos e, portanto, um teste barato de "estou no mesmo contexto de seguranca".
function Test-ProcessContextReadable {
  param([int]$ProcessId)

  if (-not $ProcessId -or $ProcessId -le 0) { return $true }

  try {
    $wmi = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop
    if ($wmi -and $wmi.CommandLine) { return $true }
  } catch {}

  try {
    $proc = Get-Process -Id $ProcessId -ErrorAction Stop
    if ($proc.Path) { return $true }
  } catch {}

  return $false
}

# Testa (sem matar nada) se o processo atual consegue encerrar o PID informado.
# Retorna $true para PID inexistente/morto: nada a encerrar nao e um bloqueio.
#
# OpenProcess(PROCESS_TERMINATE) sozinho da falso positivo contra processo elevado neste host,
# entao o resultado so vale se tambem estivermos no mesmo contexto de seguranca. Na duvida o
# teste responde $false: pedir UAC a mais custa um clique, errar aqui aborta o deploy no meio.
function Test-CanTerminateProcess {
  param([int]$ProcessId)

  if (-not $ProcessId -or $ProcessId -le 0) { return $true }
  if (-not (Test-ProcessAlive -ProcessId $ProcessId)) { return $true }

  $elevated = Test-IsElevated
  if (-not $elevated -and -not (Test-ProcessContextReadable -ProcessId $ProcessId)) {
    return $false
  }

  try {
    Initialize-QuiverTapWin32
  } catch {
    return $elevated
  }

  $PROCESS_TERMINATE = 0x0001
  $handle = [QuiverTap.Win32]::OpenProcess([uint32]$PROCESS_TERMINATE, $false, [uint32]$ProcessId)
  if ($handle -eq [IntPtr]::Zero) { return $false }
  [void][QuiverTap.Win32]::CloseHandle($handle)
  return $true
}

function Get-DeployPauseFile {
  param([hashtable]$Paths)

  return (Join-Path $Paths.RuntimeDir 'deploy.pause')
}

function Set-DeployPause {
  param(
    [hashtable]$Paths,
    [string]$Reason = 'deploy em andamento'
  )

  $payload = [ordered]@{
    pid       = $PID
    reason    = $Reason
    startedAt = (Get-Date).ToString('o')
  } | ConvertTo-Json -Compress

  Set-Content -Path (Get-DeployPauseFile -Paths $Paths) -Value $payload -Encoding UTF8
}

function Clear-DeployPause {
  param([hashtable]$Paths)

  Remove-Item (Get-DeployPauseFile -Paths $Paths) -Force -ErrorAction SilentlyContinue
}

# Pausa vale enquanto o processo que a criou estiver vivo e dentro da janela maxima.
# Pausa orfa e descartada para o watchdog voltar a subir producao sozinho.
function Test-DeployPaused {
  param(
    [hashtable]$Paths,
    [int]$MaxAgeMinutes = 60
  )

  $pauseFile = Get-DeployPauseFile -Paths $Paths
  if (-not (Test-Path $pauseFile)) { return $false }

  $ageMinutes = ((Get-Date) - (Get-Item $pauseFile).LastWriteTime).TotalMinutes
  if ($ageMinutes -gt $MaxAgeMinutes) {
    Remove-Item $pauseFile -Force -ErrorAction SilentlyContinue
    return $false
  }

  try {
    $data = Get-Content $pauseFile -Raw -ErrorAction Stop | ConvertFrom-Json
    $ownerPid = 0
    if ($data.pid) { $ownerPid = [int]$data.pid }
    if ($ownerPid -gt 0 -and -not (Test-ProcessAlive -ProcessId $ownerPid)) {
      Remove-Item $pauseFile -Force -ErrorAction SilentlyContinue
      return $false
    }
  } catch {
    # Arquivo ilegivel: trata como pausa valida ate expirar por idade.
  }

  return $true
}
