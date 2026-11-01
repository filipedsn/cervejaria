# TQ-OBS-04 — Certificação de observabilidade PRD

Primeira rodada: 2026-10-26 21:22 BRT (RELEASE_SHA `ef52d938`)  
Segunda rodada: 2026-11-01 15:35 BRT (RELEASE_SHA `1126730f15e0d2b7cdd1075eb6b72feb8859d44b`)  
Rodada final: 2026-11-01 18:40 BRT (RELEASE_SHA `1ae135808ee96c46f12e749b023847c3bc5d1424`, Elastic 9.5.5)  
Projeto Plane: TAP-138

## Rodada final (2026-11-01 18:40 BRT)

`diagnose-prd.ps1`: 19 de 19 PASS depois do deploy de `1ae13580` e do upgrade do Elastic PRD para 9.5.5.

- ES-01: green. As réplicas dos backing indices antigos foram zeradas (cluster de um nó); os índices novos já nascem com 0 réplicas.
- ILM-01 e MAP-01: PASS após `apply-retention --target prd --apply --rollover`, reaplicado depois do upgrade. Auditoria PRD com 180 dias.
- ALT-01, KB-03, KB-04, KB-05: PASS. Regras PRD criadas e 15 regras canônicas ligadas ao índice `quiver-tap-alert-events`.
- VPS-04: resolvido. tcpcheck `cervejaria-db:5432` com status 1 em 100% das amostras dos últimos 20 min; collector sem erros.
- Restarts de contêiner: fonte criada (cron `docker-state.sh` e regra `quiver-tap-container-restart-prd`).
- Pendente fora desta certificação: entrega no Telegram pelo alert-poller, que espera o token do bot (TAP-139).

A matriz abaixo é a segunda rodada, mantida como histórico.

## Autorizações

- G0: Filipe autorizou a criação dos três itens do Plane em 2026-10-26.
- G1: Filipe autorizou a leitura do Elasticsearch e Kibana PRD em 2026-10-26. Diagnóstico executado fora do sandbox (`scripts/observability/diagnose-prd.ps1`).
- G2: Filipe autorizou a execução de comandos somente leitura no VPS via SSH em 2026-10-26.
- G4: não utilizado; o poller legado não foi encontrado no PC.

## Matriz

Resultados da rodada atual. Onde a primeira rodada diverge, a diferença está na evidência.

