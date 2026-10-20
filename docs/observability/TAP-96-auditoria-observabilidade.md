# TAP-96 — auditoria de observabilidade do TAP Quiver

Data da auditoria: 2026-10-19 (America/Sao_Paulo)

Revisão de código: `e39b2e6d091906ff414fbaff3c93d2c55693c25b`
Estado: diagnóstico de código e configuração concluído; validação operacional e de ingestão pendente.

## Resumo

Há uma base útil para investigar falhas de API: `correlationId`, `requestId`, contexto de release, eventos HTTP de mutação/falha, sinais técnicos de lentidão/falha Prisma, logs de autorização e salas Socket.IO segregadas. Isso não equivale a auditoria completa de cada consulta ou jornada. Consultas HTTP bem-sucedidas são deliberadamente omitidas, chamadas SQL bem-sucedidas não são auditadas por padrão, o trace é amostrado e a fila de eventos de UI é volátil.

O defeito crítico de atribuição do portal PDV foi corrigido neste branch: `cliente_pdv_token` passa a identificar ator e tenant pelo JWT assinado, e o endpoint de auditoria passa a aceitar esse cliente quando sua comanda continua aberta. Slugs públicos passam a ser confirmados no banco antes de selecionar um dataset. Dois testes unitários cobrem a atribuição por token e a rejeição de slug inexistente. A emissão, ingestão e busca dessa correção ainda precisam ser comprovadas em DEV.

Não há base para declarar cobertura percentual ou total. O repositório contém **211 declarações de métodos HTTP** (`GET/POST/PUT/PATCH/DELETE`), **52 modelos Prisma**, **25 nomes distintos de ação `data-audit`** (29 marcações no código) e **20 arquivos de regras Kibana**. Esses números definem o inventário estático; não são o denominador de jornadas comprovadas. A matriz abaixo classifica as áreas do produto, mas os casos operacionais reais não foram executados nesta auditoria.

## Fixação da versão e limite de ambiente

| Fonte | Evidência | Resultado |
|---|---|---|
| `main` local e referência local `origin/main` | `git rev-parse HEAD` | `e39b2e6d091906ff414fbaff3c93d2c55693c25b` |
| PROD local `127.0.0.1:3001/api/health` | `/api/health` | `releaseSha=e39b2e6d` (somente prefixo exposto pela API) |
| DEV local `127.0.0.1:3002/api/health` | `/api/health` | `releaseSha=e39b2e6d091906ff414fbaff3c93d2c55693c25b` |
| Readiness PROD e DEV | `/api/ready` | `ready`; o código verifica PostgreSQL, não Elasticsearch |
| GitHub `origin/main` remoto | `git ls-remote origin refs/heads/main` | não consultável: conexão com `github.com:443` bloqueada |
| DEV público | hostname e API | a aba do navegador abriu o portal; chamadas do shell ao hostname foram bloqueadas |
| Cloudflare Tunnel | API Cloudflare somente leitura | túnel `quiver` saudável, configuração remota versão 15; `tap` vai à porta local 3001 e `tapdev` à 5202; quatro conexões reportadas |
| Docker/Collector | `docker compose ps` | não consultável: acesso negado ao named pipe do Docker; a interpolação também não tinha `POSTGRES_DEV_PASSWORD` no ambiente do shell. Nenhum valor de segredo foi lido ou impresso. |
| Elasticsearch/Kibana locais | GETs somente leitura | Elasticsearch respondeu `401` sem autenticação; Kibana respondeu `503` |
| VS Code | inventário do computador | não estava disponível como janela/app controlável nesta sessão; inspeção técnica foi feita no workspace e no navegador conectado ao DEV |

As APIs locais respondem; isso não confirma que o tráfego público chega à mesma instância nem que o collector ativo carrega os arquivos versionados. A configuração de Cloudflare confirmou DNS proxied e CNAME de `tapdev` para Cloudflare Tunnel. Isso prova a rota pública pelo túnel, mas não prova as regras do firewall do host nem exclui acesso direto à máquina por outro endereço.

## Mapa da arquitetura e fluxo do sinal

```mermaid
flowchart LR
  Browser[Frontend / PWA] -->|HTTP + X-Correlation-Id| API[Fastify API]
  Browser -->|ui.page_view / ui.click / http.request.completed em lote| Audit[/api/audit/events]
  API -->|HTTP audit| AuditRecord[Audit event]
  API -->|Pino técnico + Prisma slow/failure| Logs[Logs]
  API -->|traces, metrics, OTel logs| Collector[EDOT Collector]
  AuditRecord -->|OTel Logs API e Pino| Collector
  API --> PG[(PostgreSQL)]
  API <--> Socket[Socket.IO]
  Collector --> ES[(Elasticsearch)]
  ES --> Kibana[Kibana / regras / painéis]
  Kibana --> AlertIndex[(índice de alertas)]
  AlertIndex --> Poller[alert poller] --> Notify[SMTP / Telegram]
  CF[Cloudflare DNS + Tunnel] --> API
  CF --> Frontend
  CF --> Kibana
```

