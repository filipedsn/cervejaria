# TQ-SA-01 — Discovery e arquitetura do Support Analyst local

Data: 2026-08-31  
Escopo: descoberta, auditoria e desenho. Nenhum código funcional, credencial, índice, regra Kibana, banco, serviço, deploy ou ambiente PROD foi alterado ou consultado nesta tarefa.

Nota de status: o Support Agent descrito historicamente neste documento foi decomissionado em `TQ-SA-LEGACY-02`; o Support Analyst continua sendo um processo novo e independente.

## 1. Resumo executivo

O TAP Quiver possui sinais suficientes para iniciar um **Support Analyst local em modo shadow e não-remediador**. O caminho HTTP já carrega `correlationId`, `requestId`, tenant, contexto de release e, quando aplicável, sinais técnicos, DB, autenticação e realtime. A decisão é **C — processo separado reutilizando apenas componentes e contratos seguros do Support Agent atual**.

O processo separado é a menor forma de garantir a fronteira: o Support Agent atual foi concebido para criar Issue, marcar documentos no Elasticsearch e, fora do modo sombra, acionar um fixer/worktree/PR. O Analyst não pode herdar essas capacidades, nem por configuração acidental. Ele será um processo local out-of-band, com identidade Elastic própria e somente leitura, armazenamento local próprio e nenhuma dependência de GitHub, Telegram, shell, worktree, banco de produção ou painel de deploy.

O MVP recebe alertas, busca audit e technical logs relacionados, normaliza, correlaciona deterministicamente, agrupa incidentes, determina classe/severidade/confiança por regras, monta contexto limitado e produz dossiê local. O LLM é opcional para o texto analítico; nunca é autoridade para busca, correlação, classificação, severidade ou ação externa.

As duas prioridades abertas da reauditoria são tratadas no desenho:

- **R-01:** identidade Elastic exclusiva, privilégios mínimos `read` e `view_index_metadata`, índices explicitamente permitidos e nenhum privilégio de cluster ou escrita;
- **R-02:** novo contrato interno `NormalizedEvent`, capaz de representar correlation/request/release, DB e realtime, que o parser atual não extrai.

## 2. Support Agent atual

O código existente está em `support-agent/`, escrito em TypeScript e iniciado por `npm run agent:*` e pelos scripts `scripts/support-agent/start.ps1`, `status.ps1` e `stop.ps1`. Seus entrypoints principais são:

| Componente | Evidência | Comportamento atual | Reuso pelo Analyst |
|---|---|---|---|
| Watcher | `src/watcher.ts` | Faz poll de `quiver-tap-alert-events`, até 50 alertas por ciclo, ignorando recuperação. | Contrato do alerta e paginação limitada. |
| Cliente Elastic | `src/es.ts` | Faz `_search`, verifica `/_cluster/health` e também faz `_update` para marcar alerta. | Padrão de timeout/erro somente; não reutilizar a função de update nem health de cluster. |
| Enriquecimento | `src/enrich.ts` | Pesquisa janela de -10/+2 min em `logs-audit*.otel-prd`, até 500 documentos; parser tolera campos OTLP achatados/aninhados. | Estratégia de parsing defensivo e limites; ampliar contrato e fontes. |
| Triagem/fingerprint | `src/triage.ts` | Classifica regras como código/infra/desconhecida e usa regra + ação + stack/rota. | Ideias de normalização de rota/fingerprint; sem a semântica de “bug de código”. |
| Estado | `src/state.ts` | JSON local com cursor, IDs, fingerprints e contadores; first lookback de 1 h. | Modelo de estado local simples, com esquema e escrita atômica novos. |
| Dossiê/Issue | `src/github.ts` | Gera Markdown e usa `gh` para labels, busca e criação/comentário de Issues. | Formato Markdown como referência; não importar cliente GitHub. |
| Fixer | `src/fixer.ts`, `worktree.ts`, `policy.ts`, circuit breaker e kill switch | Pode criar worktree, chamar Cursor CLI, validar, commitar e abrir PR quando habilitado. | **Não reutilizar nem carregar.** |
| Métricas | `src/metrics.ts` | OTLP opcional para métricas do Agent. | Nomes/ideia de buffer; destino do Analyst não deve ser analisado pelo próprio Analyst. |
| Ops Panel | `ops-panel/src/support-agent.mjs` e rota `/api/support-agent` | Exibe e altera configuração do Agent, inclusive fixer/kill switch. | Apenas referência futura de visualização read-only; sem controle do Analyst no MVP. |

O Agent usa `SUPPORT_AGENT_SHADOW=true` por padrão, mas esse modo ainda pode criar Issues no GitHub; `dryRun` é que suprime escrita. Ele também usa `markTriaged`, que faz `POST /_update` em `quiver-tap-alert-events`. Portanto, “shadow” do Agent atual não equivale ao shadow estrito exigido para o Analyst.

