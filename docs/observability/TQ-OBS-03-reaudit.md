# TQ-OBS-03 — Reavaliação de readiness de observabilidade

Data da reavaliação: 2026-08-31
Escopo: repositório local, documentação versionada e provas DEV registradas. Não houve chamada, alteração, deploy ou reinício em PROD.

## 1. Resumo executivo

O TAP Quiver evoluiu de uma base útil, mas com cadeia fragmentada, para uma base **forte** para a operação atual. A melhoria decisiva foi tornar a requisição HTTP identificável de ponta a ponta: o frontend cria `X-Correlation-Id`, o Fastify o valida/devolve e o contexto o leva a audit, logs técnicos, Prisma e release. O frontend agora também registra o resultado terminal do transporte, inclusive duração, erro de rede, timeout e abort.

Há sinais semânticos de autenticação/autorização, decisões críticas de realtime, logs técnicos Pino segregados, taxonomia de falhas DB e contexto de release. Isso é suficiente para iniciar um **Support Analyst local em modo somente leitura/sombra**, desde que sua primeira versão trate o acesso a Elasticsearch e a correlação como requisitos de implementação, não como ações automáticas.

O limite remanescente não é uma ausência fundamental de sinal: é a qualidade e a operacionalização do consumo. O Support Agent atual lê alertas e `logs-audit*.otel-prd`, mas ainda não extrai `correlationId`, `requestId`, `releaseSha`, sinais DB ou realtime, nem consulta os índices técnicos por padrão. Também permanecem lacunas de business health e de telemetria centralizada de componentes auxiliares. Nenhuma delas precisa bloquear o começo do Analyst em sombra.

**Score geral atual: 83/100** (antes: 64/100).
**Jornada completa:** PARCIAL, mas a cadeia HTTP principal é reconstruível; ela quebra na associação determinística entre interação UI e requisição e na telemetria de lifecycle/entrega do Socket.IO.
**Readiness para Support Analyst:** **READY WITH GAPS**.
**Recomendação:** **B — iniciar Support Analyst agora e manter gaps em paralelo**.

### Método e limite de evidência

Foi mantida a mesma régua do TQ-OBS-01: o score mede a capacidade comprovada de detectar, explicar e correlacionar incidentes; a existência de configuração não é tratada como prova de ativação em PROD. As notas novas são comparáveis na escala 0–100; áreas sem nota explícita no baseline aparecem como `N/A` no delta.

As validações versionadas comprovam ingestão em Elasticsearch **DEV** para log técnico Pino, erro DB e audit/release (`TQ-OBS-02E`, `02F3` e `02G2`). Não foi feita inferência de entrega atual em PROD. Esta distinção reduz a nota operacional de logs/infra, mas não invalida o contrato de instrumentação implementado.

## 2. Baseline original

Em 2026-08-29, TQ-OBS-01 registrou score geral 64/100, jornada PARCIAL, P0=0 e P1=7. Os sete P1 eram correlação HTTP, telemetria HTTP do frontend, realtime, exportação de logs técnicos, diagnóstico Prisma, eventos semânticos de auth e contexto de release.

O principal impedimento era que uma ação no navegador, sua chamada HTTP e os eventos do backend não compartilhavam ID. A investigação dependia de janela de tempo, ator e tenant. Socket.IO só deixava sinal de algumas negações; Prisma não fornecia duração/classificação; e o Support Agent era limitado a um dossiê de audit sem stack técnico confiável.

## 3. Estado atual

