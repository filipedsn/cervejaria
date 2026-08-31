# TQ-SA-02 — Elasticsearch read-only e contratos operacionais do Support Analyst

Data: 2026-08-31

Resultado: **DEV COMPLETE / PRD PENDING AUTHORIZATION** — identidade runtime DEV exclusiva criada e validada; PROD não foi consultada.

Escopo executado: repositório, Elasticsearch/Kibana locais e somente recursos DEV autorizados. Foram criados o índice/connector DEV e a API key DEV, e quatro regras DEV foram religadas ao novo destino. PROD não foi consultada, alterada ou reiniciada.

## 1. Ambiente validado

O Elasticsearch local em `http://localhost:9200` respondeu como versão `8.17.0`, com security habilitada e licença `basic` ativa. O collector local usa esse cluster e separa os dados OTel por `data_stream.namespace=dev|prd|infra`.

O onboarding administrativo criou somente `quiver-tap-alert-events-dev`, o connector `quiver-tap-alert-index-dev` e a API key `quiver-support-analyst-shadow-dev`; também atualizou apenas quatro regras com nome `*-dev` e tag `development`. Um único alerta sintético seguro foi emitido pelo connector DEV para provar o caminho legítimo. O validator usou exclusivamente a nova key e executou apenas authenticate, resolve, field caps, buscas limitadas e `_has_privileges`.

## 2. Autorização disponível

- DEV: autorizado para validação técnica read-only.
- PROD: **sem autorização explícita**; não foi consultada.
- Provisionamento de role/API key DEV: explicitamente autorizado por TQ-SA-02A e concluído.
- `SUPPORT_ANALYST_ES_API_KEY`: criada e armazenada somente no arquivo local ignorado `deploy/runtime/support-analyst-dev.env`, com herança de ACL removida e acesso limitado ao usuário atual e `SYSTEM`.

Consequência: pelos critérios da tarefa, `TQ-SA-02 DEV = PASS`. O onboarding PRD continua pendente de autorização explícita.

## 3. Configuração e credenciais existentes

| Configuração | Finalidade | Escopo/privilégio observado no código |
|---|---|---|
| `ELASTICSEARCH_URL` | Endpoint administrativo/collector local. | Configuração comum de onboarding; não usar no Analyst como fonte de credencial. |
| `ELASTIC_USER` + `ELASTIC_PASSWORD` | Administração local pelos scripts `obs:*`. | Privilegiada; proibida no runtime Analyst. |
| `ELASTIC_API_KEY_COLLECTOR` | Exportação OTel para `metrics-*`, `logs-*`, `traces-*`. | Escrita/auto-configure; proibida ao Analyst. |
| `ELASTIC_API_KEY_ALERT_POLLER` | Leitura e marcação de `quiver-tap-alert-events`. | Tem escrita; proibida ao Analyst. |
| `ELASTIC_API_KEY_SUPPORT_AGENT` / `SUPPORT_AGENT_ES_API_KEY` | Agent atual lê fontes amplas e marca alertas. | Contrato atual permite escrita no índice de alertas; não reutilizar. |
| `SUPPORT_ANALYST_ES_API_KEY` | Identidade exclusiva DEV. | Criada com somente `read` e `view_index_metadata`; sem fallback. |

Arquivos auditados: `docker-compose.observability.yml`, `deploy/observability/otel-collector-config.yml`, políticas `es-ilm-policy-*.json`, `scripts/observability/setup-ilm.ps1`, `setup-index-defaults.ps1`, `create-elastic-api-keys.ps1`, Support Agent e Alert Poller. Nenhum valor secreto foi incorporado a documento, script versionado, relatório ou commit.

## 4. Data streams, aliases e índices