O Alert Poller separado do backend (`backend/src/lib/kibana-alert-poller.ts`) consome a mesma fila a cada 30 s por padrão e também realiza marcação best-effort em Elasticsearch. Ele permanece independente: o Analyst nunca deve disputar, alterar ou depender do flag `processed` dele.

## 3. Componentes reaproveitáveis

O reuso será de conhecimento e, após extração testada em ticket futuro, apenas de funções puras:

- formato e semântica de `quiver-tap-alert-events` (`ruleName`, estado, razão, URL e timestamp);
- parser tolerante a atributos OTLP achatados/aninhados e normalização de timestamp;
- normalização de rota e princípios do fingerprint existente;
- persistência local auditável em JSON como ponto de partida;
- padrão de poll com cursor, limite de lote e deduplicação local;
- convenções de dashboards/OTLP para métricas do próprio processo;
- links de Kibana com janela e IDs já usados no dossiê atual.

O reuso não deve criar dependência de módulos com side effects. O novo processo não importa `github.ts`, `fixer.ts`, `worktree.ts`, `shell.ts`, `policy.ts`, `killswitch.ts`, `markTriaged` ou qualquer configuração que aceite basic auth privilegiado.

## 4. Dúvidas e limitações do Agent atual

1. O índice padrão é somente `logs-audit*.otel-prd`; não inclui `logs-technical*.otel-prd`, onde estão Pino, Prisma e realtime.
2. `parseLogEvent` não extrai `correlationId`, `requestId`, `releaseSha`, categoria/duração DB, ação realtime, role, actor ID ou reason code.
3. O enriquecimento começa por uma janela temporal ampla; não pesquisa primeiro pelos identificadores de correlação disponíveis.
4. A consulta de histórico lê até 500 registros de sete dias e filtra em memória apenas por ação/rota; isso pode ser caro e impreciso para o Analyst.
5. O fingerprint combina regra, ação e stack/rota, mas não considera serviço, categoria DB, release ou uma regra explícita de tenant.
6. A classificação atual responde se um alerta pode gerar correção de código, não uma taxonomia operacional de incidentes.
7. O estado local não guarda dossiês, feedback, métricas de qualidade nem relacionamento evento–incidente; só fingerprints/Issues/circuit breaker.
8. A API key hoje proposta para o Agent tem `cluster: monitor`, escrita no índice de alertas e acesso amplo a `logs-*`, `traces-*` e `metrics-*`. Isso não atende ao least privilege do Analyst.
9. Não existe integração Ollama, configuração de modelo, prompt local ou fallback LLM no repositório. Nenhum modelo Gemma pode ser considerado instalado/disponível com esta auditoria estática.

## 5. Fontes de dados

Nenhuma consulta a PROD foi executada. A tabela abaixo combina os contratos versionados e as provas DEV de `TQ-OBS-02E`, `02F` e `02G`; aliases, backing indices, volumes reais, cardinalidade e retenção efetiva de PRD ainda precisam de validação operacional R-01 antes de o Analyst ser confiado a esse ambiente.

| Fonte | Finalidade e campos úteis | Retenção/configuração versionada | Situação DEV e limite |
|---|---|---|---|
| `quiver-tap-alert-events-dev` em DEV; destino PRD pendente de onboarding | Gatilho: `ruleName`, `alertState`, `reason`, `viewInAppUrl`, `environment`, `@timestamp`. | Sem ILM em DEV; backlog TQ-OBS-MAINT-01. | TQ-SA-02A isolou DEV em índice próprio; não usar como estado mutável do Analyst. |
| `logs-audit*.otel-prd*` | HTTP e negócio: `event.action/outcome/category`, `http.*`, `cervejaria.*`, ator, `requestId`, `correlationId`, trace/span, `releaseSha`, `service`, `environment`. | Política audit: rollover 14 d ou 30 GB; delete aos 90 d. | Equivalente DEV `logs-audit*.otel-dev*` comprovado com `attributes.*.keyword`. Dataset varia por tenant (`audit_<slug>`). |
| `logs-technical*.otel-prd*` | Pino/5xx, DB e realtime: severidade, `event`, `category`, `durationMs`, erro sanitizado, `requestId`, `correlationId`, tenant/ator/role, release. | Política logs: rollover 7 d; delete aos 30 d. | Equivalente DEV comprovado; campos Pino chegam como `attributes.*`; `attributes.correlationId.keyword` é confirmado. |
| `metrics-generic.otel-prd*` | Métricas de aplicação e do Agent: disponibilidade/negócio, event loop e métricas `quiver.*` quando existentes. | Política metrics versionada: rollover 7 d; delete aos 45 d. | Equivalente `metrics-generic.otel-dev*`; TQ-SA-02 removeu metrics da role inicial por não ser necessária ao MVP e ter volume muito superior. |
| `metrics-httpcheckreceiver.otel-infra*` | Saúde permitida de HTTP/TCP/host; útil só como confirmação de alertas de disponibilidade. | Validar a política/alias específico. | Namespace é `infra`, não `prd`; não é requisito inicial se o alerta trouxer a evidência. |