| Camada | Evidência atual | Leitura |
|---|---|---|
| HTTP/correlação | `frontend/src/lib/api.ts`, `backend/src/lib/correlation-context.ts`, `telemetry-context.ts`, `audit/emit-audit-event.ts` | UUID por request via `X-Correlation-Id`, retorno no response, `requestId` Fastify e propagação para audit/log/span. |
| Frontend HTTP | `frontend/src/lib/api.ts`, `frontend/src/lib/audit-tracker.ts` | Evento terminal `http.request.completed` com método, rota sanitizada, status, duração, outcome, rede/abort/timeout, correlation e request ID quando devolvido. |
| Auth/authz | `backend/src/lib/auth-observability.ts`, `app.ts`, `routes/auth.ts` | Eventos seguros de login, logout, sessão rejeitada e autorização negada, com reason code e papel quando disponível. |
| Realtime | `backend/src/lib/socket-auth.ts` | Eventos de sessão aceita/rejeitada e room aceita/negada; incluem ator, tenant/entidade, socket, reason code e correlação se o handshake a traz. |
| Logs técnicos | `backend/src/lib/logger.ts`, `technical-log.ts`, `TQ-OBS-02E-technical-logs.md` | Pino separado em `logs-technical.otel-*`, 500 estruturado e redigido; prova persistente DEV registrada. |
| Prisma | `backend/src/lib/prisma-observability.ts`, `TQ-OBS-02F-prisma-db.md` | Lentidão, falha de operação/conexão/transação, duração e taxonomia segura; ingestão DEV final comprovada. |
| Release | `release-context.ts`, `frontend/src/lib/release-context.ts`, `TQ-OBS-02G-release-context.md` | `releaseSha`, `service`, `environment` nos logs/audit e metadado estático no frontend; audit DEV persistido com os campos. |

## 4. Score comparativo

| Área | Antes | Agora | Delta | Motivo |
|---|---:|---:|---:|---|
| Backend HTTP | 78 | 92 | +14 | Correlação/request ID, resposta de correlação, audit e erro técnico 500 estruturado. GET 2xx e endpoints excluídos continuam fora do audit. |
| Frontend | 62 | 88 | +26 | Wrapper registra resultado, duração e falhas de transporte com rota sanitizada e correlação. Clique/submit ainda não compartilha automaticamente o ID da requisição. |
| Socket.IO | 28 | 75 | +47 | Sessão e rooms críticas agora têm eventos semânticos seguros. Disconnect/reconnect, leave e confirmação de entrega permanecem sem sinal. |
| Autenticação/segurança | 68 | 88 | +20 | Login, logout, sessão e negações são semânticos, com reason code/papel; não há métrica/alerta dedicado para cada padrão de abuso. |
| Business observability | 72 | 74 | +2 | Transações, caixa e cozinha continuam úteis; health de pagamento, pendência, estoque e portal continua incompleto. |
| Database/Prisma | 44 | 82 | +38 | Duração, erro categorizado e transação técnica; pool/ocupação não é exposto pela arquitetura atual. |
| Infraestrutura | 72 | 74 | +2 | API, URL pública, TCP Postgres e host têm coleta; tunnel/watchdog/Ops Panel/Docker/Kibana/Agent seguem sem centralização equivalente. |
| Deploy/recovery | 85 | 85 | 0 | Manifesto, ledger, backup, rollback e recovery continuam fortes; a mudança foi de ligação da release aos eventos, não do processo de recovery. |
| Audit | 73 | 84 | +11 | Audit herda IDs e release, e auth/HTTP adicionam semântica. Before/after comum continua parcial. |
| Alertas | 78 | 80 | +2 | Regras, poller, Telegram/e-mail, estado e dedup existem; entrega fim a fim e cobertura das novas famílias ainda não são provadas/definidas. |
| Correlação | 42 | 88 | +46 | Frontend→HTTP→Fastify→audit/log técnico→Prisma→release é correlacionável pelo ID. UI clique e Socket não formam uma única jornada universal. |
| Release/version context | N/A | 90 | N/A → 90 | Contexto central de processo e metadado frontend, alinhado ao manifesto/ledger; PROD não foi consultada. |

O score geral 83 privilegia a capacidade de explicar um incidente real de requisição, sem mascarar as lacunas de health operacional e de consumidor automatizado.

## 5. Gaps resolvidos e revisão dos 10 gaps originais