**Componentes observados no código/configuração versionada:** frontend React e PWA; Fastify HTTP; Socket.IO; PostgreSQL/Prisma; worker do alert poller e Ops Panel; Cloudflare Tunnel; Collector OpenTelemetry `otel/opentelemetry-collector-contrib:0.130.1`; Elasticsearch; Kibana; SMTP/Telegram conforme configuração. Push Web é opcional e depende de configuração de assinatura. Não foi comprovado um worker durável de jobs de negócio separado do processo da API; rotinas assíncronas usam processos/temporizadores e funções do backend.

`/api/ready` depende apenas do `SELECT 1` em PostgreSQL (`backend/src/lib/health.ts`). Uma indisponibilidade do Elasticsearch não deve, pelo código, derrubar readiness. O alert poller usa intervalo em memória e estado local. O Ops Panel atualiza sua tela a cada 30 segundos.

### Destinos declarados versus efetivos

- O código declara `data_stream.dataset=audit_<slug>` e `namespace=dev|prd` para audit; Pino usa dataset técnico global `technical`; hostmetrics publica como `infra`. Isso comprova o payload pretendido, não a existência dos índices nem ingestão atual.
- O Collector versionado recebe OTLP, usa `transform/namespace`, `tail_sampling` apenas no pipeline de traces e `batch` nos pipelines. Não há fila persistente ou `sending_queue` explícita no YAML. O tail sampler mantém decisões em memória; não há prova de comportamento de recuperação após reinício.
- O compose declara `deploy/observability/.env.observability`, mas a sessão não conseguiu consultar o processo/container ativo. Não lemos arquivos de segredo.
- Não foi possível confirmar aliases/data streams, ILM efetivo, atraso de ingestão, erros de exportação, tamanho/saúde do Elasticsearch ou configuração real do Kibana.
- O Pino e `emitAuditLogRecord()` emitem o mesmo evento por dois caminhos: log estruturado Pino e OpenTelemetry Logs API. A emissão dupla está no código; documentos duplicados no Elasticsearch não foram contados e, portanto, não são afirmados.

## Contrato global de sinais

| Ação | O que o código emite | Limite verificado |
|---|---|---|
| Requisição HTTP | `http.<method>` para métodos de mutação e erros; rota Fastify, status/outcome, `requestId`, `correlationId`, release | `GET` 2xx é omitido; só alguns GETs são ignorados por polling porque todos os demais também não geram evento de sucesso. Rotas de health/readiness/audit batch/webhook têm exclusões explícitas. |
| Frontend HTTP | `http.request.completed` com rota sem query, status, duração, outcome e IDs | Só o wrapper `api.ts`; `downloadCsv()` faz fetch próprio e não emite o resultado terminal. A chamada do lote de auditoria não recursa pelo wrapper. |
| UI | `ui.page_view`, `ui.click`, `ui.submit`, `ui.error` | Clique/submit somente quando há `data-audit`; 25 nomes únicos/29 marcações. O texto livre do DOM não é capturado. `page_view` inclui `location.search`, que ainda pode carregar dados livres. Eventos UI e HTTP não compartilham ID de jornada. |
| Prisma | Métrica de duração/resultado de transação; Pino em operação lenta (padrão 500 ms) e erro categorizado | `prisma-audit.ts` não é conectado ao cliente atual. Sucesso rápido não produz documento `db.*`. O proxy de delegates não envolve operações do `tx` entregue pelo Prisma; transação é observada no agregado. SQL raw chamado via cliente raiz é observado, mas SQL executado pelo `tx` não herda esse proxy. |
| Trace | OpenTelemetry; tail sampling: erro, latência >500 ms e 15% probabilístico | Trace é amostrado; não é registro de auditoria. Logs/auditoria não passam pelo `tail_sampling` deste YAML. |
| Realtime | Decisões de autenticação e entrada/negação de sala têm logs técnicos com ator/tenant/reason code | Não há sinal universal de `disconnect`, reconexão, `leave`, publicação, recebimento ou entrega confirmada; a conexão do socket não compartilha automaticamente o correlation ID HTTP. |
| Banco de auditoria funcional | `registrarTransacao` persiste e emite `transacao.*` para os fluxos que o chamam | Best effort para telemetria; não é contrato obrigatório ou atômico para todas as mutações. O uso varia por fluxo. |
| Alertas | 20 arquivos JSON de regra; poller, dedup, SMTP/Telegram configuráveis | Arquivos não provam regras habilitadas, entrega dos canais ou tempo de notificação. A leitura do poller/estado e da Kibana não confirmou ciclo ativo. |

