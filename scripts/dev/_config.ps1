# Config compartilhada do ambiente de desenvolvimento (portas 3002 / 5202).

$script:DevBackendPort = 3002
$script:DevFrontendPort = 5202

function Get-DevPaths {
  $projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
  $runtimeDir = Join-Path $projectRoot 'deploy\runtime'
  $logDir = Join-Path $projectRoot 'deploy\logs'

  New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null

  $nodeExe = Join-Path ${env:ProgramFiles} 'nodejs\node.exe'
  if (-not (Test-Path $nodeExe)) {
    $nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
  }

  $npmCmd = Join-Path ${env:ProgramFiles} 'nodejs\npm.cmd'
  if (-not (Test-Path $npmCmd)) {
    $npmCmd = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
  }

  @{
    ProjectRoot      = $projectRoot
    BackendDir       = Join-Path $projectRoot 'backend'
    FrontendDir      = Join-Path $projectRoot 'frontend'
    RuntimeDir       = $runtimeDir
    LogDir           = $logDir
    BackendPidFile   = Join-Path $runtimeDir 'dev-backend.pid'
    FrontendPidFile  = Join-Path $runtimeDir 'dev-frontend.pid'
    SupervisorPidFile = Join-Path $runtimeDir 'dev-supervisor.pid'
    BackendLog       = Join-Path $logDir 'dev-api.log'
    BackendErrLog    = Join-Path $logDir 'dev-api-error.log'
    FrontendLog      = Join-Path $logDir 'dev-frontend.log'
    FrontendErrLog   = Join-Path $logDir 'dev-frontend-error.log'
    SupervisorLog    = Join-Path $logDir 'dev-supervisor.log'
    NodeExe          = $nodeExe
    NpmCmd           = $npmCmd
    BackendPort      = $script:DevBackendPort
    FrontendPort     = $script:DevFrontendPort
  }
}

function Test-DevProcessAlive {
  param([int]$ProcessId)
  if (-not $ProcessId -or $ProcessId -le 0) { return $false }
  return $null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Test-DevPortListening {
  param([int]$Port)
  return $null -ne (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Write-DevLog {
  param(
    [hashtable]$Paths,
    [string]$Message
  )
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  Add-Content -Path $Paths.SupervisorLog -Value $line -Encoding UTF8
}

function Test-LaunchedFromCursor {
  $processId = $PID
  for ($i = 0; $i -lt 25; $i++) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue
    if (-not $proc) { return $false }
    if ($proc.Name -ieq 'Cursor.exe') { return $true }
    if (-not $proc.ParentProcessId -or $proc.ParentProcessId -eq $processId) { return $false }
    $processId = $proc.ParentProcessId
  }
  return $false
}

function Test-CursorRunning {
  return $null -ne (Get-Process -Name 'Cursor' -ErrorAction SilentlyContinue)
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

  $params = @{
    WindowStyle = 'Hidden'
    PassThru    = $true
    WorkingDirectory = $WorkingDirectory
  }
  if ($StdoutLog) { $params.RedirectStandardOutput = $StdoutLog }
  if ($StderrLog) { $params.RedirectStandardError = $StderrLog }

  if (Test-Path $npmCli) {
    $params.FilePath = $nodeExe
    $params.ArgumentList = @($npmCli) + $NpmArgs
  } else {
    $params.FilePath = $NpmCmd
    $params.ArgumentList = $NpmArgs
  }

  return Start-Process @params
}
