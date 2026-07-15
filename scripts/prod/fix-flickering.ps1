# Corrige piscar de tela: remove watchdog periodico e usa daemon unico oculto.

$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator
)

$vbsScript = Join-Path $PSScriptRoot 'start-watchdog-daemon-hidden.vbs'
if (-not (Test-Path $vbsScript)) {
  Write-Host 'Arquivo start-watchdog-daemon-hidden.vbs nao encontrado.' -ForegroundColor Red
  exit 1
}

Write-Host ''
Write-Host 'Iniciando watchdog daemon oculto...' -ForegroundColor Cyan
& "$PSScriptRoot\start-watchdog-daemon.ps1"
Write-Host ''

if (-not $isAdmin) {
  Write-Host 'AVISO: PowerShell sem administrador.' -ForegroundColor Yellow
  Write-Host 'O daemon foi iniciado, mas a tarefa antiga QuiverTap-Watchdog (a cada 5 min)' -ForegroundColor Yellow
  Write-Host 'so pode ser removida com admin. Enquanto ela existir, a tela pode piscar.' -ForegroundColor Yellow
  Write-Host ''
  Write-Host 'Execute UMA VEZ como administrador:' -ForegroundColor Cyan
  Write-Host '  cd C:\Users\Papai\Documents\Desenvolvimento\Cervejaria'
  Write-Host '  npm.cmd run prod:fix-flickering'
  Write-Host '  (ou: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\prod\fix-flickering.ps1)'
  Write-Host ''
  exit 0
}

$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbsScript`""

$principal = New-ScheduledTaskPrincipal `
  -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType Interactive `
  -RunLevel Highest

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -Hidden

$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

foreach ($taskName in @('QuiverTap-AtLogon', 'QuiverTap-AtStartup')) {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if (-not $task) { continue }

  if ($taskName -eq 'QuiverTap-AtStartup') {
    $startupTrigger = New-ScheduledTaskTrigger -AtStartup
    $startupTrigger.Delay = 'PT1M'
    Set-ScheduledTask -TaskName $taskName -Action $action -Trigger $startupTrigger -Principal $principal -Settings $settings | Out-Null
  } else {
    Set-ScheduledTask -TaskName $taskName -Action $action -Trigger $logonTrigger -Principal $principal -Settings $settings | Out-Null
  }
  Write-Host "Atualizado: $taskName" -ForegroundColor Green
}

$watchdogTask = Get-ScheduledTask -TaskName 'QuiverTap-Watchdog' -ErrorAction SilentlyContinue
if ($watchdogTask) {
  Unregister-ScheduledTask -TaskName 'QuiverTap-Watchdog' -Confirm:$false
  Write-Host 'Removido: QuiverTap-Watchdog (substituido por daemon unico)' -ForegroundColor Green
}

Write-Host ''
Write-Host 'Concluido: um unico processo monitora prod a cada 5 min, sem abrir PowerShell repetido.' -ForegroundColor Green