| Source | Query pattern DEV recomendado | Data stream/índice observado | Dataset / environment | Retenção efetiva DEV | Analyst precisa? | Justificativa |
|---|---|---|---|---|---|---|
| Alert events | `quiver-tap-alert-events-dev` | Índice DEV dedicado, sem alias/data stream | `environment=dev` | Sem ILM | **SIM** | Fronteira física DEV; não depende de filtro documental. |
| Audit | `logs-audit*.otel-dev*` | 56 data streams por dataset/tenant; sem alias | `audit_<slug>.otel` / `dev` | Backings unmanaged | **SIM** | HTTP, negócio, auth, tenant, release e IDs. |
| Technical | `logs-technical*.otel-dev*` | `logs-technical.otel-dev`; sem alias | `technical.otel` / `dev` | Backing unmanaged | **SIM** | Pino, 5xx, DB e futuro realtime. |
| Metrics | `metrics-generic.otel-dev*` | `metrics-generic.otel-dev`; sem alias | `generic.otel` / `dev` | Inconsistente; ver seção 8 | **NÃO** | Alertas + audit/technical bastam ao MVP; volume muito maior. |

Os padrões lógicos resolvem diretamente para os data streams. **Backing indices não precisam entrar na role**; foram observados apenas para explicar geração, volume e ILM. Não há aliases adicionais para essas fontes.

TQ-SA-02A resolveu o isolamento com o índice simples `quiver-tap-alert-events-dev`. O índice compartilhado antigo não foi alterado nem concedido à key. Os produtores DEV atualizados foram `telemetry-gap-dev`, `eventloop-high-dev`, `postgres-tcp-down-dev` e `public-ready-down-dev`; nome `*-dev` e tag `development` são exigidos pelo script antes de qualquer update. PRD continua no connector antigo.

## 5. Backing indices e volume DEV

O onboarding observou:

| Fonte | Backings | Documentos aproximados | Espaço aproximado | Intervalo observado |
|---|---:|---:|---:|---|
| Audit | 56 | 28,1 mil | dezenas de MB | 2026-08-10 a 2026-08-31 |
| Technical | 1 | 12,3 mil | 12,9 MB | 2026-08-29 a 2026-08-31 |
| Metrics | 2 | 7,53 milhões | 770,5 MB | 2026-07-16 a 2026-08-15 |
| Alert events DEV dedicado | 1 índice | 1 alerta de validação | baixo volume | 2026-08-31 |

Foram usados `_cat/indices`, duas buscas de `size:1` ordenadas por timestamp e `track_total_hits:false` para logs. Não houve scroll, PIT, full scan de conteúdo ou agregação pesada. O volume confirma a decisão de excluir metrics da role inicial.

## 6. Mappings e field capabilities

### Campos comuns comprovados

| Campo | Audit | Technical | Lookup exato |
|---|---|---|---|
| `@timestamp` | `date` | `date` | Range no campo direto. |
| `attributes.correlationId` | `text` | `text` | `attributes.correlationId.keyword`. |
| `attributes.requestId` | `text` | `text` | `attributes.requestId.keyword`. |
| `attributes.releaseSha` | `text` | `text` | `attributes.releaseSha.keyword`. |
| `attributes.service` | `text` | `text` | `attributes.service.keyword`. |
| `attributes.environment` | `text` | `text` | `attributes.environment.keyword`. |
| `trace_id` / `span_id` | `text` | `text` | `trace_id.keyword` / `span_id.keyword`. |
| `resource.attributes.service.name` | `text` | `text` | `.keyword` disponível. |
| `data_stream.dataset/namespace` | `text` | `text` | `.keyword` disponível. |

Não usar term query no campo `text`; IDs, release, serviço, dataset, environment, ação e rota usam o subcampo `.keyword` quando confirmado acima.

### Audit/HTTP/auth

- evento: `attributes.event.action` e `attributes.event.outcome`, ambos `text` + `.keyword`;
- método: `attributes.http.request.method`, não `attributes.http.method`;
- rota: `attributes.http.route` + `.keyword`;
- status: `attributes.http.response.status_code` (`long`), não `attributes.http.statusCode`;
- tenant atual: `attributes.cervejaria.id`/`slug`, com `.keyword`; também existem formas legadas `attributes.cervejariaId`/`cervejariaSlug` em parte dos streams;
- ator: `attributes.actor.id`/`type`, com `.keyword`; `actor.name` e `actor.email` existem, mas ficam fora da allowlist;
- auth DEV: `attributes.event.action`, outcome, correlation/request/release/service/environment e tenant foram observados; `reasonCode` apareceu em `attributes.metadata.reasonCode`, não em `attributes.reasonCode`.

