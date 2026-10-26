#!/usr/bin/env bash
# Forced command da chave SSH só leitura do painel Ops (PC do operador, via Tailscale).
# Instalado no VPS em /usr/local/sbin/quiver-tap-ops-report e referenciado em
# /root/.ssh/authorized_keys como:
#   restrict,command="/usr/local/sbin/quiver-tap-ops-report" ssh-ed25519 AAAA... quiver-tap-ops-panel
#
# Ignora o comando pedido pelo cliente e só imprime um JSON com o estado do VPS.
# Não altera nada e não imprime segredos: do .env.staging lê apenas RELEASE_SHA,
# do backup-postgres.env apenas BACKUP_DIR e PREFIX; dos contêineres, só estado,
# imagem e consumo (nunca variáveis de ambiente).
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
read -r disk_total disk_used _ <<<"$(df -B1 --output=size,used,avail / 2>/dev/null | tail -n1)"
mem_kb() { sed -n "s/^$1: *\([0-9]*\) kB$/\1/p" /proc/meminfo; }
mem_total_kb="$(mem_kb MemTotal)"
mem_avail_kb="$(mem_kb MemAvailable)"
read -r load1 load5 load15 _ </proc/loadavg
uptime_s="$(cut -d. -f1 /proc/uptime)"
cpus="$(nproc 2>/dev/null)"
decimal() { if [[ "$1" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then printf '%s' "$1"; else printf 'null'; fi; }
kb_bytes() { if [[ "$1" =~ ^[0-9]+$ ]]; then printf '%s' "$(($1 * 1024))"; else printf 'null'; fi; }

# CPU do servidor = fração não ociosa de /proc/stat durante o `docker stats` (~2 s).
cpu_sample() { awk '/^cpu /{ total = 0; for (i = 2; i <= NF; i++) total += $i; print total, $5 + $6 }' /proc/stat; }
read -r cpu_t1 cpu_i1 <<<"$(cpu_sample)"
declare -A stats=()
while IFS='|' read -r name cpu mem net block pids; do
  [[ -n "$name" ]] && stats["$name"]="$cpu|$mem|$net|$block|$pids"
done < <(timeout 10 docker stats --no-stream --format '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.NetIO}}|{{.BlockIO}}|{{.PIDs}}' 2>/dev/null)
read -r cpu_t2 cpu_i2 <<<"$(cpu_sample)"
cpu_pct="null"
if (( cpu_t2 > cpu_t1 )); then
  cpu_pct="$(( (100 * ((cpu_t2 - cpu_t1) - (cpu_i2 - cpu_i1)) + (cpu_t2 - cpu_t1) / 2) / (cpu_t2 - cpu_t1) ))"
fi

containers=""
ids="$(docker ps -aq 2>/dev/null)"
if [[ -n "$ids" ]]; then
  # shellcheck disable=SC2086 # um id por palavra
  while IFS='|' read -r name image project status health started restarts exit_code; do
    name="${name#/}"
    [[ -n "$name" ]] || continue
    IFS='|' read -r s_cpu s_mem s_net s_block s_pids <<<"${stats[$name]:-||||}"
    containers+="${containers:+,}{\"name\":$(str "$name"),\"image\":$(str "$image"),\"project\":$(opt_str "$project")"
    containers+=",\"status\":$(opt_str "$status"),\"health\":$(opt_str "$health"),\"started\":$(opt_str "$started")"
    containers+=",\"restarts\":$(num "$restarts"),\"exit_code\":$(num "$exit_code")"
    containers+=",\"cpu\":$(opt_str "$s_cpu"),\"mem\":$(opt_str "$s_mem"),\"net\":$(opt_str "$s_net"),\"block\":$(opt_str "$s_block"),\"pids\":$(num "$s_pids")}"
  done < <(docker inspect --format '{{.Name}}|{{.Config.Image}}|{{index .Config.Labels "com.docker.compose.project"}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.State.StartedAt}}|{{.RestartCount}}|{{.State.ExitCode}}' $ids 2>/dev/null)
fi

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
printf '"host":{"cpus":%s,"cpu_pct":%s,"load":[%s,%s,%s],"mem_total":%s,"mem_avail":%s,"disk_total":%s,"disk_used":%s,"uptime_s":%s},' \
  "$(num "$cpus")" "$(num "$cpu_pct")" "$(decimal "$load1")" "$(decimal "$load5")" "$(decimal "$load15")" \
  "$(kb_bytes "$mem_total_kb")" "$(kb_bytes "$mem_avail_kb")" "$(num "$disk_total")" "$(num "$disk_used")" "$(num "$uptime_s")"
printf '"containers":[%s],' "$containers"
if [[ -n "$backup_name" ]]; then
  printf '"backup":{"name":%s,"mtime":%s,"size":%s},' "$(str "$backup_name")" "$(num "$backup_mtime")" "$(num "$backup_size")"
else
  printf '"backup":null,'
fi
printf '"deploys":[%s]}\n' "$deploys"
