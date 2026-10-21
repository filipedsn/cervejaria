# TAP-96 — auditoria de observabilidade do TAP Quiver

> Atualização 2026-10-21: a matriz complementar que incorpora as sete jornadas TAP-114, a prova isolada de eventos/métricas de solicitação de pagamento, o filtro de payload comercial e a política mínima de metadados está em [matriz TAP-114](TAP-96-matriz-TAP-114-2026-10-21.md). Ela complementa os achados históricos abaixo; não reclassifica execuções antigas como consulta por caso.

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

## Aditivo da auditoria operacional — 2026-10-20

Este aditivo substitui as observações de estado operacional acima quando houver diferença. O relatório mantém a matriz de produto e as lacunas de código anteriores; esta atualização cobre a stack compartilhada observada após o merge do PR #81.

### Releases e disponibilidade observadas

| Componente | Evidência de leitura | Resultado em 2026-10-20 |
|---|---|---|
| Branch de auditoria | `git rev-parse HEAD` | `7b2968c6abdd53bd0d4f16505eaa5602876d7500`, `origin/main`; PR #81 já integrado por squash. |
| DEV API | `GET http://127.0.0.1:3002/api/health` e `/api/ready` | `releaseSha=f7554e6d09247b715d75df1bc8b4b9c12528efc0`; `ok` / `ready`. |
| PROD API local | `GET http://127.0.0.1:3001/api/health` e `/api/ready` | `releaseSha=e39b2e6d`; `ok` / `ready`. Nenhum deploy de produção foi feito. |
| Kibana | `GET http://127.0.0.1:5601/api/status` | `available`; container `healthy`. |
| Elasticsearch | Docker health observado em execução anterior desta mesma auditoria | versão 8.17.0, um nó, estado green; a chave de escrita do Collector não tem permissão de busca. |
| Collector | Docker e configuração montada observados | `otel/opentelemetry-collector-contrib:0.130.1`, ativo; OTLP publicado somente em `127.0.0.1:4317-4318`. |

### Ensaio sintético no Collector compartilhado

Em 2026-10-20, o runner descartável executou 18 casos Playwright em seis cenários: `SMK-S04`, `POR-S01`, `POR-S02`, `POR-X02`, `POR-X03` e `SEC-X01`. O resultado agregado foi 18 esperados, 18 aprovados, zero falhas, zero retries, zero skips e zero casos inesperados. Os casos cobriram login, abertura e envio de pedido do portal, cliente inativo, sessão ausente/adulterada/encerrada e negação entre tenants. O banco PostgreSQL foi efêmero e isolado; os dados foram sintéticos. O serviço recebeu `deployment.environment.name=development`, `test.synthetic=true` e nome único `quiver-tap-api-tap96-shared-20261020-1215`. As evidências locais do Playwright estão em `artifacts/release-e2e/e647c56c7e7f9bc52f3acf610c5caf158df0be0c/`; não foram adicionadas ao commit.

O Elasticsearch respondeu `403` à busca agregada autenticada com a chave do Collector. A chave tem escopo de escrita do pipeline e não permite leitura; a revisão automática também recusou o uso de credencial superusuária do container para contornar esse limite. Por isso o ensaio comprova os resultados funcionais das jornadas e a configuração/envio apontados pelo runner, mas **não comprova que os documentos sintéticos ficaram pesquisáveis no Elasticsearch/Kibana**, nem permite contar duplicatas, medir atraso, validar a separação por tenant no índice ou confirmar a atribuição observada nos documentos. Não foi tentada outra credencial nem alterada a stack compartilhada.

### Estado efetivo e lacunas de operação

