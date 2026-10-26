#!/usr/bin/env bash
# Forced command da chave SSH de arquivos de backup (TAP-134), usada só pelo painel
# Ops no PC do operador para baixar ou apagar um backup do Postgres de PRD.
# Instalado no VPS em /usr/local/sbin/quiver-tap-backup-files e referenciado em
# /root/.ssh/authorized_keys como:
#   restrict,from="100.64.0.0/10",command="/usr/local/sbin/quiver-tap-backup-files" ssh-ed25519 AAAA... quiver-tap-backup-files
#
# Aceita só `get <nome>` (escreve o arquivo no stdout) e `delete <nome>`, para nomes
# de backup da pasta BACKUP_DIR. Apagar segura o lock do deploy (a esteira ensaia
# migrations com o backup mais recente), nunca apaga o mais recente e mantém no
# mínimo MIN_KEEP. Do backup-postgres.env lê apenas BACKUP_DIR e PREFIX.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/quiver-tap}"
BACKUP_ENV="$APP_DIR/deploy/tap-quiver/backup-postgres.env"
LOCK_FILE="/var/lock/quiver-tap-deploy.lock"
MIN_KEEP=3

env_value() { sed -n "s/^$2=//p" "$1" 2>/dev/null | tail -n1 | tr -d '"'"'"; }
fail() {
  echo "$1" >&2
  exit "$2"
}

dir="$(env_value "$BACKUP_ENV" BACKUP_DIR)"
prefix="$(env_value "$BACKUP_ENV" PREFIX)"
prefix="${prefix:-backup-prod}"
[[ "$prefix" =~ ^[A-Za-z0-9_-]+$ ]] || fail "configuração do backup inválida no servidor" 2
[[ -n "$dir" && -d "$dir" ]] || fail "pasta de backups não encontrada no servidor" 2

client="${SSH_CLIENT:-?}"
client="${client%% *}"
verb="" name="" extra=""
read -r verb name extra <<<"${SSH_ORIGINAL_COMMAND:-}" || true
[[ -z "$extra" && ( "$verb" == get || "$verb" == delete ) ]] || fail "comando não permitido (use: get <nome> ou delete <nome>)" 64
[[ "$name" =~ ^${prefix}-[A-Za-z0-9_-]+\.(dump|sql)$ ]] || fail "nome de backup inválido" 64
file="$dir/$name"
[[ -f "$file" && ! -L "$file" ]] || fail "backup não encontrado no servidor: $name" 66

if [[ "$verb" == get ]]; then
  logger -t quiver-tap-backup-files "download de $name ($client)" || true
  exec cat -- "$file"
fi

exec 9>>"$LOCK_FILE"
flock -n 9 || fail "publicação em andamento no servidor; tente de novo em alguns minutos" 75

mapfile -t dumps < <(find "$dir" -maxdepth 1 -type f \( -name "${prefix}-*.dump" -o -name "${prefix}-*.sql" \) -printf '%T@ %f\n' | sort -rn | cut -d' ' -f2-)
[[ "${dumps[0]:-}" != "$name" ]] || fail "o backup mais recente não pode ser apagado" 65
(( ${#dumps[@]} > MIN_KEEP )) || fail "restam só ${#dumps[@]} backups no servidor; o mínimo é $MIN_KEEP" 65

rm -f -- "$file" "$file.sha256"
logger -t quiver-tap-backup-files "apagado $name ($client)" || true
echo "DELETED $name"