| Gap original | Estado | Evidência | Leitura residual |
|---|---|---|---|
| 1. Sem correlation ID frontend → HTTP → audit | **RESOLVIDO** | `api.ts` cria header; Fastify valida/devolve; telemetria, audit e logger carregam IDs. | A interação `ui.click` não recebe automaticamente o mesmo ID da chamada posterior. |
| 2. Wrapper sem resultado/latência/network | **RESOLVIDO** | `http.request.completed` tem método, rota, status, duração e outcomes `success`, `client_error`, `server_error`, `network_error`, `aborted`, `timeout`. | Download CSV não passa pelo mesmo reporter. |
| 3. Socket sem lifecycle/rooms observáveis | **PARCIAL** | `realtime.session.*` e `realtime.room.*` registram aceitação, rejeição, join e negação. | Falta disconnect/reconnect/leave, emissão/recebimento e confirmação de entrega. |
| 4. Logs Pino não garantidos no Elastic | **PARCIAL** | Dataset técnico explícito, erro 500 estruturado, fail-open e ingestão DEV persistente em `logs-technical.otel-dev*`. | Nenhuma verificação desta reauditoria consultou PROD; portanto não se afirma ingestão operacional de PROD. |
| 5. Prisma sem duração/classificação DB | **PARCIAL** | Eventos slow/failure/connection/transaction, duração e categorias explícitas, com ingestão DEV comprovada. | Pool/ocupação não existe; sucesso rápido não gera evento, intencionalmente. |
| 6. Auth/authz sem eventos semânticos | **RESOLVIDO** | `auth.login.succeeded/failed`, `logout`, `session.rejected`, `authorization.denied` e reason codes. | Alertas analíticos específicos para cada evento ainda não existem. |
| 7. Eventos sem SHA/release | **RESOLVIDO** | Contexto central injeta `releaseSha`, `service`, `environment` em Pino/audit/Prisma/realtime; frontend manda metadado da build. | A presença em PROD não foi inspecionada neste ticket. |
| 8. Before/after sem contrato comum | **ABERTO** | Correção de caixa continua forte; demais domínios seguem dependentes de payload/transação. | Necessário apenas onde uma comparação de estado altera o diagnóstico. |
| 9. Business health incompleto | **ABERTO** | Métricas existentes para transação, comanda, cozinha e divergência de caixa. | Sem sinais canônicos de pendência anormal, pagamento falhando, estoque inconsistente e portal degradado. |
| 10. Infra sem centralização comprovada | **ABERTO** | Collector cobre HTTP/TCP/host; scripts dão status local. | Tunnel, watchdog, Docker, Ops Panel, Agent, Kibana e saúde detalhada de ES não têm sinal central uniforme. |

Totais: **4 resolvidos, 3 parciais, 3 abertos**.

### Reavaliação dos sete P1 originais

| P1 original | Situação agora | Prioridade agora | Justificativa |
|---|---|---|---|
| G-01 Correlação | Resolvido | — | Contrato ponta a ponta HTTP implementado. |
| G-02 Frontend HTTP | Resolvido | — | Resultado/duração/falha de transporte registrados. |
| G-03 Realtime | Parcial | P2 | As decisões de autorização são observáveis; lifecycle/entrega não impede o Analyst de iniciar. |
| G-04 Logs técnicos | Parcial | P1 | É preciso validar o contrato de índice/permissão/retenção do ambiente a ser monitorado antes de depender dele para dossiês. |
| G-05 Prisma | Parcial | P2 | Diagnóstico de falha/lentidão já existe; pool é melhoria operacional posterior. |
| G-06 Auth/security | Resolvido | — | Semântica segura disponível. |
| G-07 Release | Resolvido | — | Release é carregada centralmente e pesquisável nos eventos em DEV. |

## 6. Gaps restantes e P0/P1 atuais

### Gap register atual

