# Validação funcional RBAC — 2026-10-10

## Continuação mais recente: permissões de cozinha no navegador real

O snapshot `33eb5321233a1802a0e7d3e52e74be4460a6ae6c` (tree `64228631f201ab02087b5eff05ded2547f2f89d7`) materializou 1.454 blobs exatos; auditoria: 198 módulos Git e zero imports do workspace mutável. Builds backend/frontend, preflight 14/14, Fastify/PostgreSQL descartável e Playwright 9/9 passaram. `kitchen.read`: sem a chave, rota/fila/API foram negadas; só com leitura concedida, a fila real apareceu sem botão “Iniciar” e tentativa de mudança foi recusada; revogar a chave removeu leitura novamente. `kitchen.operate`: com `kitchen.read` preservada, a ausência de operar ocultou o controle e negou API; com as duas chaves, o funcionário iniciou preparo pela UI; revogar somente operar manteve a tela de leitura, removeu o próximo controle e negou a transição seguinte. PostgreSQL confirmou status final `EM_PREPARO`. Recibo: [`kitchen-combined.json`](../../artifacts/rbac-permissions-ui-2026-10-10/results/kitchen-combined.json); Playwright: [`playwright-results.json`](../../artifacts/rbac-permissions-ui-2026-10-10/run-0b6c6f05f35f1b15/live-results/playwright-results.json).

**Cobertura UI real acumulada:** 33/84 PASS, 0 FAIL, 0 BLOCKED e 51 NOT RUN. Onze chaves têm três estágios aprovados; as outras 17 chaves ainda não têm estágios de UI. Certificação integral permanece **incompleta**.

## Continuação mais recente: inventory.read e inventory.adjust no navegador real

O snapshot `d2b2a0dc37e2bef598c40365f31c6e5259dce827` (tree `9127594022d71d2cbcf50dd0e3b71365900b84fe`) materializou 1.453 blobs Git exatos; auditoria: 198 módulos do snapshot e zero imports do workspace mutável. Builds backend/frontend, preflight 14/14, Fastify/PostgreSQL descartável e Playwright 7/7 passaram. `inventory.read`: sem a chave, rota e API foram negadas sem escrita; com a chave, o saldo apareceu na tela e uma tentativa de entrada foi recusada; após revogação na sessão, rota e API voltaram a negar e o saldo não mudou. `inventory.adjust`: mantendo `inventory.read`, ausência do ajuste ocultou os controles e negou POST; com ambas as chaves, a reposição pela UI persistiu +1 unidade; revogando somente o ajuste, a UI ocultou os controles, o POST foi negado e o saldo permaneceu estável. O banco confirmou um único movimento com produto, quantidade e `registradoPorId` do funcionário de QA. Recibo: [`inventory-adjust-final.json`](../../artifacts/rbac-permissions-ui-2026-10-10/results/inventory-adjust-final.json); Playwright: [`playwright-results.json`](../../artifacts/rbac-permissions-ui-2026-10-10/run-983e0841e160d023/live-results/playwright-results.json).

**Cobertura UI real acumulada:** 27/84 PASS, 0 FAIL, 0 BLOCKED e 57 NOT RUN. Nove chaves têm os três estágios aprovados; as outras 19 chaves seguem sem estágios de UI. Sem acesso a PROD ou escrita no DEV compartilhado; certificação integral permanece **incompleta**.

## Continuação mais recente: clients.manage no navegador real

O snapshot `4f4d63cc295476bc344909f068f36abcae1de028` (tree `7980919e57348f1e916545171045c5c4a0add21b`) materializou 1.452 blobs Git exatos; a auditoria confirmou 198 módulos do snapshot e zero imports do workspace mutável. Builds backend/frontend, preflight 14/14, API/PostgreSQL descartável e Playwright 5/5 passaram. O funcionário sintético sem `clients.manage` foi redirecionado para fora da tela de cadastro e o POST direto foi negado sem registro; com somente a chave concedida durante a sessão, cadastrou um cliente pela tela e o proprietário confirmou o mesmo ID, nome e telefone normalizado; após revogação na mesma sessão, a rota e um novo POST foram negados e o cliente autorizado permaneceu único. O modelo registra `cadastradoVia=STAFF` no fluxo; não há campo de ID do autor no modelo Cliente. Recibo: [`clients-live-final.json`](../../artifacts/rbac-permissions-ui-2026-10-10/results/clients-live-final.json); Playwright: [`playwright-results.json`](../../artifacts/rbac-permissions-ui-2026-10-10/run-e2a93f569a0ea9c6/live-results/playwright-results.json).

**Cobertura UI real acumulada:** 21/84 PASS, 0 FAIL, 0 BLOCKED e 63 NOT RUN. Sete chaves têm três estágios aprovados: `command.read`, `cash.values.read`, `dashboard.read`, `agenda.manage`, `command.operate`, `reports.read` e `clients.manage`. As outras 21 chaves seguem sem estágios de UI. Sem escrita no DEV compartilhado ou acesso a PROD; certificação integral permanece **incompleta**.

## Continuação mais recente: agenda.manage no navegador real

**Snapshot testado:** `fe3dba972a1e8bc503ca0c6457a8b8885590a0d9` (tree `7d53672ee0d83ac14c57536f1f55f37a4a6dd4a5`), derivado de `origin/main` e materializado exatamente com 1.448 blobs Git. Auditoria: 198 módulos do snapshot, zero imports do workspace mutável. Builds backend/frontend, preflight 14/14, suíte autenticada API/PostgreSQL descartável e Playwright passaram; o Playwright terminou 2/2. Recibo: [`agenda-live-fe3dba9.json`](../../artifacts/rbac-permissions-ui-2026-10-10/results/agenda-live-fe3dba9.json); saída do navegador: [`browser-run.log`](../../artifacts/rbac-permissions-ui-2026-10-10/run-dbde9149ec4dca9d/live-results/browser-run.log).

