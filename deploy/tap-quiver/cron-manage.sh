#!/usr/bin/env bash
# Forced command da chave SSH de schedules do VPS (TAP-178), usada só pelo painel
# Ops no PC do operador para ligar/desligar ou alterar horário dos crons de manutenção.
# Instalado no VPS em /usr/local/sbin/quiver-tap-cron-manage e referenciado em
# /root/.ssh/authorized_keys como:
#   restrict,from="100.64.0.0/10",command="/usr/local/sbin/quiver-tap-cron-manage" ssh-ed25519 AAAA... quiver-tap-cron-manage
#
# Aceita: list | enable <id> | disable <id> | set-time <id> <HH:MM>
# HH:MM é horário de Brasília (BRT); o arquivo em /etc/cron.d guarda UTC.
# Allowlist fechada; sem shell. Mutações usam o lock do deploy.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/quiver-tap}"
# shellcheck source=cron-schedules.lib.sh
source "$APP_DIR/deploy/tap-quiver/cron-schedules.lib.sh"
LOCK_FILE="/var/lock/quiver-tap-deploy.lock"

fail() {
  echo "$1" >&2
  exit "$2"
}

client="${SSH_CLIENT:-?}"
client="${client%% *}"
verb="" a1="" a2="" extra=""
read -r verb a1 a2 extra <<<"${SSH_ORIGINAL_COMMAND:-}" || true
[[ -z "$extra" ]] || fail "comando não permitido" 64

case "$verb" in
  list) ;;
  enable|disable)
    [[ -n "$a1" && -z "$a2" ]] || fail "uso: $verb <id>" 64
    schedule_allowed "$a1" || fail "schedule não permitido: $a1" 64
    ;;
  set-time)
    [[ -n "$a1" && -n "$a2" ]] || fail "uso: set-time <id> <HH:MM>" 64
    schedule_allowed "$a1" || fail "schedule não permitido: $a1" 64
    [[ "$a2" =~ ^([01][0-9]|2[0-3]):([0-5][0-9])$ ]] || fail "horário inválido (use HH:MM em Brasília)" 64
    ;;
  *)
    fail "comando não permitido (use: list | enable <id> | disable <id> | set-time <id> <HH:MM>)" 64
    ;;
esac

json_str() {
  local s="${1//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '"%s"' "$(printf '%s' "$s" | tr -d '\000-\037')"
}

field_json() {
  if [[ "$1" =~ ^[0-9*,/-]+$ ]]; then json_str "$1"; else printf 'null'; fi
}

emit_one() {
  local id="$1" path enabled=false min="" hour="" dom="" mon="" dow=""
  path="$(schedule_path "$id")"
  if [[ -z "$path" ]]; then
    printf '{"id":%s,"enabled":false,"present":false,"minute":null,"hour":null,"dow":null}' "$(json_str "$id")"
    return
  fi
  schedule_enabled "$id" && enabled=true
  if fields="$(schedule_fields "$path")"; then
    read -r min hour dom mon dow <<<"$fields"
  fi
  printf '{"id":%s,"enabled":%s,"present":true,"minute":%s,"hour":%s,"dow":%s}' \
    "$(json_str "$id")" "$enabled" "$(field_json "$min")" "$(field_json "$hour")" "$(field_json "$dow")"
}

do_list() {
  local first=1 id
  printf '['
  for id in "${SCHEDULE_IDS[@]}"; do
    [[ $first -eq 1 ]] || printf ','
    first=0
    emit_one "$id"
  done
  printf ']\n'
}

lock_or_fail() {
  exec 9>>"$LOCK_FILE"
  flock -n 9 || fail "publicação em andamento no servidor; tente de novo em alguns minutos" 75
}

do_enable() {
  local id="$1"
  [[ -f "$CRON_DIR/$id" && ! -L "$CRON_DIR/$id" ]] && fail "schedule já está ligado: $id" 65
  [[ -f "$CRON_DIR/$id.disabled" && ! -L "$CRON_DIR/$id.disabled" ]] || fail "schedule não encontrado: $id" 66
  lock_or_fail
  mv -f -- "$CRON_DIR/$id.disabled" "$CRON_DIR/$id"
  chmod 644 -- "$CRON_DIR/$id"
  logger -t quiver-tap-cron-manage "enable $id ($client)" || true
  echo "ENABLED $id"
}

do_disable() {
  local id="$1"
  [[ -f "$CRON_DIR/$id" && ! -L "$CRON_DIR/$id" ]] || fail "schedule não está ligado: $id" 65
  [[ -e "$CRON_DIR/$id.disabled" ]] && fail "já existe $id.disabled no servidor; resolva manualmente" 65
  lock_or_fail
  mv -f -- "$CRON_DIR/$id" "$CRON_DIR/$id.disabled"
  chmod 644 -- "$CRON_DIR/$id.disabled"
  logger -t quiver-tap-cron-manage "disable $id ($client)" || true
  echo "DISABLED $id"
}

do_set_time() {
  local id="$1" brt="$2" path min hour dom mon dow brt_h brt_m utc_h tmp
  path="$(schedule_path "$id")"
  [[ -n "$path" ]] || fail "schedule não encontrado: $id" 66
  fields="$(schedule_fields "$path")" || fail "arquivo de schedule sem linha de job: $id" 65
  read -r min hour dom mon dow <<<"$fields"
  schedule_can_set_time "$min" "$hour" || fail "este schedule não tem horário fixo para alterar: $id" 65
  brt_h="${brt%%:*}"
  brt_m="${brt##*:}"
  # remove leading zeros for arithmetic via 10#
  utc_h="$(brt_hour_to_utc "$brt_h")"
  # Preserve dom/mon/dow (ex.: quarta no builder-prune).
  lock_or_fail
  tmp="$(mktemp)"
  awk -v nmin=$((10#$brt_m)) -v nhour=$((10#$utc_h)) '
    BEGIN { done = 0 }
    /^[[:space:]]*#/ { print; next }
    /^[[:space:]]*$/ { print; next }
    /^[A-Za-z_][A-Za-z0-9_]*=/ { print; next }
    !done && $1 ~ /^[0-9*,/-]+$/ && $2 ~ /^[0-9*,/-]+$/ && $3 ~ /^[0-9*,/-]+$/ && $4 ~ /^[0-9*,/-]+$/ && $5 ~ /^[0-9*,/-]+$/ {
      $1 = nmin; $2 = nhour; print; done = 1; next
    }
    { print }
    END { if (!done) exit 2 }
  ' "$path" >"$tmp" || {
    rm -f -- "$tmp"
    fail "não foi possível reescrever o horário de $id" 65
  }
  # cron.d exige LF e mode 644; dono root.
  mv -f -- "$tmp" "$path"
  chmod 644 -- "$path"
  logger -t quiver-tap-cron-manage "set-time $id $brt BRT (-> ${utc_h}:$((10#$brt_m)) UTC) ($client)" || true
  echo "SET_TIME $id $brt"
}

case "$verb" in
  list) do_list ;;
  enable) do_enable "$a1" ;;
  disable) do_disable "$a1" ;;
  set-time) do_set_time "$a1" "$a2" ;;
esac