- A configuração efetiva observada usa `transform/namespace`; o processador `filter/dev-only` está declarado e não está conectado a pipeline algum. Não o habilitar sem separar os sinais PROD, pois o filtro pode eliminar tráfego de produção.
- Os pipelines não declaram `sending_queue` nem armazenamento persistente. O `tail_sampling` guarda decisões em memória. Reinício ou indisponibilidade do destino pode perder telemetria pendente; persistência/garantia de entrega não foi demonstrada.
- `hostmetrics` não monta `/proc` ou `/sys` do host e não usa `docker_stats`; portanto os sinais de host descrevem o ambiente Linux do Collector, não métricas confiáveis do Windows hospedeiro nem de cada container.
- A chave de escrita observada autentica como `elastic` via API key chamada `quiver-collector`, mas seu descritor permite apenas `monitor` no cluster e criação/escrita/indexação em `logs-*`, `metrics-*` e `traces-*`. O padrão abrange namespaces DEV e PROD. A busca retorna 403. Não há evidência de isolamento de leitura por tenant.
- Na consulta de estado de índices feita anteriormente nesta auditoria: 498 data streams; políticas efetivas de `logs` e `metrics` tinham fase hot sem exclusão por idade; `traces` não tinha ILM. O cluster tinha 522 shards ativos de limite 1000. Não alteramos ILM ou limites. Sem credencial de leitura operacional aprovada nesta retomada, essas contagens devem ser tratadas como observação da consulta anterior, não como nova medição do ensaio.
- O hostname `kibana.quivercloud.com.br` é roteado pelo Cloudflare Tunnel para Kibana; a consulta anterior à API Cloudflare não encontrou aplicação Cloudflare Access para esse hostname. Elasticsearch e Kibana publicam portas em todas as interfaces locais. Isso registra rotas/configuração, mas não prova alcance externo, regras de firewall, nem acesso anônimo ao conteúdo. A autenticação interna do Kibana estava saudável na verificação anterior.
- A configuração da zona Cloudflare tem geolocalização por IP habilitada, mas a transformação gerenciada que adiciona cidade/região não está habilitada. O código da aplicação não consome `CF-IPCountry` ou headers de cidade/região e não registra localização. Nenhuma localização precisa é observada.
- A ausência de documentos `metrics` PROD nas 24 horas da consulta anterior não permite concluir se faltou tráfego ou instrumentação em produção. Logs e traces PROD estavam presentes naquela janela.

### Fechamento e gates restantes

Não foi identificado um ajuste seguro de código para corrigir sozinho os riscos remanescentes: retenção, ACL de Kibana, escopo DEV/PROD, fila durável do Collector e autorização de busca alteram operação ou política da stack compartilhada. Nenhum desses componentes foi modificado. O ensaio passou funcionalmente, mas o gate ponta a ponta de consulta, atraso, duplicidade e isolamento por tenant continua pendente até existir credencial read-only aprovada e uma configuração de acesso compatível.

`PROD_DEPLOY_REQUIRED=YES`. A correção de identidade do PR #81 está no DEV (`f7554e6d`) e a API PROD segue em `e39b2e6d`. Esta auditoria não autoriza deploy de produção. TAP-96 deve permanecer **In Progress** até validar busca/atribuição/tenant no Kibana, decidir e aplicar retenção/controle de acesso/fila por fluxo autorizado e revisar as lacunas da matriz. Sugestões de trabalho futuro não foram criadas no Plane.


## Atualização de retenção

A preparação segura de policies/templates, os limites de capacidade e a decisão operacional pendente estão em [TAP-96-preparacao-retencao-2026-10-20.md](TAP-96-preparacao-retencao-2026-10-20.md). Nenhuma mudança foi aplicada à infraestrutura compartilhada.

## Aditivo: inventário administrativo e saldo TAP-96 — 2026-10-20

Fonte: 24 consultas administrativas somente leitura concluídas às **17:57 America/Sao_Paulo**, endpoint `http://127.0.0.1:9200`, cluster `docker-cluster`, Elasticsearch 8.17.0. Os JSON de origem estão localmente em `docs/observability/tap96-admin-inventory-2026-10-20_175727/`; não contêm credenciais. Sem busca ou leitura de conteúdo comercial. É uma fotografia, não uma medição de tendência.

### Estado efetivo comprovado

| Medida | Resultado | Interpretação e limite |
|---|---:|---|
| Cluster | 1 nó, yellow | PROD, DEV e infra compartilham o mesmo cluster. |
| Shards | 574 primários ativos; 49 não alocados; limite efetivo 1000/node | 623 cópias demandadas, não 574. A margem numérica 377 não é orçamento operacional. |
| OTel | 540 streams, 547 backings, 23.759.951 documentos, ~2,410 GiB | Store e docs observados uma vez, sem taxa de crescimento. |
| Namespace | DEV 525; PROD 12; infra 3 | DEV domina cardinalidade; PROD não está isolado em cluster separado. |
| Famílias | logs 403 streams/405 backings; traces 132/132; metrics 5/10 | Metrics concentra 95,8% dos docs e 81,4% do armazenamento OTel. |
| ILM | 415 backings gerenciados (`logs` 405, `metrics` 10), hot-only; 132 traces sem lifecycle | Policies compartilhadas `logs`/`metrics` só têm rollover 30d/50gb; nenhuma fase delete. `failed_step=0`. |

