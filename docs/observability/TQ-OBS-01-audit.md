# TQ-OBS-01 — Auditoria end-to-end de observabilidade

Data da auditoria: 2026-08-29
Escopo: repositório local (código, manifests, scripts e documentação versionados). Não foram feitas chamadas a PROD, Elasticsearch, Kibana, Telegram, GitHub ou Docker. Não houve alteração funcional.

## 1. Resumo executivo

O TAP Quiver já possui uma base de observabilidade incomum para uma aplicação deste porte: logs estruturados Pino instrumentados pelo Elastic OpenTelemetry, traces e métricas OTLP, auditoria persistida e enviada ao Elastic, métricas de negócio, verificações de readiness, alertas Kibana com poller e Telegram/e-mail, e um fluxo de deploy/recovery com manifesto e ledger de release.

A força atual é responder a **mutações de negócio que chegam ao backend**: há ator, tenant, entidade, resultado, horário e, para muitos fluxos, `TransacaoLog` mais evento auditável no Elastic. A cobertura de fechamento de comanda, caixa de quiosque, pedidos e estoque é boa.

O limite principal é a cadeia ponta a ponta. O frontend transmite `ui.click`, `ui.submit`, `ui.page_view` e `ui.error` em lote, enquanto a requisição de negócio nasce separadamente e não recebe/propaga um identificador de correlação. Logo, um “cliquei e não funcionou” pode ser investigado por janela de tempo + ator + tela, mas não reconstruído de forma determinística. Socket.IO protege salas e registra negações de autenticação, porém não registra ciclo de conexão, joins autorizados/rejeitados, nem emissões/recebimentos.

**Conclusão:** a jornada completa é **PARCIAL**. Não há indício de segredo literal versionado no escopo auditado; existem controles de redação. Há, contudo, riscos médios de PII e de conteúdo excepcional em metadados/stack traces que merecem endurecimento seletivo antes de ampliar coleta.

### Score geral: 64/100

O score mede capacidade comprovada de detectar, explicar e correlacionar incidentes no código atual; não presume que um dashboard, alerta ou variável de ambiente esteja ativo em PROD só por existir no repositório.

| Área | Score | Leitura |
|---|---:|---|
| Backend HTTP | 78 | Mutações e erros são auditados; falta request/correlation ID e duração no audit. |
| Frontend | 62 | Navegação, cliques, submit, erros React/JS e rejeições são coletados; falha HTTP e vínculo com backend não. |
| Socket.IO | 28 | Autenticação é validada e negações são logadas; lifecycle, rooms e eventos não são observados. |
| Autenticação/segurança | 68 | 401/403 HTTP e negação de socket deixam sinal; eventos semânticos e decisão cross-tenant não. |
| Comandas | 80 | Transações explícitas cobrem ciclo principal; correlação UI→API ainda é indireta. |
| Caixa | 84 | Abertura, movimentos, fechamento e correção têm transação e encadeamento contábil. |
| Cozinha | 72 | Pedido/status e tempo de preparo existem; bloqueios e erros de domínio são incompletos. |
| Mesas/quiosque | 66 | Fluxos de comanda/venda são bons; ocupação/liberação de mesa não é um sinal padronizado. |
| Estoque | 70 | Movimentos são auditados; concorrência/inconsistência não é classificada. |
| Portal cliente | 62 | Sessão e pedidos são identificáveis; lifecycle do socket e correlação são ausentes. |
| Banco/Prisma | 44 | Operações e falhas Prisma chegam ao audit; não há sinal confiável de duração, pool, lock/deadlock ou timeout. |
| Infraestrutura | 72 | HTTP/TCP/host metrics e alertas existem; processo do frontend/túnel/watchdog não é telemetria centralizada completa. |
| Deploy/recovery | 85 | Manifesto SHA, histórico, backup, smoke, rollback e recovery state são bem registrados em disco. |
| Auditoria/before-after | 73 | `TransacaoLog` é forte para fatos; before/after é inconsistente fora de correção de caixa. |
| Alertas | 78 | Boa cobertura de API, infra e negócio; delivery/estado local e ruído requerem operação validada. |
| Correlação | 42 | OTel correlaciona backend/Prisma quando há span; UI e Socket quebram a cadeia. |