**Privacidade:** a sanitização remove chaves conhecidas como senha/token/email/endereço e mascara telefone. O redator não remove sistematicamente nomes, CPF/CNPJ ou texto livre; campos digitados dentro de `nome`, `observacao` e descrições podem permanecer. Chaves de segredo escritas em maiúsculas no conjunto de `audit/redact.ts` são comparadas após lower-case e precisam de validação por teste. Não há captura de GPS encontrada. Não registre SQL/params indiscriminadamente.

## Matriz de inventário funcional

Em todas as linhas, o contrato HTTP global acima se aplica. “Parcial” significa que existe pelo menos um caminho de sinal no código, mas a cobertura de cada resultado/rota não foi reproduzida ponta a ponta. “Não executado” significa que a jornada real, transporte e consulta não foram comprovados nesta auditoria.

| Funcionalidade / recurso | Ator e escopo esperado | Operações existentes no inventário | Eventos e limites de cobertura | Estado e evidência |
|---|---|---|---|---|
| Login, logout, sessão, recuperação/reset de senha | funcionário, admin, cliente do portal; tenant após autenticação | consultar, criar sessão, terminar sessão, reset/token assíncrono | `auth.login.*`, logout, sessão rejeitada e negação têm logs semânticos; GET `/me` 401 esperado é omitido do audit HTTP. Conteúdo de e-mail/URL deve permanecer redigido. | Parcial; `auth-observability.ts`, `routes/auth.ts`; não reproduzido no DEV. |
| Administração de empresas e configurações globais | admin como ator global; empresa alvo deve ser identificada separadamente | consultar, provisionar, alterar configuração/branding, ativar/desativar | HTTP de escrita/falha tem audit; não há campo central `tenant alvo` independente do tenant do ator. Admin pode aparecer como `system` sem a empresa afetada. | Parcial; `routes/admin.ts`; lacuna de ator versus alvo. |
| Onboarding e setup | dono/funcionário; tenant e PDV | consultar estado, avançar setup, configuração inicial | HTTP de mutação/falha; ações UI só em marcações explícitas. Sem evento funcional obrigatório para todo passo. | Parcial; `routes/onboarding.ts`, `Onboarding*`; não executado. |
| Usuários, equipe e permissões | dono/admin como ator; tenant alvo | consulta, criação, alteração de permissão, negação | HTTP de alteração e logs de autorização; sem trilha comum before/after de permissões. | Parcial; `routes/usuarios.ts`, RBAC; nenhum teste concorrente multi-tenant desta auditoria. |
| Preferências, operação, branding, capacidades e mesas | dono/administrador; tenant/PDV | consulta, alteração | GET 2xx omitido; mutation HTTP e alguns eventos explícitos; sem histórico before/after geral. | Parcial; `cervejaria.ts`, `operacao/index.ts`, configurações no frontend. |
| Catálogo, preços, opcionais, categorias, cardápios | dono/gestor; tenant/PDV | consultas, criação, edição, ordenação, exclusão/ativação | Mutação HTTP e eventual transação; leitura 2xx omitida; sucesso SQL comum sem `db.*`; categoria/PDV e dados de formulário precisam de teste PII. | Parcial; `produtos.ts`, `cardapios.ts`, `operacao/produtos.ts`, `operacao/cardapios.ts`. |
| Taps, trailers e montagem | equipe com permissão; tenant/evento/PDV | consultar, criar/alterar, ativar, montar/desmontar | HTTP; `tap-montagem:updated` realtime. Sem confirmação de entrega/evento de cada ação. | Parcial; `taps.ts`, `trailers.ts`, `realtime.ts`. |
| PDVs, caixa, turnos, abertura/fechamento e correção | operador; tenant + PDV + sessão do caixa | consultas, abrir/fechar, sangria/suprimento, encerramento/correção; concorrência crítica | escrita HTTP; eventos/transações específicos; métrica agregada de transação Prisma; logs técnicos slow/failure. GET do painel não auditado; concorrência/idempotência não exercitada nesta auditoria. | Parcial; `operacao/caixa.ts`, `PainelCaixaOperacao.tsx`; `qa:cash-overnight-disposable` existe, não executado. |
| Comandas e itens | funcionário ou cliente PDV; tenant + PDV + comanda | consultar, criar, adicionar/remover, desconto, cancelar, fechar | Mutação HTTP e certos `comanda.*`/`item:*` realtime; sucesso de leitura e queries SQL normais omitidos. Cancelamento e concorrência não reproduzidos. | Parcial; `comandas.ts`, `operacao/comandas.ts`; testes de fluxo existentes não comprovam ingestão atual. |
| Pagamentos, Pix/cartão/dinheiro, venda avulsa | caixa/funcionário; tenant + PDV + comanda/venda | consultar resumo, cobrar, confirmar, estornar, venda avulsa | HTTP de mutação/falha; métricas/transação agregada; não há garantia de evento com método/resultado seguro em cada caminho. CSV/export também bypassa wrapper. | Parcial; `pagamentos.ts`, `vendas-avulsas.ts`, `operacao/vendas.ts`. |
| Fiado, contas pendentes e cobrança | usuário autorizado; tenant + cliente/conta | consultar saldo, receber parcela/pagamento, atualização | GET 2xx omitido; POST de pagamento auditado; identificador/tenant do cliente deve ser protegido. Alertas por operação não comprovados. | Parcial; `operacao/contas-pendentes.ts`, `EventoContasPendentesPage`. |
| Cozinha, fila, status e cancelamento | cozinha/caixa; tenant + PDV + pedido | consulta/polling, avançar estado, confirmar cancelamento | GET cozinha é excluído por polling; PATCH tem HTTP audit; Socket recebe eventos de pedido; não há ACK/recebimento confirmado ou correlation universal. | Parcial; `operacao/cozinha.ts`, `realtime.ts`, `socket-auth.ts`. |
| Estoque e taps | funcionário autorizado; tenant + PDV + item | consulta, entrada/saída/ajuste/mínimo | GET 2xx omitido; mutações HTTP; SQL, evento de estoque e alertas de falta não são universais. | Parcial; `operacao/estoque.ts`, `OperacaoEstoquePage`. |
| Clientes, histórico, união e exclusão | equipe/dono; tenant + cliente | consultar lista/detalhe/histórico, criar, editar, unir, excluir, find-or-create | Mutação HTTP; sucessos GET não; PII de nomes/observações e IDs precisam de política por campo. | Parcial; `clientes.ts`, telas de clientes; nenhuma busca multi-tenant real executada. |
| Portal QR clássico | cliente/anonymous; slug validado, evento/trailer/comanda | consultar cardápio/sessão, abrir comanda, pedidos e atualização | Antes da correção, sessão `cliente_token` tinha precedência incorreta sobre slug em alguns caminhos; eventos UI antes de autenticar ficam pendentes. Realtime registra salas/sessão, sem entrega confirmada. | Parcial; `public.ts`, `cliente-session.ts`, `PortalClientePage.tsx`; sem sessão sintética reproduzida. |
| Portal QR de PDV | cliente-pdv; tenant vem do JWT, PDV e comanda | consultar catálogo/categorias/comanda, criar pedido, atualizar em lote | **Corrigido no branch:** cookie `cliente_pdv_token`, ator `cliente-pdv`, tenant do JWT e slug público validado; lote de auditoria aceita sessão com comanda aberta. Teste unitário cobre tenant contra slug adulterado e slug inexistente. | Implementação local comprovada; emissão/ingestão/busca DEV não executadas. |
| Agenda, eventos e ocorrências | dono/funcionário; tenant + agenda/PDV | consultar, criar/alterar, gerar datas async, interromper/restaurar | Mutação HTTP; operação concorrente pode usar request ID/idempotência em funções de agenda; cobertura de falha/repetição não foi consultada em Kibana. | Parcial; `eventos.ts`, `operacao/agenda-operacional.ts`, `operacao/agenda.ts`. |
| Dashboard, ranking, relatórios e exportações | dono/usuário com permissão; tenant + período | consultas, agregações, baixar CSV | GET 2xx omitido; download CSV não envia evento HTTP terminal pelo wrapper; trace amostrado não cobre por garantia. | Parcial; `dashboard.ts`, `ranking.ts`, `relatorios.ts`, `downloadCsv()` em `api.ts`. |
| PWA, atualização e Web Push | usuário/dispositivo; tenant e subscription | consultar versão, instalar, registrar/remover inscrição, notificação async | HTTP/rotina técnica parcial; envio real de Web Push e sua confirmação não executados. Ações de instalação do SO não compõem trilha de negócio. | Não executado; `push.ts`, `push-notifications.ts`, `pwa-updates.ts`. |
| Ops Panel, alert poller e configuração de observabilidade | operador/admin global | consultas de saúde, ações de alertas e entrega | API readiness consulta só PostgreSQL; 20 templates existem. PID de poller existe, mas o arquivo state local tem timestamp de 29/09 e o processo não foi validado; Kibana devolveu 503. | Não comprovado; regras efetivas, canais e alertas ao operador pendentes. |

