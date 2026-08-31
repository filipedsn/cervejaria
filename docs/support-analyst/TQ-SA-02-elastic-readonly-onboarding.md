# TQ-SA-02 — Elasticsearch read-only e contratos operacionais do Support Analyst

Data: 2026-08-31  
Resultado: **PARCIAL** — discovery e contrato DEV concluídos; identidade runtime e testes de permissão pendentes de autorização explícita de provisionamento.  
Escopo executado: repositório e Elasticsearch local, somente fontes DEV e metadata necessária. PROD não foi consultada, alterada ou reiniciada.

## 1. Ambiente validado

O Elasticsearch local em `http://localhost:9200` respondeu como versão `8.17.0`, com security habilitada e licença `basic` ativa. O collector local usa esse cluster e separa os dados OTel por `data_stream.namespace=dev|prd|infra`.

Foram executadas apenas operações GET e buscas POST read-only, pequenas e com `_source:false` ou source filtering. A credencial administrativa já existente foi usada exclusivamente pelo processo de onboarding para metadata DEV; ela não é proposta nem usada como credencial runtime do Analyst. Nenhum documento, índice, template, ILM, role ou API key foi criado/alterado.

## 2. Autorização disponível

- DEV: autorizado para validação técnica read-only.
- PROD: **sem autorização explícita**; não foi consultada.
- Provisionamento de role/API key: a tarefa condiciona a criação a autorização explícita de onboarding. Não foi encontrada autorização específica para mutar o security state do cluster compartilhado, portanto a identidade não foi criada.
- `SUPPORT_ANALYST_ES_API_KEY`: não existia no processo nem no mecanismo local de configuração auditado.

Consequência: mappings, resolução, retenção e volume DEV foram comprovados; testes positivos e negativos com a futura identidade exclusiva permanecem `NÃO EXECUTADO`. Pelos critérios da tarefa, `TQ-SA-02 DEV` ainda não pode ser declarado PASS.

## 3. Configuração e credenciais existentes

| Configuração | Finalidade | Escopo/privilégio observado no código |
|---|---|---|
| `ELASTICSEARCH_URL` | Endpoint administrativo/collector local. | Configuração comum de onboarding; não usar no Analyst como fonte de credencial. |
| `ELASTIC_USER` + `ELASTIC_PASSWORD` | Administração local pelos scripts `obs:*`. | Privilegiada; proibida no runtime Analyst. |
| `ELASTIC_API_KEY_COLLECTOR` | Exportação OTel para `metrics-*`, `logs-*`, `traces-*`. | Escrita/auto-configure; proibida ao Analyst. |
| `ELASTIC_API_KEY_ALERT_POLLER` | Leitura e marcação de `quiver-tap-alert-events`. | Tem escrita; proibida ao Analyst. |
| `ELASTIC_API_KEY_SUPPORT_AGENT` / `SUPPORT_AGENT_ES_API_KEY` | Agent atual lê fontes amplas e marca alertas. | Contrato atual permite escrita no índice de alertas; não reutilizar. |
| `SUPPORT_ANALYST_ES_API_KEY` | Futura identidade exclusiva. | Ausente; deve ter somente `read` e `view_index_metadata`. |

Arquivos auditados: `docker-compose.observability.yml`, `deploy/observability/otel-collector-config.yml`, políticas `es-ilm-policy-*.json`, `scripts/observability/setup-ilm.ps1`, `setup-index-defaults.ps1`, `create-elastic-api-keys.ps1`, Support Agent e Alert Poller. Nenhum valor secreto foi incorporado a documento, script versionado, relatório ou commit.

## 4. Data streams, aliases e índices

| Source | Query pattern DEV recomendado | Data stream/índice observado | Dataset / environment | Retenção efetiva DEV | Analyst precisa? | Justificativa |
|---|---|---|---|---|---|---|
| Alert events | `quiver-tap-alert-events` | Índice comum, sem alias/data stream | Sem campo `environment` comprovado; regras DEV usam sufixo `-dev` | Sem ILM | **SIM**, com ressalva | Gatilho do pipeline, mas mistura regras DEV/PRD no mesmo índice. |
| Audit | `logs-audit*.otel-dev*` | 56 data streams por dataset/tenant; sem alias | `audit_<slug>.otel` / `dev` | Backings unmanaged | **SIM** | HTTP, negócio, auth, tenant, release e IDs. |
| Technical | `logs-technical*.otel-dev*` | `logs-technical.otel-dev`; sem alias | `technical.otel` / `dev` | Backing unmanaged | **SIM** | Pino, 5xx, DB e futuro realtime. |
| Metrics | `metrics-generic.otel-dev*` | `metrics-generic.otel-dev`; sem alias | `generic.otel` / `dev` | Inconsistente; ver seção 8 | **NÃO** | Alertas + audit/technical bastam ao MVP; volume muito maior. |