Os 49 shards yellow são réplicas: 574 primários ativos = 574 shards ativos, sem cópias de réplica ativas; CAT indices lista 49 backings yellow com `rep=1`. Distribuição: logs 34 (33 DEV e 1 PROD), traces 10 DEV, metrics 5 (DEV 1, PROD 1, infra 3). A explicação provável é a impossibilidade de colocar a réplica no mesmo nó do primary single-node, mas o motivo atual de alocação ainda precisa da resposta de `_cluster/allocation/explain`. As 24 evidências não registram o template vencedor **no momento de criação** de cada índice. Logo, não atribuo os 49 a um template histórico sem prova. O roteiro complementar de quatro leituras mais uma allocation explain está no relatório de preparação de retenção; inclui shards `p/r`, settings de réplicas, metadados de data stream, templates atuais e deciders, sem ler documentos.

### Cardinalidade e impacto de capacidade

Classificação nominal das 540 streams: 510 com nomes/IDs de teste QA sintético (389 audit, 121 traces), 14 com slugs empresariais conhecidos e 16 system/generic/unknown. Não é fonte autoritativa de tenant nem base para exclusão. Nenhuma stream QA foi excluída e nenhum roteamento foi alterado. Metrics é volumosa; logs/traces são cardinalidade/shards pequenos. A proposta atual cobre 527 streams (395 audit DEV, 1 technical DEV, 127 traces DEV, 1 metrics generic DEV, 3 infra). Uma geração a mais em cada destino acrescentaria 527 primários, levando os primários projetados a 1.101, acima de 1.000, ainda sem contar réplicas. Com uma réplica para cada novo backing, a projeção aproximada total seria 1.677 cópias frente às 623 observadas. O template simulado não explicita `number_of_replicas`; a quantidade efetiva precisa ser revalidada. Rollover semanal/quatorzenal por todas as streams seria ainda mais caro.

Os destinos propostos são estreitos e não alteram `logs`/`metrics` genéricas compartilhadas nem Collector. Templates custom prioridade 121 venceram as simulações DEV específicas no ES descartável 8.17 e mantiveram o mapping data stream e componentes logs/OTel/TSDS incluídos na composição. As probes PROD continuaram com lifecycle atual ou nenhum; os padrões de APM continuam fora dos nomes custom estreitos na simulação. Isso prova o cenário testado, não substitui comparação de composição e prioridade no cluster real antes de qualquer rollout. Templates composable concorrentes não se mesclam automaticamente; um vencedor pode substituir os outros.

### Matriz de aceite atualizada

| Área | Estado | Evidência atual | Próximo passo |
|---|---|---|---|
| Correções runtime do PR #84 | merge comprovado; DEV e PROD locais respondem, mas não estão no SHA informado para main | main informada `c5dc13c821cd5ad76ccb8e14606bee0b83a53618`; leitura `GET /api/health` e `/api/ready` em 2026-10-20 18:23 BRT: DEV `603a2d32e6b8cef855aeeff3b71e41b599d0887e` / ready; PROD `e39b2e6d` / ready | publicar o SHA de main no DEV pelo fluxo oficial e validar; deploy PROD só com autorização explícita. |
| Login e pedido sintéticos focados | parcial | API consultou 47 docs da execução `22f8ff00ab3d3345`; Discover conferiu a janela/SHA, mas a confirmação visual individual de login 401/403 e pedido aceito não foi registrada | completar somente confirmações humanas pendentes e preservar que 47 não significa cobertura total/zero duplicidade. |
| Retenção atual | comprovado para a fotografia | 415 gerenciados hot-only sem delete; 132 traces unmanaged; policies/templates inspecionados | proprietários decidem janelas e semântica; coletar deciders e confirmar alvo/composição antes do piloto. |
| Capacidade/shards | parcial | 574 primários, 49 réplicas não alocadas, limite 1000; escala de réplica é provável single-node | obter allocation explain e settings de réplica; medir tendência semanal comparável. |
| Cardinalidade de tenant/QA | parcial | 510 nomes QA, 14 slugs conhecidos, 16 generic/system/unknown | validar ownership com cadastro; definir controle de crescimento sem apagar streams nem reescrever roteamento automaticamente. |
| Jornadas além de login e pedido PDV | ausente/parcial conforme matriz de código | inventário estático e ensaios anteriores não cobrem todas as jornadas, GETs bem-sucedidos, exportações, realtime e assíncrono | selecionar jornadas de risco e instrumentação; não repetir os 18 testes sem mudança que os invalide. |
| Geolocalização | ausente para eventos da aplicação | Cloudflare country pode existir na borda, mas a aplicação não registra país/região; cidade não habilitada | decisão de produto sobre precisão, finalidade, minimização e acesso. |
| Permissão de consulta por empresa | ausente | os filtros de painel não provam ACL; esta coleta administrativa não testou dois papéis empresariais em Discover | teste positivo/negativo com usuários empresariais separados e prova de negação cross-tenant. |
| Durabilidade/entrega | ausente | pipelines sem fila persistente explícita; tail sampling mantém estado em memória; coleta de retention não mede perda em falha | definir RPO/RTO e owner; ensaio isolado de indisponibilidade/restart e confirmação de recuperação. |
| Backup/restauração | ausente | nenhum snapshot/restauração de Elasticsearch foi comprovado nesta coleta; dump local histórico não prova cópia off-host nem restore | comprovar destino/cópia e executar restore drill isolado antes de excluir dados. |
| Retenção proposta e novos templates | parcial, descartável validado | 5 policies/templates foram criados somente no container ES 8.17 descartável; simulações DEV/PROD/infra conferiram lifecycle e composição testada | decisão concreta é piloto de `metrics-generic.otel-dev` em futuras gerações, com autorização específica e prechecks. |
| Backings existentes | ausente para efeito de expiração futura | 7 backings antigos não-write identificados: technical DEV/PROD, metrics-generic DEV/PROD e três receivers infra; traces 132 sem ILM e dois têm ~30,03 dias desde criação | inventário individual de write index, ILM age/lifecycle date, docs/store, impacto de delete, e backup restaurável. Não aplicar retroativamente. |