## 2. Arquitetura de observabilidade atual

```text
Frontend SPA ── ui.* em lote ───────────────► /api/audit/events
     │                                         │
     ├── HTTP de negócio ─────────────────────► Fastify hooks / rotas
     └── Socket.IO (cookie/session) ─────────► socket-auth / rooms
                                                   │
Fastify + Prisma + transações ───────────────► emitAuditEvent + Pino
                                                   │ OTLP logs/traces/metrics
                                                   ▼
                             EDOT Collector (:4317/:4318) ─► Elasticsearch
                                                                  │
Kibana rules ─► quiver-tap-alert-events ─► Alert Poller ─► E-mail/Telegram
                                                                  │
                                                        Support Agent (sombra)
                                                        └► Issue/PR apenas sob gates
```

Evidência principal:

- `backend/package.json` inicia Node com `--import @elastic/opentelemetry-node`; não há bootstrap OTel manual no app.
- `backend/src/lib/logger.ts` cria Pino com `mixin()` do contexto assíncrono.
- `backend/src/lib/audit-hooks.ts`, `audit/emit-audit-event.ts`, `prisma-audit.ts` e `transacao-log.ts` são os quatro produtores principais: HTTP, audit UI, Prisma e negócio.
- `docker-compose.observability.yml` sobe somente o EDOT Collector; `deploy/observability/otel-collector-config.yml` recebe OTLP, `httpcheck`, `tcpcheck` e `hostmetrics` e exporta para Elasticsearch em modo `otel`.
- `deploy/observability/` contém data views, dashboards, SLI/SLO e 18 regras de alerta versionadas. Índices físicos dependem do mapeamento OTel do collector; os padrões documentados são `logs-audit*.otel-prd`, `logs-audit*.otel-dev`, logs/traces/métricas por namespace e `quiver-tap-alert-events`.

### Inventário

| Componente | Arquivos principais | Producer | Consumer / retenção conhecida |
|---|---|---|---|
| Logger backend | `backend/src/lib/logger.ts` | Fastify/Pino e código backend | OTLP quando `ELASTIC_OTEL_NODE_ENABLE_LOG_SENDING` está configurado; redact Pino. |
| Contexto OTel/audit | `telemetry-context.ts` | hook HTTP | Pino, spans e audit; tenant/ator/dataset. |
| Audit HTTP | `audit-hooks.ts` | hooks Fastify | `emitAuditEvent`; mutações e respostas >=400, com exclusões de ruído. |
| Audit UI | `frontend/src/lib/audit-tracker.ts`, `components/AuditTracker.tsx`, `routes/audit.ts` | browser | endpoint autenticado; fila de até 50, flush 5 s/20 itens/beacon. |
| Erro React/JS | `AuditErrorBoundary.tsx`, tracker | browser | `ui.error`; dedup 60 s, máximo 20/sessão. |
| Audit Prisma | `prisma-audit.ts`, `prisma.ts` | extensão Prisma | `db.*`; reads amostráveis, writes/erros sempre que habilitado. |
| Eventos de negócio | `transacao-log.ts`, `business-metrics.ts` | rotas e serviços | PostgreSQL `TransacaoLog`, audit e métricas OTel. |
| Traces/métricas | import Elastic OTel, `business-metrics.ts` | instrumentação automática e calls explícitos | collector/Elasticsearch; tail sampling: erros, >=500 ms e 15% restante. |
| Saúde API/DB | `health.ts`, `app.ts` | `/api/health`, `/api/ready` | watchdog, smoke e httpcheck. |
| Infra | `otel-collector-config.yml` | httpcheck/tcpcheck/hostmetrics | dashboards/alertas; coleta a cada 60 s. |
| Kibana | `deploy/observability/*.ndjson`, `*.json` | scripts `scripts/observability/` | dashboards, data views, saved search 4xx, regras. |
| Alert Poller | `kibana-alert-poller.ts`, `alert-poller-worker.ts`, `alert-poller-state.ts` | busca `quiver-tap-alert-events` | e-mail/Telegram; estado local `deploy/runtime/alert-poller-state.json`. |
| Ops Panel | `ops-panel/`, `scripts/prod/*ops-panel*` | scripts/status/release gate | operador local; log de override em `deploy/logs/ops-panel.log`. |
| Support Agent | `support-agent/` | alertas ES | modo sombra cria Issues; fixer é opt-in e isolado. |
| Deploy/recovery | `scripts/prod/deploy.ps1`, `_config.ps1`, `rollback.ps1`, `restore-drill.ps1` | deploy e scripts prod | `manifest.json`, `release-history.json`, recovery state, backups e logs locais. |

