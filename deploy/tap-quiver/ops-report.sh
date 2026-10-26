#!/usr/bin/env bash
# Forced command da chave SSH só leitura do painel Ops (PC do operador, via Tailscale).
# Instalado no VPS em /usr/local/sbin/quiver-tap-ops-report e referenciado em
# /root/.ssh/authorized_keys como:
#   restrict,command="/usr/local/sbin/quiver-tap-ops-report" ssh-ed25519 AAAA... quiver-tap-ops-panel
#
# Ignora o comando pedido pelo cliente e só imprime um JSON com o estado do VPS.
# Não altera nada e não imprime segredos: do .env.staging lê apenas RELEASE_SHA,
# do backup-postgres.env apenas BACKUP_DIR e PREFIX.
set -uo pipefail

APP_DIR="${APP_DIR:-/opt/quiver-tap}"
COMPOSE_DIR="$APP_DIR/deploy/tap-quiver"
ENV_FILE="$COMPOSE_DIR/.env.staging"
BACKUP_ENV="$COMPOSE_DIR/backup-postgres.env"
HISTORY_FILE="/var/log/quiver-tap-deploy.log"
API_CONTAINER="cervejaria-api"
DB_CONTAINER="cervejaria-db"

str() {
  local s="${1//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '"%s"' "$(printf '%s' "$s" | tr -d '\000-\037')"
}
num() { if [[ "$1" =~ ^[0-9]+$ ]]; then printf '%s' "$1"; else printf 'null'; fi; }
opt_str() { if [[ -n "$1" ]]; then str "$1"; else printf 'null'; fi; }
env_value() { sed -n "s/^$2=//p" "$1" 2>/dev/null | tail -n1 | tr -d '"'"'"; }

container() {
  docker inspect --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.State.StartedAt}}|{{.RestartCount}}' "$1" 2>/dev/null
}

now="$(date +%s)"

release_sha="$(env_value "$ENV_FILE" RELEASE_SHA)"
[[ "$release_sha" =~ ^[0-9a-f]{40}$ ]] || release_sha=""

IFS='|' read -r api_status api_health api_started api_restarts <<<"$(container "$API_CONTAINER")"
IFS='|' read -r db_status db_health _ _ <<<"$(container "$DB_CONTAINER")"

disk_pct="$(df --output=pcent / 2>/dev/null | tail -n1 | tr -dc '0-9')"

backup_dir="$(env_value "$BACKUP_ENV" BACKUP_DIR)"
prefix="$(env_value "$BACKUP_ENV" PREFIX)"
backup_name="" backup_mtime="" backup_size=""
if [[ -n "$backup_dir" && -d "$backup_dir" ]]; then
  latest="$(find "$backup_dir" -maxdepth 1 -type f \( -name "${prefix:-backup-prod}-*.dump" -o -name "${prefix:-backup-prod}-*.sql" \) -printf '%T@ %s %f\n' 2>/dev/null | sort -rn | head -n1)"
  if [[ -n "$latest" ]]; then
    read -r backup_mtime backup_size backup_name <<<"$latest"
    backup_mtime="${backup_mtime%.*}"
  fi
fi

deploys=""
if [[ -r "$HISTORY_FILE" ]]; then
  while read -r at rest; do
    sha="$(sed -n 's/.*\bsha=\([0-9a-f]\{40\}\).*/\1/p' <<<"$rest")"
    migrations="$(sed -n 's/.*\bmigrations=\([0-9]*\).*/\1/p' <<<"$rest")"
    result="$(sed -n 's/.*\bresult=\([a-z_-]*\).*/\1/p' <<<"$rest")"
    [[ -n "$sha" ]] || continue
    deploys+="${deploys:+,}{\"at\":$(str "$at"),\"sha\":$(str "$sha"),\"migrations\":$(num "$migrations"),\"result\":$(str "$result")}"
  done < <(tail -n 10 "$HISTORY_FILE")
fi

printf '{"now":%s,"release_sha":%s,' "$now" "$(opt_str "$release_sha")"
printf '"api":{"status":%s,"health":%s,"started":%s,"restarts":%s},' \
  "$(opt_str "$api_status")" "$(opt_str "$api_health")" "$(opt_str "$api_started")" "$(num "$api_restarts")"
printf '"db":{"status":%s,"health":%s},' "$(opt_str "$db_status")" "$(opt_str "$db_health")"
printf '"disk_pct":%s,' "$(num "$disk_pct")"
if [[ -n "$backup_name" ]]; then
  printf '"backup":{"name":%s,"mtime":%s,"size":%s},' "$(str "$backup_name")" "$(num "$backup_mtime")" "$(num "$backup_size")"
else
  printf '"backup":null,'
fi
printf '"deploys":[%s]}\n' "$deploys"