Os campos devem ser lidos com source filtering e com fallback entre a raiz e `attributes.*`, pois o mapeamento OTel expõe os payloads do produtor como atributos. Chaves de alta cardinalidade (`requestId`, `correlationId`, `traceId`, `spanId`, IDs de ator/tenant) servem para busca e ligação, não para agregações ou fingerprint padrão. E-mail, nome, telefone, payload, token, cookie, header authorization, conexão SQL, SQL e bindings não fazem parte do contrato do Analyst/LLM.

## 6. Permissões (R-01)

### Identidade e papel propostos

Criar futuramente uma API key própria, por exemplo `quiver-support-analyst-shadow`, sem fallback para usuário `elastic`. O papel terá **nenhum privilégio de cluster** e somente `read` + `view_index_metadata` sobre os padrões aprovados:

```json
{
  "support_analyst_shadow": {
    "cluster": [],
    "indices": [
      {
        "names": [
          "quiver-tap-alert-events-<env>",
          "logs-audit*.otel-<env>*",
          "logs-technical*.otel-<env>*"
        ],
        "privileges": ["read", "view_index_metadata"]
      }
    ]
  }
}
```

TQ-SA-02 confirmou em DEV que os padrões lógicos resolvem diretamente para data streams; backing indices não precisam entrar na role. Metrics e `metrics-httpcheckreceiver.otel-infra*` ficam fora até uma necessidade comprovada. Não conceder `monitor`, `manage`, `manage_ilm`, `manage_index_templates`, `write`, `create`, `index`, `delete`, `delete_index`, `all`, permissões de usuário/API key ou acesso a `traces-*`.

Nota operacional de TQ-SA-02A: DEV usa `quiver-tap-alert-events-dev`, com key exclusiva e `read`/`view_index_metadata` comprovados; o índice compartilhado antigo é negado. Audit e technical DEV continuam `managed=false`; retenção é backlog TQ-OBS-MAINT-01. O padrão `<env>` permanece conceitual para PRD até onboarding autorizado.

O processo só pode usar `/_search`, `/_msearch`, `/_field_caps`/`_mapping` e `/_resolve/index` compatíveis com essas permissões. Não chama `/_cluster/health`: health vem de alertas autorizados e de consultas de métrica limitadas. Antes de provisionar, aplicar field/document-level security, se suportado pelo licenciamento, para negar explicitamente campos livres e PII; source filtering no cliente é obrigatório, mas não substitui controle de acesso.

### Configuração e operação

- A credencial fica em arquivo local não versionado com ACL apenas da conta do processo, ou secret store do sistema; somente a variável `SUPPORT_ANALYST_ES_API_KEY` é injetada no processo.
- Não ler `.env.observability` nem aceitar `ELASTIC_PASSWORD`/basic auth como fallback.
- Rotação: chave com owner, data de expiração e runbook; sobreposição curta de duas chaves, reinício controlado do processo local e revogação da antiga após health local.
- Credencial inválida/403/401: registrar `analyst.elasticsearch.failed` somente localmente/num destino excluído; pausar o ciclo com backoff limitado, preservar cursor, gerar nenhum dossiê incompleto e nunca retentar sem limite.
- Onboarding R-01 deve verificar aliases/data streams, mapping, retenção e três consultas de leitura antes do piloto. Não criar chave, nem executar essa verificação em PROD neste ticket.

## 7. Contrato `NormalizedEvent` (R-02)

O contrato é interno, versionado e limitado a evidência útil. Valores ausentes ficam ausentes; o normalizador não inventa dados nem promove `unknown` a evidência.

