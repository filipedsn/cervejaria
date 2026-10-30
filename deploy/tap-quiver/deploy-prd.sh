#!/usr/bin/env bash
# Deploy PRD do Quiver Tap no VPS (Docker). Roda como root no VPS.
#
# Chamado pela esteira (workflow "Deploy PRD (VPS)") através do deploy-gate.sh,
# ou manualmente em emergência:
#   bash deploy-prd.sh <sha40> [head-only|allow-older] [allow-destructive]
#
# head-only         : só publica se <sha> ainda for o HEAD da main (padrão; evita que a
#                     aprovação de um run antigo volte a produção para trás).
# allow-older       : publica qualquer SHA que pertença à main (rollback intencional).
# allow-destructive : aceita migrations destrutivas (DROP/RENAME/TYPE/...); ver migration-guard.sh.
#
# Fluxo: lock → validações → guard de migrations → backup Postgres → imagem atual vira
# :rollback → sync do código (preserva env/backups) → RELEASE_SHA → build →
# [se houver migrations: ensaio no dump recém-feito → prisma migrate deploy] →
# recreate da API → smoke local (/api/ready + releaseSha).
# Falha após o sync = rollback automático do código. Schema migrado não é revertido
# (expand/contract): o backup do início do deploy é o ponto de restauração.
set -Eeuo pipefail

SHA="${1:-}"
MODE="${2:-head-only}"
DESTRUCTIVE="${3:-}"

REPO_DIR="${REPO_DIR:-/opt/cervejaria-git}"
APP_DIR="${APP_DIR:-/opt/quiver-tap}"
COMPOSE_DIR="$APP_DIR/deploy/tap-quiver"
ENV_FILE="$COMPOSE_DIR/.env.staging"
BACKUP_ENV="$COMPOSE_DIR/backup-postgres.env"
IMAGE="quiver-tap-api"
MIGRATOR_IMAGE="quiver-tap-migrator"
LOCK_FILE="/var/lock/quiver-tap-deploy.lock"
HISTORY_FILE="/var/log/quiver-tap-deploy.log"
READY_URL="http://127.0.0.1:3001/api/ready"
HEALTH_URL="http://127.0.0.1:3001/api/health"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-180}"
KEEP_SHA_IMAGES="${KEEP_SHA_IMAGES:-5}"
REHEARSAL_CONTAINER="quiver-tap-migration-rehearsal"
REHEARSAL_PORT="${REHEARSAL_PORT:-55432}"

log() { printf '[deploy %s] %s\n' "$(date -u +%FT%TZ)" "$*"; }
die() { log "ERRO: $*"; exit "${2:-1}"; }
history() { printf '%s sha=%s prev=%s migrations=%s result=%s\n' "$(date -Iseconds)" "$SHA" "${PREV_SHA:-?}" "${PENDING:-0}" "$1" >>"$HISTORY_FILE"; }

[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || die "SHA inválido (esperado 40 hex): '$SHA'" 2
[[ "$MODE" == "head-only" || "$MODE" == "allow-older" ]] || die "modo inválido: '$MODE'" 2
[[ -z "$DESTRUCTIVE" || "$DESTRUCTIVE" == "allow-destructive" ]] || die "flag inválida: '$DESTRUCTIVE'" 2

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
[[ "$PREV_SHA" =~ ^[0-9a-f]{40}$ ]] || die "RELEASE_SHA atual desconhecido; publique manualmente uma vez para fixar a base." 6
log "deploy $SHA (anterior: $PREV_SHA, modo: $MODE${DESTRUCTIVE:+, $DESTRUCTIVE})"

GUARD_RC=0
GUARD_OUT="$(cd "$REPO_DIR" && bash <(git show origin/main:deploy/tap-quiver/migration-guard.sh) "$PREV_SHA" "$SHA")" || GUARD_RC=$?
[[ -z "$GUARD_OUT" ]] || printf '%s\n' "$GUARD_OUT" | sed 's/^/[migrations] /'
case "$GUARD_RC" in
  0) ;;
  3) [[ "$DESTRUCTIVE" == "allow-destructive" ]] || die "há migrations destrutivas; publique pelo workflow manual com allow_destructive após revisar." 6 ;;
  4) die "uma migration já existente foi alterada ou removida; isso não é suportado." 6 ;;
  *) die "migration-guard falhou (código $GUARD_RC)" 6 ;;
esac
PENDING="$(printf '%s\n' "$GUARD_OUT" | grep -c '^MIGRATION ' || true)"

log "backup Postgres antes do deploy"
BACKUP_ENV_FILE="$BACKUP_ENV" bash "$COMPOSE_DIR/backup-postgres.sh"

COMPOSE=(docker compose -f docker-compose.yml)
if [[ -f "$COMPOSE_DIR/docker-compose.observability.yml" && -f "$COMPOSE_DIR/.env.observability" ]]; then
  COMPOSE+=(-f docker-compose.observability.yml)
fi
compose() { (cd "$COMPOSE_DIR" && "${COMPOSE[@]}" "$@"); }

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
  compose up -d --no-build --force-recreate api
}

# Mais recente entre candidatos, sem `ls | head` (pipefail + SIGPIPE → ls exit 2).
newest_backup() {
  local newest="" newest_mtime=0 f mt
  for f in "$@"; do
    [[ -f "$f" ]] || continue
    mt="$(stat -c %Y "$f" 2>/dev/null || echo 0)"
    if [[ -z "$newest" || "$mt" -ge "$newest_mtime" ]]; then
      newest=$f
      newest_mtime=$mt
    fi
  done
  [[ -n "$newest" ]] || return 1
  printf '%s\n' "$newest"
}