Não foi encontrado no repositório agente de observabilidade do navegador (Sentry/OTel web), APM de banco, exporter de PostgreSQL, nem um coletor dedicado ao Cloudflare Tunnel.

## 3. Modelo de evento e contexto atual

`emitAuditEvent` grava `event.category=audit`, `event.action`, `event.outcome`, `message`, horário local/UTC do exporter, tenant, ator, dataset/namespace, índice alvo e `trace_id`/`span_id` quando há span ativo. Campos HTTP, DB, UI, entidade e `metadata` são opcionais. O logger acrescenta dados de contexto, mas não cria `requestId`.

| Campo | Backend | Frontend | Socket | Negócio | Infra | Deploy |
|---|---|---|---|---|---|---|
| timestamp | consistente (`@timestamp`/audit) | parcial (timestamp enviado, ingestão é posterior) | parcial (Pino só em negação) | consistente | consistente | consistente |
| level | parcial (Pino; audit emitido como info) | inexistente como severidade | parcial | parcial | parcial | parcial |
| service/environment | parcial (OTel/env, `observabilityEnv`) | inexistente no payload | inexistente | parcial | consistente | parcial |
| userId / ator | consistente em requests com sessão resolvida | indireto, resolvido no servidor | parcial em negação cliente | consistente quando `usuarioId` é passado | inexistente | operador não padronizado |
| tenant | consistente em requests autenticados/públicos resolvidos | indireto | parcial em negação cliente; não em joins | consistente | não se aplica | inexistente |
| role | parcial (contexto não inclui papel) | inexistente | inexistente | parcial em dados de origem | inexistente | inexistente |
| requestId/correlationId | inexistente | inexistente | parcial: lê header apenas ao negar auth | inexistente | inexistente | inexistente |
| traceId/spanId | parcial/consistente com span ativo | inexistente | inexistente | parcial, herda contexto | consistente se instrumentado | inexistente |
| route/method/status | consistente para mutações e >=400 | não | inexistente | parcial | HTTP check apenas | smoke endpoints |
| duration | parcial (traces automáticos; não no audit HTTP/DB) | inexistente | inexistente | cozinha possui métrica | consistente para probes | consistente para operação inteira |
| action/entity/result | parcial HTTP | parcial (`ui.*`) | negação apenas | consistente em transações | parcial | consistente |
| erro/stack | parcial (erro HTTP e process handler; Pino) | parcial (`ui.error`, stack truncado) | razão de negação | falha ao persistir log | probes | resumo redigido |
| release SHA/version | inexistente em eventos da API | inexistente | inexistente | inexistente | inexistente | consistente no manifesto/ledger |

Classificação: “consistente” significa preenchido pelo produtor daquela camada; não significa que esteja disponível no mesmo índice/alerta em produção sem validar configuração e ingestão.

## 4. Cobertura por camada

### Backend HTTP

`registerAuditHooks` é registrado antes das rotas em `app.ts`. Para API, gera `http.<método>` em mutações e em respostas >=400. Inclui método, template da rota, status, body redigido de mutações e parte do erro de resposta. O handler global normaliza 400/401/status explícito, registra exceções no span e loga 500.

Coberto: recebimento/contexto (exceto rotas excluídas), resposta, 4xx/5xx, autenticação/autorização via sinal HTTP, exceções 500, audit de argumentos e erros Prisma, e trace automático potencialmente com duração.

Parcial/ausente: não há evento separado de request recebido; `duration` não é copiado ao audit; `requestId`/`correlationId` não existe; GET 2xx é omitido; `/health`, `/ready`, `/audit/events`, webhook e assets são totalmente excluídos; polling de cozinha/ranking/portal público é excluído em GET. Não há classificação de timeout, lentidão, erro de pool, deadlock ou cross-tenant além da rota/status/mensagem.