Esta matriz descreve módulos/recursos e não dá cobertura individual dos 211 handlers. Para provar cada resultado, faltam chamadas QA/DEV com IDs sintéticos por cenário e consulta dos documentos reais. O inventário de rotas concreto é `backend/src/routes/` (34 arquivos TS, incluindo testes); a lista inclui `admin`, `audit`, `auth`, `cardapios`, `cervejaria`, `clientes`, `comandas`, `evento-caixa`, `eventos`, `observability`, `onboarding`, `pagamentos`, `pedidos`, `public`, `produtos`, `push`, `ranking`, `relatorios`, `taps`, `trailers`, `usuarios`, `vendas-avulsas` e `operacao/{agenda,caixa,cardapios,comandas,contas-pendentes,cozinha,dashboard,estoque,produtos,vendas,index}`.

## Tenant e autorização de dados

| Camada | Situação comprovada | Limite |
|---|---|---|
| Atribuição do evento | Staff usa tenant do JWT; cliente antigo usa `cliente_token`; agora cliente PDV usa tenant/ator do JWT `cliente_pdv_token`; slug de rota pública só é aceito se existir no banco | Testes concorrentes de dois tenants e sessões antigas/troca de ator não executados em QA/DEV |
| Roteamento | Audit pretende indexar por `audit_<slug>`; log técnico vai a dataset global `technical`; métricas infra vão a `infra` | Elasticsearch não autenticou e ingestão não foi consultada |
| Filtro do painel | Data views e queries versionadas filtram `data_stream.namespace` e tenant | UI não foi aberta com Discover; filtros de dashboard são filtros de consulta, não prova de autorização |
| Autorização de consulta | Não examinável nesta sessão | Elasticsearch respondeu 401 sem credencial; Kibana respondeu 503; não foi possível consultar identidade, roles, index patterns, document-level ou field-level security. Não afirmar isolamento de leitura por tenant. |

