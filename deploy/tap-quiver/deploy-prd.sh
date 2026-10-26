#!/usr/bin/env bash
# Deploy PRD do Quiver Tap no VPS (Docker). Roda como root no VPS.
#
# Chamado pela esteira (workflow "Deploy PRD (VPS)") através do deploy-gate.sh,
# ou manualmente em emergência:
#   bash deploy-prd.sh <sha40> [head-only|allow-older]
#
# head-only   : só publica se <sha> ainda for o HEAD da main (padrão; evita que a
#               aprovação de um run antigo volte a produção para trás).
# allow-older : publica qualquer SHA que pertença à main (rollback intencional).
#
# Fluxo: lock → validações → backup Postgres → imagem atual vira :rollback →
# sync do código (preserva env/backups) → RELEASE_SHA → build → recreate da API →
# smoke local (/api/ready + releaseSha). Falha após o sync = rollback automático.
set -Eeuo pipefail

SHA="${1:-}"
MODE="${2:-head-only}"

REPO_DIR="${REPO_DIR:-/opt/cervejaria-git}"
APP_DIR="${APP_DIR:-/opt/quiver-tap}"
COMPOSE_DIR="$APP_DIR/deploy/tap-quiver"
ENV_FILE="$COMPOSE_DIR/.env.staging"
IMAGE="quiver-tap-api"
LOCK_FILE="/var/lock/quiver-tap-deploy.lock"
HISTORY_FILE="/var/log/quiver-tap-deploy.log"
READY_URL="http://127.0.0.1:3001/api/ready"
HEALTH_URL="http://127.0.0.1:3001/api/health"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-180}"
KEEP_SHA_IMAGES="${KEEP_SHA_IMAGES:-5}"

log() { printf '[deploy %s] %s\n' "$(date -u +%FT%TZ)" "$*"; }
die() { log "ERRO: $*"; exit "${2:-1}"; }
history() { printf '%s sha=%s prev=%s result=%s\n' "$(date -Iseconds)" "$SHA" "${PREV_SHA:-?}" "$1" >>"$HISTORY_FILE"; }

[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || die "SHA inválido (esperado 40 hex): '$SHA'" 2
[[ "$MODE" == "head-only" || "$MODE" == "allow-older" ]] || die "modo inválido: '$MODE'" 2

exec 9>"$LOCK_FILE"
flock -w 900 9 || die "outro deploy em andamento (lock ocupado por 15 min)" 4

git -C "$REPO_DIR" fetch --quiet origin main
MAIN_HEAD="$(git -C "$REPO_DIR" rev-parse origin/main)"
git -C "$REPO_DIR" cat-file -e "${SHA}^{commit}" 2>/dev/null || die "SHA não encontrado no repositório" 3
git -C "$REPO_DIR" merge-base --is-ancestor "$SHA" origin/main || die "SHA não pertence à main" 3
if [[ "$MODE" == "head-only" && "$SHA" != "$MAIN_HEAD" ]]; then
  die "SHA não é mais o HEAD da main ($MAIN_HEAD). Rode o workflow manualmente com o SHA desejado para publicar outro commit." 5
fi

PREV_SHA="$(sed -n 's/^RELEASE_SHA=//p' "$ENV_FILE" | tail -n1)"
[[ "$PREV_SHA" =~ ^[0-9a-f]{40}$ ]] || PREV_SHA=""
log "deploy $SHA (anterior: ${PREV_SHA:-desconhecido}, modo: $MODE)"

# Migrations: o runtime não tem o Prisma CLI; schema muda só com execução manual.
if [[ -z "$PREV_SHA" ]]; then
  die "RELEASE_SHA anterior desconhecido; não dá para checar migrations. Publique manualmente uma vez." 6
fi
if [[ -n "$(git -C "$REPO_DIR" diff --name-only "$PREV_SHA" "$SHA" -- backend/prisma/migrations)" ]]; then
  git -C "$REPO_DIR" diff --name-only "$PREV_SHA" "$SHA" -- backend/prisma/migrations
  die "o deploy contém migrations Prisma. Aplique-as manualmente (com backup) antes de usar a esteira." 6
fi

log "backup Postgres antes do deploy"
BACKUP_ENV_FILE="$COMPOSE_DIR/backup-postgres.env" bash "$COMPOSE_DIR/backup-postgres.sh"

COMPOSE=(docker compose -f docker-compose.yml)
if [[ -f "$COMPOSE_DIR/docker-compose.observability.yml" && -f "$COMPOSE_DIR/.env.observability" ]]; then
  COMPOSE+=(-f docker-compose.observability.yml)
fi

sync_code() {
  local target="$1"
  git -C "$REPO_DIR" checkout --quiet --force "$target"
  rsync -a --delete \
    --exclude '/deploy/tap-quiver/.env.staging' \
    --exclude '/deploy/tap-quiver/.env.staging.bak*' \
    --exclude '/deploy/tap-quiver/.env.observability' \
    --exclude '/deploy/tap-quiver/backup-postgres.*' \
    --exclude '/backups/' \
    --exclude 'node_modules/' \
    "$REPO_DIR/" "$APP_DIR/"
}

set_release_sha() {
  if grep -q '^RELEASE_SHA=' "$ENV_FILE"; then
    sed -i "s/^RELEASE_SHA=.*/RELEASE_SHA=$1/" "$ENV_FILE"
  else
    printf 'RELEASE_SHA=%s\n' "$1" >>"$ENV_FILE"
  fi
}

wait_healthy() {
  local expected="$1" deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS)) health=""
  while ((SECONDS < deadline)); do
    if curl -fsS -o /dev/null "$READY_URL" 2>/dev/null; then
      health="$(curl -fsS "$HEALTH_URL" 2>/dev/null || true)"
      if [[ "$health" == *"\"releaseSha\":\"$expected\""* ]]; then
        log "API pronta: $health"
        return 0
      fi
    fi
    sleep 5
  done
  log "API não ficou pronta com releaseSha=$expected em ${HEALTH_TIMEOUT_SECONDS}s (último health: ${health:-vazio})"
  return 1
}