```ts
type NormalizedEvent = {
  schemaVersion: 1;
  eventId: string; timestamp: string;
  source: 'alert' | 'audit' | 'technical' | 'metric'; dataset?: string;
  environment?: 'dev' | 'prd' | 'infra'; service?: string; releaseSha?: string;
  correlationId?: string; requestId?: string; traceId?: string; spanId?: string;
  tenantId?: string; tenantSlug?: string;
  actorId?: string; actorType?: 'usuario' | 'cliente' | 'system' | 'anonymous'; role?: string;
  eventType?: string; action?: string; outcome?: 'success' | 'failure'; severityText?: string;
  http?: { method?: string; route?: string; statusCode?: number; durationMs?: number };
  error?: { type?: string; message?: string }; // mensagem já sanitizada, truncada
  db?: { category?: 'CONNECTION' | 'TIMEOUT' | 'DEADLOCK' | 'LOCK_TIMEOUT' | 'CONSTRAINT' | 'NOT_FOUND' | 'TRANSACTION' | 'UNKNOWN'; durationMs?: number; operation?: string; model?: string };
  realtime?: { action?: string; reasonCode?: string };
  alert?: { ruleName?: string; state?: string; reason?: string; url?: string };
  rawRef: { index: string; id: string }; // referência, nunca `_source` completo
};
```

Mapeamento inicial: `attributes.correlationId`, `attributes.requestId`, `attributes.releaseSha`, `attributes.service`, `attributes.environment`, `attributes.event.action/outcome`, `attributes.http.*`, `attributes.category`, `attributes.durationMs`, `attributes.event`, `attributes.reasonCode` e campos de contexto do Pino, com fallback documentado por mapping real. `trace_id` e `span_id` são aceitos da raiz quando presentes. O normalizador deve remover campos não permitidos antes de persistir e antes de passar dados ao LLM.

## 8. Correlação

A correlação é determinística antes de qualquer LLM. A investigação de um alerta faz uma consulta curta inicial e, quando encontra uma chave, emite consultas dirigidas por esta ordem:

1. `correlationId` exato (`attributes.correlationId.keyword`);
2. `requestId` exato;
3. `traceId`, depois `spanId` quando o trace já estiver no conjunto permitido;
4. `releaseSha + service` dentro de janela limitada;
5. `tenant + rota normalizada + janela temporal`;
6. `actor + janela temporal`;
7. fingerprint de incidente.

Classificação de cada ligação:

| Nível | Regra |
|---|---|
| `DETERMINISTIC` | Mesma chave exata de correlation/request/trace, ou alerta que referencia explicitamente o mesmo evento. |
| `STRONG` | Mesmo serviço e release, rota/ação compatível e tenant, na janela curta; sem conflito de identificador. |
| `PROBABLE` | Mesma classe/rota/release ou mesma categoria DB em janela configurada, mas sem chave comum. |
| `WEAK` | Apenas proximidade temporal, ator ou fingerprint. Só aparece como contexto, não sustenta causa ou severidade alta. |

Fallback temporal começa em ±5 min do alerta; pode expandir uma única vez até ±15 min somente se houver serviço/rota/tenant compatível. Nunca faz full scan, nunca agrega eventos só porque o LLM os descreveu como relacionados e registra a regra que gerou cada relação.

## 9. Incident grouping e deduplicação

As entidades são distintas:

- **Evento:** um documento normalizado proveniente de alerta, audit, technical ou métrica.
- **Incidente:** grupo mutável de eventos com fingerprint, janela e impacto agregado.
- **Dossiê:** snapshot imutável do incidente em uma versão/instante, avaliado por humano.

Fingerprint v1 é um hash de `classe | tipo de erro/categoria DB | rota normalizada | serviço | release normalizada`, adicionando tenant apenas para eventos de isolamento por tenant (por exemplo, falha de autorização ou falha específica sem propagação multi-tenant). Nunca inclui IDs de request/correlation/trace/ator nem mensagens livres. A rota remove IDs/UUIDs e query string. Se a release estiver ausente, usa marcador estável `release:unknown`, não um ID de evento.

Janela de supressão inicial: 30 min deslizantes por fingerprint; um incidente permanece `OBSERVING` enquanto receber eventos e fecha elegível após 60 min sem ocorrência. Um alerta com correlação determinística de um incidente existente entra nele mesmo se o fingerprint diferir, preservando o motivo. O estado guarda `firstSeen`, `lastSeen`, `occurrences`, `affectedTenants` (contagem e IDs técnicos permitidos), `affectedUsers` somente como contagem/IDs pseudonimizados quando necessário e `affectedReleases`. Dossiê novo é produzido quando o incidente nasce, muda de severidade, cruza uma faixa de ocorrência ou recebe evidência forte; não para cada log.

## 10. Classificação

Classes iniciais, deliberadamente curtas:

- `APPLICATION_ERROR`
- `DATABASE_FAILURE`
- `DATABASE_SLOW`
- `AUTH_FAILURE`
- `AUTHORIZATION_DENIED`
- `REALTIME_AUTH_FAILURE`
- `FRONTEND_ERROR`
- `AVAILABILITY`
- `PERFORMANCE`
- `BUSINESS_FAILURE`
- `TELEMETRY_FAILURE`
- `UNKNOWN`

