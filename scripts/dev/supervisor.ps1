# Supervisor do ambiente de desenvolvimento:
# - sobe API/frontend dev quando o Cursor abre o workspace
# - desmonta tudo quando o Cursor e fechado

param(
  [switch]$Detached
)

$ErrorActionPreference = 'Continue'
. "$PSScriptRoot\_config.ps1"

$paths = Get-DevPaths

if (-not $Detached) {
  if (-not (Test-LaunchedFromCursor)) {
    Write-Host 'Supervisor dev ignorado: workspace nao foi aberto pelo Cursor.' -ForegroundColor DarkGray
    exit 0
  }

  if (Test-Path $paths.SupervisorPidFile) {
    $existingPid = [int](Get-Content $paths.SupervisorPidFile -ErrorAction SilentlyContinue)
    if (Test-DevProcessAlive -ProcessId $existingPid) {
      Write-Host 'Supervisor dev ja esta ativo.' -ForegroundColor DarkGray
      exit 0
    }
  }

  $argsList = @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-WindowStyle', 'Hidden',
    '-File', (Join-Path $PSScriptRoot 'supervisor.ps1'),
    '-Detached'
  )

  $launcher = Start-Process `
    -FilePath 'powershell.exe' `
    -ArgumentList $argsList `
    -WindowStyle Hidden `
    -PassThru

  Write-Host 'Supervisor dev iniciado em segundo plano.' -ForegroundColor Green
  Write-Host "  Frontend: http://localhost:$($paths.FrontendPort)" -ForegroundColor Gray
  Write-Host "  API:      http://localhost:$($paths.BackendPort)" -ForegroundColor Gray
  exit 0
}

Set-Content -Path $paths.SupervisorPidFile -Value $PID -Encoding ASCII
Write-DevLog -Paths $paths -Message "Supervisor iniciado PID $PID."

try {
  & "$PSScriptRoot\start-dev.ps1" | Out-Null

  while (Test-CursorRunning) {
    Start-Sleep -Seconds 30

    if (-not (Test-DevPortListening -Port $paths.BackendPort)) {
      Write-DevLog -Paths $paths -Message 'API dev caiu - reiniciando.'
      & "$PSScriptRoot\start-dev.ps1" | Out-Null
    } elseif (-not (Test-DevPortListening -Port $paths.FrontendPort)) {
      Write-DevLog -Paths $paths -Message 'Frontend dev caiu - reiniciando.'
      & "$PSScriptRoot\start-dev.ps1" | Out-Null
    }
  }

  Write-DevLog -Paths $paths -Message 'Cursor fechado - desmontando ambiente dev.'
  & "$PSScriptRoot\stop-dev.ps1" | Out-Null
} finally {
  Remove-Item $paths.SupervisorPidFile -Force -ErrorAction SilentlyContinue
}
