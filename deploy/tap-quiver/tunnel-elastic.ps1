# Túnel SSH: ES/Kibana do VPS (localhost) -> PC
# Uso: .\tunnel-elastic.ps1
# Depois: ES http://127.0.0.1:9200  |  Kibana http://127.0.0.1:5601
# Cursor / agente de IA apontam para essas URLs locais.

param(
  [string]$KeyPath = (Join-Path $env:TEMP 'hstgr_vps_migrate'),
  [string]$HostName = '200.141.28.26',
  [string]$User = 'root'
)

if (-not (Test-Path $KeyPath)) {
  Write-Host "Chave SSH nao encontrada: $KeyPath" -ForegroundColor Red
  Write-Host "Use a chave cadastrada no VPS (ed25519 sem passphrase) ou ajuste -KeyPath."
  exit 1
}

Write-Host "Abrindo tunel (Ctrl+C para fechar)..." -ForegroundColor Cyan
Write-Host "  Elasticsearch -> http://127.0.0.1:9200"
Write-Host "  Kibana        -> http://127.0.0.1:5601"
Write-Host "  user elastic / senha no VPS: /docker/elasticsearch-kibana/.env"
ssh -i $KeyPath -o IdentitiesOnly=yes -o ExitOnForwardFailure=yes -N `
  -L 9200:127.0.0.1:9200 `
  -L 5601:127.0.0.1:5601 `
  "${User}@${HostName}"