Ordem de regras: indisponibilidade/health explícito; evento DB categorizado; actions de auth/authz/realtime; HTTP 5xx/erro técnico; frontend/UI; duração/latência; regra de negócio/alerta; `UNKNOWN`. A regra devolve classe, motivo e evidências que a ativaram. LLM pode explicar a classe determinada, nunca alterá-la silenciosamente.

## 11. Severidade

O MVP usa `SEV1`–`SEV4`, calculado por uma matriz determinística e sempre acompanhado de razões:

| Severidade | Base inicial |
|---|---|
| `SEV1` | indisponibilidade confirmada, DB `CONNECTION` recorrente, ou impacto amplo multi-tenant com serviço indisponível. |
| `SEV2` | 5xx/DB técnico recorrente, degradação relevante, múltiplos tenants/usuários ou regressão forte após release. |
| `SEV3` | falha limitada, erro de negócio relevante, auth/realtime anômalo ou lentidão confirmada sem indisponibilidade. |
| `SEV4` | evento isolado, telemetria, contexto fraco ou impacto ainda não confirmado. |

A regra calcula uma faixa/base com: disponibilidade, 5xx, categoria DB, recorrência, duração, número de tenants, contagem de usuários quando permitida, presença de release nova e relação confirmada. Evidência fraca não pode elevar acima de `SEV3`; sinais auth/security sem prova de exploração não passam de `SEV3` por si. O LLM só redige a justificativa da faixa já calculada.

## 12. Segurança

`auth.login.failed`, `authorization.denied`, `session.rejected`, rejeições realtime e picos 401/403 são sinais operacionais, não prova de vulnerabilidade. O Analyst usa as etiquetas auxiliares `SECURITY_SIGNAL`, `SUSPICIOUS_PATTERN` e `AUTH_ANOMALY` com linguagem condicional.

Só é aceitável registrar “possível vulnerabilidade a investigar” com evidência técnica concreta, por exemplo: acesso autorizado observado fora da política, bypass reproduzível documentado, inconsistência confirmada de controle de acesso ou artefato de segurança validado por humano. O dossiê nunca usa “vulnerabilidade encontrada” somente com falhas de login/negações, não inclui token/cookie/credenciais e separa fato de hipótese.

## 13. LLM/Ollama

Não foi encontrada ocorrência de `ollama`, `gemma` ou configuração LLM no `support-agent/`, backend, Ops Panel, scripts ou arquivos de deploy auditados. Assim, o modelo atual, endpoint, timeout, context window, temperatura, retries e uso CPU/GPU estão **não configurados/não comprovados**. Nenhum modelo deve ser instalado nesta tarefa.

Para o MVP, a recomendação é uma integração Ollama local opcional, desligada por padrão, com o **ID exato de um modelo Gemma que esteja realmente instalado e aprovado no ticket de implementação**. Não há base para recomendar um ID específico agora. O ticket de LLM deve inventariar `ollama list`, validar endpoint loopback, definir limite de contexto e comparar modelos Gemma disponíveis contra fixtures sanitizadas. Se Ollama estiver offline, lento, retornar formato inválido ou exceder timeout, o dossiê determinístico ainda é salvo com `llmStatus: unavailable|timeout|invalid`; não há retry ilimitado nem impacto no TAP Quiver.

## 14. Fact vs hypothesis

Cada dossiê tem quatro blocos obrigatórios:

- **FACTS:** afirmações diretamente derivadas de eventos normalizados e suas contagens.
- **EVIDENCE:** IDs/referências, consultas, timeline e nível de correlação que sustentam os facts.
- **HYPOTHESES:** explicações possíveis, condicionais e ordenadas por compatibilidade com a evidência.
- **RECOMMENDED CHECKS:** verificações humanas concretas, sem comandos mutadores executados pelo Analyst.

O prompt e o validador de saída devem proibir causalidade não suportada. Exemplo: “14 `db.connection.failed` ocorreram na release `abc123`” é fato; “a conectividade pode ter se degradado após a release” é hipótese; “`abc123` causou a falha” não é permitido sem prova independente.

## 15. Dossiê

Formato Markdown + JSON sanitizado, com versão de schema e hash do contexto. Campos propostos:

1. Incident ID, status, classe, severidade, confidence e motivo das regras.
2. First/last seen, occurrences, serviço, tenant(s) em forma minimizada, release(s).
3. Resumo executivo factual, seguido de impacto conhecido.
4. Timeline limitada e ordenada, com referência `index/id` e nível de correlação.
5. Evidência por HTTP, DB, realtime e auth/security, incluindo lacunas explícitas.
6. Facts, hypotheses, alternative hypotheses e recommended checks.
7. Similar incidents por fingerprint, sem alegar identidade se a relação for fraca.
8. Links/consultas Kibana pré-definidas e reproduzíveis, Analyst version e modelo/estado LLM.