Os padrões lógicos resolvem diretamente para os data streams. **Backing indices não precisam entrar na role**; foram observados apenas para explicar geração, volume e ILM. Não há aliases adicionais para essas fontes.

O índice de alertas é um ponto de isolamento pendente: possui documentos DEV e possivelmente PRD, mas não tem `environment` no mapping observado. O filtro por `ruleName.keyword=*-dev` limita a query, porém source filtering/query filtering não é fronteira de autorização. Antes de uma identidade DEV completa, escolher uma destas soluções em ticket autorizado: adicionar ambiente ao contrato/índice de alertas, separar o índice por ambiente ou aprovar conscientemente o acesso ao índice compartilhado. Não alterar isso neste ticket.

## 5. Backing indices e volume DEV

O onboarding observou:

| Fonte | Backings | Documentos aproximados | Espaço aproximado | Intervalo observado |
|---|---:|---:|---:|---|
| Audit | 56 | 28,1 mil | dezenas de MB | 2026-08-10 a 2026-08-31 |
| Technical | 1 | 12,3 mil | 12,9 MB | 2026-08-29 a 2026-08-31 |
| Metrics | 2 | 7,53 milhões | 770,5 MB | 2026-07-16 a 2026-08-15 |
| Alert events | 1 índice | 7 no total; 2 regras DEV | 45,6 KB | regras DEV entre 2026-08-10 e 2026-08-11 |

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

`@timestamp` é `date`; `ruleName`, `alertState`, `reason` e `viewInAppUrl` são `text` com `.keyword`. Não foi observado campo environment, dataset ou namespace nesse índice.

## 7. Aliases e padrão final de query

- Alias audit: nenhum; usar `logs-audit*.otel-{env}*`.
- Alias technical: nenhum; usar `logs-technical*.otel-{env}*`.
- Alias metrics: nenhum; fora do MVP.
- Alert events: índice concreto `quiver-tap-alert-events`.
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
- `quiver-tap-alert-events`: nenhuma lifecycle setting/ILM observada.

Portanto, os prazos 90/30/45 dias são intenção versionada, **não retenção efetiva do cluster DEV**. A diferença provável está na aplicação/prioridade dos templates: `quiver-otel-replicas-zero` foi observado com prioridade 250, enquanto os templates ILM propostos pelo script usam prioridade 110. Corrigir templates/ILM é trabalho administrativo de observabilidade separado; não ampliar privilégios runtime do Analyst para isso.

## 9. Role mínima final proposta

Metrics e backing indices foram removidos. A role runtime por ambiente fica:

```json
{
  "support_analyst_shadow": {
    "cluster": [],
    "indices": [
      {
        "names": [
          "quiver-tap-alert-events",
          "logs-audit*.otel-<env>*",
          "logs-technical*.otel-<env>*"
        ],
        "privileges": ["read", "view_index_metadata"]
      }
    ]
  }
}
```

`<env>` deve ser materializado como `dev` ou `prd`; não conceder ambos à mesma key. Para DEV, o índice compartilhado de alertas precisa da decisão de isolamento da seção 4 antes da aplicação. A licença `basic` foi observada; não assumir que field/document-level security estará disponível. Source filtering é obrigatório, mas não substitui uma separação de autorização do índice compartilhado.

## 10. API key identity

Nome proposto: `quiver-support-analyst-shadow-dev` para validação DEV e, futuramente, uma key separada `quiver-support-analyst-shadow-prd` após autorização PRD.

Requisitos:

- somente `SUPPORT_ANALYST_ES_API_KEY` no runtime;
- endpoint por `SUPPORT_ANALYST_ES_URL`;
- sem `ELASTIC_PASSWORD`, basic auth, chave do collector/poller/Agent ou credencial Kibana;
- segredo em storage local não versionado/ACL restrita ou secret store do sistema;
- rotação por sobreposição curta e revogação da chave anterior;
- nunca imprimir a key.

Nenhuma role/key foi aplicada neste ticket porque não havia autorização explícita de provisionamento. A definição acima está pronta para revisão administrativa.

## 11. Permissões concedidas e explicitamente ausentes

Na definição proposta:

- cluster: `[]`;
- índices allowlisted: `read`, `view_index_metadata`;
- ausentes nos índices: `auto_configure`, `write`, `index`, `create`, `create_doc`, `create_index`, `delete`, `delete_index`, `manage`, `manage_data_stream_lifecycle`, `all`;
- ausentes no cluster: `monitor`, `manage`, `manage_security`, `manage_api_key`, `manage_own_api_key`, `manage_ilm`, `manage_index_templates`, `all`;
- fora da allowlist: traces, `.kibana*`, `logs-generic*`, metrics e quaisquer outras aplicações.

Como a key não foi criada, essa ausência ainda não foi comprovada contra uma identidade aplicada. O validador criado usa `_has_privileges` da própria identidade e falha se qualquer capacidade proibida aparecer, sem tentar escrita/delete reais.

## 12. Testes positivos

| Teste | Descoberta administrativa DEV | Com API key Analyst | Resultado do ticket |
|---|---|---|---|
| A — alert events | Índice resolve; 2 alertas DEV identificados por metadata. | Não executado. | `NÃO EXECUTADO` |
| B — audit | 56 streams resolvem; field caps e eventos recentes confirmados. | Não executado. | `NÃO EXECUTADO` |
| C — technical | Stream resolve; field caps/DB recentes confirmados. | Não executado. | `NÃO EXECUTADO` |
| D — mapping/field caps | PASS com onboarding administrativo read-only. | Não executado. | `PASS` para contrato; pendente para runtime key. |
| E — metrics | Stream observado para decisão de escopo. | Não aplicável. | `NÃO NECESSÁRIO` |

Não declarar acesso runtime PASS até esses testes rodarem com `SUPPORT_ANALYST_ES_API_KEY` exclusiva.

## 13. Testes negativos e isolamento

Nenhuma operação destrutiva foi executada. Não houve tentativa de index, update, create ou delete. Como a identidade não existe, os testes negativos não foram executados contra o cluster.

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
- `body.text`/mensagem técnica: máximo 2.000 caracteres após sanitizer;
- stack: fora da consulta inicial; buscar separadamente somente para incidente técnico confirmado, truncar e sanitizar.

Excluídos: authorization, cookie, JWT/token, senha, API key, connection string, SQL/bindings, body HTTP, payload completo, e-mail, telefone, nome completo, dados financeiros individuais e `_source` completo.

## 15. Query templates conceituais

O LLM não gera DSL. As futuras Sources usam funções fechadas:

- `findAlertEvents(cursor, until, limit<=50)`: índice fixo, range obrigatório, filtro de ambiente, source allowlist e sort asc;
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

## 18. Script de onboarding

Criado `scripts/support-analyst/validate-elastic-readonly.mjs`, disponível por:

```powershell
npm run analyst:validate-elastic
```

O script:

- exige `SUPPORT_ANALYST_ES_API_KEY`;
- bloqueia PRD até `SUPPORT_ANALYST_ALLOW_PRD=true` após autorização;
- valida resolve index, field caps, três buscas limitadas e privilégios;
- exclui metrics;
- não imprime documentos nem secret;
- não possui endpoint de escrita;
- retorna 1 se contrato falhar e 2 para configuração inválida.

Nesta tarefa foram validados syntax/help e o fail-closed sem key. A validação real aguarda provisionamento autorizado.

## 19. Pendências para DEV e PRD

DEV:

1. Autorizar provisionamento da key exclusiva.
2. Resolver isolamento do índice compartilhado de alertas.
3. Aplicar role descriptor e armazenar secret fora do Git.
4. Rodar o validator e anexar resultado sanitizado.
5. Tratar o gap de ILM audit/technical em ticket de observabilidade separado.
6. Gerar fixture realtime sanitizada para comprovar mapping de `reasonCode`/ator/role.

PRD:

1. Obter autorização explícita de consulta/provisionamento.
2. Repetir resolve, field caps, retenção e volume somente nos padrões PRD.
3. Criar key PRD separada, sem padrões DEV/infra/metrics.
4. Executar positivos/negativos/isolamento com a própria key.

## 20. Conclusão

O contrato mínimo ficou menor e mais preciso: alert events + audit + technical, sem metrics e sem backing indices. Os campos centrais de correlation/request/release e DB estão disponíveis com lookups exatos `.keyword`; realtime ainda carece de evidência operacional. A retenção efetiva DEV é uma lacuna real: audit e technical estão unmanaged.

R-01 está **desenhado e comprovado quanto a fontes/mappings em DEV**, mas **não encerrado operacionalmente** porque nenhuma identidade exclusiva foi autorizada/aplicada e os testes de privilégios não puderam rodar. PRD permanece `PENDING AUTHORIZATION`.
