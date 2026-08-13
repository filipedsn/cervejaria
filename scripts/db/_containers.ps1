# Nomes e portas dos containers Postgres (prod intacto, dev isolado).
$script:DbProdContainer = 'cervejaria-db'
$script:DbDevContainer = 'cervejaria-db-dev'
$script:DbProdPort = 5432
$script:DbDevPort = 5434
$script:DbProdName = 'cervejaria'
$script:DbDevName = 'cervejaria_dev'

function Assert-DbProdContainer {
  $container = docker ps --filter "name=^${script:DbProdContainer}$" --format '{{.Names}}' 2>$null
  if (-not $container) { throw "Container ${script:DbProdContainer} nao esta rodando. Execute: npm run db:up:prod" }
}

function Assert-DbDevContainer {
  $container = docker ps --filter "name=^${script:DbDevContainer}$" --format '{{.Names}}' 2>$null
  if (-not $container) { throw "Container ${script:DbDevContainer} nao esta rodando. Execute: npm run db:up:dev" }
}

function Assert-DbContainers {
  Assert-DbProdContainer
  Assert-DbDevContainer
}