Nunca incluir `_source` bruto, headers, body, SQL, bindings, dados pessoais, stack sem sanitização ou uma resposta LLM sem validação estrutural.

## 16. Confidence

`HIGH`, `MEDIUM` e `LOW` são calculados, não escolhidos pelo LLM:

- **HIGH:** chave determinística liga pelo menos duas fontes relevantes, ou alerta/evento tem prova explícita de impacto e release/serviço.
- **MEDIUM:** mesma classe, rota/ação, serviço/release e janela curta, sem chave primária.
- **LOW:** somente proximidade temporal, ator, fingerprint ou evidência parcial/ausente.

Confidence é reduzida por query truncada, mapping incompleto, fonte indisponível, conflito de IDs, evento sanitizado sem campos essenciais ou fallback temporal. Nunca é elevada somente porque o modelo produziu uma explicação fluente.

## 17. Persistência

Para o piloto, usar diretório local exclusivo e auditável, por exemplo `deploy/runtime/support-analyst/` (ignorado pelo Git e fora de dados de aplicação), com escrita atômica e permissões restritas:

- `state.json`: cursor por fonte, versão e health do último ciclo;
- `incidents.json`: registro compacto de incidente/fingerprint/contadores/estado;
- `dossiers/<incident-id>/<timestamp>.md` e `.json`: snapshots imutáveis sanitizados;
- `feedback.jsonl`: avaliações append-only, com ID do dossiê e motivo;
- `quality.jsonl`: métricas de avaliação por execução/replay.

JSON/JSONL é suficiente no MVP: facilita inspeção, backup e replay sem nova infraestrutura. Limites de tamanho/rotação e lock de processo único são requisitos. SQLite local é alternativa posterior somente se concorrência, consulta de histórico ou volume medido justificar; não introduzir banco externo.

Estados: `NEW` → `OBSERVING` → `ASSESSED` → `CLOSED`; `DUPLICATE` é uma referência a incidente canônico, não um workflow paralelo. Uma avaliação humana pode marcar o dossiê, mas não autoriza ações externas.

## 18. Shadow mode

Fluxo V1:

```text
alerta/evento -> coleta read-only -> normalização -> correlação -> incidente
              -> classificação/regras -> contexto limitado -> dossiê local -> humano avalia
```

Não há Telegram, GitHub Issue, e-mail, marcação em Elasticsearch, comentário, mudança de configuração, comando shell operacional ou remediação. O cursor é exclusivamente local; reiniciar o Analyst pode reavaliar poucos eventos, mas a deduplicação local impede dossiês repetidos. Falha do processo é isolada: API, poller, collector, banco e Ops Panel continuam sem chamar o Analyst.

## 19. Quality metrics

O shadow cria baseline, não metas arbitrárias. Para cada dossiê com feedback humano e para cada fixture de replay, medir:

- acurácia de classificação e acordo de severidade;
- false-positive rate e duplicate rate;
- missed-correlation rate, precisão de `correlationId`/request/release e identificação correta de tenant;
- distribuição de confidence e taxa de relações `DETERMINISTIC`/`STRONG`/`PROBABLE`/`WEAK` confirmadas;
- utilidade do dossiê e contexto ausente;
- unsupported-claim rate (causalidade/afirmação não sustentada);
- tempo alerta→dossiê e processamento por fonte;
- latência LLM, falhas, timeout, resposta inválida e fallback determinístico;
- cobertura/truncamento de fonte e erro de normalização.

Definições e denominadores devem acompanhar cada métrica; “não avaliado” não é contabilizado como correto. Um conjunto de fixtures revisadas permite medir antes de haver falhas reais suficientes.

## 20. Human feedback

Cada dossiê recebe uma avaliação local simples: `USEFUL`, `PARTIAL` ou `WRONG`. Opcionalmente o revisor marca: classificação, severidade, correlação, causa provável, duplicação ou contexto insuficiente, e pode acrescentar comentário sanitizado. `feedback.jsonl` armazena `dossierId`, timestamp, rótulo, flags e versão do schema; não armazena identidade pessoal do revisor por padrão.

O MVP pode oferecer um comando local que valida a entrada e faz append, ou edição guiada de arquivo. Não construir UI; a leitura no Ops Panel só é candidata após o piloto provar necessidade.

## 21. Observabilidade do Analyst

Sinais mínimos, emitidos localmente ou para um destino explicitamente excluído das fontes do próprio Analyst:

