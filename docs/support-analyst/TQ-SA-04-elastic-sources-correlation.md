# TQ-SA-04 — Elasticsearch Sources read-only e Correlation Engine

Data: 2026-08-31  
Status: concluído — offline e DEV smoke read-only validados em 2026-08-31.

## Sources e fronteira

`support-analyst/` usa `fetch` nativo do Node 24; nenhuma dependência Elasticsearch foi adicionada. O cliente é mínimo e só emite `POST <índice>/_search`. Ele autentica exclusivamente com `SUPPORT_ANALYST_ES_API_KEY` no endereço `SUPPORT_ANALYST_ES_URL`. Não há Basic Auth, fallback para `ELASTIC_USER`, `ELASTIC_PASSWORD`, Collector, Alert Poller ou `SUPPORT_AGENT_*`.

TQ-SA-04 é DEV-only. `SUPPORT_ANALYST_ENV=prd` sempre falha com `PRD access is not enabled for TQ-SA-04.`, mesmo que exista uma variável de gate futuro. Não há endpoint de escrita, cursor no Elasticsearch, polling, persistência, incidente, severidade, dossier ou Ollama.

As únicas fontes são:

- alertas: `quiver-tap-alert-events-dev`;
- audit: `logs-audit*.otel-dev*`;
- technical: `logs-technical*.otel-dev*`.

Metrics e `traces-*` não são consultados. `findByTraceId` consulta somente `trace_id.keyword` nos logs audit e technical autorizados.

## Templates fechados e limites

Os únicos templates públicos são `findAlertEvents`, `findByCorrelationId`, `findByRequestId`, `findByTraceId`, `findAuditAround`, `findTechnicalAround` e `findByReleaseAndService`. IDs são aceitos apenas em formato técnico limitado; os três lookups exatos usam, respectivamente, `attributes.correlationId.keyword`, `attributes.requestId.keyword` e `trace_id.keyword`. Release/service usa os dois campos `.keyword` e sempre recebe intervalo temporal.

Todo template exige intervalo. Alertas aceitam cursor local previsível (`search_after` de timestamp) e ordenam por `@timestamp`. O `_id` não é usado como sort porque o cluster DEV desabilita fielddata nesse campo; o cursor persistente ainda não faz parte deste ticket. Nunca observam ou alteram `processed`. Janelas contextuais são ±5 minutos por padrão e só aceitam expansão explícita até ±15 minutos.

| Limite | Valor |
|---|---:|
| Alertas | 50 |
| Lookup/fallback por fonte | 50 |
| Total antes da normalização | 100 |
| Timeout Elasticsearch | 5 s |
| Timeout HTTP/abort | 10 s |

Os `_source` são allowlists: alertas incluem somente timestamp, severidade, rule/state/reason/URL e ambiente; signals incluem somente os campos necessários ao `NormalizedEvent` V1. Não são solicitados body, header, authorization, cookie, ator nominal/e-mail, SQL, bindings, connection string, stack ou texto técnico livre. `alert.reason` continua passando pelo sanitizer existente.

401/403 produzem erro sanitizado sem fallback; 429 é identificado como transitório; timeout aborta a requisição; resposta inválida falha fechada. Nenhuma ausência ou falha de fonte é tratada como evidência de correlação.

## Pipeline e correlação

Hits Elasticsearch são imediatamente convertidos para `RawEventDocument` (`index`, `id`, `sourceType`, `source`); o hit completo nunca sai da Source. `normalizeBatch` reutiliza exclusivamente os normalizadores TQ-SA-03, mantém os eventos válidos e conta `received`, `normalized`, `rejected` e razões de rejeição sanitizadas.

`CorrelationEngine` é puro: recebe âncora e candidatos já normalizados, sem relógio, Elasticsearch ou estado. Ele elimina a própria âncora e candidatos duplicados por `eventId`, ordena de forma estável e devolve `relations` e `conflicts` explícitos. A orquestração pode também fornecer `sourceFailures` técnicos (por exemplo, timeout technical); ausência de dados nunca vira evidência.

| Level | Regra mínima |
|---|---|
| `DETERMINISTIC` | Mesmo `correlationId`, ou `requestId`, ou `traceId`, nessa prioridade. |
| `STRONG` | Até 5 min, mesmo service, release, tenant e route ou action. |
| `PROBABLE` | Até 15 min, mesmo service e release, mais route, action ou categoria DB. |
| `WEAK` | Apenas proximidade temporal de até 5 min; nunca significa causalidade. |

Reasons são estruturadas: `SAME_CORRELATION_ID`, `SAME_REQUEST_ID`, `SAME_TRACE_ID`, `SAME_RELEASE`, `SAME_SERVICE`, `SAME_TENANT`, `SAME_ROUTE`, `SAME_ACTION`, `SAME_DB_CATEGORY` e `WITHIN_TIME_WINDOW`. Se não houver chave igual e quaisquer IDs explícitos presentes forem diferentes, o engine não aplica heurística: retorna o registro técnico `conflicts` e nenhuma relação.

As fixtures sintéticas incluem os casos de IDs, contexto forte/parcial, janela simples, conflito, distância e duplicata em `support-analyst/test/fixtures/correlation-events.json`. Os testes offline também verificam endpoint/pattern, range, size, `_source`, campos `.keyword`, timeout, 401/403/429, resposta inválida, segredo ausente em erros, bloqueio PRD, normalização parcial, determinismo e imutabilidade.

## Smoke DEV manual

Após `npm run analyst:validate`, execute `npm run analyst:dev-smoke` com `SUPPORT_ANALYST_ENV=dev`, `SUPPORT_ANALYST_ES_URL` e a API key exclusiva `SUPPORT_ANALYST_ES_API_KEY`. Opcionalmente, `SUPPORT_ANALYST_TEST_CORRELATION_ID` aciona um lookup exato. O comando faz somente buscas pequenas, não imprime documentos, valores de IDs nem credenciais, não persiste dados e retorna contagens de alert/audit/technical/normalização. Zero resultados é válido; nesse caso correlação real entre fontes não fica comprovada.

Smoke executado com a identidade existente `quiver-support-analyst-shadow-dev`: validator `ok=true`, sem warnings/failures; authenticate, resolve, field caps, alert, audit, technical e runtime privileges passaram. Após aceitar o formato DEV `@timestamp` epoch-milliseconds com sufixo `.0`, o smoke reportou `alerts=3`, `audit=0`, `technical=3`, `received=6`, `normalized=6`, `rejected=0`; nenhum documento, segredo ou valor de ID foi impresso. A janela audit contextual não tinha eventos, portanto `real cross-source exact correlation = NOT PROVEN`; nenhum correlationId foi fabricado e nenhum lookup exato foi executado.

Não houve escrita Elasticsearch, alteração de índice/alerta, consulta ou alteração de PROD, alteração de banco ou deploy.

## Fica para TQ-SA-05

Esta entrega não cria `IncidentGrouper`, fingerprint/dedupe de incidente, lifecycle, severity/confidence de incidente, store, dossier ou Ollama. Também não autoriza PROD.