| ID | Área | Gap | Prioridade | Bloqueia Support Analyst? | Esforço |
|---|---|---|---|---|---|
| R-01 | Operação de dados | Validar, no ambiente que o Analyst irá ler, aliases/índices, permissões read-only e retenção para audit/técnico/alertas. | P1 | Não — o Analyst pode começar em sombra após o onboarding operacional. | Baixo |
| R-02 | Support Agent/Analyst | Consumidor atual não extrai correlation/request/release nem classes DB/realtime; índice padrão é só `logs-audit*.otel-prd`. | P1 | Não — é trabalho normal da primeira versão do Analyst. | Médio |
| R-03 | Business health | Sem métricas/alertas de pedido pendente anormal, pagamento falhando, caixa divergente acionável, estoque inconsistente e portal com erro. | P2 | Não | Médio |
| R-04 | Realtime | Sem disconnect/reconnect/leave, entrega ou correlação criada pelo cliente Socket. | P2 | Não | Médio |
| R-05 | Infra | Sem health central de tunnel, watchdog, Docker, Ops Panel, Agent, Kibana e checks detalhados de Elasticsearch. | P2 | Não | Médio |
| R-06 | Auditoria | Before/after e motivo não são contrato comum para estoque, usuários, clientes e configuração. | P2 | Não | Médio |
| R-07 | Alertas | Novos sinais auth/realtime/DB não têm regras/thresholds específicos; entrega Telegram/e-mail não é comprovada continuamente. | P2 | Não | Médio |
| R-08 | Privacidade | Campos livres/stack podem conter PII apesar da redação forte de segredos. | P2 | Não | Baixo |
| R-09 | Frontend | Click/submit e HTTP são eventos separados; CSV não emite telemetria terminal. | P3 | Não | Baixo |
| R-10 | DB | Sem métricas de pool/ocupação/espera; sucesso rápido não produz série por operação. | P3 | Não | Médio |

**P0 atual: 0.** Não há gap de observabilidade que exija parar a operação ou que, isoladamente, impeça um Analyst somente leitura.
**P1 atual: 2** (`R-01`, `R-02`). Ambos são pré-requisitos de qualidade para a primeira entrega do Analyst, não bloqueadores para começar a construí-lo/rodá-lo em sombra.

### Top 5 gaps por valor prático

1. `R-02` — fazer o Analyst consumir e correlacionar os novos campos/índices.
2. `R-01` — garantir permissões e descoberta operacional dos índices que ele vai ler.
3. `R-03` — health de pagamento, pendência, estoque, caixa e portal.
4. `R-07` — transformar novos sinais em alertas com limiares e runbook.
5. `R-04` — lifecycle e entrega de realtime para incidentes de tela que não atualiza.

## 7. Jornada reconstruível

Classificação: **PARCIAL**.

```text
usuário/tela
  ├─ ui.click / ui.submit (audit em lote; ID próprio do lote) ──┐
  └─ api.ts cria correlationId ──> HTTP ──> Fastify requestId  │
                                          ├─ audit HTTP/auth    │
                                          ├─ log técnico 5xx     │
                                          ├─ Prisma DB           │
                                          └─ releaseSha          │
Socket handshake/room (correlation somente se cliente a enviar) ┘
```

A cadeia determinística de uma chamada via `api.ts` é: **frontend HTTP → correlationId → backend/requestId → audit/log técnico → Prisma quando acionado → resultado/status → release**. O audit HTTP inclui rota/status e o evento terminal do frontend inclui outcome/duração; uma busca por `attributes.correlationId.keyword` liga os data streams DEV demonstrados.

Ela ainda quebra em três pontos:

1. `ui.click`/`ui.submit` é enfileirado independentemente e não recebe o ID da requisição que o handler pode iniciar.
2. Socket.IO não gera correlation ID no cliente e não registra lifecycle ou entrega; os eventos de autorização só carregam ID se já veio no handshake.
3. Nem todo resultado gera DB/realtime: operação rápida de DB não emite log técnico adicional e uma chamada de fechar comanda não implica evento realtime correlacionável.

### Cenário: “tentei fechar uma comanda e deu erro”

Para uma chamada de fechamento que passa pelo wrapper padrão, **10 de 13 pontos são determinísticos** no registro da requisição: usuário autenticado, cervejaria/tenant, rota/chamada, `correlationId`, `requestId`, status, hora, outcome, releaseSha e mensagem de regra/erro de resposta quando o handler a retorna. A seguir, a granularidade correta:

| Ponto | Situação | Evidência/limite |
|---|---|---|
| Usuário | Determinístico | Contexto Fastify resolve ator autenticado. |
| Cervejaria | Determinístico | Contexto contém `cervejariaId`/slug quando a sessão o possui. |
| Tela/chamada | Chamada determinística; tela parcial | `http.request.completed` tem rota; UI em lote mostra tela, mas não é ligada automaticamente ao HTTP. |
| correlationId | Determinístico | Criado por `api.ts`, aceito/devolvido pelo backend. |
| requestId | Determinístico | `request.id` propagado no backend e retornado quando disponível. |
| Status | Determinístico | Evento HTTP/audit guarda status. |
| Erro técnico | Condicional | 5xx inesperado gera Pino estruturado com stack; regra de negócio 4xx não deve ser tratado como erro técnico. |
| Regra de negócio | Determinístico quando retornada | `audit-hooks.ts` preserva `responseError` seguro para respostas >=400. |
| DB | Condicional | Falha/lentidão técnica gera categoria/duração; sucesso rápido não cria evento DB. |
| Realtime | Não determinístico | Não há elo obrigatório do fechamento ao evento/entrega Socket. |
| Release | Determinístico no contrato | Campos centrais presentes; prova de persistência registrada em DEV, não revalidada em PROD. |
| Horário | Determinístico | `@timestamp` e horário local do audit. |
| Outcome | Determinístico | `success`/`failure` no audit e classificação terminal no frontend. |

## 8. Business health

| Domínio | Cobertura atual | Lacuna que afeta diagnóstico de cliente |
|---|---|---|
| Comandas | Boa para criação, itens, fechamento e transações; contador de fechadas. | Falta idade/volume de comandas abertas e alerta de fechamento bloqueado. |
| Pagamentos | Validações e auditoria HTTP/negócio ajudam a explicar uma falha individual. | Não há métrica de tentativas versus conclusão/falha por forma/jornada, nem alerta. |
| Caixa | Movimentos, fechamento, correção e métrica de divergência existem. | Divergência não possui regra/threshold operacional versionado que abra incidente. |
| Cozinha | Transações e histograma de preparo; SLO de cozinha lenta. | Não há contagem/idade de fila pendente anormal nem classificação de bloqueios de transição. |
| Mesas | Fluxos de comanda/venda são auditáveis. | Ocupação/liberação de mesa não é sinal canônico. |
| Estoque | Movimentos e locks/validações de insuficiência existem. | Não há health de saldo negativo/inconsistente, ruptura ou concorrência agregada. |
| Portal | Pedido, sessão HTTP e autorização realtime deixam sinal. | Sem taxa de erro por jornada, abandono, disponibilidade de sessão ou entrega Socket. |

O maior risco para diagnóstico orientado ao cliente não é “não saber que a requisição falhou”, mas não detectar proativamente degradação de operação normal antes que o cliente abra chamado — especialmente pagamento, fila de cozinha, estoque e portal.

## 9. Infraestrutura

| Componente | Sinal atual | Avaliação |
|---|---|---|
| API | `/api/health`/`ready`, httpcheck, alertas de down/ready/5xx/SLO. | Boa. |
| PostgreSQL | TCP check, readiness `SELECT 1`, logs DB categorizados. | Boa para indisponibilidade; pool não observado. |
| Docker/collector | Compose, métricas host e procedimentos locais. | Parcial; saúde de container/collector não é evento central dedicado. |
| Cloudflare Tunnel | URL pública no httpcheck; watchdog local o gerencia. | Parcial; processo do tunnel não possui health central. |
| Watchdog | PID/scripts/log local e ciclo de 60 s. | Parcial; sem telemetria central. |
| Alert Poller | health local, PID e logs; estado local de dedup. | Parcial; sem regra central de saúde/entrega. |
| Ops Panel | status/scripts/log local. | Parcial; sem health central. |
| Support Agent | métricas OTLP opcionais e dashboard versionado. | Parcial; depende de endpoint/configuração e não tem alerta de indisponibilidade próprio. |
| Elasticsearch | alerta de cluster e é destino de telemetria. | Parcial; regra versionada de cluster está desabilitada e Kibana não tem health dedicado. |
| Kibana | dashboards/regras/configuração. | Parcial; sem probe/alerta direto. |

