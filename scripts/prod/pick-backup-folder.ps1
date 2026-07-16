# Seletor de pasta nativo do Windows (FolderBrowserDialog + vista upgrade).
# Uso: powershell -Sta -File pick-backup-folder.ps1 -ResultFile <arquivo>
# Exit 0 = ok, 2 = cancelado

param(
  [Parameter(Mandatory = $true)]
  [string]$ResultFile
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$defaultDir = Join-Path $projectRoot 'deploy\backups'
if (-not (Test-Path $defaultDir)) {
  New-Item -ItemType Directory -Force -Path $defaultDir | Out-Null
}

$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Selecione a pasta onde salvar o backup do banco de producao'
$dialog.ShowNewFolderButton = $true
$dialog.RootFolder = [Environment+SpecialFolder]::MyComputer
if (Test-Path $defaultDir) {
  $dialog.SelectedPath = $defaultDir
}

try {
  $dialog.AutoUpgradeToVistaDialog = $true
} catch {
  # Windows/.NET antigo: usa dialogo classico com navegacao completa.
}

$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$owner.WindowState = [System.Windows.Forms.FormWindowState]::Minimized
$owner.Size = New-Object System.Drawing.Size(1, 1)

$result = $dialog.ShowDialog($owner)
$owner.Dispose()

if ($result -ne [System.Windows.Forms.DialogResult]::OK) {
  exit 2
}

$selected = $dialog.SelectedPath.Trim()
if (-not $selected) {
  exit 2
}

Set-Content -LiteralPath $ResultFile -Value $selected -Encoding UTF8
exit 0