O novo caso percorreu `agenda.manage` nos três estágios: sem permissão, a rota foi redirecionada e a escrita direta retornou recusa sem alteração; com a permissão concedida pela API administrativa, a mesma sessão do funcionário criou uma ocorrência pela interface e a persistência foi conferida pela API; após revogação, a sessão voltou a ser redirecionada, a escrita foi recusada e o único registro permitido permaneceu intacto. A fixture ativou CANONICAL_PDV somente no PostgreSQL descartável e removeu os registros temporários do segundo PDV após concluir os asserts de isolamento anteriores. Não houve escrita no DEV compartilhado nem acesso a PROD.

**Cobertura UI real acumulada:** `command.read`, `cash.values.read` e `agenda.manage` passaram em desabilitada/habilitada/revogada; `dashboard.read` passou em habilitada/revogada, com desabilitada ainda NOT RUN. São **11/84 PASS**, **0 FAIL**, **0 BLOCKED** e **73 NOT RUN**. As verificações API representativas continuam PASS para as 28 chaves, sem substituir os estágios de UI pendentes. Certificação integral permanece **incompleta**.

## Continuação seguinte: dashboard.read desabilitada no navegador real

Snapshot `203b6e176b1f5e21427d4e45f31e30ae8bdef5dc`, tree `b789a9e15c044843c4e803c3b99f1a8b1ac0de5e`, passou com 1.449 blobs materializados, auditoria de imports PASS, builds backend/frontend, preflight 14/14, API/PostgreSQL descartável e Playwright 2/2. Sem `dashboard.read`, a chamada autenticada foi recusada e a navegação real não permaneceu na rota `/dashboard`; grant/revoke e os demais cenários seguiram PASS. Recibo: [`dashboard-live-203b6e1.json`](../../artifacts/rbac-permissions-ui-2026-10-10/results/dashboard-live-203b6e1.json).

**Cobertura UI real acumulada:** 12/84 PASS, 0 FAIL, 0 BLOCKED, **72 NOT RUN**. As quatro chaves com evidência são `command.read`, `cash.values.read` e `agenda.manage` (desabilitada/habilitada/revogada) e `dashboard.read` (desabilitada/habilitada/revogada). Os outros 24 pares-chave/estágio continuam pendentes; certificação integral permanece **incompleta**.

## Continuação mais recente: command.operate no navegador real

Snapshot `e503a9c01958cecf006c69d429f4f83b08473c38` passou com 1.450 blobs Git materializados exatamente, auditoria de imports PASS (198 módulos; zero do workspace mutável), builds backend/frontend, preflight 14/14, API/PostgreSQL descartável e Playwright 3/3. Para isolar `command.operate`, `command.read` foi mantida como dependência de leitura: sem operar, a rota nova e o POST foram recusados sem comanda; com as duas chaves, o funcionário criou comanda pela UI, a API autenticada do proprietário confirmou o registro e o banco confirmou `abertaPorId` correto; após revogar somente `command.operate`, a tela caiu no fallback e um novo POST foi negado sem segunda escrita. Não houve pagamento nem chamada externa. Recibo: [`command-operate-e503a9c.json`](../../artifacts/rbac-permissions-ui-2026-10-10/results/command-operate-e503a9c.json).

**Cobertura UI real acumulada:** 15/84 PASS, 0 FAIL, 0 BLOCKED, **69 NOT RUN**. Cinco chaves têm os três estágios aprovados: `command.read`, `cash.values.read`, `agenda.manage`, `dashboard.read` e `command.operate`. Restam 23 chaves sem estágios UI; certificação integral permanece **incompleta**.

## Continuação mais recente: reports.read no navegador real

Snapshot `4c5c1bc6c2b022330614188120a0ebd8a2bd17dd` passou com 1.451 blobs materializados, auditoria PASS sem imports do workspace mutável, builds backend/frontend, preflight 14/14, API/PostgreSQL descartável e Playwright 4/4. A fixture fechou apenas um evento sintético descartável. Sem `reports.read`, a rota do resumo executivo e os endpoints de resumo/CSV foram negados; concedida somente a chave, a página real carregou o evento e a API retornou o resumo e CSV; após revogação, mesma sessão perdeu a rota e ambas as APIs. Nenhum dado externo foi enviado. Recibo: [`reports-read-4c5c1bc.json`](../../artifacts/rbac-permissions-ui-2026-10-10/results/reports-read-4c5c1bc.json).

**Cobertura UI real acumulada:** 18/84 PASS, 0 FAIL, 0 BLOCKED, **66 NOT RUN**. Seis chaves têm os três estágios UI PASS: `command.read`, `cash.values.read`, `agenda.manage`, `dashboard.read`, `command.operate` e `reports.read`. Restam 22 chaves sem estágios UI; a certificação integral continua **incompleta**.

## Continuação: execução com código Git fixado

**Revisão exata testada:** `d139a94c8fb89147e06fd9356fbe94cefff0c3d2`, tree `2942ddafd556d75a13979e457fa9ce93ae7975ae`, descendente de `origin/main` observado no início da execução. O snapshot materializou 1.441 blobs rastreados via `git cat-file` em `artifacts/rbac-permissions-ui-2026-10-10/`; imports de módulos operacionais do workspace mutável: zero. O teste não incorporou alterações locais não commitadas. Runner: `backend/scripts/run-pdv-unico-git-snapshot-qa.mjs`, SHA-256 `25500816cc1519109e9af7a2e5cdffe04bc3b37cca7df0ac8d1036beb6739d7f`. Node `v24.18.0`; Prisma Client `6.19.3`; PostgreSQL `17-alpine`. Recibo da execução: [`pinned-api-evidence.json`](../../artifacts/rbac-permissions-ui-2026-10-10/pinned-api-evidence.json).