### Decisão e limites operacionais

Recomendação concreta: preparar como primeira etapa **um piloto futuro, estritamente em `metrics-generic.otel-dev`**, com policy própria de 45 dias após rollover e um template de nome exato só para DEV; aguardar autorização do proprietário e revalidar templates, replicas e shards no cluster real imediatamente antes. O piloto não inclui backing atual nem força rollover. Benefício: foco na família de maior volume, escopo controlado e capacidade de testar governança sem mudar policies compartilhadas. Risco: a métrica de 1,6 GiB está no backing antigo e não expira com o template futuro; réplica adicional pode ficar amarela; template 121 pode competir com composição Elastic futura. Abortar se a simulação real não preservar mapping/TSDS, se abranger PROD/infra, se o primário+réplica ultrapassar orçamento explicitamente aprovado, se houver efeito em backing histórico ou se backup/restore for requisito ainda não satisfeito.

Antes/depois do piloto: capturar winner/composição/replicas; simular nomes DEV, PROD, infra e APM; conferir policy/template efetivos e `_ilm/explain`; monitorar criação natural do próximo backing, saúde, docs/store/shards e erros. O rollback da configuração não restaura documentos eliminados. Para backings existentes é necessário plano e aprovação separados; primeiro comprovar snapshot e restauração, idade efetiva, write index, docs e store. As janelas audit 90d, technical 30d, traces 30d, metrics 45d e infra 15d seguem **não aprovadas**, salvo a hipótese proposta do piloto, que também exige aceite expresso.

Relatórios atualizados: [preparação de retenção](TAP-96-preparacao-retencao-2026-10-20.md) e este aditivo. A coleta local foi resumida; os artefatos brutos permanecem como entrada não versionada. TAP-96 continua **In Progress**. `PROD_DEPLOY_REQUIRED=YES` enquanto os gates de runtime e operação permanecerem. Merge/publicação das correções de runtime e a futura intervenção na infraestrutura de observabilidade são mudanças distintas. Nenhuma policy, template, rede, credencial, réplica, limite ou serviço compartilhado foi alterado nesta etapa.

## TAP-96 follow-up: PR #85, active releases and coverage progress - 2026-10-20

This addendum records post-merge observations. Earlier values remain historical snapshots.

### Git, DEV and production