- `analyst.poll.completed`, `analyst.incident.created`, `analyst.incident.updated`, `analyst.dossier.generated`;
- `analyst.llm.failed`, `analyst.elasticsearch.failed`, `analyst.processing.failed`.

Métricas: `eventsProcessed`, `incidentsCreated`, `incidentsUpdated`, `dossiersGenerated`, `duplicatesSuppressed`, `llmDuration`, `processingDuration` e `failures`, com fonte/classe/resultado de baixo cardinalidade. Por padrão, `service.name=quiver-tap-support-analyst` e seus data streams são excluídos de busca, alertas e fingerprints do Analyst para impedir recursão.

## 22. Fail-safe

O Analyst é consumidor out-of-band, usa timeouts, limites de concorrência e backoff com jitter. Elasticsearch, arquivos locais, parsing ou Ollama indisponíveis encerram apenas o ciclo afetado, registram falha e preservam o último cursor confirmado. Um dossiê parcial declara a fonte ausente; não é promovido para ação. Não existe caminho de código para deploy, rollback, restart, banco, migration, escrita Elastic, GitHub, Telegram, e-mail ou shell de remediação.

## 23. Privacidade

A minimização ocorre antes de persistir o contexto e novamente antes do LLM: allowlist de campos, redação por chave/valor, truncate de mensagens/stack, remoção de body/header e pseudonimização opcional de ator. IDs técnicos só são mantidos quando correlacionam o incidente; tenant slug/ID segue a mesma regra de necessidade. O LLM local não reduz a obrigação de minimização. Fixtures de replay são sanitizadas e não contêm dados de produção identificáveis.

## 24. Performance

Limites iniciais sujeitos a calibração no replay: lote de até 50 alertas, busca de correlação por chave exata, janela de ±5 min (uma expansão até ±15 min), no máximo 200 eventos normalizados por incidente e 40 itens de timeline/contexto LLM. O contexto seleciona primeiro alertas, falhas 5xx/DB, eventos com chave determinística e mudanças de release; depois agrega contagens, em vez de enviar centenas de logs. Queries têm `size`, ordenação e source includes explícitos; não usam wildcard sem faixa temporal, scroll, PIT longo ou full scan histórico.

## 25. MVP

O MVP é adequado e fica limitado a:

- consumir `quiver-tap-alert-events` em read-only;
- buscar audit e technical logs PRD relacionados, com equivalentes DEV para replay;
- normalizar contrato R-02 e correlacionar primeiro por `correlationId`;
- enriquecer por request, trace, serviço/release e sinais DB/auth/realtime disponíveis;
- agrupar/deduplicar, classificar, calcular severidade/confidence por regras;
- gerar dossiê local determinístico e, se Ollama local aprovado estiver disponível, complemento analítico;
- persistir feedback humano e métricas de qualidade;
- operar exclusivamente em shadow.

Não é MVP: criação de Issues/Telegram, leitura de traces, health de todos os auxiliares, UI, SQLite, correção, alertas novos, embeddings/RAG ou autonomia operacional.

## 26. Arquitetura proposta

Criar, em implementação posterior, `support-analyst/` como package/processo local independente. O código pode compartilhar uma biblioteca pequena de tipos/funções puras com o Agent somente após testes de regressão; inicialmente duplicação controlada do mínimo seguro é preferível a acoplar o novo processo ao mecanismo de Issue/fixer.

Componentes:

1. `AlertSource` e `SignalSource`: consultas Elastic allowlisted e read-only.
2. `Normalizer`: converte documentos em `NormalizedEvent` e redige dados.
3. `CorrelationEngine`: pesquisa dirigida, produz relações e seus níveis.
4. `IncidentGrouper`: fingerprint, janela, estado e dedupe.
5. `Classifier` e `SeverityEngine`: regras determinísticas e justificativas.
6. `ContextBuilder`: timeline/impacto/evidência compactos e seguros.
7. `LocalLlmAnalyzer` opcional: texto estruturado, nunca ferramenta/capacidade de busca.
8. `DossierStore`, `FeedbackStore` e `QualityRecorder`: persistência local.

O Analyst não integra o caminho de request da aplicação, não expõe rota de controle e não reaproveita o processo do Alert Poller. É um único processo local, não microserviço distribuído.

## 27. Diagrama textual

```text
Elastic read-only                         armazenamento local do Analyst
quiver-tap-alert-events ─┐                         ┌─ state/incidents
logs-audit*.otel-* ──────┼─> Sources -> Normalizer ├─ dossiers MD + JSON
logs-technical*.otel-* ──┘            │            ├─ feedback JSONL
metrics permitidas ───────────────────┘            └─ quality JSONL
                                           │
                                    CorrelationEngine
                                           │
                              IncidentGrouper -> rules (class/severity/confidence)
                                           │
                                   ContextBuilder -> [Ollama local opcional]
                                           │
                                       dossiê shadow -> humano

Sem setas para Elasticsearch write, banco, GitHub, Telegram, deploy, shell ou aplicação.
```