**Resultado da execução fixada:** backend build PASS; frontend build PASS; preflight focado de ativação PASS 14/14; suíte API autenticada com Fastify e PostgreSQL descartável PASS; auditoria de import PASS; checkout, index e alterações locais idênticos antes/depois. O contêiner PostgreSQL foi removido ao final; portas publicadas apenas em loopback. PROD e DEV compartilhado: sem acesso e sem escrita.

| Evidência da continuação | Resultado | Limite |
|---|---|---|
| API RBAC no SHA fixado | PASS | A suíte integrada passou; não equivale a 28 ações por UI nem a todas as rotas alternativas. |
| TAP-82: item entregue | PASS | `command.item.cancel` sozinho retorna 403 sem mutação; as duas chaves autorizam cancelamento parcial/total em comanda aberta com motivo, tratamento de estoque, quantidade esperada e idempotência. Quantidade obsoleta, comanda paga/fechada, tenant estrangeiro e funcionário LEGACY são recusados. A comanda permanece entregue; produto preparado/perdido não retorna ao estoque; erro de lançamento reverte somente a baixa correspondente. |
| UI operacional com login, API e persistência reais | NOT RUN | Os 12 testes Playwright anteriores continuam sendo somente evidência simulada do editor. Nenhuma ação operacional foi certificada por browser contra API real nesta continuação. |
| Concessão e revogação em sessão para todas as 28 chaves | NOT RUN | A suíte integrada confirma casos de sessão pré-existente em endpoints específicos, mas não percorre grant/revoke e refresco visual de cada chave, incluindo duas sessões simultâneas. |
| Troca de usuário no mesmo navegador, inclusive entre tenants | NOT RUN | Cookies, query cache, sockets e armazenamento entre logins não foram verificados em browser real. |
| Contrato operacional do admin global e tentativas de autoelevação | PARTIAL | Há evidência histórica de Socket.IO LEGACY; o contrato completo de ações operacionais e edição de permissões continua sem prova. |
| Rotas alternativas, efeitos e combinações LEGACY/CANONICAL_PDV | PARTIAL | A suíte fixada cobre os caminhos e fixtures descritos acima e parte dos guards de módulos. Não executa a matriz de 28 permissões em cada modo/parâmetro nem todas as rotas equivalentes. |

Os 28 casos API permitidos/negados, builds e 12 cenários do editor relatados na rodada inicial continuam registrados como **evidência histórica da árvore de trabalho suja**, conforme a ressalva original; não os reclassificar como execução limpa do SHA fixado. A execução atual comprova a suíte integrada de API nesse SHA, mas não certifica as lacunas marcadas `NOT RUN`/`PARTIAL`. Nenhum defeito RBAC de produto foi confirmado. Uma execução preliminar do gate completo acionou teste de categoria fora do escopo e falhou 1/10; o gate focado agora o omite, sem alterar ou atribuir essa falha ao RBAC.

## Escopo e resultado

Inventário efetivo em `backend/src/lib/operacao/permissoes.ts`: **28 chaves**. Revisados também o editor em `PermissoesAgrupadas.tsx`, os guardas das rotas, o contexto de autenticação, os contratos de TAP-76/78/82 e a matriz de ações existente. A matriz abaixo registra evidência observada, sem elevar o comportamento atual à especificação quando ele diverge dos tickets.

O teste de API usa o app Fastify real, login que emite cookie, PostgreSQL descartável, dois tenants, PDVs, funcionários e dados sintéticos. Nenhuma chamada foi feita ao DEV compartilhado ou PROD. Os efeitos são lidos no PostgreSQL após cada escrita e recusa. O runner remove o próprio contêiner efêmero ao terminar.

**Resultado desta rodada:** API PostgreSQL descartável PASS; testes focados de permissão PASS 1/1; Playwright do editor PASS 12/12 em 390 px e 768 px; build backend PASS; build frontend PASS. O Playwright intercepta APIs e comprova apenas estrutura, usabilidade e persistência simulada do editor; não certifica autorização operacional.

**Limite de integridade do snapshot:** HEAD operacional inicial `d1fb75740834bf78abbee486598a5b558ff551fc`. O workspace já continha alterações do usuário em rotas backend relevantes antes da rodada. O runner de permissões selecionou o HEAD para schema/migrations, mas importa o código do workspace; portanto, o resultado da API descreve a árvore de trabalho observada, não uma certificação isolada do blob Git `d1fb757`. Essas mudanças locais foram preservadas e não fazem parte desta tarefa.

## Matriz por permissão

`A/D` = ação permitida/desabilitada por API com teste de integração autenticado. `UI editor` = rótulo, grupo e seleção testados com mock em ambos os tamanhos. `UI operação` indica a tela funcional além do editor. Revogação individual foi comprovada somente nas linhas em que há uma chamada pós-revogação explícita; uma sessão autenticada do funcionário é reutilizada em ações de concessão e revogação.

