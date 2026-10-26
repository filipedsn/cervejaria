# Liga o Tap Quiver Ops (http://127.0.0.1:3099) sozinho ao entrar no Windows.
#
# Tarefa agendada dedicada, do usuário atual e sem administrador: o painel usa as chaves SSH
# e o login do `gh` deste usuário, então não pode rodar como SYSTEM nem antes do login.
# Não reativa as tarefas legadas do PC-como-produção (QuiverTap-AtLogon/AtStartup/Watchdog).
#
#   npm run ops:autostart           instala ou atualiza
#   npm run ops:autostart:remove    remove

param(
  [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$taskName = 'QuiverTap-OpsPanel'

if ($Remove) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Removida: $taskName (o painel em execução não foi encerrado)."
  exit 0
}

$startScript = (Resolve-Path (Join-Path $PSScriptRoot 'start-ops-panel.ps1')).Path
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$powershell = Join-Path $PSHOME 'powershell.exe'

# conhost --headless: nenhuma janela de console pisca no login.
$action = New-ScheduledTaskAction `
  -Execute (Join-Path $env:WINDIR 'System32\conhost.exe') `
  -Argument "--headless `"$powershell`" -NoProfile -ExecutionPolicy Bypass -File `"$startScript`" -Quiet" `
  -WorkingDirectory $projectRoot

$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$trigger.Delay = 'PT20S'

$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

# Sem limite de tempo: o Agendador não pode encerrar o painel que a tarefa deixou rodando.
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
  -Description 'Tap Quiver Ops: liga o painel local (porta 3099) ao entrar no Windows. TAP-132.' -Force | Out-Null

Write-Host "Instalada: $taskName (20 s depois de entrar no Windows, sem janela)." -ForegroundColor Green