Administração usa ator global (`system`/`ADMIN`) e pode afetar outra cervejaria. O contrato atual não representa universalmente `tenant do ator` e `tenant alvo` em campos separados. Eventos globais de host/infra não devem receber cervejaria fictícia.

## Geolocalização e privacidade

- Cloudflare confirmou o Tunnel e o DNS proxied. O Managed Transform `add_visitor_location_headers` está **desativado**.
- O código não declara `trustProxy`, lê `CF-Connecting-IP`/`CF-IPCountry` ou registra país/cidade. O valor IP não está no contrato do audit atual.
- Não foi possível examinar ACL/firewall do host nem executar teste direto ao origin. O túnel encaminha para serviços em portas locais; isso não comprova que o host aceite apenas conexões do tunnel.
- Proposta mínima sem serviço externo pago: primeiro decidir se país aproximado basta. Caso sim, habilitar somente `CF-IPCountry`/visitor location no Cloudflare e confiar no header apenas quando a requisição tiver vindo pela cadeia Cloudflare Tunnel autorizada. `XX` e `T1` devem permanecer como desconhecido/Tor; ausência, VPN/proxy e fonte incerta não devem virar cidade presumida. Para região/cidade, usar os campos aproximados do Cloudflare Managed Transform; não capturar GPS.
- Não ativar a transformação nesta fase. Ela altera configuração externa e aumenta a coleta. Não há justificativa aprovada para transferir IP para outro serviço pago.
- Política recomendada para decisão: não persistir IP bruto no audit; se necessário a diagnóstico antifraude, acesso restrito e retenção curta definida pelo responsável de produto. País/região aproximados, fonte/confiança e `unknown` têm retenção e ACL explícitas, separadas dos índices por cliente. Não registrar conteúdo digitado.

Fonte oficial: [Cloudflare HTTP headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/) descreve `CF-IPCountry` e o Managed Transform de localização. A transformação ativa não foi confirmada, foi consultada diretamente e está desligada.

## Infraestrutura, alertas, retenção e recuperação

| Área | Configuração/código | Estado observado nesta auditoria |
|---|---|---|
| API e readiness | health local nas portas 3001/3002; readiness depende de `SELECT 1` no PostgreSQL | PROD prefixo SHA `e39b2e6d`, DEV SHA completo igual à `main` local; respostas locais `ready` |
| API pública / DNS / TLS / Socket.IO | Cloudflare Tunnel ativo; rotas PROD `tap`→3001 e DEV `tapdev`→5202; Socket.IO configurado junto ao servidor HTTP | Tunnel saudável/versão de config 15; TLS termina no Cloudflare, origem HTTP local no tunnel. ACL do host não verificada. |
| PostgreSQL | Prisma pool padrão `connection_limit=30`, `pool_timeout=30`; sinal TCP 5432/5434 no Collector; erros/lentidão/transactions no Prisma | Porta local 5432 respondeu; sem métricas de pool, lock/wait, I/O do PostgreSQL ou validação de backup/restore atual. |
| Host / containers | hostmetrics CPU, memória, disco I/O, filesystem, load/paging em 60s | Config do Collector não monta `/proc`, `/sys` ou filesystem do host nem usa `docker_stats`; no Docker Desktop/Windows não há prova de CPU/memória/disco do host ou de cada container. |
| Collector | OTLP local nas portas 4317/4318; batch 5 s/256; tail sampling em memória | TCP 4318 abriu localmente; Docker inacessível; sem métricas de fila, retry/drop, atraso ou heartbeat independente. |
| Elasticsearch | exporter destino interno `elasticsearch:9200`; alert template de cluster | GET sem credencial `401`; capacidade, erros, saúde, índices e ACL efetivos não consultáveis. |
| Kibana | Tunnel route para `5601`; data views/alertas versionados | GET local `/api/status` `503`; dashboards, regras habilitadas e consultas não verificadas. |
| Poller/Ops Panel/watchdog/tunnel | scripts de start/status/autostart; PID files locais | PID files de alert poller e Ops Panel foram atualizados às 22:36 e 22:53; não foi possível validar que PIDs ainda correspondem a processos saudáveis. `alert-poller-state.json` não muda desde 29/09; alerta de atraso precisa de verificação. |
| SMTP/Telegram/Web Push | configurações opcionais e testes de envio no repositório | Não executados; nenhum segredo/canal foi lido ou acionado. |
| Backup | dumps PROD locais em `deploy/backups`, mais scripts com SHA-256 e opção `OffHostDir`/retenção; restore drill versionado | Dump local mais recente `backup-prod-2026-10-19-223425.sql`, ~60.9 MB às 22:34 (aprox. 20 min antes do snapshot 22:54). Destino externo, tarefa agendada, checksum de cópia remota e restauração atual não comprovados. Não abrir/consultar conteúdo do dump. |

