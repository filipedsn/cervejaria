# Tarefa agendada do watch do Support Analyst: parte com o Windows e no logon do usuario.
# Desde o TAP-171 so -Target dev instala; o watch PRD roda no conteiner do VPS. -Uninstall/-Status seguem para prd.
#   -Install    registra (ou atualiza) a tarefa. Pode exigir PowerShell "Executar como administrador".
#   -Uninstall  remove a tarefa.
#   -Status     mostra a tarefa, a ultima execucao e o estado local do watch (padrao).
# Aceita -WhatIf (nada e registrado/removido). A instalacao real e o GATE G12 (feita pelo Filipe).
# Conta do usuario atual com LogonType S4U: roda sem sessao aberta e nao guarda senha.
[CmdletBinding(SupportsShouldProcess = $true, DefaultParameterSetName = 'Status')]
param(
  [Parameter(ParameterSetName = 'Install', Mandatory = $true)][switch]$Install,
  [Parameter(ParameterSetName = 'Uninstall', Mandatory = $true)][switch]$Uninstall,
  [Parameter(ParameterSetName = 'Status')][switch]$Status,
  [ValidateSet('prd', 'dev')][string]$Target = 'prd'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$taskName = if ($Target -eq 'prd') { 'QuiverTap-SupportAnalyst-Watch-PRD' } else { 'QuiverTap-SupportAnalyst-Watch-DEV' }
$runner = Join-Path $PSScriptRoot 'run-analyst.ps1'
$user = "$env:USERDOMAIN\$env:USERNAME"

function New-WatchTaskDefinition {
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runner`" -Target $Target -Mode watch" -WorkingDirectory $root
  $atStartup = New-ScheduledTaskTrigger -AtStartup
  $atStartup.Delay = 'PT60S'
  $atLogOn = New-ScheduledTaskTrigger -AtLogOn -User $user
  $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType S4U -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  return [pscustomobject]@{ Action = $action; Triggers = @($atStartup, $atLogOn); Principal = $principal; Settings = $settings }
}

function Show-WatchStatus {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if (-not $task) {
    Write-Host "Tarefa $taskName nao instalada." -ForegroundColor Yellow
  } else {
    $info = Get-ScheduledTaskInfo -TaskName $taskName
    $triggers = @($task.Triggers | ForEach-Object { $_.CimClass.CimClassName -replace '^MSFT_Task', '' -replace 'Trigger$', '' }) -join ', '
    [pscustomobject]@{
      Tarefa = $taskName
      Estado = [string]$task.State
      Gatilhos = $triggers
      Conta = $task.Principal.UserId
      LogonType = [string]$task.Principal.LogonType
      UltimaExecucao = $info.LastRunTime
      UltimoResultado = $info.LastTaskResult
      ProximaExecucao = $info.NextRunTime
    } | Format-List
  }
  $runtimeDir = Join-Path $root "deploy\runtime\support-analyst-$Target"
  $statePath = Join-Path $runtimeDir 'watch\state.json'
  if (Test-Path -LiteralPath $statePath) {
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    $firing = @($state.detectors.PSObject.Properties | Where-Object { $_.Value.status -eq 'FIRING' } | ForEach-Object { $_.Name })
    Write-Host ("Watch: inicio {0}; espera de rede: {1}; detectores em alerta: {2}" -f $state.startedAt, $(if ($state.waiting) { "$($state.waiting.status) ($($state.waiting.attempts) tentativas)" } else { 'n/d' }), $(if ($firing.Count) { $firing -join ', ' } else { 'nenhum' }))
  } else {
    Write-Host "Watch: sem estado local em deploy\runtime\support-analyst-$Target\watch (ainda nao rodou)."
  }
  $log = Get-ChildItem -LiteralPath (Join-Path $runtimeDir 'logs') -Filter 'watch-*.log' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($log) { Write-Host "Ultimo log: $($log.FullName) ($($log.LastWriteTime))" }
}

switch ($PSCmdlet.ParameterSetName) {
  'Install' {
    if ($Target -eq 'prd') { throw 'O watch PRD roda no conteiner quiver-tap-support-analyst do VPS (TAP-171); use -Target dev para o PC.' }
    if (-not (Test-Path -LiteralPath (Join-Path $root "deploy\runtime\support-analyst-$Target.env"))) {
      Write-Warning "deploy\runtime\support-analyst-$Target.env ainda nao existe; a tarefa vai falhar ate o arquivo ser criado (G11)."
    }
    $definition = New-WatchTaskDefinition
    if ($PSCmdlet.ShouldProcess($taskName, "Registrar tarefa (AtStartup +60s e AtLogOn de $user, S4U, RestartCount 999, sem limite de tempo)")) {
      Register-ScheduledTask -TaskName $taskName -Action $definition.Action -Trigger $definition.Triggers -Principal $definition.Principal -Settings $definition.Settings -Description "Quiver Tap Support Analyst $($Target.ToUpper()) (watch, Elastic somente leitura). TAP-140." -Force | Out-Null
      Write-Host "Instalada: $taskName" -ForegroundColor Green
    } else {
      Write-Host ("Definicao validada (nada registrado): acao={0} {1}; gatilhos=AtStartup(+{2}) e AtLogOn({3}); LogonType={4}; RestartCount={5}; RestartInterval={6}; ExecutionTimeLimit={7}; MultipleInstances={8}" -f $definition.Action.Execute, $definition.Action.Arguments, $definition.Triggers[0].Delay, $user, $definition.Principal.LogonType, $definition.Settings.RestartCount, $definition.Settings.RestartInterval, $definition.Settings.ExecutionTimeLimit, $definition.Settings.MultipleInstances)
    }
  }
  'Uninstall' {
    if (-not (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)) { Write-Host "Tarefa $taskName nao instalada; nada a remover."; return }
    if ($PSCmdlet.ShouldProcess($taskName, 'Remover tarefa agendada')) {
      Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
      Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
      Write-Host "Removida: $taskName" -ForegroundColor Green
    }
  }
  default { Show-WatchStatus }
}
