# Supervisor do ambiente de desenvolvimento:
# - sobe API/frontend dev quando Cursor ou VS Code abre o workspace
# - desmonta tudo quando os editores sao fechados

param(
  [switch]$Detached
)

$ErrorActionPreference = 'Continue'
. "$PSScriptRoot\_config.ps1"

$paths = Get-DevPaths

if (-not $Detached) {
  $supervisorIdentity = Test-ManagedPidFile -PidFile $paths.SupervisorPidFile -ExpectedProcessNames @('powershell.exe','pwsh.exe') -CommandLinePatterns @('supervisor.ps1', 'Detached')
  if ($supervisorIdentity.State -eq 'VALID') {
      Write-Host 'Supervisor dev ja esta ativo.' -ForegroundColor DarkGray
      exit 0
  }
  if ($supervisorIdentity.State -ne 'MISSING') { Clear-InvalidManagedPidFile -Identity $supervisorIdentity -PidFile $paths.SupervisorPidFile | Out-Null }

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

$checkIntervalSeconds = 120
$consecutiveFrontendFailures = 0
$backoffUntil = [DateTime]::MinValue

try {
  & "$PSScriptRoot\start-dev.ps1" | Out-Null

  while (Test-EditorRunning) {
    Start-Sleep -Seconds $checkIntervalSeconds

    if ((Get-Date) -lt $backoffUntil) { continue }

    $backendOk = Test-DevPortListening -Port $paths.BackendPort
    $frontendOk = Test-DevPortListening -Port $paths.FrontendPort

    if ($backendOk -and $frontendOk) {
      $consecutiveFrontendFailures = 0
      continue
    }

    if (-not $backendOk) {
      Write-DevLog -Paths $paths -Message 'API dev caiu - reiniciando.'
    } else {
      Write-DevLog -Paths $paths -Message 'Frontend dev caiu - reiniciando.'
    }

    & "$PSScriptRoot\start-dev.ps1" | Out-Null

    Start-Sleep -Seconds 5
    $backendOk = Test-DevPortListening -Port $paths.BackendPort
    $frontendOk = Test-DevPortListening -Port $paths.FrontendPort

    if ($backendOk -and -not $frontendOk) {
      $consecutiveFrontendFailures++
      if ($consecutiveFrontendFailures -ge 3) {
        $backoffUntil = (Get-Date).AddMinutes(10)
        Write-DevLog -Paths $paths -Message "Frontend dev instavel ($consecutiveFrontendFailures falhas) - pausa 10 min para evitar piscar tela."
        $consecutiveFrontendFailures = 0
      }
    } else {
      $consecutiveFrontendFailures = 0
    }
  }

  Write-DevLog -Paths $paths -Message 'Cursor fechado - desmontando ambiente dev.'
  & "$PSScriptRoot\stop-dev.ps1" | Out-Null
} finally {
  Remove-Item $paths.SupervisorPidFile -Force -ErrorAction SilentlyContinue
}
