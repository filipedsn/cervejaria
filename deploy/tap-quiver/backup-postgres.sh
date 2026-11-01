#!/usr/bin/env bash
# Backup diario do Postgres PRD (cron 04:00 e deploy-prd.sh). Configuracao fica no backup-postgres.env do VPS (fora do Git).
# Cada execucao grava uma linha JSON em BACKUP_STATUS_LOG, lida pelo collector (filelog/backup) e
# vigiada pelas regras quiver-tap-backup-failed-prd / quiver-tap-backup-missing-prd.
set -euo pipefail

ENV_FILE="${BACKUP_ENV_FILE:-/opt/quiver-tap/deploy/tap-quiver/backup-postgres.env}"
# shellcheck disable=SC1090
source "$ENV_FILE"

: "${BACKUP_DIR:?}"
: "${LOG_DIR:?}"
: "${CONTAINER:?}"
: "${PGUSER:?}"
: "${PGDATABASE:?}"
: "${PREFIX:=backup-prod}"
: "${FORMAT:=custom}"
: "${RETENTION_DAYS:=30}"
: "${RETENTION_COUNT:=30}"
: "${OFFSITE_ENABLED:=0}"
: "${RCLONE_REMOTE:=}"
: "${OFFSITE_RETENTION_COUNT:=30}"
: "${TZ_NAME:=America/Sao_Paulo}"
: "${BACKUP_STATUS_LOG:=/var/log/quiver-backup-status.log}"
: "${BACKUP_TRIGGER:=cron}"

export TZ="$TZ_NAME"
mkdir -p "$BACKUP_DIR" "$LOG_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="$LOG_DIR/backup-postgres.log"
EXT="dump"
if [[ "$FORMAT" == "plain" ]]; then EXT="sql"; fi
OUT="$BACKUP_DIR/${PREFIX}-${STAMP}.${EXT}"
TMP_IN_CONTAINER="/tmp/${PREFIX}-${STAMP}.${EXT}"
STARTED_AT="$(date +%s)"
BYTES=0
OFFSITE_STATE="disabled"

log() {
  printf '%s %s\n' "$(date -Iseconds)" "$*" | tee -a "$LOG_FILE"
}

write_status() {
  local exit_code="$1" status="ok"
  (( exit_code == 0 )) || status="failed"
  [[ "$OFFSITE_STATE" == "running" ]] && OFFSITE_STATE="failed"
  printf '{"ts":"%s","job":"postgres_backup","status":"%s","exit_code":%d,"bytes":%d,"offsite":"%s","duration_s":%d,"trigger":"%s"}\n' \
    "$(date -u +%FT%TZ)" "$status" "$exit_code" "$BYTES" "$OFFSITE_STATE" "$(( $(date +%s) - STARTED_AT ))" "$BACKUP_TRIGGER" \
    >>"$BACKUP_STATUS_LOG" 2>/dev/null || true
  chmod 644 "$BACKUP_STATUS_LOG" 2>/dev/null || true
}

cleanup() {
  local exit_code=$?
  docker exec "$CONTAINER" rm -f "$TMP_IN_CONTAINER" >/dev/null 2>&1 || true
  write_status "$exit_code"
}
trap cleanup EXIT

log "START backup container=$CONTAINER db=$PGDATABASE -> $OUT"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  log "ERROR container $CONTAINER nao esta rodando"
  exit 1
fi

DUMP_FLAGS=(-U "$PGUSER" -d "$PGDATABASE" --no-owner --no-acl)
case "$FORMAT" in
  custom) DUMP_FLAGS+=(-Fc) ;;
  plain)  DUMP_FLAGS+=(-Fp) ;;
  *) log "ERROR FORMAT invalido: $FORMAT (use custom|plain)"; exit 1 ;;
esac

docker exec "$CONTAINER" pg_dump "${DUMP_FLAGS[@]}" -f "$TMP_IN_CONTAINER"
docker cp "${CONTAINER}:${TMP_IN_CONTAINER}" "$OUT"

if [[ ! -s "$OUT" ]]; then
  log "ERROR arquivo vazio: $OUT"
  rm -f "$OUT"
  exit 1
fi

sha256sum "$OUT" | awk '{print $1}' > "${OUT}.sha256"
BYTES="$(stat -c%s "$OUT")"
log "OK bytes=$BYTES file=$OUT sha256=$(cat "${OUT}.sha256")"

# Retenção local: mantém apenas os N dumps mais recentes (+ respectivos .sha256)
mapfile -t DUMPS < <(find "$BACKUP_DIR" -type f \( -name "${PREFIX}-*.dump" -o -name "${PREFIX}-*.sql" \) -printf '%T@ %p\n' | sort -nr | awk '{print $2}')
if ((${#DUMPS[@]} > RETENTION_COUNT)); then
  for ((i=RETENTION_COUNT; i<${#DUMPS[@]}; i++)); do
    f="${DUMPS[$i]}"
    log "PRUNE $f"
    rm -f "$f" "${f}.sha256"
  done
fi

# Offsite OneDrive (rclone) — nao depende do PC ligado
if [[ "${OFFSITE_ENABLED}" == "1" ]]; then
  OFFSITE_STATE="running"
  if [[ -z "${RCLONE_REMOTE}" ]]; then
    log "ERROR OFFSITE_ENABLED=1 mas RCLONE_REMOTE vazio"
    exit 1
  fi
  if ! command -v rclone >/dev/null 2>&1; then
    log "ERROR rclone nao instalado"
    exit 1
  fi
  log "OFFSITE copy -> ${RCLONE_REMOTE}"
  rclone copy "$OUT" "$RCLONE_REMOTE" --checksum --retries 5 --low-level-retries 10
  rclone copy "${OUT}.sha256" "$RCLONE_REMOTE" --retries 5
  log "OFFSITE ok"
  OFFSITE_STATE="ok"

  # Retencao remota: manter apenas N dumps mais recentes (+ sha256)
  mapfile -t REMOTE_DUMPS < <(rclone lsf "$RCLONE_REMOTE" --files-only | grep -E "^${PREFIX}-.*\.(dump|sql)$" | sort -r)
  if ((${#REMOTE_DUMPS[@]} > OFFSITE_RETENTION_COUNT)); then
    for ((i=OFFSITE_RETENTION_COUNT; i<${#REMOTE_DUMPS[@]}; i++)); do
      rf="${REMOTE_DUMPS[$i]}"
      log "OFFSITE PRUNE $rf"
      rclone deletefile "$RCLONE_REMOTE/$rf" || true
      rclone deletefile "$RCLONE_REMOTE/${rf}.sha256" || true
    done
  fi
fi

log "END ok"
