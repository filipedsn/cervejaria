# Corrige piscar de tela: tarefas agendadas passam a rodar 100% ocultas (via wscript).

$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator
)

$vbsScript = Join-Path $PSScriptRoot 'ensure-running-hidden.vbs'
if (-not (Test-Path $vbsScript)) {
  Write-Host 'Arquivo ensure-running-hidden.vbs nao encontrado.' -ForegroundColor Red
  exit 1
}

$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbsScript`""

$runLevel = if ($isAdmin) { 'Highest' } else { 'Limited' }
$principal = New-ScheduledTaskPrincipal `
  -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType Interactive `
  -RunLevel $runLevel

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -Hidden

$watchdogDuration = New-TimeSpan -Days 3650
$watchdogTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
  -RepetitionInterval (New-TimeSpan -Minutes 5) `
  -RepetitionDuration $watchdogDuration

foreach ($taskName in @('QuiverTap-AtLogon', 'QuiverTap-AtStartup', 'QuiverTap-Watchdog')) {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if (-not $task) { continue }

  if ($taskName -eq 'QuiverTap-Watchdog') {
    Set-ScheduledTask -TaskName $taskName -Action $action -Trigger $watchdogTrigger -Principal $principal -Settings $settings | Out-Null
  } else {
    Set-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Settings $settings | Out-Null
  }
  Write-Host "Atualizado: $taskName" -ForegroundColor Green
}

Write-Host ''
Write-Host 'Tarefas agora rodam via wscript (sem janela) e watchdog a cada 5 min.' -ForegroundColor Cyan