## 28. Roadmap

Tickets pequenos, testáveis e reversíveis após esta discovery:

| Ticket | Entrega e critério de aceite |
|---|---|
| `TQ-SA-02` | Onboarding R-01: role/API key proposta aplicada somente em ambiente autorizado, aliases/mapping/retenção documentados, três consultas read-only verificadas. |
| `TQ-SA-LEGACY-01` | Freeze, inventário de side effects e plano de transição do Support Agent legado; não altera seu comportamento. |
| `TQ-SA-03` | **Concluído:** package/processo isolado, config sem fallback privilegiado, `NormalizedEvent` e fixtures DEV sanitizadas. |
| `TQ-SA-04` | **Concluído:** Sources Elastic DEV read-only com source filter, parser, correlação por IDs e fallback temporal limitado; smoke read-only validado. |
| `TQ-SA-05` | **Concluído:** grouping/dedupe, estados, classe, severidade/confidence determinísticos e persistência local. |
| `TQ-SA-06` | **Concluído:** ContextBuilder limitado, dossiê determinístico/imutável, privacy guard, Markdown e feedback JSONL local. |
| `TQ-SA-07A` | Hardware Validation & Local LLM Bake-off: inventário Ollama/GPU, candidatos locais, prompt/schema, validação offline e benchmark sanitizado; não integra LLM ao Analyst. |
| `TQ-SA-07B` | LocalLlmAnalyzer integration with selected model, somente após a revisão humana do bake-off SA-07A. |
| `TQ-SA-08` | Replay, baseline de qualidade e relatório de métricas; correção de falsos positivos antes do piloto. |
| `TQ-SA-HEALTH-01` | Heartbeat, process health, Elastic/LLM health, watchdog externo, `health.json` e status read-only opcional. |
| `TQ-SA-09` | Piloto shadow sem saída externa, runbook e avaliação humana periódica. |
| `TQ-SA-LEGACY-02` | Decommission concluído antes de `TQ-SA-03`; runtime legado removido, rollback preservado no Git. |
| `TQ-SA-10` | Desenho/validação de adapters novos e gated para Telegram/GitHub; qualquer Remediation Executor futuro é processo separado e não reutiliza o runtime legado. |

## 29. Riscos

1. R-01 pode revelar aliases/mappings/permissões diferentes em PRD; mitigar com onboarding read-only e contratos verificados antes do piloto.
2. Campos PII podem chegar em texto livre/stack apesar da redação existente; mitigar com allowlist, segunda redação, truncamento e fixtures sanitizadas.
3. Correlação temporal pode criar falsos vínculos; mitigar com ordem por ID, classificação de relação e confidence reduzida.
4. Volume/retenção pode tornar consultas ou histórico caros; mitigar com limites, agregação e nenhuma busca sem janela.
5. LLM local pode estar indisponível, lento ou gerar afirmação não suportada; mitigar com dossiê determinístico completo, schema de saída e validação Fact/Hypothesis.

## 30. O que não implementar

Não implementar agora: vector database, RAG genérico, embeddings de logs, Kafka/fila distribuída, Kubernetes, microserviços, banco externo, cloud LLM, fine-tuning, framework de agentes/multi-agent, acesso a traces sem caso comprovado, UI sofisticada, novas regras Kibana, Telegram/Issue automáticos, auto-remediação, deploy/rollback/restart, migrations ou qualquer escrita em banco/Elastic/aplicação.

## 31. Definition of Done da primeira versão

A primeira versão estará pronta quando:

- identidade Elastic exclusiva e read-only for validada no ambiente autorizado (R-01), sem privilégios de cluster/escrita;
- `NormalizedEvent` R-02, parsers e mappings suportados estiverem documentados e cobertos por fixtures;
- um replay sanitizado produzir eventos, relação, incidente e dossiê reproduzíveis sem Elastic/Ollama;
- correlação primária por `correlationId` e fallbacks tiverem testes de precisão/confidence;
- dedupe, classe, severidade e confidence forem determinísticos e explicáveis;
- dossiês locais separarem facts, evidence, hypotheses e recommended checks;
- dados proibidos não alcançarem persistência de dossiê nem prompt LLM;
- falhas Elastic/Ollama/arquivo forem fail-safe e não afetarem o TAP Quiver;
- feedback e métricas de qualidade forem gravados localmente;
- não houver integração de Telegram/GitHub nem qualquer capacidade de remediação/escrita;
- o piloto shadow tiver runbook, limites de desempenho e revisão humana definida.
