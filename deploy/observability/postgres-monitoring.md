# Postgres TCP monitoring

O OTel Collector (contrib **0.130.1+**) usa o receiver `tcpcheck` para validar conectividade TCP em:

- `host.docker.internal:5432` (Postgres prod)
- `host.docker.internal:5434` (Postgres dev)

Métricas `tcpcheck.*` são exportadas para `metrics-tcpcheckreceiver.otel-infra*` no Elasticsearch.

## Correção automática

Se o data stream foi criado com mapping mínimo (só `@timestamp`), execute:

```powershell
npm run obs:fix-tcpcheck
npm run obs:up
```

O script `fix-tcpcheck-ds.mjs` clona o mapping OTel do httpcheck e aplica o template `quiver-tcpcheck-otel-infra` (priority 350).

Aguarde ~70s e confira (com auth — use `npm run obs:report-slo` ou scripts `obs:*`):

```powershell
# Com credenciais em deploy/observability/.env.observability:
curl.exe -s -u elastic:SUA_SENHA "http://localhost:9200/metrics-tcpcheckreceiver.otel-infra*/_count"
```

## Alertas Kibana

- `quiver-tap-postgres-tcp-down-prd` — porta 5432
- `quiver-tap-postgres-tcp-down-dev` — porta 5434

## Fase opcional (métricas profundas)

Receiver `postgresql` com usuário read-only `otel_monitor` — conexões, deadlocks, tamanho DB.
