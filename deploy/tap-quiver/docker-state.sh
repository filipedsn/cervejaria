#!/usr/bin/env bash
# Estado dos contêineres Docker do VPS em JSON Lines, lido pelo collector (filelog/docker).
# Roda pelo cron /etc/cron.d/quiver-tap-docker-state a cada minuto. Não expõe o socket do Docker ao collector.
set -euo pipefail
OUT="${DOCKER_STATE_LOG:-/var/log/quiver-docker-state.log}"
MAX_BYTES="${DOCKER_STATE_MAX_BYTES:-5242880}"
now="$(date +%s)"
ts="$(date -u +%FT%TZ)"
if [[ -f "$OUT" ]] && (( $(stat -c %s "$OUT") > MAX_BYTES )); then
  mv -f "$OUT" "$OUT.1"
fi
ids="$(docker ps -aq)"
[[ -n "$ids" ]] || exit 0
docker inspect -f '{{.Name}}|{{.RestartCount}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.State.StartedAt}}|{{.State.OOMKilled}}|{{.State.ExitCode}}|{{.Config.Image}}' $ids |
  while IFS='|' read -r name restarts status health started oom exit_code image; do
    started_epoch="$(date -d "$started" +%s 2>/dev/null || echo 0)"
    uptime=$(( now - started_epoch ))
    recent=false
    (( started_epoch > 0 && uptime < 180 )) && recent=true
    printf '{"ts":"%s","container":"%s","image":"%s","restarts":%d,"status":"%s","health":"%s","uptime_s":%d,"recent_start":%s,"oom_killed":%s,"exit_code":%d}\n' \
      "$ts" "${name#/}" "$image" "$restarts" "$status" "${health:-none}" "$uptime" "$recent" "$oom" "$exit_code"
  done >>"$OUT"
chmod 644 "$OUT"
