param(
  [ValidateSet('development','production')]
  [string]$Environment = 'development',
  [switch]$Remove
)
$ErrorActionPreference='Stop'
$name=if($Environment -eq 'development'){'QuiverTap-DevBackup'}else{'QuiverTap-ProdBackup'}
$script=(Resolve-Path (Join-Path $PSScriptRoot 'backup-db.ps1')).Path
if ($Remove) { Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue; exit 0 }
$action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`" -Environment $Environment -OffHostDir `"$([Environment]::GetFolderPath('UserProfile'))\OneDrive\Quiver\Tap Quiver\Backup banco\$(if($Environment -eq 'development'){'Dev'}else{'PRD'})`""
$trigger=New-ScheduledTaskTrigger -Daily -At 03:15
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Description "TAP-33 $Environment PostgreSQL backup with verified OneDrive copy." -Force | Out-Null
Get-ScheduledTask -TaskName $name | Select-Object TaskName,State
