#!/usr/bin/env bash
# Upgrade do Elastic PRD (VPS) 8.17.0 -> 8.19.23 -> 9.5.5, com snapshot antes de cada salto.
# Uso (no VPS, como root): bash /opt/quiver-tap/deploy/tap-quiver/upgrade-elastic.sh <fase>
#   fase = prep      : backup do compose/.env, repositorio de snapshot (path.repo), heap 4g, SERVER_PUBLICBASEURL; recria ES+Kibana em 8.17.0
#          snap <tag>: snapshot completo "pre-<tag>" e espera terminar
#          up819     : imagens 8.19.23, recria, espera green/yellow e Kibana available
#          up9       : confere deprecations criticas = 0, imagens 9.5.5, recria, espera
# Rollback (manual, ver docs/observability/upgrade-elastic-9.md): o ES nao faz downgrade do diretorio de dados; restaurar = subir a versao anterior com volume novo + restore do snapshot.
set -Eeuo pipefail
DIR=/docker/elasticsearch-kibana
BK=/root/quiver-env-backups
SNAPDIR=/docker/elasticsearch-kibana/snapshots
cd "$DIR"
log() { printf '[elastic-upg %s] %s\n' "$(date -u +%FT%TZ)" "$*"; }
pass() { sed -n 's/^ELASTIC_PASSWORD=//p' .env | tr -d '"'"'"; }
es() { curl -fsS -u "elastic:$(pass)" -H 'Content-Type: application/json' "http://127.0.0.1:9200$1" "${@:2}"; }
wait_es() {
  for _ in $(seq 1 90); do
    st="$(es '/_cluster/health?filter_path=status' 2>/dev/null || true)"
    [[ "$st" == *green* || "$st" == *yellow* ]] && { log "ES $st"; return 0; }
    sleep 5
  done
  log "ES nao ficou pronto"; return 1
}
wait_kb() {
  for _ in $(seq 1 120); do
    lv="$(curl -fsS http://127.0.0.1:5601/api/status 2>/dev/null | grep -o '"level":"[a-z]*"' | head -n1 || true)"
    [[ "$lv" == *available* ]] && { log "Kibana available"; return 0; }
    sleep 5
  done
  log "Kibana nao ficou available"; return 1
}
set_images() {
  sed -i -E "s#(elasticsearch/elasticsearch:)[0-9.]+#\1$1#; s#(kibana/kibana:)[0-9.]+#\1$1#" docker-compose.yml
  grep -n 'image:' docker-compose.yml
}
case "${1:-}" in
  prep)
    install -d -m 700 "$BK"
    ts="$(date +%F-%H%M)"
    install -m 600 docker-compose.yml "$BK/elastic-docker-compose.yml.bak-$ts"
    install -m 600 .env "$BK/elastic-env.bak-$ts"
    install -d -m 775 "$SNAPDIR"; chown 1000:0 "$SNAPDIR"
    grep -q 'path.repo' docker-compose.yml || sed -i -E 's#^(\s+)- discovery.type=single-node#&\n\1- path.repo=/usr/share/elasticsearch/snapshots#' docker-compose.yml
    grep -qF './snapshots:' docker-compose.yml || sed -i -E 's#^(\s+)- es_data:/usr/share/elasticsearch/data#&\n\1- ./snapshots:/usr/share/elasticsearch/snapshots#' docker-compose.yml
    sed -i -E 's#-Xms512m -Xmx512m#-Xms4g -Xmx4g#' docker-compose.yml
    sed -i -E 's#^(\s+- SERVER_PUBLICBASEURL=).*#\1http://127.0.0.1:5601#' docker-compose.yml
    for want in 'path.repo=/usr/share/elasticsearch/snapshots' './snapshots:/usr/share/elasticsearch/snapshots' '-Xms4g -Xmx4g' 'SERVER_PUBLICBASEURL=http://127.0.0.1:5601'; do
      grep -qF -- "$want" docker-compose.yml || { log "compose sem '$want'; ajuste manual e rode prep de novo"; exit 4; }
    done
    docker compose config -q
    docker compose up -d
    wait_es; wait_kb
    es '/_snapshot/quiver-fs' -X PUT -d '{"type":"fs","settings":{"location":"/usr/share/elasticsearch/snapshots","compress":true}}'; echo
    es '/_nodes/stats/jvm?filter_path=nodes.*.jvm.mem.heap_max_in_bytes'; echo
    ;;
  snap)
    tag="${2:?tag}"
    es "/_snapshot/quiver-fs/pre-$tag-$(date +%Y%m%d%H%M)?wait_for_completion=true" -X PUT -d '{"indices":"*","include_global_state":true}' | grep -o '"state":"[A-Z_]*"'
    ;;
  up819)
    set_images 8.19.23; docker compose up -d; wait_es; wait_kb
    es '/?filter_path=version.number'; echo
    ;;
  up9)
    crit="$(es '/_migration/deprecations' | { grep -o '"level":"critical"' || true; } | wc -l)"
    [[ "$crit" == 0 ]] || { log "ha $crit deprecations criticas; abortando"; exit 3; }
    set_images 9.5.5; docker compose up -d; wait_es; wait_kb
    es '/?filter_path=version.number'; echo
    ;;
  *) echo "fase invalida"; exit 2 ;;
esac
log "fase ${1} ok"
