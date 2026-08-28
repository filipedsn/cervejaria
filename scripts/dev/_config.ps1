# Config compartilhada do ambiente de desenvolvimento (portas 3002 / 5202).
. (Join-Path $PSScriptRoot '..\prod\_config.ps1')

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

function Get-DevLanIPv4 {
  $virtualPattern = 'Hyper-V|Virtual|WSL|VMware|VirtualBox|Loopback|Bluetooth|Default Switch|vEthernet'

  $candidate = Get-NetIPConfiguration -ErrorAction SilentlyContinue |
    Where-Object {
      $_.IPv4DefaultGateway -and
      $_.NetAdapter.Status -eq 'Up' -and
      $_.NetAdapter.Name -notmatch $virtualPattern -and
      $_.IPv4Address.IPAddress -match '^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)'
    } |
    Sort-Object { $_.NetAdapter.InterfaceMetric } |
    Select-Object -First 1

  if ($candidate) {
    return $candidate.IPv4Address.IPAddress
  }

  return $null
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

  $argLine = ($NpmArgs | ForEach-Object {
    if ($_ -match '\s') { "`"$_`"" } else { $_ }
  }) -join ' '

  $cmd = "Set-Location -LiteralPath '$WorkingDirectory'; & '$NpmCmd' $argLine"

  $params = @{
    FilePath         = 'powershell.exe'
    ArgumentList     = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', $cmd)
    WorkingDirectory = $WorkingDirectory
    WindowStyle      = 'Hidden'
    PassThru         = $true
  }
  if ($StdoutLog) { $params.RedirectStandardOutput = $StdoutLog }
  if ($StderrLog) { $params.RedirectStandardError = $StderrLog }

  return Start-Process @params
}
