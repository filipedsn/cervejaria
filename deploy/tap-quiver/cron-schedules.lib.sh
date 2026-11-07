#!/usr/bin/env bash
# Catálogo e helpers dos crons gerenciáveis pelo painel Ops (TAP-178).
# Sourced por ops-report.sh e cron-manage.sh. Não executar sozinho.
# shellcheck shell=bash

CRON_DIR="${CRON_DIR:-/etc/cron.d}"
# BRT = UTC−3 (sem DST desde 2019).
BRT_UTC_OFFSET=3

# Ordem estável na UI.
SCHEDULE_IDS=(
  quiver-tap-backup
  docker-image-prune
  docker-builder-prune
  quiver-tap-docker-state
)

schedule_allowed() {
  local id="$1" s
  for s in "${SCHEDULE_IDS[@]}"; do
    [[ "$s" == "$id" ]] && return 0
  done
  return 1
}

# Caminho ativo ou .disabled; vazio se nenhum.
schedule_path() {
  local id="$1"
  if [[ -f "$CRON_DIR/$id" && ! -L "$CRON_DIR/$id" ]]; then
    printf '%s' "$CRON_DIR/$id"
  elif [[ -f "$CRON_DIR/$id.disabled" && ! -L "$CRON_DIR/$id.disabled" ]]; then
    printf '%s' "$CRON_DIR/$id.disabled"
  else
    printf ''
  fi
}

schedule_enabled() {
  local id="$1"
  [[ -f "$CRON_DIR/$id" && ! -L "$CRON_DIR/$id" ]]
}

# Primeira linha de job do arquivo cron.d (5 campos + user + comando).
# Imprime: min hour dom mon dow
schedule_fields() {
  local file="$1" line
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line//[[:space:]]/}" ]] && continue
    [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]] && continue
    if [[ "$line" =~ ^([0-9*,/-]+)[[:space:]]+([0-9*,/-]+)[[:space:]]+([0-9*,/-]+)[[:space:]]+([0-9*,/-]+)[[:space:]]+([0-9*,/-]+)[[:space:]]+ ]]; then
      printf '%s %s %s %s %s' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}" "${BASH_REMATCH[4]}" "${BASH_REMATCH[5]}"
      return 0
    fi
  done <"$file"
  return 1
}

# true se minuto e hora são numéricos (pode alterar horário).
schedule_can_set_time() {
  local min="$1" hour="$2"
  [[ "$min" =~ ^[0-9]+$ && "$hour" =~ ^[0-9]+$ ]]
}

utc_hour_to_brt() {
  local h="$1"
  printf '%s' "$(( (10#$h - BRT_UTC_OFFSET + 24) % 24 ))"
}

brt_hour_to_utc() {
  local h="$1"
  printf '%s' "$(( (10#$h + BRT_UTC_OFFSET) % 24 ))"
}