| Chave — rótulo exibido | Função, tela e endpoint exercitado | Pré-condições / dependências | API A/D | Revogação no mesmo login | UI operação | Efeito e observação |
|---|---|---|---|---|---|---|
| `cash.open` — Abrir caixa | Abrir caixa de evento e sessão operacional; `POST /api/eventos/:id/caixa/abrir`, `POST /api/operacao/caixa/abrir` | PDV e cardápio válidos; abrir não concede leitura dos valores | PASS / PASS | NOT RUN específico | NOT RUN | Sessão e troco persistidos; valores iniciais não vazam sem `cash.values.read`. |
| `cash.close` — Fechar caixa | Fechar caixa de evento/operação | Exige separadamente `cash.values.read` | PASS / PASS | NOT RUN específico | NOT RUN | Fechamento sem leitura negado; com ambas as chaves, fechamento persistido. |
| `cash.values.read` — Visualizar valores do caixa | Caixa de evento/operação e salas Socket.IO financeiras | Leitura não concede movimento nem fechamento | PASS / PASS | PASS (realtime) | NOT RUN | Respostas sem a chave são sanitizadas; valores, totais e movimentos ocultos. |
| `cash.movement.write` — Registrar suprimento e sangria | `POST /api/eventos/:id/caixa/movimentos` e rota operacional | Resposta redigida sem `cash.values.read` | PASS / PASS | NOT RUN específico | NOT RUN | Movimento persistido uma vez; resposta não revela valor. |
| `payment.receive` — Receber pagamentos | Venda/comanda e pagamentos pendentes | Venda também exige `command.operate`; fechamento pago exige `command.close` | PASS / PASS | NOT RUN específico | NOT RUN | Pagamento, baixa e estoque verificados; recusa deixa fotos financeiras/estoque iguais. |
| `debt.receive` — Receber dívidas | `POST /api/eventos/:id/contas-pendentes/:id/pagamentos` | Conta pendente e sessão; leitura/recebimento exercitados | PASS / PASS | NOT RUN específico | NOT RUN | Pagamento parcial e saldo persistidos. |
| `command.close` — Fechar comandas | Fechamento unitário/em grupo | Pagamento exige também `payment.receive`; configuração decide cozinha pendente | PASS / PASS | NOT RUN específico | NOT RUN | Sem permissão dependente não há pagamento, fechamento, baixa de estoque nem ledger. |
| `discount.apply` — Aplicar descontos | `PATCH /api/operacao/comandas/:id/desconto` | Parâmetro de negócio separado: valor não pode exceder subtotal; atualização de acesso sincroniza o booleano legado | PASS / PASS | PASS | NOT RUN | Desconto persistiu apenas com a chave; recusa e revogação preservaram desconto/total. Migração preserva booleano antigo. |
| `command.item.cancel` — Cancelar itens | DELETE e redução de quantidade em comanda | Redução valida quantidade sob lock; não cancela comanda inteira | PASS / PASS | PASS (reutilização da sessão) | NOT RUN | Lixeira e redução testadas; recusas preservam itens, total, opcionais, estoque e ledger. |
| `command.item.cancel.delivered` — Cancelar item já entregue | DELETE de item entregue em comanda aberta | Exige também `command.item.cancel`, motivo, quantidade esperada e tratamento de estoque; venda paga/fechada tem regra própria | PASS / PASS | NOT RUN específico | Editor PASS; tela operacional NOT RUN | Sem chave especial, recusa 403 e não cria auditoria/efeito; com ambas, cancelamento e auditoria persistem. Compatibilidade LEGACY também nega a funcionários. Ver TAP-82. |
| `command.cancel` — Cancelar comanda inteira | `POST /api/operacao/comandas/:id/cancelar` | Concessão independente; cancelar item não concede cancelamento integral | PASS / PASS | NOT RUN específico | NOT RUN | Perfil sem chave não cancela; perfil mínimo cancela fixture elegível. |
| `kitchen.cancel` — Cancelar pedidos da cozinha | Solicitação e confirmação de cancelamento | Exige também `sale.refund` quando há venda paga | PASS / PASS | NOT RUN específico | NOT RUN | Confirmação com uma só chave negada sem alterar status; par autorizado cria estorno/ledger. |
| `sale.refund` — Estornar venda | Cancelar pedido pago e confirmar estorno | Exige também `kitchen.cancel`; não há estorno genérico independente | PASS / PASS | NOT RUN específico | NOT RUN | Pagamento negativo, estoque e movimento de estorno comparados. |
| `dashboard.read` — Visualizar dashboard | `/api/cervejaria/dashboard` | Apenas leitura do painel consolidado | PASS / PASS | PASS | NOT RUN | Mesmo cookie funciona após concessão e recebe 403 após revogação. |
| `event.dashboard.read` — Visualizar painel do evento | `GET /api/eventos/:id/dashboard` | Evento do tenant; não concede relatórios | PASS / PASS | PASS (endpoint após revogação) | NOT RUN | Leitura permitida com chave isolada; após revogar, 403. |
| `reports.read` — Visualizar relatórios | `GET /api/eventos/:id/transacoes` | Evento do tenant; resumo executivo exige evento encerrado | PASS / PASS | PASS (endpoint após revogação) | NOT RUN | Transações permitidas com a chave e negadas após revogação. CSV/resumo não executados. |
| `command.operate` — Abrir comandas e lançar itens | Abrir comanda, lançar/incluir/aumentar itens e vendas | Não concede leitura, cancelamento, fechamento ou pagamento | PASS / PASS | NOT RUN específico | NOT RUN | Abrir e aumento testados; venda paga também cruza `payment.receive`. |
| `command.read` — Consultar comandas | Listas/detalhes e sala Socket.IO | Não concede operação; escopo do tenant/PDV | PASS / PASS | PASS (realtime) | NOT RUN | Leitura e projeção realtime sem conteúdo financeiro/cozinha não autorizado; IDs estrangeiros retornam 404. |
| `kitchen.read` — Consultar fila da cozinha | Fila, consulta e sala Socket.IO | Não concede mudança de status/cancelamento | PASS / PASS | PASS (realtime) | UI mockada parcial | Fila permitida; transição negada sem escrita; revogação remove conteúdo da mesma sessão. |
| `kitchen.operate` — Avançar preparo e entrega | `PATCH /api/operacao/cozinha/:id/status` e Socket.IO | `kitchen.read` é independente; cancelamento segue par próprio | PASS / PASS | PASS | UI mockada parcial | Transição persiste; após revogação 403 e estado permanece igual. |
| `inventory.read` — Consultar estoque | `GET /api/operacao/estoque` | PDV deve pertencer ao tenant; não concede ajuste | PASS / PASS | NOT RUN específico | UI mockada parcial | Leitura própria permitida, PDV externo 404 e escrita não autorizada. |
| `inventory.adjust` — Movimentar estoque manualmente | `POST /api/operacao/estoque/entrada` | Módulo de estoque habilitado; não é exigido para baixa automática de venda | PASS / PASS | NOT RUN específico | UI mockada parcial | Entrada permitida atualiza saldo e ledger; tentativa sem chave deixa ambos iguais. |
| `catalog.manage` — Manter catálogo e cardápios globais | Produtos, categorias, preços, opcionais e modelos | `catalog.shift.manage` não substitui gestão global | PASS / PASS | NOT RUN específico | UI mockada parcial | Produto/preço/opcionais persistem para perfil mínimo; controles globais independentes do turno. |
| `catalog.shift.manage` — Manter cardápio e preços do turno | `PUT /api/operacao/caixa/cardapio`, `PATCH .../preco` | Escopo `TURNO`; `TEMPLATE` exige `catalog.manage` | PASS / PASS | NOT RUN específico | UI mockada parcial | Preço do turno persistido; preço global permanece intacto. |
| `clients.manage` — Administrar clientes | Lista e CRUD comum administrativo | Busca de checkout/portal e merge/exclusão seguem contratos separados | PASS / PASS | NOT RUN específico | NOT RUN | CRUD comum exercitado; merge/exclusão continuam owner-only. |
| `taps.operate` — Montar e operar Taps | `PUT /api/eventos/:id/taps/:tapId/chope` | Módulo/PDV com Tap habilitado; cadastro do Tap é owner-only | PASS / PASS | NOT RUN específico | NOT RUN | Montagem persistida; negação não altera histórico; tenant cruzado 404. |
| `agenda.manage` — Administrar agendas | `POST /api/operacao/agenda/agendas` | Agenda e PDV válidos | PASS / PASS | NOT RUN específico | UI mockada parcial | Agenda persistida apenas com a permissão mínima. |
| `event.menu.manage` — Configurar cardápio do evento | `PUT /api/eventos/:id/cardapio` | Evento regular e produtos unitários do próprio tenant | PASS / PASS | PASS (endpoint após revogação) | NOT RUN | Lista de produtos persistida; negação e revogação preservam vínculos. |