# Restaura o dump recém-feito num Postgres descartável e aplica as migrations nele.
rehearse_migrations() (
  trap - ERR
  set -euo pipefail
  # shellcheck disable=SC1090
  source "$BACKUP_ENV"
  local dump pg_image pass url restore_rc
  shopt -s nullglob
  dump="$(newest_backup "$BACKUP_DIR"/"${PREFIX:-backup-prod}"-*.dump "$BACKUP_DIR"/"${PREFIX:-backup-prod}"-*.sql)" \
    || { log "ensaio: nenhum backup encontrado em $BACKUP_DIR"; exit 1; }
  pg_image="$(docker inspect -f '{{.Config.Image}}' "$CONTAINER")"
  # openssl evita pipeline quebrada por pipefail (head|base64|tr|head).
  pass="$(openssl rand -hex 12)"
  url="postgresql://$PGUSER:$pass@127.0.0.1:$REHEARSAL_PORT/$PGDATABASE?schema=public"
  cleanup() { docker rm -f "$REHEARSAL_CONTAINER" >/dev/null 2>&1 || true; }
  trap cleanup EXIT
  cleanup
  log "ensaio: restaurando $(basename "$dump") em Postgres descartável ($pg_image)"
  docker run -d --name "$REHEARSAL_CONTAINER" -e POSTGRES_USER="$PGUSER" -e POSTGRES_PASSWORD="$pass" \
    -e POSTGRES_DB="$PGDATABASE" -p "127.0.0.1:$REHEARSAL_PORT:5432" "$pg_image" >/dev/null
  for _ in $(seq 1 60); do
    docker exec "$REHEARSAL_CONTAINER" pg_isready -h 127.0.0.1 -U "$PGUSER" -d "$PGDATABASE" >/dev/null 2>&1 && break
    sleep 1
  done
  docker cp "$dump" "$REHEARSAL_CONTAINER:/tmp/rehearsal.backup"
  if [[ "$dump" == *.dump ]]; then
    # pg_restore: 0=ok, 1=warnings (comum em custom dump), >=2=erro fatal.
    set +e
    docker exec "$REHEARSAL_CONTAINER" pg_restore -U "$PGUSER" -d "$PGDATABASE" --no-owner --no-acl /tmp/rehearsal.backup
    restore_rc=$?
    set -e
    if (( restore_rc >= 2 )); then
      log "ensaio: pg_restore falhou (código $restore_rc)"
      exit "$restore_rc"
    fi
    if (( restore_rc == 1 )); then
      log "ensaio: pg_restore warnings (código 1) — seguindo"
    fi
  else
    docker exec "$REHEARSAL_CONTAINER" psql -q -v ON_ERROR_STOP=1 -U "$PGUSER" -d "$PGDATABASE" -f /tmp/rehearsal.backup >/dev/null
  fi
  log "ensaio: prisma migrate deploy na cópia"
  compose run --rm -T -e DATABASE_URL="$url" migrator npx --no-install prisma migrate deploy
  log "ensaio ok"
)

ROLLBACK_READY=0
API_RECREATED=0
MIGRATED=0
rollback() {
  local code=$?
  trap - ERR
  if ((ROLLBACK_READY == 0)); then
    history "failed-before-change"
    log "falhou antes de alterar a produção (código $code)"
    exit "$code"
  fi
  log "FALHA (código $code) — voltando o código para $PREV_SHA"
  set +e
  sync_code "$PREV_SHA"
  set_release_sha "$PREV_SHA"
  docker tag "$IMAGE:rollback" "$IMAGE:staging"
  if ((MIGRATED == 1)); then
    # shellcheck disable=SC2012
    log "ATENÇÃO: o prisma migrate deploy rodou em PRD; o schema fica como está (total ou parcialmente migrado). Confira 'prisma migrate status'. Backup pré-deploy: $(ls -1t "$(sed -n 's/^BACKUP_DIR=//p' "$BACKUP_ENV" | tr -d '"')"/*.{dump,sql} 2>/dev/null | head -n1)"
  fi
  if ((API_RECREATED == 1)); then
    recreate_api
    if wait_healthy "$PREV_SHA"; then
      history "rolled-back"
      log "rollback ok: produção segue em $PREV_SHA"
    else
      history "rollback-failed"
      log "ROLLBACK FALHOU: intervenção manual necessária"
    fi
    docker logs --tail 80 cervejaria-api 2>&1 | sed 's/^/[api] /'
  else
    history "aborted-api-untouched"
    log "API não foi recriada; produção segue em $PREV_SHA"
  fi
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
compose build api
docker tag "$IMAGE:staging" "$IMAGE:$SHA"

if ((PENDING > 0)); then
  log "$PENDING migration(s) a aplicar"
  compose --profile tools build migrator
  docker tag "$MIGRATOR_IMAGE:staging" "$MIGRATOR_IMAGE:$SHA"
  rehearse_migrations
  log "status antes de migrar"
  compose run --rm -T migrator npx --no-install prisma migrate status || true
  MIGRATED=1
  log "prisma migrate deploy em PRD"
  compose run --rm -T migrator npx --no-install prisma migrate deploy
fi

log "recriando a API"
API_RECREATED=1
recreate_api
wait_healthy "$SHA"

trap - ERR
history "ok"

{
  for img in "$IMAGE" "$MIGRATOR_IMAGE"; do
    docker images "$img" --format '{{.Tag}}' | grep -E '^[0-9a-f]{40}$' | tail -n "+$((KEEP_SHA_IMAGES + 1))" |
      while read -r old; do docker rmi "$img:$old" >/dev/null 2>&1 || true; done
  done
  docker image prune -f >/dev/null 2>&1
} || true

log "PRD_DEPLOY_OK=$SHA"