recreate_api() {
  (cd "$COMPOSE_DIR" && "${COMPOSE[@]}" up -d --no-build --force-recreate api)
}

ROLLBACK_READY=0
rollback() {
  local code=$?
  trap - ERR
  if ((ROLLBACK_READY == 0)); then
    history "failed-before-change"
    log "falhou antes de alterar a produção (código $code)"
    exit "$code"
  fi
  log "FALHA (código $code) — rollback para $PREV_SHA"
  set +e
  sync_code "$PREV_SHA"
  set_release_sha "$PREV_SHA"
  docker tag "$IMAGE:rollback" "$IMAGE:staging"
  recreate_api
  if wait_healthy "$PREV_SHA"; then
    history "rolled-back"
    log "rollback ok: produção segue em $PREV_SHA"
  else
    history "rollback-failed"
    log "ROLLBACK FALHOU: intervenção manual necessária"
  fi
  docker logs --tail 80 cervejaria-api 2>&1 | sed 's/^/[api] /'
  exit 1
}
trap rollback ERR

if docker image inspect "$IMAGE:staging" >/dev/null 2>&1; then
  docker tag "$IMAGE:staging" "$IMAGE:rollback"
fi
docker image inspect "$IMAGE:rollback" >/dev/null 2>&1 || die "sem imagem atual para servir de rollback" 7

ROLLBACK_READY=1
log "sincronizando código"
sync_code "$SHA"
set_release_sha "$SHA"

log "build da imagem"
(cd "$COMPOSE_DIR" && "${COMPOSE[@]}" build api)
docker tag "$IMAGE:staging" "$IMAGE:$SHA"

log "recriando a API"
recreate_api
wait_healthy "$SHA"

trap - ERR
history "ok"

{
  docker images "$IMAGE" --format '{{.Tag}}' | grep -E '^[0-9a-f]{40}$' | tail -n "+$((KEEP_SHA_IMAGES + 1))" |
    while read -r old; do docker rmi "$IMAGE:$old" >/dev/null 2>&1 || true; done
  docker image prune -f >/dev/null 2>&1
} || true

log "PRD_DEPLOY_OK=$SHA"