**É possível reconstruir uma requisição problemática?** Parcialmente. Para uma mutação/erro há rota, status, ator/tenant quando resolvidos, payload redigido e possivelmente trace com SQL. Não é possível escolher uma requisição individual de forma confiável a partir de um request/correlation ID, nem ligar uma UI batch a ela de modo determinístico.

### Frontend

O tracker global é montado em `App.tsx` via `AuditTracker`; captura mudança de rota SPA, clique de `button/a/[role=button]/[data-audit]`, submit, `window.error`, `unhandledrejection` e erro capturado por `AuditErrorBoundary`. Eventos são autenticados no servidor como staff ou cliente. Cliques críticos de quiosque já usam vários `data-audit` semânticos.

Não há `x-request-id` gerado no wrapper `frontend/src/lib/api.ts`, não há telemetria explícita de resposta HTTP/latência/falha de rede, nem identificação cliente/tenant no payload do browser (o backend resolve sessão). `sendBeacon` no unload não inclui `credentials: include` explícito e sua entrega não é garantida. O PWA/service worker existe (`src/sw.ts`), mas falhas dele não são instrumentadas. O cliente Socket.IO reconecta e refaz joins, sem logs/telemetria.

**“Cliquei e não funcionou”**: normalmente se pode descobrir ator/tenant após ingestão, tela, clique/label e erro UI se um ocorreu. Não se sabe de modo determinístico qual HTTP foi disparado nem se o clique iniciou uma requisição que falhou, pois ambos são eventos distintos sem ID comum. Falhas HTTP tratadas pela UI podem nunca aparecer como `ui.error`.

### Socket.IO / realtime

O servidor revalida sessão staff e cliente. Para portal, valida evento, geração, comanda e cliente antes de entrar nas salas. Para staff, impõe tenant em `join:cervejaria` e consulta evento do tenant antes de `join:evento`. `socket_auth_denied` é logado com razão e, quando disponível, tenant/evento/comanda. O cliente reconfigura salas após `connect`.

Não há logs/audit para conexão aceita, disconnect, tentativa/resultado de join, leave, reconexão, salas concedidas, emissões servidor→cliente, eventos recebidos ou falha de entrega. As recusas de room retornam silenciosamente; não há contador/alerta de abuso. `x-request-id` é apenas lido em falha de auth; o frontend não o gera.

### Autenticação e segurança

Login/logout staff e portal passam por hooks HTTP e, sendo POST, deixam audit HTTP; login falho/401/403 também deixa HTTP audit salvo exceção esperada de `GET /api/auth/me` 401. Cookie/JWT não é gravado intencionalmente: Pino redige authorization/cookie e `redactObject` redige senhas, token/JWT/cookie/secret e mascara telefone. A autenticação Socket registra token ausente/inválido, payload inválido e sessão cliente inválida sem incluir o token.

Faltam eventos semânticos (`auth.login_success`, `auth.login_failure`, `auth.logout`, `auth.authorization_denied`, `security.cross_tenant_denied`) com papel, motivo seguro e alvo. O contexto de telemetria tem ator mas não o `papel`; ADMIN é classificado como `actor.type=system`, o que reduz precisão de auditoria humana. Negações de join de sala e decisões cross-tenant silenciosas não são rastreáveis.

### Database / Prisma

`prisma.ts` aplica extensão `createPrismaAuditExtension`. Quando `AUDIT_SQL` não é false/0, writes e erros são emitidos; reads obedecem `AUDIT_SQL_SAMPLE_RATE` (default 1). Inclui modelo, operação e resumo de argumentos redigidos, com exceções/erro emitidos como falha. `TransacaoLog` é excluído para não duplicar a audit de negócio. `ready` executa `SELECT 1` e reporta latência.

Não há medição explícita de duração por query no audit, parser/classificação de erros Prisma, métrica de pool/conexões, timeouts, transações abortadas, locks/advisory locks/deadlocks, nem distinção segura e objetiva entre indisponibilidade do banco, concorrência e erro da aplicação. O readiness permite dizer que o `SELECT 1` falhou, mas não diagnostica a causa.

**Banco lento/transação falha:** há sinal parcial de operação/erro, e de latência apenas do readiness e traces amostrados. Não há sinal suficiente para distinguir confiavelmente as quatro categorias pedidas.

