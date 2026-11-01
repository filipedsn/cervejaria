# Batimento do Support Analyst no Elastic PRD (TAP-169): template do data stream e chave so-escrita.
# Sem -Apply so mostra o estado. Com -Apply -ConfirmPrd (GATE do Filipe):
#   1. PUT do template quiver-tap-analyst-heartbeat (retencao 30d, sem replica);
#   2. cria a API key de docs\support-analyst\prd-heartbeat-writer-role.json (create_doc so nesse
#      data stream) se o env do analista ainda nao tiver uma (-RotateKey forca outra) e grava
#      SUPPORT_ANALYST_REMOTE_HEARTBEAT_API_KEY em deploy\runtime\support-analyst-prd.env sem imprimir o valor.
# A regra Kibana vem do configure-kibana.ps1 + wire-alert-actions.ps1. Reinicie a tarefa do analista depois.
[CmdletBinding()]
param([switch]$Apply, [switch]$ConfirmPrd, [switch]$RotateKey)

$ErrorActionPreference = 'Stop'
$script:ObsTarget = 'prd'
. (Join-Path $PSScriptRoot '_elastic-auth.ps1')

$root = $ObsProjectRoot
$templateFile = Join-Path $root 'deploy\observability\es-template-analyst-heartbeat-prd.json'
$roleFile = Join-Path $root 'docs\support-analyst\prd-heartbeat-writer-role.json'
$envFile = Join-Path $root 'deploy\runtime\support-analyst-prd.env'
$varName = 'SUPPORT_ANALYST_REMOTE_HEARTBEAT_API_KEY'

if (-not (Test-Path -LiteralPath $envFile)) { throw "Env do analista ausente: $envFile" }
$envLines = @(Get-Content -LiteralPath $envFile)
$hasKey = [bool]($envLines | Where-Object { $_ -match "^$varName=.+" })
$template = Invoke-Elastic -Path '/_index_template/quiver-tap-analyst-heartbeat' | ConvertFrom-Json
$hasTemplate = [bool]($template.index_templates | Where-Object { $_.name -eq 'quiver-tap-analyst-heartbeat' })
Write-Host "Template: $(if ($hasTemplate) { 'existe' } else { 'ausente' }) | chave no env: $(if ($hasKey) { 'sim' } else { 'nao' })"
if (-not $Apply) { Write-Host 'Modo PLAN: nada alterado. Use -Apply -ConfirmPrd com GATE autorizado.'; return }

Assert-PrdMutationConfirmed -Confirmed:$ConfirmPrd

$put = Invoke-Elastic -Method PUT -Path '/_index_template/quiver-tap-analyst-heartbeat' -BodyFile $templateFile | ConvertFrom-Json
if (-not $put.acknowledged) { throw 'PUT do template falhou.' }
Write-Host 'Template aplicado.' -ForegroundColor Green

if ($hasKey -and -not $RotateKey) { Write-Host 'Chave ja configurada no env; nada a criar (use -RotateKey para trocar).'; return }

$created = Invoke-Elastic -Method POST -Path '/_security/api_key' -BodyFile $roleFile | ConvertFrom-Json
if (-not $created.encoded) { throw "Criacao da API key falhou: $($created.error.type)" }
$kept = @($envLines | Where-Object { $_ -notmatch "^$varName=" })
$content = (@($kept) + "$varName=$($created.encoded)") -join "`r`n"
[IO.File]::WriteAllText($envFile, $content + "`r`n", [Text.UTF8Encoding]::new($false))
Write-Host "API key $($created.name) criada (id $($created.id)); gravada no env do analista." -ForegroundColor Green