Não é recomendado adicionar um exporter sofisticado para todos os processos antes do Analyst. Para cada componente restante, o sinal só deve ser criado quando houver uma ação operacional clara.

## 10. Alertas

As regras versionadas ativas cobrem API/ready, URL pública, TCP PostgreSQL, event loop, 5xx, 401 surge, `ui.error`, falha de transação, telemetry gap e SLOs de disponibilidade, falha de transação e cozinha lenta. Os intervalos declarados são 1 ou 5 minutos. O poller busca `quiver-tap-alert-events` a cada 30 s por padrão (mínimo 10 s), usa `lastPollIso`, lista de até 2.000 IDs e marcação best-effort no Elasticsearch. E-mail e Telegram podem coexistir.

Há deduplicação suficiente para o fluxo atual, mas não uma garantia transacional: perda do estado local reabre uma janela de dois minutos, o lote é de 50 eventos e a marcação no ES é best-effort. Os thresholds estão versionados, porém precisam de calibração por operação real para reduzir falso positivo — em especial 401, `ui.error`, event loop e telemetry gap. Não há evidência nesta reauditoria de entrega contínua no Telegram/e-mail nem regras para auth/realtime/DB e os healths auxiliares.

**Os sinais já são suficientes para um analista automatizado consumir? Sim, com escopo.** Ele pode consumir alertas, HTTP/audit e logs técnicos, correlacionar falhas e produzir dossiês read-only. Ele não deve alegar cobertura preventiva completa de negócio/infra até os gaps `R-03`, `R-05` e `R-07` evoluírem.

## 11. Support Agent atual

O Support Agent já lê:

- `quiver-tap-alert-events` pelo watcher;
- `logs-audit*.otel-prd` por padrão para enriquecimento;
- opcionalmente métricas próprias via OTLP para `metrics-generic.otel-prd*`.

Ele entende timestamp, severity, action/outcome, rota/método/status, tenant slug, tipo de ator, trace/span, serviço, dataset e stack. Ele separa 4xx de falha atribuível ao servidor, faz fingerprint, deduplica, classifica regras e pode abrir GitHub Issue. O modo padrão é sombra; a correção continua desligada e fora do escopo desta decisão.

Ele **não entende ainda** `correlationId`, `requestId`, `releaseSha`, categoria/duração DB ou o contrato realtime como campos do dossiê. `parseLogEvent` não os extrai e o índice de logs padrão exclui `logs-technical*.otel-prd`, onde vivem os sinais Pino/Prisma/realtime. Assim, ele não correlaciona auth/realtime/DB de forma semântica hoje; no máximo pode encontrá-los como ação/contexto se entrarem no índice consultado.

Para virar o futuro Support Analyst, as mudanças necessárias são de consumidor, não de coleta: ler os três data streams relevantes, normalizar esses campos OTLP, buscar por `correlationId` antes de cair para janela de tempo, acrescentar release e categoria DB ao dossiê, classificar eventos realtime/auth, definir severidade/runbook e manter criação de Issue/Telegram sob gates humanos. Não foram feitas mudanças no agente neste ticket.

## 12. Support Analyst readiness

Classificação: **READY WITH GAPS**.

| Capacidade alvo | Base de sinal | Estado |
|---|---|---|
| Monitorar Elasticsearch | Índice de alertas, audit, técnico e queries já existem. | Pronto para implementar em leitura. |
| Consultar saúde de serviços | API/URL/Postgres/host e alertas existentes. | Parcial para auxiliares. |
| Correlacionar eventos | `correlationId`, `requestId`, trace e release no contrato HTTP. | Pronto para HTTP/DB; parcial para UI/Socket. |
| Identificar falha/vulnerabilidade operacional | 5xx, auth/authz, DB e realtime têm sinais. | Parcial: vulnerabilidade requer regra/política, não só logs. |
| Classificar severidade/deduplicar | Alertas já têm estado; Agent tem fingerprint/dedup. | Pronto como base, com thresholds a calibrar. |
| Criar GitHub Issue e enviar Telegram | Fluxos já existem separadamente. | Pronto sob credenciais/gates operacionais. |