Os PASS de API são representativos por chave e não equivalem a testar cada endpoint alternativo listado no inventário. O editor contém 28 opções únicas, grupos nomeados, estados vazios, seleção, salvar/reabrir, erro/retry e controles de toque/teclado. A evidência visual está em [`artifacts/rbac-permissions-ui-2026-10-10`](../../artifacts/rbac-permissions-ui-2026-10-10/).

## Divergências encontradas na documentação

- A matriz de arquitetura existente, atualizada em 07/10, enumera 27 chaves e não inclui `command.item.cancel.delivered`; catálogo backend e editor atuais enumeram 28. Esta avaliação inclui a chave extra e documenta seu endpoint/dependências acima.
- A descrição atual do TAP-82 ainda descreve o cancelamento entregue como bloqueado. A implementação vigente exige simultaneamente as duas chaves, motivo e trilha de auditoria para item entregue em comanda aberta; o teste de API confirmou negação e permissão mínima. Venda paga/fechada permanece em fluxo diferente. O ticket continua aberto e não foi encerrado.
- TAP-78 pede que funcionários com `command.close` + `payment.receive` fechem comanda com cozinha pendente quando os dois parâmetros estão ativos sem marcar pedido como entregue. O runner cobre os parâmetros ativados/desativados, os dois funcionários e o estado do pedido; cenários restantes de interface e tenants do cliente não foram cobertos aqui.

## LEGACY e CANONICAL_PDV

- **CANONICAL_PDV:** o runner valida o mapeamento de um tenant para PDV canônico, persistência de produto/opcional/cardápio de turno e rejeição de IDs de outro tenant/PDV em ações cobertas. Não executa todas as 28 permissões em tenants canônicos separados.
- **LEGACY / flag RBAC desligada:** compatibilidade de schema sem a coluna aditiva, login/lista de usuários, caixa de evento e salas Socket.IO. Operações históricas que eram abertas continuam abertas por contrato de transição; `command.item.cancel.delivered` segue excepcional e não é concedida automaticamente a funcionário. Não executa a matriz inteira de 28 chaves no modo legado.
- **Admin global:** não foi validado para todas as combinações de papel, tenant e modo. Um caso de sala LEGACY não certifica acesso operacional administrativo.

## Limitações e casos não executados