| Source | Observed SHA/state | Evidence and limit |
|---|---|---|
| `origin/main` | `45e149aa0c7851457b0bf1980daced58c768e497` | Commit `docs(observability): registrar proposta de retencao TAP-96 (#85)`, parent `c5dc13c821cd5ad76ccb8e14606bee0b83a53618`; PR #85 is integrated. Seven PR checks and isolated `npm.cmd run ci` passed before this new change. |
| DEV `:3002` | `05b5c84a0164f0d9960404aaf0d8acd4d0d3f344`, `/api/ready=ready` | Local read at 2026-10-20 18:41 BRT and `deploy/dev-artifacts/manifest.json`, activation `2026-10-20T21:40:47.811Z`. This activity did not publish it. |
| Prior DEV commit | `6b56cb0daf6430c7a7cab8a4aabdecbd8deacbc5` | Parent `603a2d32e6b8cef855aeeff3b71e41b599d0887e`, both in branch/worktree `feat/portal-cliente-comanda-pagamento`. Current DEV `05b5c84` is a child of `6b56cb0` and changes a portal payment flow file. |
| PROD `:3001` | `e39b2e6d091906ff414fbaff3c93d2c55693c25b`, `/api/ready=ready` | Local health at 18:41 BRT exposed prefix `e39b2e6d`, resolved to the full commit. No deploy was done. |

The portal branch is active work from a separate flow. Compared with `origin/main`, revision `6b56cb0` has 19 divergent paths: 17 portal feature/migration files and two TAP-96 documents absent because the branch descends from `c5dc13c`, before PR #85. `backend/package.json` changes only the `test:unit` script list; it does not change dependencies. No lockfile differs. The `05b5c84` dependency manifest declares Node 24.18.0, npm 11.16.0 and `npm ci`. The branch is not evidence of a merge to `main`; its DEV SHAs are not TAP-96 candidates and must not be replaced without coordination.

### Focused implementation in this branch

`downloadCsv()` previously called `fetch` outside the HTTP wrapper, omitting a terminal outcome, duration, `correlationId`, `requestId` and transport failure classification. This branch emits one request signal per response or transport failure, with a route stripped of query and no payload; HTTP errors remain errors for the UI. The `page_view` signal also strips query and fragment because reset and query URLs can contain user data.

Focused tests cover CSV 200, 403, network failure, response correlation, request ID, route without query, absence of CSV content, and removal of query/fragment from `page_view`. Result: 8/8 passed. Local `npm.cmd run ci` passed all local stages in the isolated checkout; `realtime-security-qa` remains GitHub Actions only. This change covers client-side export telemetry; it does not prove audit persistence, Elasticsearch ingestion/ACL, export integrity or coverage of every report route.

### Reused functional evidence and remaining gates

The user-provided local certification material at `docs/testing/release-certification/65dc9df8677efa130a11135dc199454377df434b/` summarizes functional certification for SHA `65dc9df8677efa130a11135dc199454377df434b` (2026-10-18): 162 catalog cases, P0 80/80 in three rounds, P1 80/82, and 172/174 executions across desktop/tablet/mobile/TV. The report marks `POR-X02` and `PWA-S05` absent/skipped. This is earlier functional evidence, not proof of audit logging, database audit persistence, Elasticsearch/Discover or current runtime behavior. The local source artifact was not included in the commit.

The prior 18-case test, execution `22f8ff00ab3d3345` with 47 documents and visual confirmation of time range/SHA remain partial evidence. Forty-seven documents do not prove complete coverage, no duplicates or an SLA. Individual visual confirmation of login 401/403 and accepted order remains pending unless it exists in the corresponding human comment.

Unproven independently: staff and customer journeys outside the sample, successful reads per resource, cancellation/refund/stock, concurrency/retry, Socket.IO delivery, jobs/integrations, trusted geolocation, Elasticsearch/Kibana ACL by company, retention and growth, active alerts/channels, Collector outage/replay durability, off-host backup and restore. The previous read key was confirmed revoked and its file removed; no current read credential is available for another shared-cluster query.

The first `npm ci` hit EPERM in the global npm cache. A retry with a dedicated cache in this temporary checkout completed. No service, key, index, policy, template or shared configuration was changed. TAP-96 remains **In Progress** and `PROD_DEPLOY_REQUIRED=YES`.

## Aditivo: ensaio isolado de fila persistente — 2026-10-20

A configuração 0.130.1 compartilhada permanece inalterada. Em ambiente Docker descartável com ES 8.17.0 e Collector Contrib 0.156.0, uma fila com `file_storage` e volume persistente carregou 1 item (250 bytes) depois do restart e drenou quando o ES voltou. Em duas requisições sintéticas únicas, o resultado final teve duas cópias por ID; há duplicação observada, logo sem garantia exactly-once. Com fila artificial de 8 KiB, uma requisição de 200 logs recebeu HTTP 200 do OTLP, mas o exporter rejeitou os 200 por `sending queue is full`; `otelcol_exporter_enqueue_failed_log_records_total=200`, `queue_capacity=8192`. Assim, a confirmação do receiver não comprova exportação final. Também foi observado que retry curto e finito resultou em `dropped_items=1` durante indisponibilidade.

