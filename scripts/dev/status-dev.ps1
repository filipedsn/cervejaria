# Status do ambiente de desenvolvimento (portas 3002 / 5202).

. "$PSScriptRoot\_config.ps1"
$paths = Get-DevPaths

$backendOk = Test-DevPortListening -Port $paths.BackendPort
$frontendOk = Test-DevPortListening -Port $paths.FrontendPort

Write-Host ''
Write-Host 'Quiver Tap - Desenvolvimento' -ForegroundColor Cyan
Write-Host '============================' -ForegroundColor Cyan
Write-Host "API      (:$($paths.BackendPort)): $(if ($backendOk) { 'OK' } else { 'FORA' })" -ForegroundColor $(if ($backendOk) { 'Green' } else { 'Red' })
Write-Host "Frontend (:$($paths.FrontendPort)): $(if ($frontendOk) { 'OK' } else { 'FORA' })" -ForegroundColor $(if ($frontendOk) { 'Green' } else { 'Red' })

if (Test-Path $paths.SupervisorPidFile) {
  $supervisorPid = Get-Content $paths.SupervisorPidFile -ErrorAction SilentlyContinue
  $alive = Test-DevProcessAlive -ProcessId ([int]$supervisorPid)
  Write-Host "Supervisor: PID $supervisorPid $(if ($alive) { '(ativo)' } else { '(morto)' })"
}

if ($backendOk -and $frontendOk) {
  Write-Host ''
  Write-Host "Local:    http://localhost:$($paths.FrontendPort)" -ForegroundColor Gray
  Write-Host "Internet: https://tapdev.quivercloud.com.br" -ForegroundColor Gray
}
Write-Host ''