- Não houve Playwright com browser conectado a backend real. As APIs operacionais do Playwright são mockadas; os fluxos API reais foram executados separadamente com Fastify e PostgreSQL.
- Não foram percorridas todas as telas/endpoints alternativos por permissão; ações em `NOT RUN` na tabela continuam sem prova visual operacional. Múltiplos relatórios/CSV, checkout de clientes, trilhas de cancelamento financeiro em variações, calendário de eventos e estados de erro/timeout de autorização seguem pendentes.
- Troca de usuário no mesmo browser, concessão visível na UI sem credencial do proprietário, falha de consulta de permissão e concorrência financeira geral não foram certificadas. Retry/idempotência e concorrência específica de cancelamento aparecem nos testes existentes.
- Matrizes completas para cozinha ligada/desligada, cobrança no lançamento, cozinha pendente, estoque ligado/desligado, Tap ligado/desligado e operações planejadas/eventos em todos os endpoints não foram executadas.
- Build e testes foram rodados na árvore de trabalho existente; não foi repetida a certificação integral de migrations. Nenhum dado real, sessão, serviço compartilhado, impressão, pagamento, e-mail ou WhatsApp foi usado.

**Defeitos de produto confirmados nesta rodada:** nenhum. A suíte de interface tinha asserts obsoletos de 27 permissões; foram atualizados para 28 e os 12 cenários passaram. Isso era dívida do teste, não defeito operacional. TAP-82 descrevia anteriormente o cancelamento entregue como bloqueado; no SHA/árvore testados, a permissão especial e a auditoria estão implementadas e o cenário mínimo passou. O ticket permanece aberto por instrução explícita e porque não houve aceite completo de seus demais critérios.

## Rastreamento Plane

Busca no projeto por RBAC/permissões não encontrou ticket dedicado. Itens relacionados lidos: TAP-76 “Certificar fluxos CAIXA/EVENTO após convergência de setembro” (In Progress, high, labels Product/Quality), TAP-78 “Fechar comanda com cozinha pendente usando usuários autorizados” (In Progress, high, sem labels) e TAP-82 “Cancelar item já entregue somente com autorização específica” (In Progress, high, sem labels). Seus títulos, prioridades, labels e estados não foram alterados; nenhum foi encerrado. Não foi criado item novo porque não foi confirmado defeito de produto.

## Próximos ajustes de prioridade

1. Repetir a matriz sobre uma revisão Git limpa e imutável, sem alterações locais nas rotas.
2. Completar Playwright autenticado contra frontend/backend/DB de QA e comprovar concessão/revogação e troca de usuário no mesmo browser.
3. Expandir por endpoint alternativo e por matrizes completas LEGACY/CANONICAL_PDV e de parâmetros operacionais; adicionar evidência de tela por fluxo.
4. Depois disso, confrontar critérios restantes de TAP-76/78/82 e atualizar Plane com evidência final sem mudar escopo.

## Live browser continuation (10 Oct 2026; supersedes earlier NOT RUN wording above)

The exact Git source snapshot used for this continuation is `8d7ea1c98a0b2b12c4856737bba5976aede98cce` (tree `3cf7e0ef27c5f5b997a1088be17256e7b0ff7146`), parented on published `origin/main` code `4b2649e47335f92ca9201258c04f514f185a6694`. It materialized 1,448 tracked blobs with `git cat-file`; no mutable workspace source modules were imported. The backend/frontend builds and activation preflight passed (14/14). The authenticated Fastify/PostgreSQL suite passed, and its disposable PostgreSQL container was removed. The outer runner withheld its final receipt because its workspace fingerprint changed during execution; unrelated concurrent files were preserved. The exact source snapshot remained fixed.

### Synthetic reference and configuration

The browser fixture is a synthetic `Permission QA` establishment with a synthetic owner, two synthetic attendants, one open synthetic comanda, and a disposable PostgreSQL database. Initial settings are `plannedOperationsEnabled=false`, `tapsEnabled=false`, `inventoryEnabled=false`, `kitchenEnabled=false`, and first-access setup marked complete. API fixtures toggle representative inventory, kitchen, Tap and pending-kitchen settings. These settings are representative only; no DEV read or real customer configuration was used, so they are not asserted to match Churrasquinho do Thiago.

### Live browser results and denominator

There are 28 current permission keys. The requested three core states per key form 84 permission-stage cases, before alternate routes, settings, global admin and screen-specific actions. The API suite contains representative enabled/disabled and persistence/revocation cases for the catalog, plus tenant and TAP-82 coverage; this is not proof of 84 UI action stages.

The live browser covered `command.read` only (1/28):

- Disabled: direct `GET /api/operacao/comandas` is denied (401/403). The fallback `GET /api/operacao/caixa` returns 200 with financial values sanitized.
- Enabled: owner grants the key through the real admin API while two staff sessions stay open. The staff session observes the grant, reaches the command list and reads the live endpoint successfully.
- Revoked: the existing staff session is denied by the API after owner revocation. Navigation falls back to `/operacao/caixa`, where the UI throws `TypeError: Cannot read properties of undefined (reading 'esperadoDinheiro')`. The API did not expose the hidden financial values. The backend records `ui.error`.
- Two simultaneous staff sessions, viewport widths 390 and 768, and a same-browser tenant switch via real logout API plus real login form passed. `/api/auth/me` changed company ID and the second tenant's user list excluded the first tenant's staff ID.

The Playwright harness test passed 1/1 while explicitly logging the product FAIL above. Its failure-only trace capture was removed after Playwright reported that the fixture had not started tracing. The passing run produced `live-results/command-read-revocation-cash-fallback.png`; the screenshot is embedded in the Playwright result JSON and extracted beside it. The other 27 keys have no live browser certification in this run. The existing mocked editor tests remain editor-only evidence.

### Product defect and trace

