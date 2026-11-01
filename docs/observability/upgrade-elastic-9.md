# Upgrade do Elastic para 9.x (TAP-159)

Elasticsearch e Kibana sobem de 8.17.0 para 9.5.5 passando por 8.19.23 (o salto direto de 8.17 para 9.x não é suportado). São as versões mais novas publicadas no registry da Elastic em 2026-11-01.

## Por que

- Streams (wired e classic, com processing) e as telas novas de Observability e Security vêm na licença Basic do 9.x.
- Workflows exigem licença Enterprise (a API responde 403 na Basic). Os alertas continuam pelas regras do Kibana mais o alert-poller (TAP-139).

## DEV (feito em 2026-11-01)

- 8.17.0, depois 8.19.23, depois 9.5.5, com backup do volume antes.
- Ingestão do collector (otel contrib 0.130.1) continuou sem mudança de versão nem de configuração.
- `ensureMetricsFingerprint` (scripts de observabilidade) foi ajustado para o ES 9.
- Depois de `apply-retention --target dev --apply --rollover`, os erros `version_conflict_engine_exception` de TSDB pararam (0 nos 30 minutos conferidos).
- Kibana 9.5.5: dashboards, data views e regras recriados pelos scripts. Streams, APM e Security abrem na licença Basic.

## PRD (exige autorização de produção)

O compose do Elastic PRD fica fora do repositório, no VPS. O script `deploy/tap-quiver/upgrade-elastic.sh` roda no VPS como root, uma fase por vez, e para no primeiro erro.

| Ordem | Fase | O que faz |
|---|---|---|
| 1 | `prep` | Guarda cópias do compose e do `.env` fora da pasta, cria o repositório de snapshot em disco (`path.repo` e bind `./snapshots`), sobe o heap para 4 GB, corrige `SERVER_PUBLICBASEURL`, recria ES e Kibana ainda em 8.17.0 e registra o repositório `quiver-fs`. Aborta se alguma alteração do compose não pegar. |
| 2 | `snap pre-819` | Snapshot completo com estado global e espera terminar. |
| 3 | `up819` | Imagens 8.19.23, recria, espera o cluster green/yellow e o Kibana available. |
| 4 | `snap pre-9` | Novo snapshot completo. |
| 5 | `up9` | Aborta se houver deprecation crítica; senão, imagens 9.5.5, recria e espera. |

Durante cada recriação o Elastic fica alguns minutos fora; a aplicação continua atendendo, o collector segura o que couber na fila em memória (o excedente se perde) e os alertas de telemetria podem disparar.

O VPS tem 16 GB de RAM com cerca de 12 GB livres e disco em 9%, o que comporta o heap de 4 GB e os snapshots.

## Verificação depois do `up9`

1. `GET /` responde `9.5.5` e `_cluster/health` está green ou yellow.
2. `diagnose-prd.ps1` sem falhas (data streams recebendo, regras presentes).
3. Kibana abre pela Tailscale; regras ativas e alert-poller lendo o índice de alertas.
4. Collector PRD sem erros de exportação.
5. `apply-retention --target prd --apply --rollover --confirm-prd` para recriar os índices de escrita com os templates do 9.x.

## Reversão

O Elasticsearch não faz downgrade do diretório de dados. Para voltar:

1. Parar ES e Kibana.
2. Restaurar o compose guardado pelo `prep` (versão anterior) apontando para um volume de dados novo.
3. Subir, registrar o repositório `quiver-fs` e restaurar o snapshot `pre-819-*` ou `pre-9-*` com `include_global_state`.

Os snapshots ficam no disco do próprio VPS; o backup off-site continua sendo só o do Postgres.
