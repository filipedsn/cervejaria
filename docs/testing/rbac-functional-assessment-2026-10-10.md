# Validação funcional RBAC — 2026-10-10

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