Expected behavior is a usable fallback cash page with sensitive totals omitted. Observed behavior is a frontend crash while reading `esperadoDinheiro` from the sanitized response. Impact: staff without `command.read` cannot use the fallback cash screen; the revoked route flow is interrupted. The issue was attached to TAP-76 as internal comment `f7bc162e-2364-4b2b-92c5-f1ecbccf62ee`; TAP-76 stays In Progress. TAP-78 and TAP-82 stay open and unchanged. No duplicate Plane item was created.

The browser log, Playwright result JSON and revocation screenshot are under `artifacts/rbac-permissions-ui-2026-10-10/live-results/`. No valid trace was produced. The API runner removed its disposable container. PROD and shared DEV were not accessed. `CANONICAL_PDV`/`LEGACY`, all 28 UI actions, global-admin behavior, alternative routes and full business-setting combinations remain unverified live; do not describe this result as 100% certification.

## Final continuation after cash fallback correction (10 Oct 2026)

The product correction is in candidate commit `4017a9ddc7d934b81c411f3808121fb681a520fa` (parent `4e5a8eb6e05b30cd017d83fbe63fc0a3a50dd176`). The defect was the sanitized `/api/operacao/caixa` projection omitting `sessao.gaveta` (and other financial objects), while `PainelCaixaOperacao` dereferenced `esperadoDinheiro`. The consumer now renders a restricted state without financial values, distinguishes loading and request error, and does not substitute zero for hidden values. Cash close is unavailable unless both values and close authorization are present.

The exact test candidate was `e9c59938b0721b8d07a795eb4927951dfe7fbfa6`, tree `71e7024b19c2c444d9f5d45f585a1e6da438ca20`, parented on the fix commit. The focused immutable snapshot runner passed with exit code 0. It materialized 1,448 tracked blobs; selected and materialized trees matched. The module audit found 198 snapshot project modules, zero mutable-workspace imports, and 1,531 external dependency modules. Backend/frontend builds, activation preflight, authenticated Fastify/PostgreSQL suite, and Playwright (1/1) passed. The disposable PostgreSQL container was removed. Checkout tree was unchanged before/after; no external workspace changes were observed during this run. Full receipt: [`rbac-final-evidence.json`](../../artifacts/rbac-permissions-ui-2026-10-10/rbac-final-evidence.json); console: [`rbac-final-console.log`](../../artifacts/rbac-permissions-ui-2026-10-10/rbac-final-console.log).

### Functional matrix status by permission

`API representative` means the authenticated disposable API suite exercised representative allowed and denied behavior for that key; it does not imply every alternative endpoint or all three stages through the UI. `UI D/E/R` are the disabled, enabled, and revoked stages in the live browser. API evidence and UI evidence are reported separately.

| Permission | API representative A/D | UI D | UI E | UI R | Live browser evidence |
|---|---|---|---|---|---|
| `cash.open` | PASS | NOT RUN | NOT RUN | NOT RUN | Open session API only; no UI action stage |
| `cash.close` | PASS | NOT RUN | NOT RUN | NOT RUN | Close permission dependency covered by API suite; no UI action stage |
| `cash.values.read` | PASS | PASS | PASS | PASS | Real login; sanitized projection without values; grant reveals `gaveta.esperadoDinheiro`; revoke restores sanitized usable UI |
| `cash.movement.write` | PASS | PASS | PASS | PASS | Live supply/withdrawal UI; redacted response without `cash.values.read`; revoke denies; snapshot `25b06d7` |
| `payment.receive` | PASS | NOT RUN | NOT RUN | NOT RUN | Payment dependencies covered by API suite; no live UI payment |
| `debt.receive` | PASS | NOT RUN | NOT RUN | NOT RUN | No live UI receipt action |
| `command.close` | PASS | NOT RUN | NOT RUN | NOT RUN | Close/payment dependency covered by API suite; no live UI close |
| `discount.apply` | PASS | NOT RUN | NOT RUN | NOT RUN | No live UI discount action |
| `command.item.cancel` | PASS | NOT RUN | NOT RUN | NOT RUN | No live UI cancel action |
| `command.item.cancel.delivered` | PASS | NOT RUN | NOT RUN | NOT RUN | TAP-82 API fixture only; no live UI action |
| `command.cancel` | PASS | NOT RUN | NOT RUN | NOT RUN | No live UI full cancel action |
| `kitchen.cancel` | PASS | NOT RUN | NOT RUN | NOT RUN | Kitchen/refund dependency covered by API suite; no live UI cancel |
| `sale.refund` | PASS | NOT RUN | NOT RUN | NOT RUN | Refund dependency covered by API suite; no live UI refund |
| `dashboard.read` | PASS | PASS | PASS | PASS | Real dashboard route/API denied while disabled; same-session grant/revoke; snapshot `203b6e1` |
| `event.dashboard.read` | PASS | NOT RUN | NOT RUN | NOT RUN | Event-specific live fixture/action not run |
| `reports.read` | PASS | PASS | PASS | PASS | Real executive report route and API plus CSV endpoint; same-session grant/revoke; snapshot `4c5c1bc` |
| `command.operate` | PASS | PASS | PASS | PASS | Real UI comanda create; `command.read` kept as read dependency; grant/revoke affects only `command.operate`; DB confirms creator |
| `command.read` | PASS | PASS | PASS | PASS | Real command API denial/grant/revocation in two sessions; cash fallback remains usable with financial values sanitized |
| `kitchen.read` | PASS | PASS | PASS | PASS | Real queue/API readable; no `kitchen.operate` control or status write; same-session revoke; snapshot `33eb532` |
| `kitchen.operate` | PASS | PASS | PASS | PASS | `kitchen.read` retained; real UI starts preparation; revoke hides next action and denies status API; DB status `EM_PREPARO`; snapshot `33eb532` |
| `inventory.read` | PASS | PASS | PASS | PASS | Real stock screen/API read-only; `inventory.adjust` absent, entry refused; snapshot `d2b2a0d` |
| `inventory.adjust` | PASS | PASS | PASS | PASS | `inventory.read` retained; UI entry adds exactly 1 unit with staff actor; revoke hides controls/refuses another write; snapshot `d2b2a0d` |
| `catalog.manage` | PASS | NOT RUN | NOT RUN | NOT RUN | No live catalog UI action |
| `catalog.shift.manage` | PASS | NOT RUN | NOT RUN | NOT RUN | No live shift-menu UI action |
| `clients.manage` | PASS | PASS | PASS | PASS | Live client create via UI, owner confirms same persisted ID/name/normalized phone; route and POST denied after revoke; snapshot `4f4d63c` |
| `taps.operate` | PASS | NOT RUN | NOT RUN | NOT RUN | Tap module live fixture was not enabled |
| `agenda.manage` | PASS | PASS | PASS | PASS | Live CANONICAL_PDV agenda UI create; disabled/revoked route and writes denied without mutation; exact snapshot `fe3dba9` |
| `event.menu.manage` | PASS | NOT RUN | NOT RUN | NOT RUN | No live event-menu UI action |

