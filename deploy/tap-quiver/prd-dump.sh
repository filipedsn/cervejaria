#!/usr/bin/env bash
# Forced command da chave SSH de cópia do banco (TAP-129), usada só pelo painel
# Ops no PC do operador para levar o banco de PRD ao ambiente de testes (DEV).
# Instalado no VPS em /usr/local/sbin/quiver-tap-prd-dump e referenciado em
# /root/.ssh/authorized_keys como:
#   restrict,from="100.64.0.0/10",command="/usr/local/sbin/quiver-tap-prd-dump" ssh-ed25519 AAAA... quiver-tap-prd-dump
#
# Ignora o comando pedido pelo cliente e escreve no stdout um pg_dump -Fc do banco
# de PRD. Não grava arquivo no VPS e não altera o banco. Segura o lock do deploy
# enquanto roda: nunca coincide com uma publicação (que espera alguns segundos).
# Do backup-postgres.env lê apenas CONTAINER, PGUSER e PGDATABASE.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/quiver-tap}"
BACKUP_ENV="$APP_DIR/deploy/tap-quiver/backup-postgres.env"
LOCK_FILE="/var/lock/quiver-tap-deploy.lock"

env_value() { sed -n "s/^$2=//p" "$1" 2>/dev/null | tail -n1 | tr -d '"'"'"; }

container="$(env_value "$BACKUP_ENV" CONTAINER)"
user="$(env_value "$BACKUP_ENV" PGUSER)"
db="$(env_value "$BACKUP_ENV" PGDATABASE)"
container="${container:-cervejaria-db}"
if [[ -z "$user" || -z "$db" ]]; then
  echo "configuração do backup incompleta no servidor" >&2
  exit 2
fi

exec 9>>"$LOCK_FILE"
if ! flock -n 9; then
  echo "publicação em andamento no servidor; tente de novo em alguns minutos" >&2
  exit 75
fi

logger -t quiver-tap-prd-dump "cópia do banco $db solicitada (${SSH_CLIENT:-?})" || true
exec docker exec "$container" pg_dump -U "$user" -d "$db" -Fc --no-owner --no-acl