A POC, as limitações e o exemplo versionado estão em [TAP-96-collector-durability-test.md](TAP-96-collector-durability-test.md) e [examples/otel-collector-durable-queue-0.156.0.yml](examples/otel-collector-durable-queue-0.156.0.yml). São material de proposta, não ativados em Compose ou DEV. O limite de 128 MiB da file_storage é por arquivo bbolt; não comprova quota do volume inteiro. Falta scrape/alerta em operação e aceite de RPO/RTO/duplicação. Hostmetrics do Collector ativo mira o namespace do próprio container, não o host Windows nem cada container.

| Gate | Estado atualizado | Evidência / limite |
|---|---|---|
| Fila persistente e replay | parcial comprovado em descartável | item persistiu e drenou após restart; não há prova de perda de volume ou crash de host. |
| Duplicação | risco comprovado | duas cópias do mesmo ID em dois casos de falha/replay; outro ID apareceu uma vez em retry sem restart. Dedupe/idempotência do destino permanece pendente. |
| Saturação/descarte | comprovado no probe | métrica interna e log de queue full; HTTP 200 de OTLP coexistiu com rejeição no exporter. Sem alerta operacional conectado. |
| Geolocalização confiável | ausente | API escuta `0.0.0.0`, Fastify não configura `trustProxy`, e o IP do socket não distingue o visitante atrás de `cloudflared`. `CF-Connecting-IP` não é consumido; aceitar esse header em chamadas diretas seria spoofável. Cloudflare diz que o header é enviado do edge ao origin e recomenda restringir o origin a tráfego Cloudflare; Tunnel e bind local têm outro peer imediato. É necessário desenhar e verificar a fronteira de confiança primeiro, sem mudança de Cloudflare/rede nesta etapa. Fonte: [Cloudflare headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/) e [restaurar IP de visitante](https://developers.cloudflare.com/support/troubleshooting/restoring-visitor-ips/restoring-original-visitor-ips/). |
| Autorização de consulta por empresa | ausente | Discover/Kibana é acesso operacional interno; não há prova de ACL empresarial. Chaves DEV de leitura comprovam apenas acesso ambiental global DEV e já foram revogadas. |
| Cobertura de jornadas | parcial | PR #87 corrige terminal de CSV e remove query/fragment de page_view; demais operações/jobs/realtime precisam de inventário finito e casos por resultado, tenant e ator. As evidências anteriores dos 47 docs/18 cenários continuam amostra. |
| Backup e restauração ES | ausente | POC é descartável e não exercitou snapshot ou restore. |
| Infra e detecção do próprio monitoramento | parcial/ausente | API readiness testa PostgreSQL, não ES/Collector/Kibana; hostmetrics observa namespace do Collector. Métricas internas do Collector não têm scraper/alerta operacional comprovado. |

TAP-96 continua **In Progress**; `PROD_DEPLOY_REQUIRED=YES`. Publicação das correções de runtime, eventual release DEV e atualização do Collector compartilhado são operações distintas. Nenhuma infraestrutura compartilhada ou produção foi alterada.

## Aditivo: auditoria de leituras HTTP — 2026-10-20

A branch `fix/tap96-successful-read-audit` adiciona evento `http.get` para respostas GET 2xx nas rotas API não classificadas como polling. O evento usa o template da rota, status, duração medida pelo servidor, correlation/request ID, release, tenant e ator resolvidos pelo contexto já existente. Query, corpo de resposta e identificadores de caminho concretos não são incluídos. GET 4xx/5xx e mutações continuam usando o fluxo existente; endpoints de cozinha/eventos/ranking/polling explicitamente excluídos continuam sem evento para controlar volume. A duração é tempo de processamento/resposta no servidor; não mede entrega nem latência de ingestão.

Teste focal: rota parametrizada com query contendo e-mail/token não vaza esses valores, captura rota template e duração, e o polling de cozinha continua excluído. `npm.cmd run ci` local passou (backend 275 pass / 2 skipped e demais gates verdes). O evento ainda aguarda merge, publicação/validação no DEV e reconciliação por rota no Elasticsearch. Portanto a cobertura de jornadas permanece parcial, não total. A questão de emissão pelos dois canais atuais (Pino/OTel) e a duplicidade documental efetiva seguem sem medição de ingestão.

## Aditivo TAP-96 — execução finita e validação isolada (2026-10-20)

A matriz finita, 93 IDs executados, resultados por jornada, consultas/reconciliação no Elasticsearch descartável e limites de cada evidência estão em [TAP-96-jornadas-executadas-2026-10-20.md](TAP-96-jornadas-executadas-2026-10-20.md). Resumo: 172 testes de release passaram em desktop/mobile/tablet/TV; 2 cenários administrativos adicionais também passaram funcionalmente. Pipeline descartável ES 8.17.0 + Collector 0.130.1 indexou login, 401, pagamento e pedido público em data streams DEV sintéticos sob o SHA `d0ed1c1…`. Não foram encontrados eventos pesquisáveis para admin/concorrência numa execução focada de 7 documentos; causa não determinada. As regras candidatas de alarme passaram `promtool` com cinco fixtures, sem ativação nem teste de notificação.

Estado mais recente observado durante a validação: main `d0ed1c189abd9df2dfefd98ebcfb40b58e01c4d4`; DEV `1c85adf2272afe50b5ee705c22fb7361cb24e50a` (release paralela, pronta e preservada); PROD `e39b2e6d` (ready). Não publiquei em DEV/PROD nem alterei Elasticsearch, Collector, retenção, rede ou credenciais compartilhadas. A validação do runtime integrado no DEV oficial, a prova de admin/Socket, ACL por empresa, geolocalização confiável, snapshots/restauração, capacidade/durabilidade operacional e janelas de retenção continuam pendentes. `PROD_DEPLOY_REQUIRED=YES`; TAP-96 permanece **In Progress**.

## Aditivo de evidencias pos-PR #90 (2026-10-20)

Main testada: `41f49a0aa8a8bbd3014e5bd4910d1228dbdee41a`. A main inclui o merge de portal posterior ao antigo candidato `d0ed1c18`, portanto o SHA antigo nao e intercambiavel com a main final. A validacao integrada e a matriz focada por jornada/ID estao em [TAP-96-jornadas-executadas-2026-10-20.md](TAP-96-jornadas-executadas-2026-10-20.md).

| Gate | Estado atualizado | Evidencia e limite |
|---|---|---|
| Admin e pedido concorrente | comprovado em ambiente descartavel | Run `1be0ae921f5fde9a`: 451 emissões OTEL e 451 documentos ES no mapping OTEL dinamico; negação por tenant/ator, GET 403, controle 200 e POST de pedido 201. A amostra antiga de sete documentos nao tem config suficiente para causa retroativa; a ausencia nao se reproduziu. |
| Socket | parcial comprovado | `CMD-S11` cobre conexao autenticada, room, propagacao a dois navegadores e recuperacao apos reconexao/reload. RT-17 cobre token invalido, negacao cross-tenant por ausencia de propagacao, room propria e reconexao. `realtime.room.*` e sinal tecnico Pino; o runner nao exporta Pino ao OTLP. |
| Duplicidade/atraso | parcial mensurado | 12 pares/grupos repetidos de `ui.page_view` no run de 451; nenhuma duplicidade nas acoes de admin/pedido/RT-17 pelo critério acao+correlationId. Sem timestamp independente de chegada, atraso de ingestao nao medido. |
| Alertas | parcial comprovado | Prometheus e Alertmanager descartaveis entregaram firing e resolved a webhook local para a regra de fila alta. Canal de operador real continua nao provado. |
| Snapshot/restore | parcial comprovado | Snapshot/delete/restore em ES 8.17.0 descartavel recuperou documento sintetico. Backup off-host, schedule, RPO/RTO e permissao real pendentes. |
| Geolocalizacao | candidato seguro testado, nao ativado | Helper isolado aceita pais somente de peer explicitamente confiavel; spoof direto, IPv4/IPv6 e desconhecido cobertos. Endereco do peer Cloudflare Tunnel e restricao da origem ainda precisam de decisao operacional. |
| Acesso Kibana | decisao de produto/operacao | Evidencia existente indica ferramenta interna de operadores; ACL empresarial no Discover nao e gate automatico se clientes nao acessam. Atribuicao tenant/ator no evento continua obrigatoria. Confirmar se acesso externo a Kibana e requisito futuro. |
| Retencao, capacidade e durabilidade compartilhada | pendentes | Nenhuma policy, template, replica, limite, rede ou Collector compartilhado foi alterado. Projecao, capacidade fisica e aceite de perda/RPO/RTO nao sao substituidos pelos probes descartaveis. |

Proximas operacoes compartilhadas continuam separadas: uma troca DEV para o SHA final de main quando o slot for liberado; depois smoke minimo de observabilidade; qualquer deploy PROD exige autorizacao especifica. Mudancas do Collector, Elasticsearch, policies/templates, caminho Cloudflare/origem e retenção exigem aprovacao operacional propria com escopo, verificacoes, impacto e retorno definidos. Nenhuma delas foi aplicada nesta execucao. TAP-96 permanece **In Progress**; `PROD_DEPLOY_REQUIRED=YES`.

## Aditivo de certificação técnica e decisão operacional (2026-10-21)

O ensaio real Pino → EDOT → Collector → Elasticsearch e a correção de emissão repetida `ui.page_view` estão documentados em [TAP-96-jornadas-executadas-2026-10-20.md](TAP-96-jornadas-executadas-2026-10-20.md). O tracker agora suprime replay da mesma location key; PWA-S02 verifica um único `/login` no POST de auditoria. A duplicidade histórica de 12 grupos foi reproduzida na origem no build exato de QA; os IDs brutos históricos não foram preservados, portanto não há atribuição retroativa documento a documento. O harness grava request/correlation IDs recebidos nas respostas para próximas provas. Os 172 testes/93 IDs antigos continuam prova funcional agregada; não provam ingestão por cada ID e não foram repetidos.

O relatório histórico contém estados e conclusões de 2026-10-20. Para gates atuais, prevalece este aditivo e a tabela de certificação abaixo; não se deve interpretar status antigos como reabertura da falha administrativa/concorrente que não se reproduziu.

| Gate | Status em 2026-10-21 | Evidência / próximo passo |
|---|---|---|
| Pino técnico real e redação | Comprovado em stack descartável | 1 info, 1 warn e 1 erro controlado pesquisáveis; sentinel de senha `[REDACTED]`; metadados de host foram incluídos e requerem decisão de detector antes de rollout. |
| Audit versus technical | Comprovado para probe | Audit uma vez em `logs-audit_system.otel-dev`; Pino em `logs-technical.otel-dev`; uma ocorrência não é garantia exactly-once. |
| `page_view` repetida | Causa reproduzida e correção preparada | Mesmo load `/login` emitiu duas ações antes do transporte; correção por location key, PWA-S02 passou 4/4 (desktop/mobile/tablet/TV). |
| Rastreio por chamada QA | Implementado | `requestId`/`correlationId` capturados no helper; evidência histórica não pode ser reconstruída. |
| 451/451 e admin/concorrência | Comprovado para execução 41f49a0 | Não reabrir investigação antiga; cobertura universal, atraso e exactly-once permanecem fora da prova. |
| DEV oficial | Bloqueado pelo slot de tarefa paralela | Esperar liberação efetiva; uma troca para o único SHA final após PR/CI e smoke focado. Nenhuma mudança compartilhada feita. |
| Alertas reais | Bloqueado por decisão de destinatário/autorização de envio | Receptor descartável firing/resolved comprovado; pacote operacional define texto e aceite humano. |
| Geolocalização | Bloqueado pela fronteira de confiança | Helper seguro testado, sem ligação no runtime; descobrir peer Tunnel e aprovar país-only/origem restrita. |
| Retenção/capacidade | Bloqueado por autorização operacional | Piloto futuro `metrics-generic.otel-dev` descrito; janelas não aprovadas, backings existentes separados. Confirmar fotografia comparável e budget primário+r​​éplica. |
| Durabilidade/recuperação | Bloqueado por aceite RPO/RTO e destino | Replay duplica; fila cheia pode coexistir com OTLP 200; marcador snapshot isolado não prova restore integral/off-host. |
| Kibana/ACL empresarial | Não aplicável enquanto Discover for interno; confirmar decisão de produto | Não criar role empresarial sem necessidade; se acesso externo virar requisito, modelo DLS/FLS e prova negativa cross-tenant. |
| Produção | Não autorizado | `PROD_DEPLOY_REQUIRED=YES`; PR de runtime e troca DEV não autorizam deploy PROD. |

Pacotes executáveis, impactos, precondições, verificações, retorno e decisões humanas estão em [TAP-96-pacote-operacional-final-2026-10-21.md](TAP-96-pacote-operacional-final-2026-10-21.md). Nenhum envio real, mudança de rede/Collector/Elasticsearch/retention ou deploy ocorreu. TAP-96 permanece **In Progress**.