The Playwright flow also checked two simultaneous staff sessions, viewport widths 390 and 768, same-browser tenant switch after real logout/login, command/cash permission independence, and a synthetic 503 query-error state. Only the query-error response was intercepted; authentication, grants, revokes and successful operational reads used the real API. No production or shared DEV access occurred. No evidence supports matching the synthetic tenant's flags to a real customer configuration. The backend API matrix is representative; 16 of 28 keys still lack live browser action stages, and the requested full permission/configuration matrix is therefore **incomplete**.

### Receipt and changed files

Product result: **PASS for the corrected cash fallback and the three browser-tested keys; not a full 28-key certification**. Harness result: **PASS**. Snapshot integrity: **PASS**. External changes observed: **none during the final run**; earlier dirty/staged work in the shared checkout was preserved. PROD access: **NO**. Shared DEV writes: **NO**. Disposable service cleanup: **PASS**.

Files changed by this task: `frontend/src/components/operacao/PainelCaixaOperacao.tsx`; `backend/scripts/pdv-individual-permissions.isolated.test.mjs`; `e2e/rbac-live/operational-session.spec.ts`; `backend/scripts/run-pdv-unico-git-snapshot-qa.mjs`; `docs/testing/rbac-functional-assessment-2026-10-10.md`; `docs/testing/rbac-functional-assessment-2026-10-10.json`; `docs/architecture/pdv-individual-permissions-action-matrix.md`; and `artifacts/rbac-permissions-ui-2026-10-10/rbac-final-evidence.json` plus its console log. Runner-owned temporary snapshots and disposable services were removed. The remaining 25 browser cases, full `CANONICAL_PDV`/`LEGACY` permutations, global-admin contract, and alternate UI endpoints are pending; they are not treated as passed or product failures.

## Latest isolated continuation (10 Oct 2026)

The final focused snapshot is `e534a777df434cb96d65c98d98e080ccc746faaf` (tree `c63d578183b7bf9e03306e0dabf0ff98b32257ea`). It materialized 1,448 tracked Git blobs, audited 198 project modules with zero mutable-workspace imports, passed backend/frontend builds and 14/14 activation preflight tests, and passed the authenticated Fastify/PostgreSQL API suite. Playwright passed 1/1 against that exact API and frontend build; two simultaneous staff sessions remained authenticated across grants/revokes, same-browser logout/login changed to a second synthetic tenant, and 390px/768px layouts had no horizontal overflow. Checkout/index status and the exact source tree remained unchanged. The disposable PostgreSQL container and the snapshot were removed.

The latest browser evidence proves all three stages for `command.read`, `cash.values.read`, `agenda.manage`, `dashboard.read`, `command.operate`, `reports.read`, `clients.manage`, `inventory.read`, `inventory.adjust`, `kitchen.read`, `kitchen.operate`, and `cash.movement.write`. That leaves **36/84 UI stages PASS** and **48/84 NOT RUN** across the other 16 keys. The representative API suite still passed enabled/denied cases for all 28 catalog keys; API evidence does not substitute for those missing UI stages or the alternate route, business-setting, LEGACY/CANONICAL_PDV, and global-admin cases. Full certification remains **incomplete**.

The first rerun on `509e56a` reproduced a UI crash on the sanitized cash fallback. `PainelCaixaOperacao` calculated close differences by dereferencing the intentionally absent `sessao.gaveta`; commit `3df315c84bdf8a14e624568ba9651da5fd810a5e` guards financial rendering/calculation while restricted, loading, or errored and does not replace omitted values with zero. The exact final snapshot `e534a77` passed the cash regression after the correction. An intermediate run then exposed a Playwright logout/login navigation race; the harness retry was committed as `e534a777df434cb96d65c98d98e080ccc746faaf` and the same-browser tenant-switch scenario passed.

Final receipt: [`final-live-e534a77.json`](../../artifacts/rbac-permissions-ui-2026-10-10/results/final-live-e534a77.json). Playwright output: [`playwright-results.json`](../../artifacts/rbac-permissions-ui-2026-10-10/run-0895b4cfd740d8a8/live-results/playwright-results.json) and [`browser-run.log`](../../artifacts/rbac-permissions-ui-2026-10-10/run-0895b4cfd740d8a8/live-results/browser-run.log). No PROD access or shared DEV writes occurred during these tests.