| Id | Verificação | Critério | Resultado | Evidência |
|---|---|---|---|---|
| ES-01 | Saúde do cluster | green PASS; cluster de um nó yellow é WARN conforme §4.8 | WARN | yellow, 1 nó; réplicas não alteradas |
| ES-02 | Heap e disco do nó | Heap <85% e disco <80%; RAM alta com heap abaixo de 85% é PASS | PASS | heap 61%; disco 7,7%; RAM 49% (26/10: heap 44%, RAM 90% com cache do SO) |
| DS-01 | Frescor de metrics-generic PRD | Dado mais recente até 5 min | PASS | idade 1,4 min |
| DS-02 | Frescor de logs-technical PRD | Dado mais recente até 60 min | PASS | idade 0,5 min |
| DS-03 | Existência de logs-audit PRD | Fonte presente; informativo | INFO | existe; idade 4,8 min |
| DS-04 | Frescor de traces PRD | Dado mais recente até 60 min | PASS | idade 1,8 min |
| DS-05 | Frescor de httpcheck infra | Dado mais recente até 5 min | PASS | idade 1,4 min; `:3001/` e `:3001/api/ready` com HTTP 200 nos últimos 15 min |
| DS-06 | Frescor de tcpcheck infra | Dado mais recente até 5 min | PASS | idade 1,3 min (o dado chega; o status do Postgres está em VPS-04) |
| DS-07 | Frescor de hostmetrics infra | Dado mais recente até 5 min | PASS | idade 1,4 min |
| DS-08 | Segregação DEV/PRD | Nenhum data stream otel-dev no cluster PRD | PASS | 0 streams |
| ILM-01 | Política de retenção em streams PRD/infra | Todos os streams aplicáveis têm política quiver-tap | FAIL | sem política em traces-generic.otel-prd |
| MAP-01 | Mapping _metric_names_hash | Campo presente no mapping custom | FAIL | presente=false |
| COR-01 | Correlação ponta a ponta | Pelo menos um documento com correlationId | PASS | 3 documentos encontrados |
| ALT-01 | Índice de eventos de alerta | Criado no WI-B/G8 | WAIVED | entregue no WI-B (TAP-139), G8 |
| KB-01 | Disponibilidade do Kibana | overall available | PASS | available |
| KB-02 | Chave permanente de criptografia do Kibana | Presente | PASS | has_permanent_encryption_key=true |
| KB-03 | Regras PRD presentes e sem erro | Regras PRD configuradas no WI-B/G8 | WAIVED | faltam as 12 regras esperadas; entregue no WI-B (TAP-139), G8 |
| KB-04 | Connector de índice de alertas | Criado no WI-B/G8 | WAIVED | ausente; entregue no WI-B (TAP-139), G8 |
| KB-05 | Data views PRD | Criadas no WI-B/G8 | WAIVED | zero data views otel-prd; entregue no WI-B (TAP-139), G8 |
| HM-01 | Disco via hostmetrics | Comparação com df -h /; diferença até 5 pontos percentuais é representativa | PASS | campo `system.filesystem.utilization`, mount em `attributes.mountpoint`; os bind mounts do collector (`/etc/hostname`, `/etc/hosts`, `/etc/resolv.conf`) refletem o disco raiz do host (26/10: host 10%, hostmetrics 9,4%). A regra de disco usa `/etc/hostname` |
| VPS-01 | Contêineres PRD | Up e healthy; collector sem healthcheck é aceito se Up e zero restarts | PASS | API, Kibana, Elasticsearch e banco healthy; collector Up, sem healthcheck |
| VPS-02 | Exportadores OTEL e RELEASE_SHA | Traces, metrics e logs em otlp; RELEASE_SHA preenchido | PASS | três exportadores em otlp; RELEASE_SHA presente |
| VPS-03 | Variáveis de observabilidade | ELASTICSEARCH_URL, ELASTIC_USER e ELASTIC_PASSWORD presentes; registrar só nomes | PASS | os três nomes foram confirmados |
| VPS-04 | Erros recorrentes do collector | Sem erro recorrente | FAIL | tcpcheck do Postgres com status 0 em 100% das amostras. Causa: o Postgres PRD roda no contêiner `cervejaria-db` (rede `banco-de-dados_default`) publicado só no loopback do host; o collector, na rede do Elastic, tenta o gateway do Docker e é recusado. `version_conflict_engine_exception`: recorrente em 26/10, zero nos últimos 10 min em 01/11 (ligado ao MAP-01) |
| VPS-05 | Porta do poller | Porta 3098 livre | PASS | não aparece em escuta |
| VPS-06 | Disco e memória do VPS | Disco <80%, memória com folga; heap ES anotado | PASS | raiz em 10%; memória disponível cerca de 12,7 GiB; heap ES 512 MB |
| VPS-07 | Chave de criptografia Kibana | Contagem ≥1 em algum dos arquivos verificados | PASS | contagem 1 |
| PC-01 | Poller legado no PC | Nenhum poller de produção vivo no PC | PASS | nenhum processo `alert-poller`, nada em 3098, nenhuma tarefa agendada de alerta (só a do painel Ops) |

## Correções aplicadas

Em 2026-11-01, com autorização do Filipe: pipeline `quiver-tap-audit-enrich`, retenção com rollover (antes e depois do upgrade), réplicas zeradas nos índices antigos, recriação do collector nas redes do Elastic e do banco, cron de estado dos contêineres, objetos e regras do Kibana PRD, upgrade 8.17.0 → 8.19.23 → 9.5.5 com snapshots `pre-819` e `pre-9`.

## Pendências

- Todas as pendências da segunda rodada foram resolvidas na rodada final.
- Entrega no Telegram pelo alert-poller: espera o token do bot (TAP-139).
