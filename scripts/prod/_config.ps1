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
  $healthPath = if ($Settings.HealthPath) { $Settings.HealthPath } else { '/api/health' }
  $healthUrl = "http://127.0.0.1:${apiPort}${healthPath}"
  $frontendUrl = "http://127.0.0.1:${frontendPort}/"

  $cfConfig = $Settings.CloudflaredConfig
  if (-not $cfConfig) {
    $cfConfig = Join-Path $env:USERPROFILE '.cloudflared\config.yml'
  }

  @{
    ProjectRoot       = (Resolve-Path $root).Path
    BackendDir        = Join-Path $root 'backend'
    FrontendDir       = Join-Path $root 'frontend'
    ApiEntry          = Join-Path $root 'backend\dist\index.js'
    ApiPort           = $apiPort
    FrontendPort      = $frontendPort
    HealthUrl         = $healthUrl
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
    ApiPidFile        = Join-Path $runtimeDir 'api.pid'
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

  $nodeDir = Split-Path $NpmCmd -Parent
  $nodeExe = Join-Path $nodeDir 'node.exe'
  $npmCli = Join-Path $nodeDir 'node_modules\npm\bin\npm-cli.js'

  if (Test-Path $npmCli) {
    return Start-HiddenProcess `
      -FilePath $nodeExe `
      -ArgumentList (@($npmCli) + $NpmArgs) `
      -WorkingDirectory $WorkingDirectory `
      -StdoutLog $StdoutLog `
      -StderrLog $StderrLog
  }

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
