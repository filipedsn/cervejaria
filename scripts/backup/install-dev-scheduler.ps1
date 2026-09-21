param([switch]$Remove)
$ErrorActionPreference='Stop'
$name='QuiverTap-DevBackup'
$script=(Resolve-Path (Join-Path $PSScriptRoot 'backup-db.ps1')).Path
if ($Remove) { Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue; exit 0 }
$action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`" -Environment development"
$trigger=New-ScheduledTaskTrigger -Daily -At 03:15
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Description 'TAP-33 DEV PostgreSQL backup; PROD is intentionally excluded.' -Force | Out-Null
Get-ScheduledTask -TaskName $name | Select-Object TaskName,State