O Analyst inicial deve ser estritamente **read-only e humano no loop**: pode observar, correlacionar, classificar, deduplicar, abrir Issue e notificar; não deve alterar código, banco, deploy ou serviços. `R-01` e `R-02` entram como critérios de aceite da sua implementação, sem exigir uma nova onda de instrumentação antes de iniciá-la.

## 13. Bloqueadores reais

**Não há bloqueador fundamental antes do Support Analyst.** O único cuidado operacional indispensável é não promover o Analyst a fonte de verdade antes de validar quais índices/permissões estão disponíveis no ambiente que ele vai observar (`R-01`). Isso é onboarding de um consumidor read-only, não um motivo para adiar seu desenvolvimento.

Filtro pragmático aplicado aos gaps:

| Gap | Resolver antes do Analyst? | Decisão |
|---|---|---|
| R-01 Índices/permissões/retention | Sim, antes de confiar no modo ativo | Necessário para que o consumidor não opere às cegas; não bloqueia construir/simular. |
| R-02 Parser/correlação do Analyst | Sim, dentro da primeira entrega | É a própria função do novo Analyst, não pré-onda OBS. |
| R-03 Business health | Não | Evoluir em paralelo conforme owner/runbook. |
| R-04 Lifecycle realtime | Não | O Analyst já cobre autorizações e incidentes HTTP; entrega realtime é expansão. |
| R-05 Infra auxiliar | Não | Começar pelos componentes com ação clara. |
| R-06 Before/after | Não | Aplicar seletivamente em fluxos de alto risco. |
| R-07 Alertas novos | Não | Adicionar quando houver limiar e resposta operacional definidos. |
| R-08 Privacidade | Não | Endurecimento contínuo; manter minimização no dossiê. |

## 14. Roadmap recomendado

**Opção B — iniciar Support Analyst agora e manter gaps em paralelo.**

Critérios objetivos: (1) HTTP, audit, Pino, DB, auth e release oferecem contexto suficiente para um dossiê; (2) já há Alert Poller, Telegram, GitHub Issue e deduplicação que podem ser reaproveitados; (3) o agente inicial não terá autoridade de mutação; (4) os gaps restantes reduzem cobertura preventiva ou precisão em classes específicas, mas não eliminam o caminho diagnóstico principal.

Sequência recomendada para a próxima iniciativa, sem implementar nada neste ticket:

1. Criar o Analyst em sombra/read-only, com acesso mínimo aos índices e uma prévia local do dossiê.
2. Tornar `correlationId`, release, DB e realtime campos de primeira classe no enriquecimento; não depender apenas de janela temporal.
3. Medir qualidade dos dossiês e falsos positivos antes de permitir abertura automática de Issue/Telegram em novas categorias.
4. Em paralelo, priorizar business health de pagamento/pendência/estoque e somente os healths auxiliares que tenham runbook.

## 15. O que não implementar agora

- Não instrumentar cada clique, cada emit/receive Socket ou cada query rápida; isso acrescentaria volume sem resolver um incidente prioritário.
- Não criar alertas para todos os eventos auth/realtime/DB sem limiar, dono e runbook.
- Não adicionar exporter completo de PostgreSQL, Docker ou Cloudflare apenas para elevar score.
- Não tentar automação de correção, deploy, restart ou banco pelo Analyst.
- Não ampliar payloads com corpo HTTP, token, cookie, SQL, bindings ou IDs de alta cardinalidade para “melhorar” correlação.
- Não tocar PROD para validar esta reauditoria.

## 16. Conclusão operacional

Para a operação atual, a observabilidade é **forte**: não é perfeita, mas permite investigar com precisão uma falha HTTP de cliente e relacioná-la a identidade, tenant, status, outcome, erro técnico/DB quando aplicável e release. A evolução agora deve concentrar-se em transformar esses sinais em consumo automatizado disciplinado e em completar health de negócio, não em uma nova rodada ampla de instrumentação.