As regras e policies ILM em `deploy/observability/es-ilm-policy-*.json` só mostram intenção versionada. Aplicação a data streams reais, fases, idade de retenção e deleção não foram verificadas. Não se alterou retenção, índice ou permissão em PROD.

Para monitorar o próprio monitoramento, a configuração atual não dá evidência de heartbeat externo do Collector/Elasticsearch nem de alerta quando a telemetria deixa de chegar. O caminho do poller depende do ES/Kibana que também monitora. O arquivo de estado não é uma prova de entrega contínua.

Fonte oficial atual: [OpenTelemetry tail sampling](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/processor/tailsamplingprocessor/README.md) descreve estado em memória e necessidade de enviar os spans de um mesmo trace ao mesmo Collector. [Elasticsearch privileges](https://www.elastic.co/docs/reference/elasticsearch/security-privileges) documenta `read`, `view_index_metadata`, `monitor`, `read_ilm` e privilégios que permitem escrita/gestão; não foi possível comparar isso às roles efetivas da instalação.

## Consultas e roteiro de validação no Kibana

Os exemplos abaixo são **modelos não executados**. Selecionar a data view `Quiver Tap Audit DEV` e limitar a uma janela curta. Usar IDs do run sintético quando a certificação os inserir pelo caminho normal de QA. Não inserir documentos manualmente para simular instrumentação.

```esql
FROM logs-audit*.otel-dev*, logs-technical*.otel-dev*
| WHERE attributes.test.run.id == "<RUN_ID>"
| KEEP @timestamp, attributes.test.scenario.id,
  attributes.event.action, attributes.event.outcome,
  attributes.correlationId, trace_id,
  attributes.http.response.status_code, message
| SORT @timestamp ASC
```

```esql
FROM logs-audit*.otel-dev*
| WHERE attributes.test.run.id == "<RUN_ID>"
  AND attributes.correlationId == "<CORRELATION_ID>"
| KEEP @timestamp, attributes.event.action, attributes.actor.type,
  attributes.cervejaria.id, attributes.cervejaria.slug,
  attributes.requestId, trace_id, releaseSha, message
| SORT @timestamp ASC
```

```esql
FROM logs-audit*.otel-dev*, logs-technical*.otel-dev*
| WHERE attributes.test.run.id == "<RUN_ID>"
  AND attributes.test.scenario.id == "<SCENARIO_ID>"
| KEEP @timestamp, attributes.event.action, attributes.event.outcome,
  attributes.actor.type, attributes.correlationId, trace_id, message
| SORT @timestamp ASC
```

Para cada cenário, comparar o que o teste observou com os eventos reais: emissões esperadas, recebidas, repetidas, ausentes e tempo até consultáveis. Distinguir audit HTTP, `ui.*`, logs técnicos, traces amostrados e métricas. IDs test-run/test-scenario não são atualmente propagados em todos os caminhos, portanto não presumir que esses filtros retornem tudo.

## Lacunas priorizadas e trabalho sugerido

| Prioridade | Lacuna / evidência | Impacto | Próximo passo |
|---|---|---|---|
| P1 | A fila de UI é em memória, ilimitada; flush com erro repõe lote sem agendar novo flush; identidade é resolvida no servidor quando o lote chega | perda silenciosa, crescimento de memória e possível atribuição atrasada a outra sessão | Criar item Plane sugerido: **“UI audit queue: retry bounded and identity-safe”**; definir limites, abandono visível e captura segura de ator/tenant sem dados de credencial. |
| P1 | ES 401 / Kibana 503 / Docker sem acesso; ILM e roles atuais não verificáveis | operação não consegue demonstrar ingestão, retenção ou autorização por empresa | Obter sessão somente leitura com `monitor`, `view_index_metadata`, `read_ilm` e `read` apenas nos data streams necessários; confirmar roles e data views efetivas. |
| P1 | `cliente_pdv_token` e slug eram ignorados/mal confiáveis no contexto; correção local ainda sem ingestão DEV | eventos de cliente podiam ficar anônimos ou no dataset incorreto | Corrigido no branch; publicar em DEV pelo fluxo PR e executar cenários sintéticos A/B de portal antes de encerrar TAP-96. |
| P2 | GET 2xx omitido em todas as rotas; CSV bypassa wrapper; só 25 rótulos semânticos explícitos | consultas, exportações e ações de interface não formam inventário observável | Criar item sugerido **“Audit read-success and export operations in selected critical journeys”**; escolher consultas de valor operacional sem tornar polling/SQL indiscriminados. |
| P2 | Emissão audit OTLP + Pino duplicada no código; o índice não foi consultado | volume/contagem podem ser inflados ou custo duplicado | Medir documento por evento sintético e decidir manter somente um caminho de emissão. |
| P2 | Sem separação de tenant alvo em eventos admin e sem prova de ACL por tenant em ES/Kibana | filtros de painel podem ser confundidos com autorização | Criar item sugerido **“Tenant-aware observability authorization and admin target context”**; verificar roles antes de prometer isolamento. |
| P2 | Geolocalização desligada; endereço IP e retenção não têm contrato | não é possível responder país/região nem determinar confiança | Decisão de produto: país aproximado ou região/cidade; política de retenção/acesso. O caminho mínimo usa Cloudflare, sem terceiro pago. |
| P2 | Saúde de Collector, exportação, poller e canais não tem prova de heartbeat externo; estado de poller antigo | o monitoramento pode parar sem alertar | Nomear proprietário e resposta antes de ampliar Ops Panel; relacionar ao TAP-18/TAP-29 já existentes. |
| P2 | Dump recente local; off-host, agendamento e restore não comprovados | falha local pode eliminar a única cópia útil | Confirmar tarefa e destino externos com metadados/checksum; executar restore drill isolado e registrar RPO/RTO. |

Nenhum item adicional foi criado no Plane. Sugestões são títulos para decisão humana; o trabalho de infraestrutura/ACL/geo que excede a correção de atribuição permanece separado.

## Tickets relacionados lidos

| Ticket | Título | Estado / prioridade | Labels | Uso nesta auditoria |
|---|---|---|---|---|
| TAP-96 | [OBS] Revisar observabilidade de ponta a ponta das jornadas do usuário | In Progress / high | Observability, Quality | Ticket atual; aceitação exige matriz, gaps críticos corrigidos e validação DEV. |
| TAP-70 | Observability & User Activity Audit | Done / high | — | Certificação anterior cobriu uma venda simples; não prova as jornadas novas. |
| TAP-18 | [OPS-HEALTH] Ops Panel — cobertura de saúde dos componentes | Backlog / low | Ops | Pede componente com impacto operacional demonstrado antes de ampliar painel. |
| TAP-22 | [OBS-CORE] Correlação, request ID e release context | Done / none | Observability | Base de correlation/release existente; cobertura real ainda parcial. |
| TAP-23 | [OBS-AUTH] Semântica de auth/security | Done / none | Observability | Logs semânticos existem; não substituem validação de jornadas. |
| TAP-24 | [OBS-FRONT] Observabilidade HTTP frontend | Done / none | Observability | Wrapper HTTP existe; export/download foge dele. |
| TAP-25 | [OBS-DB] Diagnóstico Prisma/DB | Done / none | Observability | Lentidão/falha agregada suficiente; auditoria SQL por operação está separada e desconectada. |
| TAP-26 | [OBS-RT] Realtime lifecycle | Done / none | Observability | Auth/rooms cobertos parcialmente; entrega e lifecycle continuam sem prova. |
| TAP-27 | [OBS-AUDIT] Auditoria funcional genérica before/after | Ready / low | Observability | Evitar before/after genérico; necessidade por campo precisa de incidente/risco. |
| TAP-28 | [OBS-BIZ] Business Health simples | Ready / medium | Observability | Continua sendo gap de sinais de operação/negócio. |
| TAP-29 | [OBS-INFRA] Saúde de componentes auxiliares | Backlog / low | Observability | Requer componente, impacto, owner e ação nomeados. |
| TAP-30 | [OBS-ALERT] Jornada de alerta até operador | Done / medium | Observability | Config existe; alerta entregue/operador acionado não foi testado aqui. |

## Resultado e pendências

### Validação desta alteração

- **Causa do ENOMEM:** neste host `node.exe` é `C:\Program Files\nodejs\node.exe` v24.18.0 e npm é 11.16.0. `node -e "os.userInfo()"` reproduziu `ERR_SYSTEM_ERROR`/`uv_os_get_passwd` fora da suíte. O script `dossier-replay` chamava o CLI `tsx`, cujo módulo de diretório temporário cai em `os.userInfo()` quando `process.geteuid` não existe nesse processo. O replay direto via Node com o shim de host já usado pelos testes (`node --import ../scripts/node24-tsx-host.mjs --import tsx src/index.ts --dossier-replay`) passa. O script do pacote foi ajustado para esse mesmo lançador; o replay e todos os demais gates continuam ativos. Não foi possível consultar WMI para medir memória; portanto o erro não foi classificado como falta de RAM.
- **CI local completo:** `npm run ci` passou nas 10 etapas locais: frontend, Prisma Generate (fallback por `EPERM`; client comparado e compatível com schema), Prisma validate, backend-test (274, 272 passed, 2 skipped), backend-build, Ops Panel, Support Analyst typecheck/tests/replay/build e Pester (12/12). `realtime-security-qa` permanece exclusivo do GitHub Actions.
- **Identidade de evento e privacidade:** requests de `/api/public/*` usam a sessão de cliente correspondente ou ficam anônimos, mesmo se também houver cookie de equipe. O lote de UI aplica contexto separado por evento; sessão pública inválida não cai para ator de equipe e lote misto exige credenciais válidas para ambos os lados. A consulta de cliente PDV exige comanda aberta da origem CAIXA vinculada ao mesmo tenant, PDV e cliente. Query strings, rótulos semânticos fora da allowlist e metadados livres não entram no evento; chaves `JWT_SECRET`, `SMTP_PASS` e Telegram em maiúsculas/snake case também são redigidas. Os testes sintéticos de contexto, autorização e privacidade passaram; nenhuma jornada de negócio real foi executada.
- **GitHub:** o acesso autenticado voltou a funcionar com Git elevado. A branch `chore/tap-96-observability-audit` foi enviada e o PR [#81](https://github.com/filipedsn/cervejaria/pull/81) foi aberto. Os sete checks obrigatórios passaram para o commit `f7554e6d09247b715d75df1bc8b4b9c12528efc0`: frontend, backend-validate, backend-test, backend-build, ops-panel-test, support-analyst-test e realtime-security-qa. `npm run ci` local também passou após o ajuste mínimo na fixture de redação exigido pelo scanner de artefatos DEV.
- **DEV e PROD:** o procedimento oficial preparou e publicou no DEV o candidato do commit `f7554e6d09247b715d75df1bc8b4b9c12528efc0`. A API em `:3002` reporta esse SHA e `/api/ready` retorna `ready`; o frontend em `:5202` responde HTTP 200 e o bundle contém o mesmo SHA. A API local de produção continua em `e39b2e6d` e o PID do listener `:3001` era idêntico antes/depois da troca DEV. A página do DEV foi conferida no navegador, mas redirecionou para uma sessão de equipe já autenticada; nenhum controle foi usado e essa visita não foi considerada evidência sintética.
- **Transporte e consulta:** portas OTLP locais `4317` e `4318` aceitam conexão TCP, mas Elasticsearch `:9200` responde `401` sem autenticação e Kibana `:5601/api/status` responde `503`. Sem acesso de leitura ao índice e sem contas/atores de QA sintéticos disponíveis no DEV, não foi emitido evento de auditoria autenticado nem consultada ingestão. A cadeia `ação sintética → emissão → transporte → Elasticsearch → Kibana`, contagens/atraso/duplicidade e separação entre tenants continuam sem validação operacional.

O código permite reconstruir parte de requests HTTP de mutação/falha e alguns erros de banco. Não comprova consultas bem-sucedidas de cada recurso, todas as ações/etapas assíncronas, entrega realtime, completude de traces, ACL por tenant ou ingestão/retention atuais. A correção de atribuição PDV/cliente/equipe e minimização de campos passou nos testes sintéticos locais e nos sete checks de CI. A matriz acima mantém cobertura parcial, ausente e não executada explícita; não há base para declarar percentual ou cobertura total.

**Pendências para TAP-96:** abrir acesso operacional somente leitura ao Elasticsearch/Kibana e disponibilizar contas/sessões de QA sintéticas em dois tenants DEV, com atores e comandas válidas e descartáveis. Então executar jornadas concorrentes sem dados reais, registrar IDs de correlação/janela/contagens/atraso, consultar os eventos por empresa no Kibana e comprovar ACL, ausência de cruzamento e ILM/retention. O PR ainda segue o fluxo de merge oficial. `PROD_DEPLOY_REQUIRED=YES`: produção permanece em `e39b2e6d` e a correção de runtime não foi publicada nela; deploy de produção requer autorização específica.