### Infraestrutura, Ops Panel e watchdog

O collector verifica a cada 60 s API PRD/DEV/local, URL pública e TCP PostgreSQL 5432/5434; coleta CPU, memória, disco, paging e load do host. A API oferece liveness simples e readiness dependente de banco. Alert poller possui endpoint local `127.0.0.1:3098/health`. Scripts de produção controlam PID, portas e logs para API, alert-poller, Ops Panel e watchdog; `watchdog-daemon.ps1` chama `ensure-running.ps1` a cada 60 s.

Há dashboards para PRD/DEV, infraestrutura, negócio, SLO e agente. Não foi encontrado probe/telemetria centralizada de processo do frontend, Cloudflare Tunnel, Docker daemon/container health, watchdog, Ops Panel ou Support Agent no mesmo nível dos sinais OTLP (alguns têm status/PID local). Elasticsearch possui alerta de cluster; Kibana é consultado por scripts, mas não há health check/alerta dedicado verificável no collector.

## 5. Cobertura por jornadas de negócio

`registrarTransacao` persiste primeiro em `TransacaoLog`, emite `transacao.<tipo>` com entidade/metadata e registra métrica. Ele é chamado pelas rotas/serviços de comandas, eventos, pedidos, vendas avulsas e quiosque. A lista abaixo é evidência de código, não prova de entrega no Elastic em um ambiente executando.

| Jornada | Evidência e cobertura | Reconstrução QUEM→O QUÊ→TENANT→ENTIDADE→RESULTADO→ERRO→HORA |
|---|---|---|
| Comanda | `COMANDA_CRIADA`, item adicionado/removido, desconto, fechada e cancelada em rotas/serviços; `fechar-comanda.ts` também mede venda. | Boa para sucesso e transação registrada; parcial para erro de domínio antes da transação. |
| Caixa quiosque | aberto, movimento, fechado e correção em `routes/quiosque/caixa.ts`; modelo liga original/correção, motivo, solicitante/autorizador e data. Métrica de divergência. | Boa; before/after genérico permanece parcial. |
| Cozinha | pedido criado/status por `quiosque/comandas.ts` e `quiosque/cozinha.ts`; métrica de tempo até preparo. | Parcial: ator/tenant/pedido/hora funcionam nas transações, mas bloqueios e falhas de transição não têm taxonomia própria. |
| Mesas/quiosque | comanda, venda avulsa, pedido e grupo de comandas são transações. | Parcial: não há sinal canônico de ocupar/liberar mesa. |
| Estoque | entradas/movimentos são registrados em `quiosque/estoque.ts`; venda pode gerar movimento derivado. | Parcial: consumo/ajuste identificáveis, mas falta sinal específico de falta, conflito/concorrência e inconsistência. |
| Portal cliente | criação/recusa de pedido portal e audit UI autenticada por cookie cliente. Sessão portal é revalidada em HTTP e Socket. | Parcial: pedido e identidade podem ser reconstruídos; abertura/logout/desconexão e vínculo do socket não. |

Sinais de business health existentes: contador de comandas fechadas, valor vendido, duração de preparo de cozinha, divergência de caixa e total/falha de transação, além dos dashboards/regras SLO. Sinais ausentes ou insuficientes: taxa de conversão do portal, pedidos pendentes/atrasados, pagamentos iniciados versus concluídos, fechamento bloqueado, ruptura de estoque, idade de comandas abertas, sessão/entrega de Socket e taxa de erro por jornada.

## 6. Auditoria e before/after

| Domínio | Cobertura | Evidência/limite |
|---|---|---|
| Correção de caixa | Completa para trilha contábil | Modelo `MovimentoCaixaQuiosque` preserva original, `correcaoDeId`, natureza, motivo, solicitante, autorizador e datas; transação de negócio é emitida. |
| Estoque | Parcial | Há movimentos e saldo materializado; não há contrato universal de valor anterior/novo nem motivo obrigatório em todos os ajustes. |
| Configuração/admin | Parcial | HTTP audit registra mutação e body redigido; não há evento semântico before/after comum. |
| Usuário/permissão | Parcial | Rotas mutantes são auditadas por HTTP/Prisma; não há modelo de auditoria de concessão/revogação com valores antes/depois. |
| Clientes | Parcial | exclusão/alteração passa por audit HTTP/Prisma; não há before/after semântico padronizado. |
| Quiosque | Parcial | transações específicas cobrem operação; configuração não tem garantia de before/after. |