### Technical/DB/realtime

- tipo técnico: `attributes.event` (`text` + `.keyword`), não `attributes.event.action`;
- DB: `attributes.category` (`text` + `.keyword`) e `attributes.durationMs` (`long`) comprovados;
- foram encontrados cinco eventos DB DEV recentes, todos `db.connection.failed`, com categoria, duração, correlation e contexto de release/serviço;
- `attributes.reasonCode`, `attributes.userId` e `attributes.role` não estavam mapeados no data stream technical observado;
- nenhum evento `realtime.*` estava presente nos últimos 30 dias DEV. O contrato de realtime está definido no produtor, mas seu mapping operacional continua **não comprovado** até existir fixture/evento sanitizado.

### Alert events

No índice dedicado, `@timestamp` é `date`; `ruleName`, `alertState`, `viewInAppUrl` e `environment` são `keyword`; `reason` é `text`. Lookup exato usa o campo direto, sem `.keyword`. O mapping é `dynamic=strict` e aceita somente o contrato aprovado.

## 7. Aliases e padrão final de query

- Alias audit: nenhum; usar `logs-audit*.otel-{env}*`.
- Alias technical: nenhum; usar `logs-technical*.otel-{env}*`.
- Alias metrics: nenhum; fora do MVP.
- Alert events DEV: índice concreto `quiver-tap-alert-events-dev`.
- Backing `.ds-*`: não conceder diretamente.

O wildcard lógico é estável porque o dataset audit varia por tenant. Ele sempre deve ser acompanhado de range temporal e source filter.

## 8. Retenção

### A. Configuração versionada

| Família | Política versionada | Rollover | Delete |
|---|---|---|---|
| Audit | `quiver-otel-audit-90d` | 14 d ou 30 GB | 90 d |
| Technical/generic logs | `quiver-otel-logs-30d` | 7 d ou 30 GB | 30 d |
| Metrics generic | `quiver-otel-metrics-45d` | 7 d ou 30 GB | 45 d |
| Alert events | Nenhuma política versionada associada | — | — |

### B. Cluster DEV observado

- todos os 56 backings audit: `managed=false`;
- backing technical: `managed=false`;
- metrics: backing antigo gerenciado pela política built-in `metrics` (somente hot/rollover 30 d ou 50 GB, sem delete observado); backing atual `managed=false`;
- `quiver-tap-alert-events-dev`: sem ILM, por decisão explícita de não corrigir lifecycle neste ticket.

Portanto, os prazos 90/30/45 dias são intenção versionada, **não retenção efetiva do cluster DEV**. A diferença provável está na aplicação/prioridade dos templates: `quiver-otel-replicas-zero` foi observado com prioridade 250, enquanto os templates ILM propostos pelo script usam prioridade 110. Corrigir templates/ILM é trabalho administrativo de observabilidade separado; não ampliar privilégios runtime do Analyst para isso.

## 9. Role mínima efetiva DEV

O role descriptor `support_analyst_shadow_dev`, embutido na API key, foi aplicado assim:

```json
{
  "support_analyst_shadow_dev": {
    "cluster": [],
    "indices": [
      {
        "names": [
          "quiver-tap-alert-events-dev",
          "logs-audit*.otel-dev*",
          "logs-technical*.otel-dev*"
        ],
        "privileges": ["read", "view_index_metadata"]
      }
    ]
  }
}
```

Não foram concedidos índice compartilhado, PRD, metrics, traces, generic logs, `.kibana*`, infra ou backing `.ds-*`. A fronteira é o nome do índice/data stream, compatível com a licença Basic.

## 10. API key identity

Identidade criada: `quiver-support-analyst-shadow-dev`, com expiração de 90 dias. Uma futura key PRD deverá ser separada e só pode existir após autorização PRD.

Requisitos:

- somente `SUPPORT_ANALYST_ES_API_KEY` no runtime;
- endpoint por `SUPPORT_ANALYST_ES_URL`;
- sem `ELASTIC_PASSWORD`, basic auth, chave do collector/poller/Agent ou credencial Kibana;
- segredo em storage local não versionado/ACL restrita ou secret store do sistema;
- rotação por sobreposição curta e revogação da chave anterior;
- nunca imprimir a key.

O segredo nunca foi impresso, versionado ou incluído em relatório. O arquivo local de runtime está coberto por `deploy/runtime/*` no `.gitignore`, com ACL protegida e duas regras de acesso.

## 11. Permissões concedidas e explicitamente ausentes

Comprovado pela própria API key via `_has_privileges`:

- cluster: `[]`;
- índices allowlisted: `read`, `view_index_metadata`;
- ausentes nos índices: `auto_configure`, `write`, `index`, `create`, `create_doc`, `create_index`, `delete`, `delete_index`, `manage`, `manage_data_stream_lifecycle`, `all`;
- ausentes no cluster: `monitor`, `manage`, `manage_security`, `manage_api_key`, `manage_own_api_key`, `manage_ilm`, `manage_index_templates`, `all`;
- fora da allowlist: traces, `.kibana*`, `logs-generic*`, metrics e quaisquer outras aplicações.

O teste de isolamento confirmou `read=false` e `view_index_metadata=false` para `quiver-tap-alert-events`, audit/technical PRD, traces, generic logs, metrics e `.kibana*`. Nenhuma operação de escrita/delete real foi tentada.

## 12. Testes positivos

| Teste | Descoberta administrativa DEV | Com API key Analyst | Resultado do ticket |
|---|---|---|---|
| A — alert events | Índice DEV + alerta via connector. | 1 hit recente. | `PASS` |
| B — audit | 56 streams resolvem. | 3 hits limitados. | `PASS` |
| C — technical | 1 stream resolve. | 3 hits limitados. | `PASS` |
| D — mapping/field caps | Contrato verificado. | Executado pela key. | `PASS` |
| E — metrics | Stream observado para decisão de escopo. | Não aplicável. | `NÃO NECESSÁRIO` |

Authenticate e resolve index também passaram com authentication type `api_key` e o nome esperado.

## 13. Testes negativos e isolamento

Nenhuma operação destrutiva foi executada. Não houve tentativa de index, update, create ou delete com a key. Os testes negativos foram executados por inspeção de privilégios e passaram.

O script `scripts/support-analyst/validate-elastic-readonly.mjs` consulta `_security/user/_has_privileges` autenticado pela própria key e exige:

- cluster privileges todos falsos;
- somente `read`/`view_index_metadata` verdadeiros nos três padrões;
- todos os privilégios de escrita/manage falsos;
- `read`/metadata falsos para traces, generic logs, metrics e `.kibana*`.

Se privilege inspection não estiver disponível para a key/versão, o script falha fechado; o administrador deverá fornecer evidência equivalente sem executar escrita.

## 14. Source filtering e privacidade

Allowlist inicial:

- tempo/roteamento: `@timestamp`, `severity_text`, `data_stream.dataset/namespace`, `resource.attributes.service.name`;
- correlação/release: correlation, request, release, service, environment, trace/span;
- evento: event/action/outcome, HTTP method/route/status, duration/category;
- tenant/ator minimizado: IDs/slug/type necessários; não nome/e-mail;
- DB/realtime/auth: `attributes.event`, category, duration, `attributes.reasonCode` e `attributes.metadata.reasonCode` quando existirem.

Campos livres condicionais:

- alerta `reason`: máximo 1.000 caracteres após sanitizer;
- mensagem técnica livre: fora do validator; qualquer inclusão futura exige justificativa e sanitizer;
- stack: fora da consulta inicial; buscar separadamente somente para incidente técnico confirmado, truncar e sanitizar.

Excluídos: authorization, cookie, JWT/token, senha, API key, connection string, SQL/bindings, body HTTP, payload completo, e-mail, telefone, nome completo, dados financeiros individuais e `_source` completo.

## 15. Query templates conceituais

O LLM não gera DSL. As futuras Sources usam funções fechadas:

- `findAlertEvents(cursor, until, limit<=50)`: `quiver-tap-alert-events-dev`, range obrigatório, `environment=dev`, source allowlist e sort asc;
- `findByCorrelationId(id, from, to, limit<=50)`: term em `attributes.correlationId.keyword`, msearch nos padrões audit/technical;
- `findByRequestId(...)`: term em `attributes.requestId.keyword`;
- `findByTraceId(...)`: term em `trace_id.keyword`, sem conceder `traces-*`;
- `findAuditAround(from,to,filters,limit<=50)`: audit fixo, range e filtros tipados;
- `findTechnicalAround(...)`: technical fixo, range e filtros tipados;
- `findByReleaseAndService(...)`: terms em `releaseSha.keyword` e `service.keyword`, sempre com janela.

Todo template possui pattern allowlisted, range, size, `_source`, timeout, sort previsível e nenhuma opção de escrita.

## 16. Limites runtime

- poll de alertas: até 50;
- onboarding validator: até 3 hits por busca;
- Sources futuras: até 50 hits por fonte e no máximo 100 antes de agregação;
- lookup exato antes de fallback;
- janela inicial ±5 min, uma expansão até ±15 min;
- timeout Elasticsearch 5 s e timeout HTTP 10 s (máximo configurável 15 s);
- sem scroll, PIT longo, full scan, wildcard sem range ou histórico ilimitado;
- retry limitado fora do validator, somente para falha transitória/429.

## 17. Fail-safe

- 401/403: parar o ciclo, preservar cursor, erro local, sem credencial alternativa;
- 429: backoff limitado com jitter;
- timeout/Elastic offline: abortar query/ciclo e manter TAP Quiver intacto;
- mapping ausente: marcar contrato incompleto; não fabricar campo/fato;
- key inválida: validator retorna exit code diferente de zero;
- nenhuma queda para `ELASTIC_PASSWORD`, basic auth ou key de outro componente.

## 18. Scripts de onboarding e validação

Criado `scripts/support-analyst/onboard-elastic-dev.ps1`, disponível por `npm run analyst:onboard-elastic-dev`, para provisionamento DEV idempotente. O alerta sintético só é emitido quando o script é chamado diretamente com `-EmitValidationAlert`.

O validator `scripts/support-analyst/validate-elastic-readonly.mjs` continua disponível por:

```powershell
npm run analyst:validate-elastic
```

O script atualizado:

- exige `SUPPORT_ANALYST_ES_API_KEY`;
- bloqueia PRD até `SUPPORT_ANALYST_ALLOW_PRD=true` após autorização;
- usa `quiver-tap-alert-events-dev` em DEV, removeu `body.text` e valida alert field caps;
- valida resolve index, três buscas limitadas e privilégios;
- exclui metrics;
- não imprime documentos nem secret;
- não possui endpoint de escrita;
- retorna 1 se contrato falhar e 2 para configuração inválida.

O onboarding foi executado com `scripts/support-analyst/onboard-elastic-dev.ps1 -EmitValidationAlert`; o resultado sanitizado local registrou `ok=true`, sem warnings/failures.

## 19. Pendências para DEV e PRD

DEV:

1. Rotacionar a key antes da expiração de 90 dias.
2. Tratar o gap de ILM audit/technical no backlog `TQ-OBS-MAINT-01`.
3. Gerar fixture realtime sanitizada para comprovar mapping de `reasonCode`/ator/role; isso não bloqueia R-01.

PRD:

1. Obter autorização explícita de consulta/provisionamento.
2. Repetir resolve, field caps, retenção e volume somente nos padrões PRD.
3. Criar key PRD separada, sem padrões DEV/infra/metrics.
4. Executar positivos/negativos/isolamento com a própria key.

## 20. Conclusão

O contrato mínimo DEV ficou isolado e comprovado: alert events dedicado + audit + technical, sem metrics e sem backing indices. Os campos centrais de correlation/request/release e DB estão disponíveis; realtime ainda carece de evidência operacional. A retenção efetiva DEV continua como backlog e não amplia a key runtime.

**R-01 DEV = PASS. TQ-SA-02 = DEV COMPLETE / PRD PENDING.** PRD permanece `PENDING AUTHORIZATION` e não foi consultada.