`metadata.payload` e o resumo Prisma podem carregar dados úteis para diagnóstico, mas não substituem um contrato de auditoria: o conteúdo é variável por chamador e não permite comparar automaticamente todos os estados antes/depois.

## 7. Correlação end-to-end

O elo backend é razoável: o hook estabelece `AsyncLocalStorage`, atributos de span e Pino; `emitAuditEvent` lê span ativo e escreve `trace_id`/`span_id`; a extensão Prisma executada dentro do contexto pode compartilhar o trace. O collector mantém traces de erro, lentos (>=500 ms) e 15% dos demais.

As quebras são:

1. Frontend não cria `requestId` nem envia `traceparent`/correlation ID na API.
2. `ui.*` vai em lote posterior para `/api/audit/events`; mesmo click e HTTP não compartilham trace.
3. Backend não adiciona ID próprio de request, duração auditável, nem release SHA aos eventos.
4. Socket não cria/propaga contexto OTel e não audita lifecycle ou emissão.
5. Logs técnicos não auditáveis podem ficar só nos arquivos locais/Pino; a documentação do Support Agent registra que produção não possui `logs-generic.otel-prd` e os audit logs chegam com severidade `info`.
6. Deploy/release é rastreado em arquivos locais, sem enriquecimento automático dos eventos de aplicação.

Hoje, a investigação operacional usa `trace_id` para HTTP↔Prisma quando presente, e timestamp + ator + tenant + entidade para ligar demais eventos. Isso é útil, mas não satisfaz correlação automática confiável de frontend→HTTP→backend→Prisma→Socket→negócio→infra→release.

## 8. Alertas

As regras versionadas incluem: API down/ready (PRD e alguns DEV), URL pública ready, TCP PostgreSQL, Elasticsearch não verde, event loop alto, 5xx, surto 401, `ui.error`, falha de transação, lacuna de telemetria, e SLO de disponibilidade, falha de transação e cozinha lenta. As frequências são 1 ou 5 minutos. Exemplos de thresholds declarados: 5xx >2/5 min, 401 >10/5 min, SLO de falha de transação 5 e regras de disponibilidade em 1 min; a semântica final depende do JSON importado no Kibana.

O Alert Poller consulta `quiver-tap-alert-events` a cada 30 s (mínimo configurável 10 s), lê até 50 eventos por vez, usa `lastPollIso` e até 2.000 IDs processados no arquivo local, e marca ES como `processed` em best effort. E-mail e Telegram podem coexistir; a API só inicia poller com flag explícita, enquanto o worker standalone inicia quando há canal configurado e não foi desabilitado.

| Classe | Regras/sinais |
|---|---|
| Infraestrutura | API/public ready/down, Postgres TCP, ES cluster, event loop, availability burn, telemetry gap. |
| Aplicação | 5xx, `ui.error`, 401 surge. |
| Segurança | 401 surge; negações socket chegam só como log, sem regra dedicada. |
| Negócio | `transacao.failure`, SLO de falha de transação e cozinha lenta. |

Riscos de falso positivo/negativo: 401 pode refletir expiração/uso normal; event loop/telemetry gap dependem de ingestão; estado local perdido reabre janela de 2 min; eventos além de 50 em uma rodada podem atrasar; marcar `processed` é best effort; alerta não prova que canal de notificação está configurado ou que Telegram entregou a mensagem. Não há regras comprovadas para socket, pagamentos, ruptura de estoque, watchdog/túnel/Ops Panel ou falha de deploy.

## 9. Support Agent atual

O Support Agent lê alertas do Elasticsearch, enriquece evidências, classifica e deduplica por fingerprint. Alertas de infraestrutura seguem o fluxo de notificação e não abrem Issue; alertas acionáveis podem abrir Issue no GitHub. O README declara **modo sombra** padrão: abre Issues e nunca corrige código. Não usa modelo de IA diretamente no processo de triagem; o fixer opcional chama Cursor CLI headless com `SUPPORT_AGENT_MODEL` opcional.

Ele pode abrir Issues e, somente quando sair do modo sombra e o fixer estiver habilitado, criar worktree fora do repositório principal, aplicar correção, validar e abrir PR. Não faz merge ou deploy. Há kill switch em `deploy/runtime/support-agent-fixer.disabled`, flag de ambiente, allow/deny list de caminhos, worktree isolado, 2 tentativas por fingerprint, 3 PRs/dia, até 6 execuções/dia, timeout de 20 min e limite de custo estimado. O preço não é observável por execução no stream do Cursor; o limite de gasto é indireto.

**Pronto para IA autônoma? Não.** A configuração segura atual é sombra + correção desabilitada, e o próprio README registra ausência de stacks e de logs técnicos no índice genérico de PROD. O modelo não é suficiente para superar dossiês sem evidência; manter revisão humana e bloqueio de deploy é correto.

## 10. Segurança, redação e privacidade

Não foram reproduzidos segredos e esta auditoria não inspecionou arquivos `.env` não versionados. O escaneamento de arquivos rastreados e a leitura de código não encontraram um segredo literal comprovado. A avaliação abaixo trata superfícies de risco, não vazamento confirmado.

| Achado | Severidade | Evidência e impacto |
|---|---|---|
| Não há vazamento confirmado de segredo versionado | — | Pino e `redactObject` redigem autorização, cookie, senha, token/JWT, secret e alguns nomes de variáveis. |
| Redação incompleta por nomes alternativos | Média | Pino usa uma lista curta e `redactObject` compara algumas chaves; `apiKey`, `accessToken`, `refreshToken`, connection strings e nested headers fora dos paths previstos podem escapar se incluídos em `metadata`/erro. |
| Erro/stack e body mutante podem conter PII | Média | UI envia stack até 2.000 caracteres; process handlers e request audit podem enviar mensagem/stack/body redigido. Telefone é mascarado, mas e-mail, nome, endereço e campos livres não são genericamente minimizados. |
| Console error em processo sem contexto | Média | `process-handlers.ts` usa `console.error(err/reason)` no fallback e no processo; exceções que incorporem dados sensíveis podem ir ao log local sem a redação do audit. |
| Credencial em URL de configuração | Baixa | poller/agent registram URL de ES no startup; se uma URL operacional contiver credencial embutida, ela não é explicitamente redigida. A configuração prevista usa API key/header, não URL com senha. |

Não foram encontrados logs de senha/JWT/cookie intencionais em audit/socket. O relatório não contém valores de token, cookie, connection string ou dados pessoais.

## 11. Gap register

Impacto e probabilidade usam Baixo/Médio/Alto; prioridade aplica o filtro de simplicidade: só é P1 se reduz claramente tempo para encontrar/explicar problema real de cliente ou PROD.

| ID | Área | Gap | Impacto | Prob. | Prioridade | Esforço |
|---|---|---|---|---|---|---|
| G-01 | Correlação | Sem request/correlation ID frontend→API→audit; UI batch não liga à ação HTTP. | Alto | Alto | P1 | Médio |
| G-02 | Frontend | Wrapper HTTP não registra resultado, duração, rede/offline ou vínculo com clique. | Alto | Alto | P1 | Médio |
| G-03 | Socket.IO | Sem observabilidade de connect/disconnect/reconnect, join permitido/negado, salas e emit/receive. | Alto | Médio | P1 | Médio |
| G-04 | Logs técnicos | Produção pode não exportar logs Pino técnicos fora de audit e severity de audit é info. | Alto | Médio | P1 | Médio |
| G-05 | Banco | Sem duração/classificação Prisma, pool, timeout, lock/deadlock e transação abortada. | Alto | Médio | P1 | Médio |
| G-06 | Segurança | Login/logout/negações/cross-tenant não têm evento semântico com role e alvo seguro. | Médio | Médio | P1 | Baixo |
| G-07 | Release | Eventos de API não trazem SHA/release; correlação incidente→versão depende de horário/manifesto local. | Médio | Médio | P1 | Baixo |
| G-08 | Auditoria | Before/after e motivo não são contrato comum para config, usuários, clientes e estoque. | Médio | Médio | P2 | Médio |
| G-09 | Business health | Falta sinal de pagamentos, ruptura/idade de estoque, pedidos pendentes e fechamento bloqueado. | Médio | Médio | P2 | Médio |
| G-10 | Infra | Túnel, watchdog, Ops Panel, Docker e Kibana não têm telemetria/alerta centralizada comprovada. | Médio | Baixo | P2 | Médio |
| G-11 | Privacidade | Redação/minimização não cobre todos os nomes alternativos e textos livres. | Alto | Baixo | P2 | Baixo |
| G-12 | Alertas | Sem prova automatizada de entrega/falha de notificação e sem alertas de Socket/jornadas restantes. | Médio | Médio | P2 | Médio |

P0: **0**. Não há evidência no código auditado de cegueira que por si só implique perda imediata de dados/segredo ou bypass de segurança. Esta não é uma declaração de ausência de vulnerabilidades fora do escopo.
P1: **7** (G-01 a G-07).

## 12. Plano recomendado — TQ-OBS-02

Nenhuma onda deve ser iniciada por este ticket. Antes de cada mudança, validar no ambiente de teste e manter volume/PII sob controle.

### Onda A — gaps críticos de diagnóstico

1. Definir um único `correlationId` gerado no frontend para cada ação/requisição, propagado por header, contexto Fastify, audit e log; aceitar `traceparent` se a instrumentação escolhida suportar isso sem duplicidade.
2. Criar eventos semânticos mínimos de segurança para login sucesso/falha, logout, autorização/cross-tenant negada e join Socket recusado, sem tokens/cookies e com papel/alvo seguro.
3. Garantir que erro técnico relevante tenha nível/severidade correto e chegue ao Elasticsearch, validando ingestão de Pino sem criar segundo pipeline concorrente.

### Onda B — jornada do usuário

1. Instrumentar o wrapper `api` com método/rota/status/duração/erro de rede e o mesmo correlation ID, com amostragem e sem corpo sensível.
2. Registrar lifecycle Socket e decisões de room; registrar eventos de domínio no servidor, não todo payload realtime.
3. Adotar `data-audit` apenas nos controles críticos ainda ambíguos e eventos de negócio que expliquem pagamento, pedido e bloqueio de fechamento.

### Onda C — diagnóstico operacional

1. Medir duração e classificar erros Prisma de forma segura; adicionar sinais de pool/timeout/lock somente se a biblioteca/driver expuser esses dados sem instrumentação invasiva.
2. Inserir identificador de release no resource OTel/logs e alinhar com manifesto/ledger para responder a versão no incidente.
3. Centralizar health mínimo de watchdog, tunnel, Ops Panel, Docker/Kibana somente para componentes operados em PROD e com ação clara associada.

### Onda D — opcionais

1. Contrato before/after seletivo para correção de caixa, estoque, permissões e configurações administrativas.
2. Métricas de business health (pedidos atrasados, fechamento bloqueado, estoque crítico) após definir quem reage a cada alerta.
3. Dashboards adicionais apenas para sinais que tenham runbook e decisão operacional concreta.

## 13. O que não vale implementar agora

- Tracing manual de cada clique, cada emit Socket ou cada query: aumentaria custo/ruído sem resolver a ausência de um ID comum e de semântica de negócio.
- Dashboard novo para cada módulo antes de validar entrega e utilização dos dashboards/regras já versionados.
- Métricas de cardinalidade alta por usuário, comanda ou request ID.
- Exporter completo de PostgreSQL/infra se não houver capacidade de reagir a pool/lock/IO; comece por classificação de falhas reais.
- IA autônoma para corrigir/deployar incidentes: o Support Agent permanece corretamente em sombra e com PR/revisão humana.
- Registrar bodies completos, tokens, headers ou payloads Socket para “melhorar” correlação; isso pioraria a privacidade.

## 14. Validação e limites da evidência

Foram inspecionados os produtores e consumidores relevantes, arquivos de configuração do collector/Kibana, regras de alerta, scripts de PROD, schema Prisma e Support Agent. A presença de manifests/regras não comprova que credenciais, collector, data views, regras, canais ou serviços estejam ativos em PROD; essa validação exigiria acesso operacional, explicitamente fora deste ticket.

Validação obrigatória após criar este documento: `git diff --check`. Não foram executados deploy, migration, alteração de dashboard, alteração de código funcional, chamada a PROD ou alteração em arquivos de produção.
