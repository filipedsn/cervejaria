# Plano de testes: PDV único

## Revisão e9b1afb — isolamento da cobrança de cozinha — 05/10/2026

**Reprodução antes da correção:** comanda aberta, pedido `RECEBIDO`, item de preparo de R$ 10,00, configuração legada `true` e canônica `false`, o `resumoComanda` retornava total R$ 0,00 e pendente R$ 10,00 sem ativação. O include operacional também selecionava `configuracaoPdv` em todos os casos.

**Executado após a correção:**

| Cenário | Fonte efetiva | Resposta e total persistido | Pagamento enquanto pedido `RECEBIDO` |
|---|---|---|---|
| Ativação ausente; legado `true`, PDV `false` | Legado | Total R$ 10,00; pendente R$ 0,00 | PIX 200; R$ 10,00 persistidos; pedido continua `RECEBIDO` |
| Ativação QA; PDV `false`, legado `true` | PDV | Total R$ 0,00; pendente R$ 10,00 | 409; nenhum pagamento; comanda permanece aberta |
| Ativação QA; PDV `true` | PDV | Total R$ 10,00; pendente R$ 0,00 | PIX 200; R$ 10,00 persistidos; pedido continua `RECEBIDO` |

Também foi executada a consulta real do include em PostgreSQL QA isolado com schema pré-aditivo e sem a tabela `ConfiguracaoPontoVenda`; consulta concluiu com ativação desligada. O teste puro exige contexto canônico quando o guard está ligado, e confirma precedência de `false` explícito sobre o legado. Bloqueios por configuração canônica ausente/ambígua e leituras/escritas de tenant cruzado permaneceram cobertos pela cadeia Fastify autenticada existente.

**Gates executados nesta rodada:** `npm run build` PASS; testes focados `venda.test.ts` e `comanda-adapter.test.ts` 17/17 PASS; `npm run qa:pdv-current-disposable` PASS agregado (histórico, financeiro e comercial, nenhum skip). Nenhuma migration candidata foi criada. O runner criou e removeu apenas recursos temporários do PostgreSQL QA. Não houve consulta ou escrita no DEV compartilhado, nem acesso a PROD. Não prova migração de dados reais, UI, RBAC global, cutover ou remoção do legado. `PROD_ACCESS_USED=NO`.

## Registro da entrega anterior — leitura canônica e API Por Caixa autenticada — 05/10/2026

Em QA descartável, o perfil operacional lê `PontoVenda` + `ConfiguracaoPontoVenda` sob ativação técnica exclusiva do runner. A flag é desligada por padrão; sem ativação, o teste puro comprova que nenhum delegate aditivo é lido. Com ativação, ausência de PDV/configuração e PDV múltiplo são bloqueios, sem fallback para legado. Nesta entrega passaram o build do backend, 28 testes puros focados e `npm run qa:pdv-commerce-disposable` sobre 91 migrations. `npm run qa:pdv-current-disposable` (etapas histórica, financeira e comercial agregadas) não foi reexecutado nesta rodada.

O executor usa `buildApp`/`Fastify.inject` e autenticação real. Exercitou tenants sintéticos originalmente EVENTO e CAIXA pelo mesmo fluxo de abrir caixa, escolher cardápio, abrir comanda, vender, pagar PIX e fechar. Resultado persistido: 950¢ × 2 = 1.900¢/PIX 1.900¢ no tenant EVENTO e 400¢ × 2 = 800¢/PIX 800¢ no tenant CAIXA; sessões FECHADO, troco/contagem dinheiro 500¢, snapshots preservados e estoque sem alteração sob configuração canônica false. Retornos: fluxo 201/200/201/201/200/200; credencial ausente/token inválido 401; atendente em rota `requireDono` 403; IDs cruzados 404; sem PDV, sem configuração e múltiplos PDVs 409 com bloqueadores distintos. Foram comparadas contagens totais de PDVs/configurações e registros operacionais antes/depois das tentativas negadas. Não cobre UI, RBAC além das recusas pontuais indicadas nesta fixture, nem operação fora dessas rotas. Não representa migração de dados reais, corte ou cobertura global.

**Pendente de produto:** (1) flag de produto para criar pedido de cozinha independente sem separar comanda/financeiro; regra de agrupamento de múltiplas unidades ainda indefinida. (2) permissões individuais por ação dos usuários da empresa, dono com acesso completo, enforcement no backend e seletores na UI. Nenhum desses cenários está implementado ou certificado.

### Fatos anteriores mantidos como histórico

## Estado atual da certificação — entrega baseada em 2926b97b

**Implementado:** hash Decimal exato versionado; revalidação completa das ocorrências confirmadas; reconciliação comercial por nova leitura do PostgreSQL; manifesto corrente com schema/SQL/código e runners fixados sem depender do índice Git; preflight explícito para pedido de cozinha legado sem PDV apontado por movimento de estoque com PDV.

**Ensaiado nesta entrega em QA descartável:** `npm run qa:pdv-current-disposable` passou nas etapas histórica, financeira e comercial integrada. A cadeia comercial cobriu dois tenants no mesmo banco, revalidação dos runs anteriores, replay no mesmo/novo run, rollback/retomada, divergência após leitura, pais históricos de item/opcional/status, dependências de ocorrência adulterada e concorrência com lock observado. O preflight da migration sobre pedido legado sem PDV ligado a movimento de estoque bloqueou de forma específica e preservou as linhas antigas.

**Pendente / NÃO COMPROVADO:** não houve migração de negócio em DEV; o caso legado que falha no preflight requer backfill com evidência e validação posterior da FK; cobertura global de comandas não atribuíveis, ledger integral de estoque, reconciliação de dados reais, API/UI autenticadas, realtime/PWA, login/RBAC, operação e recuperação de infraestrutura continuam gates separados. Nenhum cenário planejado deve ser contado como executado.

Os quadros anteriores são **evidência histórica** das entregas indicadas, não resultado automático desta execução. A bateria atual é `npm run qa:pdv-current-disposable`; seu resultado agregado foi PASS apenas após histórico, financeiro e teste integrado concluírem sem falha ou skip obrigatório.

Status: cobertura separa planejado, executado e NAO COMPROVADO. Os cenarios QA de escrita ficam limitados ao PostgreSQL descartavel e nao autorizam migracao em DEV/PROD nem remocao de tabelas.

## Inventário funcional e configuração

O modelo alvo tem um PDV por empresa; configuração operacional explícita; catálogo compartilhado pelo PDV; múltiplos cardápios com produto/volume/preço; ajuste de preço por turno; agenda opcional separada de ocorrências; sessão que guarda ocorrência de origem; cliente único; financeiro, estoque, cozinha e portal comuns. Categorias configuram participação e medida (unidades ou volume). Ranking por ocorrência, por mês e geral da recorrência, mais recortes mensal/geral do PDV e histórico de cliente. Itens vendidos guardam snapshots de preço, volume, categoria/medida e opcionais. Dívida não muda origem; cancelamento/estorno ajusta estoque e pontos segundo política aprovada.

As flags sensíveis são `tapsEnabled`, `inventoryEnabled` e `kitchenEnabled` em `ConfiguracaoOperacional`. A matriz abaixo executa as oito configurações necessárias uma vez com sessão sem ocorrência e uma vez com ocorrência fixa. Para cada célula usa venda em tap, venda de produto controlado por estoque e item de cozinha, inspecionando o efeito ligado e a recusa/ausência de efeito quando desligado. Os fluxos sem dependência direta dessas flags não são multiplicados pela matriz.

## Matriz de capacidades

| Bits T/S/K | Taps | Estoque | Cozinha | Sem ocorrência / com ocorrência | DB/API/UI esperado em ambos os contextos | Prioridade/camada | Executor/estado |
|---|---:|---:|---:|---|---|---|---|
| 000 | off | off | off | CAP-00 / CAP-10 | Sem efeito de tap, saldo ou preparo; APIs recusam capacidades desligadas e UI não oferece ações. | P0 integration | Pendente |
| 001 | off | off | on | CAP-01 / CAP-11 | Só fila de cozinha é ativada; sem tap/baixa de estoque. | P0 integration | Pendente |
| 010 | off | on | off | CAP-02 / CAP-12 | Só baixa/estorno de estoque; sem tap/cozinha. | P0 integration | Pendente |
| 011 | off | on | on | CAP-03 / CAP-13 | Estoque e cozinha atuam; tap permanece indisponível. | P0 integration | Pendente |
| 100 | on | off | off | CAP-04 / CAP-14 | Só tap elegível de chope; sem baixa de estoque ou preparo. | P0 integration | Pendente |
| 101 | on | off | on | CAP-05 / CAP-15 | Tap e cozinha atuam; estoque não é movimentado. | P0 integration | Pendente |
| 110 | on | on | off | CAP-06 / CAP-16 | Tap e estoque atuam; sem fila/preparo. | P0 integration | Pendente |
| 111 | on | on | on | CAP-07 / CAP-17 | Tap, estoque e cozinha atuam com vínculos e totais únicos. | P0 integration | Pendente |

## Cenários

Em toda ação autenticada, conferir resposta/API, linhas e vínculos no banco e estado apresentado na UI. Erros de API não podem deixar writes parciais; realtime deve refletir o estado persistido após commit.

| ID | Pré-condições, configuração e estados | Ação | Resultado esperado no DB / API / UI | Prioridade / camada | Executor atual |
|---|---|---|---|---|---|
| AUTH-01 | Dono, atendente, sessão válida; token expirado/revogado e papel sem permissão | Ler e mutar cadastro, caixa e auditoria | 401/403 sem write para não autorizado; sessão válida vê apenas funções do papel | P0 E2E | Login real pendente; teste de rota QA injeta usuário e não comprova RBAC |
| TEN-01 | Duas empresas e IDs cruzados de PDV, evento, cliente, cardápio, sessão | Tentar ler/alterar/excluir ID de outra empresa em cada API | 404/403 sem alterar dados nem emitir evento realtime no tenant errado | P0 integration/E2E | Parcial em EVT-DEL-03, simulação de tenant |
| PDV-01 | Empresa nova e empresa existente | Provisionar empresa/PDV/configuração repetidamente e concorrentemente | Exatamente um PDV; operação atômica; retry não duplica | P0 integration | Pendente |
| PDV-02 | Legacy sem PDV, um PDV e múltiplos PDVs | Ler/atualizar/arquivar PDV e configurações | Uma relação canônica; conflito legado explícito; sem escolher pelo nome | P0 integration | Pendente |
| CFG-01 | Cada capacidade ausente/null/false/true | Provisionar e alterar configuração | Defaults explícitos e estáveis; NULL legado não vira habilitação silenciosa | P0 unit/integration | Pendente |
| OPCFG-API-01 | Tenant EVENTO mantém `plannedOperationsEnabled=true`; tenant CAIXA; flags antigas divergentes; origem sintética já migrada para um PDV/configuração | Login real; abrir caixa, selecionar cardápio, abrir comanda, lançar produto, PIX e fechar pelas mesmas rotas para os dois tenants; tentar contexto com zero PDVs, config ausente e PDV múltiplo | Perfil retorna CAIXA e `CANONICAL_PDV`; usa flags/mesas canônicas sem reescrever a flag legada; preços, snapshot, pagamento, sessão e estoque conferidos; erros específicos 409 e nenhum PDV/config/sessão/comanda/item/pagamento escrito nas tentativas negadas | P0 integration/API | `pdv-unico-commerce-migrator.isolated.test.mjs` — executado em QA descartável nesta entrega; UI pendente |
| CAT-01 | Produtos ativos/inativos, nome duplicado, categoria existente | CRUD, busca, ordenação e desativação | Referências e vendas preservadas; ID e tenant corretos | P1 integration/E2E | Pendente |
| MENU-01 | 2 cardápios, produto com volume 0 e vários volumes | Associar produtos e preço por volume; abrir caixa escolhendo menu | Uma linha por produto/volume; não permitir associação cross-tenant | P0 integration/E2E | Pendente |
| MENU-02 | Preço padrão, preço de cardápio e override de turno em centavos | Abrir caixa, vender, editar preço futuro | Precedência turno → cardápio → produto; venda guarda preço/volume histórico; edições futuras não alteram | P0 unit/integration | Pendente |
| MENU-03 | Item com grupos de opcionais apenas se a capacidade estiver comprovada | Vender e consultar snapshot histórico | Validar limites suportados; comportamento obrigatório/opcional aguarda decisão de produto | P1 integration/E2E | Pendente; requisito não aprovado |
| SALE-01 | Caixa com e sem ocorrência; comandas vazia, identificada, fechada | Abrir, lançar produto, ajustar quantidade/desconto e fechar | IDs, sessão e origem persistidos; total exato em centavos; duplicate retry idempotente | P0 integration/E2E | Pendente |
| SALE-02 | Quantidade parcial, estoque e cozinha ligados/desligados | Cancelar linha e cancelar parcialmente | Status/quantidade e devolução de estoque uma vez; sem ledger paralelo; UI atualizada | P0 integration/E2E | Pendente |
| SALE-03 | Item em recebido, preparo, pronto, entregue, cancelado | Transicionar, entregar, cancelar após cada estágio | Transições permitidas; estoque e ranking conforme política; transição duplicada sem efeito duplo | P0 integration/E2E | Pendente |
| FIN-01 | Pagamento único/misto por forma, limites em centavos; taxa somente se capacidade aprovada e comprovada | Fechar comanda e consultar caixa/relatório | Soma por forma fecha com total; valores exatos em centavos; sem dupla cobrança ao repetir. Taxas aguardam decisao de produto | P0 unit/integration | TAP-77 parcial; aceite funcional pendente |
| FIN-02 | Conta original, parcial, quitada; cliente ativo/inativo | Receber dívida em várias formas e consultar fora do turno | Saldos coerentes; pagamento preserva origem original e não transfere ranking/ocorrência | P0 integration/E2E | Pendente |
| FIN-03 | Estorno/cancelamento de venda já fechada | Estornar com pagamentos, caixa fechado e caixa reaberto | Histórico imutável; contralançamento; saldo, relatório e estoque reconciliados | P0 integration | TAP-8/10 refinamento pendente |
| CASH-01 | Sessão ausente, aberta, fechada; dois pedidos concorrentes | Abrir/movimentar/fechar caixa | No máximo uma sessão aberta; movimento exige caixa aberto e mesmo tenant; conferência preservada | P0 integration | Parcial em testes de operação |
| CASH-02 | Suprimento/sangria positivos, zero, limite superior, usuário sem permissão | Criar movimento e fechar | Limites validados; esperado por forma e gaveta correto; sem movimento por request inválida | P0 unit/integration | Pendente |
| INV-01 | Unidade, volume, estoque baixo/zero e movimento anterior | Vender/cancelar/estornar e reconciliar | Débito/crédito idempotente na unidade correta; histórico imutável; saldo nunca negativo quando política proíbe | P0 unit/integration | Pendente |
| KITCH-01 | Cozinha ligada/desligada, TV conectada/desconectada | Lançar, preparar, marcar pronto e entregar | Fila contém somente itens aplicáveis; API e TV convergem após reconnect; sem cobrança/baixa duplicada | P0 integration/E2E | APIs existem; validação visual de TV pendente. Impressora não aprovada nem comprovada |
| EVT-01 | Sem agenda, série semanal, ocorrência normal e exceção cancelada | Criar/editar agenda e ocorrências | Agenda não altera regra comercial; recorrência gera ocorrências sem duplicar; exclusões de data estáveis | P1 integration/E2E | Parcial em EVT-DEL-04 |
| EVT-02 | Caixa abre em ocorrência A; agenda depois renomeada/trocada; dívida recebida depois | Registrar venda, editar agenda e receber dívida | `sessao.ocorrenciaId`/origem e itens permanecem A; nenhuma transferência automática | P0 integration | Pendente; seleção de ocorrência é proposta de produto |
| RANK-01 | Categorias com pontuação on/off e medida quantidade/volume; mistura de produtos | Entregar, cancelar e estornar itens | Snapshot categoria/medida usado; pontos mudam uma vez conforme política aprovada; dívida não apaga consumo | P0 unit/integration | Pendente; momento da pontuação ainda pendente |
| RANK-02 | A e B da mesma recorrência; C de outra; meses distintos | Consumir em todas e consultar recortes | Por ocorrência isola A/B; mensal/geral agrega A+B apenas; outra recorrência excluída | P0 integration/E2E | Pendente |
| CRM-01 | Cliente duplicado por telefone normalizado e sem telefone; contas a receber | Resolver/mesclar clientes e consultar histórico | Um cliente PDV; contas, pagamentos e origens mantidos; sem colisão de unicidade/telefone | P0 integration | Merge parcial; cenário financeiro pendente |
| PORT-01 | Portal válido/revogado, produto sem estoque, cozinha off, repetição e concorrência | Criar pedido pelo portal e acompanhar | Origem, confirmação/lançamento e sessão corretos; sem duplicação; UI mostra estado real | P0 E2E | Autenticação de portal pendente; fluxo direto é proposta pendente |
| PORT-02 | QR legado e link inválido/expirado | Abrir portal e redirecionar | Destino único sem validar segredo como sessão; resposta uniforme e origem preservada | P1 E2E | Pendente |
| REP-01 | Vendas canceladas, dívidas, pagamentos tardios, sessões/ocorrências cruzadas | Consultar diário, mensal, geral e financeiro | Totais em centavos por origem/tenant/período; exclusões explícitas; ranking distinto de recebimento | P0 integration/E2E | Parcial; ver TAP-76/77 |
| RT-01 | Socket desconectado durante venda/caixa e volta posterior | Escrever e reconectar | Evento emitido só após commit; snapshot recupera estado; tenant correto | P1 integration/E2E | Pendente |
| PWA-01 | Rede indisponível durante venda; reconexão e resposta perdida | Tentar venda offline; confirmar indisponibilidade; reconectar e repetir com segurança | UI informa indisponibilidade e não confirma nem enfileira venda offline; após reconexão servidor é autoritativo; retry idempotente suportado não duplica | P1 E2E | Pendente; PWA não possui fila offline de vendas. Evidência UI separada dos testes DB/API |
| AUD-01 | Exclusão/reversão, comando vazio, falha e retry | Consultar `TransacaoLog` e stream após commit | `eventoId/comandaId` nulos quando removidos; `entidadeId` original e metadados preservados; sem sucesso pré-commit | P0 integration | EVT-AUD-01..03 implementado em QA |
| DEL-01 | Evento e caixa aberto/fechado, sessão com movimento | Tentar excluir/reverter | 409; sessão/movimento (ID, valor, tipo e sessão) intactos; sem log de sucesso | P0 integration | EVT-DEL-01/02 em QA; sem movimento em fixture ainda |
| CON-01 | Primeira sessão e exclusão/reversão concorrentes | Coordenar as duas ordens com barreiras DB | Criação vence: exclusão 409 e sessão persiste. Exclusão vence: abertura falha e nenhuma sessão órfã | P0 integration | EVT-CON-01..04 com triggers e pg_stat_activity |
| FK-01 | Dados sessão/movimento anteriores à FK restritiva | Executar migration em DB isolado e consultar constraint | IDs/valores preservados; DELETE direto com caixa bloqueado; DELETE sem caixa permitido; `confdeltype='r'` | P0 integration | `event-cash-fk.isolated.test.mjs` |
| MIG-01 | Mapa vazio/parcial/completo e retomada | Migrar escopo registrado repetidamente | Identidade estavel, sem destinos duplicados; checkpoint aponta so lotes confirmados | P0 integration | `pdv-unico-business-migrator.isolated.test.mjs`: escopo PDV/agenda/ocorrencia executado em QA; outras entidades planejadas |
| MIG-02 | Casos órfãos e divergência intencional | Reconciliar valores centavos, pagamentos, dívidas, estornos, movimentos, clientes, ranking | Diferença bloqueia corte e é listada; nenhuma associação ou pagamento inventado | P0 integration | Pendente |
| MIG-03 | Backup, restore, corte e rollback | Ensaiar recuperação integral em QA | Dados e IDs restaurados; consumidores alternáveis; nenhuma tabela substituída é abandonada vazia | P0 integration/E2E | Pendente |
| MAP-01 | One/no PDV with single trailer; multiple PDVs/trailers; null and non-null links | Validate source graph and plan target transformation | sourceValidation, targetMapping and executionEligibility are separate. Every record remains NOT_AUTHORIZED; incomplete transformation is never executable. ID preservation does not mean links are transformed. | P0 unit | pdv-unico-migration-planner.test.ts, passed |
| MAP-02 | Comanda EVENTO com Evento ausente/bloqueado; comanda CAIXA/QUIOSQUE com PDV ausente | Planejar cada grafo | Bloqueio tipado com código/evidência; evento/PDV pai inválido bloqueia comanda | P0 unit/integration | Testes puros; fixture DEV isolada pendente |
| MAP-03 | Comanda bloqueada com itens, opcionais, pagamentos, dívida, pedido, sessão, movimento e montagem dependentes | Planejar grafo em ordem e ordem invertida | Bloqueios propagam pelo pai; dependência resolvida apenas por tipo/ID/tenant | P0 unit | Planner cobre propagação de cliente/pedido; fixture completa pendente |
| MAP-04 | Payment with zero/one/two sessions or cross-tenant session; valid/invalid command and debt | Build graph from observed rows | Missing, dual or cross-tenant reference blocks payment; amount, method, date, IDs and balance remain exact | P0 unit/integration | Pure test and PDV-GRAPH-QA-01 passed; Prisma fixture supplied rows, no injected blocker |
| MAP-05 | EVENTO command with matching Evento+PDV links, then incompatible links | Plan both graphs | Dual link passes only when both resolve to same PDV; true mismatch has typed evidence | P0 unit/integration | Pure test and synthetic Prisma fixture passed |
| MAP-06 | Valid EVENTO debt; debt with missing command/client/parent | Plan debt and receipts | EVENTO origin alone is valid; preserve ID, principal, client, command, payments and balance. Missing parent blocks. | P0 unit/integration | Pure test and synthetic Prisma fixture passed; valid EVENTO debt has no blocker |
| MAP-07 | Produto, cliente ou pedido de outro tenant; produto/opcional/tap/pedido ausente | Planejar pedido, item e seus filhos | Pai cruzado/ausente bloqueia origem e dependentes; nenhum tenant é inferido por nome | P0 unit/integration | Planner puro cobre tenant de pedido/cliente/produto; fixtures de consulta pendentes |
| MAP-08 | Mesmos registros em ordens distintas, inclusive agenda/ocorrência e pais depois dos filhos | Reexecutar planejamento | Saída byte a byte estável e ordenada; ciclos/missing parents não passam | P0 unit | `pdv-unico-migration-planner.test.ts` |
| MAP-09 | Single/multiple trailer; recurring definition and dated occurrence; Event cash; historical command | Map to target contract | Trailer maps to PDV; recurring definition to agenda and each dated occurrence to an occurrence linked to agenda; Event cash maps to the single Por Caixa session with occurrence and historical origin; command preserves origin. Undefined financial transforms remain incomplete and not executable. | P0 unit | pdv-unico-migration-planner.test.ts, passed |
| PDV-GRAPH-QA-01 | Two synthetic tenants, valid/missing IDs, EVENTO debt, Evento+PDV command, payment with two sessions and missing reference | Read RepeatableRead read-only snapshot and build graph with inventory shared functions | Valid debt/coherent command accepted; incompatible links, missing refs, tenant mismatch and two sessions detected; parent blocker reaches children; IDs, cents and snapshots exact | P0 integration | pdv-unico-planner.isolated.test.ts, disposable QA passed |
| SNAP-01 | Venda sintética com cliente, autores, dinheiro, itens/opcionais, cancelamento, preparo/viagem e timestamps | Projetar saída redigida | IDs, centavos, volumes, quantidades e datas persistem na saída; nome/contato/observação não aparecem; data UTC fallback vem marcada não comprovada | P0 unit | `pdv-unico-snapshot.test.ts` |
| CFG-02 | Explicit config absent/present and legacy config active/inactive with equal/divergent flags | Read effective behavior; do not synchronize | Por Caixa comes from plannedOperationsEnabled; inventory/kitchen use explicit flags when present and legacy values as fallback. Preserve effective state; unresolved precedence remains blocked. | P0 unit/integration | Precedence verified in operacao/capacidades.ts; pure test passed. No DB config writes. |

## Testes disponiveis e estado

- backend/scripts/event-deletion.isolated.test.ts: synthetic isolated fixtures for routes, audit, tenant, existing rules, rollback and concurrency. Test decorator injects identity; it does not prove real login/RBAC.
- backend/scripts/event-cash-fk.isolated.test.mjs: migration chain and restrictive FK test against disposable PostgreSQL; validates prior session/movement preservation, direct DELETE behavior and catalog constraint.
- backend/scripts/pdv-unico-source-graph.ts: shared source snapshot reader and graph builder. Import does not instantiate/connect Prisma; inventory and QA call the same functions.
- backend/scripts/pdv-unico-planner.isolated.test.ts: synthetic Prisma fixture; RepeatableRead/READ ONLY and actual graph construction. PDV-GRAPH-QA-01 passed.
- backend/scripts/pdv-unico-migration-planner.test.ts: pure tests for source validation, target mapping, non-authorization, ancestry, precedence and exact decimals.
- backend/scripts/inventory-pdv-unico-env.test.ts and backend/scripts/isolated-qa-env.test.mjs: pure environment guards; no database connection.
- backend/scripts/pdv-unico-snapshot.test.ts: IDs, cents, quantities, volumes, states and timestamps; excludes PII.
- backend/scripts/run-pdv-unico-disposable-qa.mjs: validates exact QA destination before connection, creates a labeled loopback/tmpfs PostgreSQL container and removes only its own container.
- backend/scripts/pdv-unico-qa-migration-manifest.mjs: reconstructs exact tracked migrations from Git blobs and verifies hashes.

The manifest docs/testing/pdv-unico-qa-migration-manifest.json pins base ccd1f1f96b92843b42f319c4bb07a749fa99e9d2, 86 tracked migrations and SHA-256 78f4a3857d8fdbdb706843f3c3891b879bc096e8550bb3c89a1e83ed1ea9af60. The runner applied the first 85, inserted session/movement fixtures, then applied the 86th restrictive FK migration. The untracked local phone migration is not in the base Git tree, is excluded from the pinned manifest and remained untouched. Temporary PostgreSQL was removed by the runner. No migration was applied to shared DEV.

## Inventario, mapeamento e conciliacao

The DEV inventory is read-only and uses a RepeatableRead, READ ONLY transaction. It reads rows using the shared snapshot function and builds the dependency graph with the same builder used in QA. The graph validates source references, tenant ownership, payment session references and blocker propagation. This does not implement business writes.

The read-only planner keeps source validation, target mapping, and NOT_AUTHORIZED execution eligibility separate. The first scoped business migrator is separate, QA-only, uses the shared graph, and changes no operational routes. Event cash, commands, payments, debts, catalogue, and stock are outside its scope.

Effective configuration follows proven consumers in operacao/capacidades.ts: plannedOperationsEnabled selects EVENTO versus CAIXA (Por Caixa); explicit inventory/kitchen flags take precedence and legacy values are fallback. Client DEV B measures explicit inventory/kitchen true while legacy flags are false; effective mode is CAIXA, inventory and kitchen enabled. No config rows were synchronized. Behavior without proven precedence remains a decision gate.

DEV inventory measured 114 blocked rows: 29 root multi-PDV choices, 5 root multiple-trailer choices and 80 propagated dependent rows. It observed zero payment session conflicts, zero missing command destinations and zero cross-tenant command links. These measured DEV facts are separate from user-provided requirements and synthetic QA results; they do not certify all source rows or target transforms.

Financial, inventory and ranking reconciliation remain future gates: compare commands by origin/state/operational date; payments by method/receipt date including negatives; debt principal/receipts/balance; sessions/movements; and stock by product/unit. Use scaled integers/BigInt and never sum unlike units. Every variance needs entity/ID and cause or NOT PROVEN.

## Evidencia executada nesta entrega

- Disposable migration/FK QA: PASS, all 86 migrations from pinned Git manifest; existing session/movement preserved; direct DELETE with history restricted, without history allowed, confdeltype=r verified.
- Event deletion QA: PASS, 8 tests, 0 skipped, including open/closed cash blocks, movement preservation, tenant, agenda/command, audit, rollback and both concurrency orders with PostgreSQL barriers.
- PDV-GRAPH-QA-01: PASS, synthetic fixtures through shared reader and graph builder; dual/missing payment refs and tenant mismatch derived from DB rows; exact IDs/cents/snapshots checked.
- Pure tests: 10 passed, 0 failed/skipped (planner, snapshot, DEV env guard and QA env guard).
- Script typecheck tsc --noEmit -p tsconfig.scripts.json: PASS. Backend npm run build: PASS. git diff --check: PASS (only line-ending warnings).
- DEV inventory was read-only: 114 blocked rows (29 multi-PDV decisions, 5 multiple-trailer decisions, 80 dependent rows); 0 payment conflicts and 0 cross-tenant command links.
- QA code was based on ccd1f1f96b92843b42f319c4bb07a749fa99e9d2 plus working-tree delivery changes; final package was rerun after the final planner change. Manifest migration source came from pinned Git blobs. No business migration ran.

NOT PROVEN: real login/RBAC E2E, full DEV source-to-target coverage, financial/stock reconciliation, restart/recovery for out-of-scope entities, ranking isolation by occurrence/recurrence, and all 8 capability combinations with/without occurrence. QA restart/rollback/concurrency evidence below covers only the first PDV/agenda/occurrence slice.
## Gates

**Rápido (PR):** build backend/frontend; unitários de domínio/preço/centavos/estados; lint/typecheck; validação de migrations; testes puros de guards. Sem skips silenciosos.

**Completo (DEV/QA):** gates rápidos; todos os cenários P0 de integração; matriz `CAP-00..17`; pagamentos, cancelamento parcial, dívida, estoque e cozinha; isolamento de tenant; duas ordens de concorrência com barreiras explícitas; relatório de contagens e valores reconciliados. Cada fixture obrigatória ausente torna o gate BLOQUEADO, nunca PASS.

**Pós-migração (QA isolado antes de release):** executar migrador duas vezes, hash/conciliação completa, interrupção e retomada, restore/rollback, regressão de UI/portal/PWA/realtime, auditoria e ausência de tabelas paralelas. Só evidência funcional observada permite aceite; batch DONE, skip, HTTP 200 e busca textual não certificam cenário.
## Ensaio do primeiro schema aditivo (executado)

- Candidate base: cafec78d55a7ee8af1240092e972816fb921c790. Historical manifest unchanged: ccd1f1f96b92843b42f319c4bb07a749fa99e9d2, 86 migrations, SHA-256 78f4a3857d8fdbdb706843f3c3891b879bc096e8550bb3c89a1e83ed1ea9af60.
- Candidate 20261003210000_additive_pdv_operational_core: SQL SHA-256 95f1b4535510615d9355f9d018f87849ae71cbf955bdc95ec7b232ce8dacd719; selected schema SHA-256 53d7ffb037c43da4031b3de64798d32681a492ec3998e5ac9e831bcfc427eba7; candidate manifest SHA-256 ed857e86728fc541f01a1441d1c8b65bd3a0ac2f21b51b5dc48150ad35dc3557. Exact composition: historical 86 plus candidate = 87.
- Prisma validate/generate used the selected schema, and the compatible generated client executed the fixture. Existing Por Caixa session and movement IDs/values persisted; avulsa/recurring creation passed; mismatched tenant/PDV, invalid weekday, duplicate agenda/date and cross-run/batch mismatch were rejected; RESTRICT constraints blocked deletion; map upsert reused one source identity across runs; transaction rollback removed run/batch/map/checkpoint effects.
- Prior FK suite, all 8 event deletion/audit/concurrency scenarios (0 skips), and PDV-GRAPH-QA-01 passed again. Audit fixture now proves tenant-wide log count and ID in snapshot and graph after the real delete route; detached FKs do not require the deleted Evento.
- QA disposable container and generated per-run clients were removed. Shared DEV was untouched; no business backfill or migration was run there.

NOT PROVEN: migracao de dominios fora do escopo, reconcilicao financeira/estoque do produto, recuperacao de outros dominios, repeticao integral, corte operacional e politicas de produto. Schema e primeira fatia de dados PDV/agenda/ocorrencia foram ensaiados somente em QA.


## Primeira fatia do migrador: cenarios executados em QA

| ID | Configuracao e pre-condicao | Acao | Verificacao observada | Camada/prioridade | Estado |
|---|---|---|---|---|---|
| MIG-PDV-01 | Empresa com PDV existente e um Trailer; outra empresa sem PDV e um Trailer | Executar o mesmo migrador | PDV existente nao duplica; Trailer unico cria PDV de ID estavel; mapa guarda tenant/PDV | P0 integration | Executado: `pdv-unico-business-migrator.isolated.test.mjs` |
| MIG-PDV-02 | Definicao semanal, duas ocorrencias em datas distintas e Evento avulso datado | Migrar agenda e ocorrencias | IDs, datas, horas, local, nomes, timestamps, status e agendaId preservados; avulso permanece sem agenda | P0 integration | Executado em QA descartavel |
| MIG-PDV-03 | Multiplos PDVs, multiplos Trailers, data ausente e Trailer de outro tenant | Planejar/executar escopo | Bloqueio por codigo especifico; sem destino do registro invalido nem avanco de checkpoint correspondente | P0 integration | Executado em QA descartavel |
| MIG-PDV-04 | Escopo valido; limite de lote e falha injetada apos criacao do destino | Interromper entre lotes e dentro de transacao; retomar | So lotes confirmados persistem; falha intralote reverte destino/mapa/batch; retomada termina sem duplicar | P0 integration | Executado em QA descartavel |
| MIG-PDV-05 | Mapa existente, payload alterado, destino ausente/adulterado e duas execucoes independentes | Reexecutar/concorrer | Payload/conteudo divergente bloqueia sem sobrescrever; lock por tenant/escopo; IDs unicos e ambos os runs concluidos | P0 integration | Executado em QA descartavel |
| MIG-PDV-06 | DEV compartilhado, host aleatorio, banco/nome fora da allowlist | Invocar executor antes de carregar Prisma | Rejeicao pela validacao de URL; loader Prisma nao chamado; importar modulo nao executa | P0 unit | Executado sem banco em `pdv-unico-business-migrate-env.test.mjs` |

O ensaio usou schema/SQL imutaveis do commit-base `ed5380e67078255efb0bfeb34b832e9d4771a85f`, 86 migrations historicas mais o SQL aditivo do baseline (87). O manifesto com candidatos de schema/migration vazios e hashes do codigo tem digest `cc8af07b155bfca5a7120d688b4693d5fc32702ba1582672b55099373adc679e`. Nenhuma migration ou dado foi escrito em DEV. Contagens antes/depois/reexecucao, hashes e escopo estao na saida QA e na evidencia da TAP-76.

**Planejado, ainda nao executado:** migrar comandas, pagamentos, movimentos, dividas e estoque com as referencias para sessoes ja mapeadas; reconciliacao financeira/estoque; recuperacao apos interrupcao nesses dominios; migracao repetida de todo o produto; teste de corte/rollback; isolamento dos rankings por ocorrencia/recorrencia; gates reais de autenticacao e RBAC. Conclusao do run atual significa apenas conclusao do escopo PDV/agenda/ocorrencia registrado.

## Certificacao de retomada e finalizacao do run (executado em QA)

O helper `validateConfirmedState` e compartilhado por retomada, cada lote e finalizacao. Ele valida identidade/escopo/hash da fotografia, prefixo ordenado, `lastSourceKey`, sequencia e intervalos dos lotes, hash do lote, recibos completos em ordem, mapa de origem, hash/destino real e dependencias. Run concluido reutilizado passa pela mesma verificacao integral antes de retornar `COMPLETED`. Qualquer divergencia retorna bloqueio tipado e conserva o checkpoint confirmado; nenhuma rotina repara destinos ou mapas.

| ID | Pré-condição e ação | Verificação | Camada/prioridade | Estado |
|---|---|---|---|---|
| MIG-RUN-01 | Executar duas vezes o mesmo run íntegro | Segunda chamada valida novamente e retorna `COMPLETED`; contagens não aumentam | P0 integration | Executado em QA descartável |
| MIG-RUN-02 | Run concluído; adulterar agenda ou PDV | `MAPPED_DESTINATION_DIVERGED`; conteúdo adulterado e checkpoint ficam como estavam | P0 integration | Executado em QA descartável |
| MIG-RUN-03 | Run concluído; remover destino ou mapa | `MAPPED_DESTINATION_MISSING` ou `CHECKPOINT_MAP_MISSING`; não recria nem avança | P0 integration | Executado em QA descartável |
| MIG-RUN-04 | Alterar ordem de chaves do checkpoint concluído mantendo a contagem | `RUN_CHECKPOINT_DIVERGED`; não confunde tamanho com completude | P0 integration | Executado em QA descartável |
| MIG-RUN-05 | Adulterar destino do lote 1 após commit e antes do lote 2 | Bloqueia antes de gravar o lote 2; checkpoint permanece no lote 1 | P0 integration | Executado em QA descartável |
| MIG-RUN-06 | Adulterar destino após último lote e antes da finalização | Finalização bloqueia com motivo específico; status não vira `COMPLETED` e checkpoint não muda | P0 integration | Executado em QA descartável |
| MIG-RUN-07 | Duas chamadas para o mesmo runId; primeira segura o lock dentro da transação | Segunda chamada observada como waiter de advisory lock no PostgreSQL; ambas terminam `COMPLETED`, sem lote/mapa duplicado | P0 integration | Executado com barreira observável em QA descartável |
| MIG-RUN-08 | Dois runs independentes para a mesma empresa | Ambos completam; identidade de origem/destino permanece única e íntegra mesmo com o mapa global apontando para o último recibo | P1 integration | Executado em QA descartável |

O ensaio final usou o manifesto QA explícito (86 migrations históricas mais o schema/SQL aditivo fixado no baseline `ed5380e67078255efb0bfeb34b832e9d4771a85f`; nenhum SQL ou schema candidato nesta entrega). O manifesto de entrega fixa hashes dos candidatos de código. `PDV-CORE-SCHEMA-QA-01`, `PDV-BUSINESS-MIGRATOR-QA-01`, `EVT-DEL/CON/AUD` (8 testes, 0 skips) e `PDV-GRAPH-QA-01` passaram no PostgreSQL efêmero em tmpfs; o container e os clients gerados foram removidos. DEV compartilhado e PROD não foram consultados.

Contagens observadas no fixture principal do migrador: antes `PDV/agenda/ocorrência/mapa/lotes = 0/0/0/0/0`; depois `1/1/3/5/3`; após outro run idempotente, destinos/mapas mantiveram `1/1/3/5` e lotes passaram a `6`. Fixture com PDV pré-existente manteve PDVs em `1 -> 1`. A pausa após dois lotes guardou 2 de 5 origens; a retomada confirmou as cinco origens em três lotes totais. Fixture de interrupção dentro do lote reverteu destino, mapa e lote a zero e retomou até `COMPLETED`.

## Fatia de configuração e catálogo (implementada no código; ensaiada em QA, não migrada em DEV)

O escopo abaixo foi implementado como migration candidata e migrador reiniciável. Foi executado somente em PostgreSQL QA descartável. Nenhuma linha comercial foi migrada em DEV e a migration candidata não foi aplicada ao DEV.

- **Configuração:** considerar `ConfiguracaoQuiosque` (`ativo`, `exclusivo`, `controlaEstoque`, `temCozinha`, `quantidadeMesas`) e `ConfiguracaoOperacional` (`plannedOperationsEnabled`, `tapsEnabled`, `inventoryEnabled`, `kitchenEnabled`, `kitchenItemsChargeAtLaunch`, `allowCloseComandaWithPendingKitchenOrders`, notificações). Consumidores: `operational-profile.ts`, `operational-config.ts`, `operacao/modulo.ts`, `capacidades.ts` e guards de `operacao/index.ts`. `plannedOperationsEnabled` é o sinal persistido do modo. Para estoque/cozinha, valor explícito em `ConfiguracaoOperacional` prevalece; nulo recua para `ConfiguracaoQuiosque`, enquanto taps usa valor explícito ou existência de taps ativos. A próxima transformação deve preservar esse resultado efetivo ao materializar parâmetros opcionais por PDV; não copiar flags legadas por cima de valor explícito. Não reintroduzir um modo recorrente alternativo: `CAIXA` continua fluxo único e ocorrência apenas dá contexto.
- **Múltiplos cardápios e preços:** manter `Cardapio` e `CardapioProduto` como catálogo compartilhado existente; mapear cada produto/volume e `precoUnit`, incluindo `chopeVolumesConfigurados`. Preservar preço base `Preco` por produto/volume. Não mesclar cardápios distintos. Consumidores incluem rotas de catálogo/cardápio, `sessao-cardapio.ts` e `venda.ts`.
- **Preço por turno:** `SessaoCaixaProdutoOperacao` guarda presença de item e override nullable `precoUnit`; precedência atual é override do turno, preço do cardápio, depois preço de catálogo. Essa precedência e volume (incluindo unidade 0/volume do chope) devem continuar idênticos.
- **Categorias e opções:** `Produto.categoria` é categoria operacional em texto livre; `ProdutoOpcionalGrupo`, `ProdutoOpcional` e `ProdutoOpcionalVinculo` representam adicionais atuais. O futuro modelo de categoria precisa servir categorias comuns, com associação gamificada opcional, sem obrigar toda categoria a participar de pontos/ranking. Reutilizar estes vínculos existentes, sem catálogo paralelo.
- **Histórico:** novos dados de catálogo nunca recalculam venda antiga. Preservar snapshots por item, incluindo `ItemComanda.nome`, `precoUnit`, `volumeMl`, opcionais/preços adicionais, quantidade, preparo e para-viagem; conferir também itens de pedidos/caixa e recibos históricos antes de definir o backfill.

Políticas de portal e pontuação permanecem pendentes de decisão de negócio e estão fora desta etapa. Os testes descritos a seguir foram executados no fixture sintético e não certificam a fotografia nem os valores reais em DEV.

### Catálogo e configuração: cenários da fatia

| ID | Pré-condição / configuração | Ação | Resultado esperado e evidência | Camada/prioridade | Executor / estado |
|---|---|---|---|---|---|
| CAT-01 | Flags explícitas e fallback legado divergentes | Transformar configuração | Explicitamente persistido prevalece inclusive `false`; ausente usa a precedência real; mapa guarda configuração de origem | unit/P0 | `pdv-unico-catalog-transform.test.ts`; executado |
| CAT-02 | Empresas EVENTO e CAIXA/Por Caixa com capacidades equivalentes | Mapear ao PDV canônico | Uma ConfiguracaoPontoVenda por PDV e capabilities preservadas; modo não copiado como seletor alvo | QA/P0 | `pdv-unico-catalog-migrator.isolated.test.mjs`; executado |
| CAT-03 | Produto com volume unitário 0 e volumes 500/1000; dois cardápios | Migrar e reconciliar preços | IDs, decimais e volumes exatos; cardápios distintos e preço de cardápio por produto/volume preservados | QA/P0 | runner QA descartável; executado |
| CAT-04 | Override turno ausente, nulo, zero e não nulo | Consultar preço operacional | override existente > cardápio > catálogo; nulo permite fallback, 0 é explícito | unit/P0 | teste chama `resolveEffectivePrice` usado em `sessao-cardapio.ts`; executado |
| CAT-05 | Produto com grupos/opções/adicionais e múltiplas ordens | Migrar vínculos | nomes, ativos, obrigatório/máximo, preços, estoque referenciado, ordem e timestamps iguais | QA/P0 | runner QA descartável; executado |
| CAT-06 | Fixtures de tenant e PDV incompatíveis | Associar vínculo composto | Banco rejeita FK incompatível; origem/destino/checkpoint ficam intactos | QA/P0 | `P2003`/constraint verificada no runner; executado |
| CAT-07 | Venda com snapshots de item e opcional | Migrar catálogo e editar produto depois | snapshots históricos não mudam, embora catálogo atual mude | QA/P0 | runner QA descartável; executado |
| CAT-08 | Run íntegro, mesmo ID e novo ID; falha após destino; múltiplos lotes | Reexecutar, interromper e retomar; concorrer | mapas e recibos estáveis, rollback atômico, último checkpoint retoma, advisory lock serializa e divergência de origem/destino bloqueia sem sobrescrita | QA/P0 | runner QA descartável; executado |
| CAT-09 | Mais de um PDV ou fonte ambígua/sem timestamp necessário | Executar escopo | Bloqueio tipado sem escolher identidade ou fabricar valor | QA/P0 | transformação/migrador QA; executado para casos incluídos no escopo; ausência de timestamps testada |

Manifesto candidato `pdv-unico-catalog-qa-manifest.json`: baseline commit `06b23a9c93e3d9e54c106d173f7d6921bf3e7138`, schema base SHA-256 `53d7ffb037c43da4031b3de64798d32681a492ec3998e5ac9e831bcfc427eba7`, schema candidato SHA-256 `211a9062506d380d9d18e63089e4d4d2358e6f8978d55a364f5a6413f5899bff`, migration `20261003220000_pdv_catalog_configuration` SQL SHA-256 `66d2b0ac0d37319c0d7292d24bfc0a2d5290a8844616fae5d49b6a9be96908a4`. O bundle inclui manifesto/histórico e núcleo anteriores sem alterá-los, e a migration candidata explícita; telefone local não rastreado não entra. O client foi gerado do schema candidato. O ensaio passou com 88 linhas na migration chain do runner, fixture principal Produto/Preco/Cardapio/CardapioProduto/grupo/opção/opcional/vínculo/configuração `1/3/2/4/1/2/1/2/1`, preços zero/unidade e 500/1000 reconciliados; a empresa com PDV existente permaneceu com 1 PDV. O runner reportou `PDV_CATALOG_QA=PASS`, regressões anteriores incluídas, e removeu o próprio container e clients temporários.

**Planejado / ainda NAO COMPROVADO:** fotografia completa e reconciliacao dos dados comerciais reais; aplicacao da migration ou backfill no DEV; catalogos de pedidos/caixa externos a fotografia; reconciliacao financeira/estoque; execucao integral multiempresa e recuperacao operacional apos falha de infraestrutura; corte/rollback do produto; autenticacao e RBAC reais; rankings por ocorrencia e recorrencia; politicas de portal e pontuacao. Cenarios sinteticos executados nao certificam esses gates.


## Sessoes e overrides: primeira transferencia (candidata QA)

| ID | Pre-condicao / configuracao | Acao | Resultado esperado e verificacao | Camada/prioridade | Executor / estado |
|---|---|---|---|---|---|
| SES-01 | Sessao Por Caixa com cardapio, volumes e overrides 0/NULL | Executar migrador de sessoes | Sessao e linhas preservadas exatamente, incluindo IDs, timestamps, presenca, ausencia e NULL distinto de zero | QA/P0 | `pdv-unico-session-migrator.isolated.test.mjs`; executado em QA descartavel |
| SES-02 | Sessao Evento aberta com ocorrencia mapeada | Migrar sessoes | Mesmo ID, dia de Evento.data, ocorrencia/PDV/tenant corretos, Trailer e cardapio de origem confirmados | QA/P0 | executado em QA descartavel |
| SES-03 | Sessao Evento fechada com contagens separadas e agregadas | Migrar sessoes | Estado, autores, troco, timestamps, observacao e valores decimais exatos preservados; origem EVENTO | QA/P0 | executado em QA descartavel |
| SES-04 | EventoProduto selecionado sem volume ou preco de turno | Migrar sessoes | Presenca por sessao preservada; volume legado 0, override SQL NULL; nenhum preco inferido | QA/P0 | executado em QA descartavel |
| SES-05 | Preco de turno 0 e NULL, cardapio com preco | Consultar o resultado completo pelo consumidor | Override 0 e 16.60 prevalecem; NULL herda cardapio; ausencia de override segue cardapio/catalogo | QA/P0 | consumer real `sessao-cardapio.ts`; executado em QA descartavel |
| SES-06 | Pagamento, movimento, divida e snapshot vinculados a caixa Evento | Migrar sessoes | Todos os registros e vinculos legados permanecem IDs, vinculos e valores identicos; financas ficam fora deste escopo | QA/P0 | executado em QA descartavel |
| SES-07 | Evento sem data, PDV cruzado, sessao aberta concorrente ou ID colidente | Executar migrador | Bloqueio pelo codigo especifico; nenhum destino sobrescrito; origem e checkpoint preservados | QA/P0 | executado em QA descartavel |
| SES-08 | Run completo adulterado: destino, mapa ausente ou checkpoint divergente | Revalidar o run de Catalogo | Retorno BLOCKED e estado BLOCKED persistido; checkpoint/evidencia retidos; nenhum reparo automatico | QA/P0 | executado em QA descartavel |
| SES-09 | Falha apos escrever destino; retomada; duas chamadas no mesmo escopo/run | Interromper e reexecutar sob barreira PostgreSQL | Rollback atomicamente remove destino/mapa/recibo/lote nao confirmado; retomada parte do ultimo checkpoint; lock concorrente observado | QA/P0 | executado em QA descartavel |
| SES-10 | Novo run para fontes ja mapeadas | Executar novamente | Contagens nao duplicam; IDs de destino continuam estaveis; recibos/checkpoint do novo run confirmados | QA/P0 | executado em QA descartavel |

O manifesto `pdv-unico-session-qa-manifest.json` fixa baseline, schema staged da entrega, SQL candidato e hashes dos manifestos anteriores. Cenarios acima so passam quando suas fixtures sinteticas e asserts obrigatorios executam; skip, falta de fixture ou erro generico nao e PASS. Pagamentos, movimentos, dividas, migracao financeira, reconciliacao e rollback operacional seguem como etapa posterior.

### Resultado da regressao legada em bundle de nucleo

A execucao de `qa:pdv-disposable` aplicou somente as 86 migrations historicas e o nucleo confirmado. FK, schema-core, business-migrator e os oito testes de exclusao/auditoria/concorrencia passaram; o runner encerrou com erro no teste do grafo porque esse teste usa `Produto.pontoVendaId`, coluna introduzida pela migration de catalogo que nao faz parte daquele bundle de nucleo. A mesma fixture `PDV-GRAPH-QA-01` foi executada e passou no runner novo com a cadeia completa de 89 migrations (historico + nucleo + catalogo + sessao). Assim, o resultado do comando legado e parcial/falho, nao PASS agregado.

## Commerce regression: commands, kitchen, portal and inventory

Scope PDV_COMANDAS_PEDIDOS_ESTOQUE_V1 uses the shared source graph. These tests certify migration links and integrity, not authenticated API, UI, realtime or portal policy.

| ID | Preconditions and action | DB/API/UI expected result | Priority/layer | Executor/status |
|---|---|---|---|---|
| COM-01 | CAIXA and EVENTO commands, mapped occurrence | Preserve ID, origin, Event, client, state, totals, discount, dates and timestamp; attach only PDV and EVENTO occurrence | P0 QA/integration | Commerce disposable test; synthetic PASS |
| COM-02 | Sold items, cancelled item and sold optional | Preserve IDs, prices, volume, quantity, snapshots, cancellation, kitchen/takeaway and optional link | P0 QA/integration | Synthetic PASS; API/UI and stock effects NOT PROVEN |
| KCH-01 | Delivered/cancelled kitchen orders, six transitions and item links | Preserve orders, status, day, authors, timestamps, items and history; fill only missing PDV | P0 QA/integration | Synthetic PASS; kitchen API/UI/realtime NOT PROVEN |
| PRT-01 | Portal order/lines, client, EVENTO command, product and occurrence map | Preserve IDs/references; create no order, confirmation or score | P0 QA/integration | Synthetic links PASS; portal policy/auth API NOT PROVEN |
| STK-01 | Balance 3.125, minimum 0.500, movement 0.875 | Preserve exact Decimal values/IDs; invent no stock movement | P0 QA/integration | Synthetic PASS |
| STK-02 | Cross-tenant product/PDV/order or changed confirmed balance | Composite FK rejects incompatible link; tampered target blocks without overwrite | P0 QA/integration | FK and 3.125 to 3.126 tamper PASS |
| COM-03 | Command without Event/PDV; command linked to another PDV | Unattributable row remains in coverage; incompatible link gets specific blocker and stays intact | P0 QA/integration | Synthetic PASS; current DEV inventory NOT PROVEN |
| COM-04 | Pause, error after write, same/new run and concurrent calls | Roll back failed batch to last checkpoint; no duplicate maps; observed scope lock; tamper invalidates | P0 QA/integration | Synthetic PASS; PostgreSQL lock observed |
| COM-05 | Before/after commerce source rows | Coverage 4 attributable commands + 1 separate unattributable command; 19 mapped records; compare exact IDs, contents and decimals | P0 QA/integration | Current 91-migration manifest; PASS |

Fixtures are synthetic and created only inside disposable PostgreSQL. Tests do not inject expected blockers. Missing required fixture fails. Evidence includes content, IDs, checkpoints, maps, receipts and DB constraints, not status text alone.

### Current regression command

npm run qa:pdv-current-disposable runs historical, finance and commerce gates sequentially. Finance runs PDV-GRAPH-QA-01 with the compatible 89-migration Prisma Client before the restrictive finance FK, then applies finance as migration 90. Commerce applies the manifest-pinned 91-migration chain; the eight event deletion/audit/concurrency tests run after Comanda.ocorrenciaId exists. Any subprocess failure fails the aggregate. Historical manifests remain unchanged.

**Executed:** `qa:pdv-current-disposable` passed with no omitted stages. Historical gate: FK/core/business migrator. Finance: 90 migrations, 6 payments (97.00), 2 debts (principal 73.00; received 55.00; balance 18.00), 13 maps and deliberate reconciliation drift blocked; graph ran with schema-compatible client at 89 migrations. Commerce: 91 migrations, 19 maps from 4 attributable commands plus 1 separate unattributable command; eight deletion/audit/concurrency tests passed, zero skips. The preflight/preparation path assigned two synthetic orders, applied/recovered the candidate commercial SQL, revalidated prior scopes and replayed commerce mapping. Rollback, resume, same/new run replay, observed locks and stock tamper blocker passed. The same commerce QA runner also completed the authenticated Por Caixa API flow below. The temporary QA database used tmpfs/local port 55439 and was removed.

**NOT PROVEN:** this delivery did not query DEV, so no current real counts or multi-company stock reconciliation are claimed. UI, global RBAC, other authenticated API modules, portal, kitchen/realtime, cancellation/stock side effects, real ledger reconciliation, infrastructure recovery and product cutover/rollback remain pending. The authenticated API evidence is restricted to the synthetic Por Caixa flow below.

## Regressão atual e financeiro

This section records the earlier finance regression details. Current command composition and its complete aggregate result are stated in the commerce section above. The main command is npm run qa:pdv-current-disposable and includes the commerce gate.

| ID | Pré-condição e ação | Resultado exigido | Camada/prioridade | Executor / estado |
|---|---|---|---|---|
| FIN-01 | Venda Evento quitada com DINHEIRO+PIX; dinheiro entregue e troco | Dois pagamentos com IDs, valores, formas, recebido/troco e sessão confirmada; total quitado usa `valor`, não `valorRecebido` | QA/P0 | `pdv-unico-finance-migrator.isolated.test.mjs`; executado |
| FIN-02 | Dívida parcialmente recebida em Evento e depois quitada em sessão Por Caixa | Principal 50,00, recebimentos 15,00+35,00, saldo 0,00; sessão de cada recebimento preservada | QA/P0 | executado |
| FIN-03 | Segunda dívida com débito parcial | Principal 23,00, recebido 5,00, saldo 18,00; cliente e comanda iguais | QA/P0 | executado |
| FIN-04 | DINHEIRO, PIX, DÉBITO, CRÉDITO; nullable e zero explícito | Soma por forma/sessão em centavos; `valorRecebido` 0,00 distinto de NULL; contagens de fechamento fora da soma | QA/P0 | executado |
| FIN-05 | Suprimento e sangria Evento; correção Por Caixa com estorno/substituição | Movimentos Evento transferidos por ID/tipo/valor; três movimentos Por Caixa e cadeia de correção idênticos; origem preservada | QA/P0 | executado |
| FIN-06 | Referência dupla, sessão ausente, cliente de outro tenant | Cada caso bloqueia por código específico e não confirma destino | QA/P0 | executado |
| FIN-07 | Mesmo e novo run, pausa após um lote, falha após escrita de destino | Reexecução reutiliza 13 mapas; último checkpoint confirmado permanece; destino/mapa/lote parcial revertem | QA/P0 | executado |
| FIN-08 | Duas chamadas do mesmo run com barreira | Segunda chamada observada aguardando advisory lock; um mapa/lote, estado íntegro | QA/P0 | executado |
| FIN-09 | Run concluído com vínculo destino, payload ou mapa adulterado | BLOCKED tipado e persistido, checkpoint retido, sem reparo automático | QA/P0 | executado |
| FIN-10 | Pagamento alterado deliberadamente em 0,01 dentro de transação | `FINANCE_RECONCILIATION_DIVERGED`; alteração revertida | QA/P0 | executado |
| FIN-11 | Snapshot de item e saldo/movimento de estoque não vazios | IDs, preços, quantidades 12,375/1,250 e timestamps permanecem iguais; nenhum ajuste de estoque | QA/P0 | executado |
| FIN-12 | FK de pagamento e movimento restritivas | Constraints validadas no banco; DELETE de sessão com histórico rejeitado | QA/P0 | executado |
| FIN-13 | Dados reais multiempresa, órfãos, pedidos e estoque com saldo | Reconciliar os domínios completos e falhas de infraestrutura antes de qualquer corte | QA/P0 | **NÃO COMPROVADO** |

Manifesto candidato: `pdv-unico-finance-qa-manifest.json`, baseline commit `e7082d4b7ab08f480d82978ac0686d3af4bd8bf0`; fixa schema staged, migration financeira, migrations anteriores e hashes dos scripts. Prisma Client é gerado do schema candidato. O teste de FK/origem não certifica login/RBAC real. Aplicação em DEV compartilhado, dados reais, corte/rollback do produto, ranking por ocorrência/recorrência e reconciliação de estoque permanecem **NÃO COMPROVADOS**.


## Certification gap closure - delivery from 2926b97b

These scenarios were added and run by the current integrated runner. Executed means synthetic data on the disposable PostgreSQL bundle; it does not mean real-data migration or operational acceptance.

| ID | Preconditions / action | Expected result | Priority / layer | Executor / result |
|---|---|---|---|---|
| HASH-01 | Decimal stock 3.125 and 3.126; hash a persisted target | Distinct exact hashes; change after confirmation invalidates certification without repair | P0 QA/integration | catalog hash unit test plus commerce QA; PASS |
| COM-LINK-01 | Reparent item, sold optional and order-status history between valid same-tenant parents | Original parent IDs are part of source payload; each altered link blocks recertification | P0 QA/integration | Commerce isolated QA; 3 specific blockers, PASS |
| OCC-01 | Change mapped occurrence date, agenda, or content while tenant/PDV remain valid; invoke session, finance, or commerce scope | Full business checkpoint/receipts/maps/destinations are revalidated; dependent scope blocks before checkpoint advancement | P0 QA/integration | Commerce isolated QA; three typed occurrence blockers, PASS |
| COM-REC-01 | Read commercial source independently after target writes; compare IDs, parents, snapshots, status/timestamps, Decimal fields and totals | Missing/additional/changed rows or reparenting invalidate the run; unattributable source stays pending; stock ledger coverage remains NOT PROVEN | P0 QA/integration | reconcilePdvCommerce; integrated QA and target-tamper rollback, PASS |
| INT-01 | Two tenants share one disposable DB; run business -> catalog -> sessions -> finance -> commerce, then replay same/new run IDs | PDV/occurrences/configuration/catalog/session/payment/debt/command/kitchen/portal/stock identities remain stable; prior scopes revalidate | P0 QA/integration | qa:pdv-current-disposable; 19 commerce maps; PASS |
| INT-02 | Pause across batches, inject target drift between read and receipt verification, inject write failure, and run concurrent same-scope calls with a barrier | Atomic rollback, prior checkpoint retained, deterministic resume, no duplicate maps, PostgreSQL lock observed | P0 QA/integration | Integrated commerce QA; PASS |
| FK-LEGACY-01 | Before commerce SQL, create kitchen order without PDV referenced by stock movement with PDV | Preflight reports PDV_COMMERCE_PREFLIGHT_ORDER_CONTEXT_REQUIRED; prepare proven links, recover QA migration state, apply SQL, revalidate prior scopes and complete/replay commerce mapping | P0 QA/integration | Commerce disposable pre/post-commercial clients; executed |

**Regression executed for this delivery:** `npm run qa:pdv-current-disposable` passed historical schema/business tests, finance suite and integrated commerce suite. Historical and finance gates used baseline-compatible migration manifests/clients. Commerce applied the explicit current 91-migration bundle with its pinned candidate client. Build, Prisma validation and diff checks passed. No stage was skipped.

**Still NOT PROVEN:** real DEV data coverage and reconciliation, global command attribution, full stock ledger, authenticated login/RBAC and API/UI behavior, product cutover/rollback, infrastructure-level recovery, portal/scoring/ranking decisions, and actual migration of business data. Real records without authoritative command/event/map evidence remain blocked.

## Kitchen order context preparation before commercial SQL

The preparation is part of integrated commerce disposable QA and runs before `20261004170000_pdv_commerce_inventory_context`. It generates and uses the Prisma Client pinned to the pre-commercial schema; the source reader intentionally does not query `Comanda.ocorrenciaId`. It uses the shared locked runner and writes only `PedidoOperacao.pontoVendaId`, its stable map (`PEDIDO_COZINHA_PDV_PREPARATION`), receipt, batch and checkpoint in one transaction. The source hash keeps all original order fields, command authority and every linked movement; it normalizes only the pointer this preparation writes. The order's `updatedAt` is preserved.

| ID | Preconditions / action | Expected result | Priority / layer | Executor / result |
|---|---|---|---|---|
| PREP-01 | CAIXA command belongs to same canonical PDV; order has null PDV and a movement to that PDV | Preflight blocks; preparation assigns only proven PDV; exact movement ID/quantity remain unchanged | P0 QA/integration | Commerce disposable pre-commercial client; executed |
| PREP-02 | Same-tenant CAIXA command has canonical PDV; order has no stock movement | Command is sufficient authority; PDV is assigned without inventing a movement | P0 QA/integration | Commerce disposable pre-commercial client; executed |
| PREP-03 | Multiple linked movements point to distinct PDVs | `KITCHEN_ORDER_MULTIPLE_MOVEMENT_PDVS`; no order write or checkpoint | P0 QA/integration | Synthetic QA rows and real transform/runner; executed |
| PREP-04 | No movement and no command PDV, or command PDV belongs to another tenant | `KITCHEN_ORDER_COMMAND_PDV_UNPROVEN`; no assignment | P0 QA/integration | Synthetic QA rows and real transform; executed |
| PREP-05 | Completed preparation; alter original status or prepared PDV | Revalidation blocks, preserves tampered data/checkpoint and never repairs it | P0 QA/integration | Pre-commercial Prisma Client; executed |
| PREP-06 | Pause after first order; fail after next write; resume and replay same/new run | Failed write rolls back; last confirmed batch remains; stable maps are reused | P0 QA/integration | Disposable PostgreSQL; executed |
| PREP-07 | Two calls prepare the same tenant/PDV/scope | PostgreSQL advisory lock serializes calls; no duplicate map or inconsistent checkpoint | P0 QA/integration | Disposable PostgreSQL; executed |
| PREP-08 | Prisma records failed commercial preflight, then source context is prepared | Resolve that QA migration as rolled back, deploy SQL, verify final composite FK is validated/restrictive | P0 QA/integration | Disposable PostgreSQL; executed |
| PREP-09 | Event order has confirmed occurrence; all command/event/map/movement links agree | Assign only with confirmed occurrence map; any disagreement or missing authority stays blocked | P0 QA/integration | No pre-commercial Event-order fixture in this delivery; **NOT PROVEN end to end** |
| PREP-10 | Real DEV kitchen orders and linked stock movements | Reconcile every record before backfill | P0 operational/data | Not authorized/read; **NOT PROVEN** |

The first preflight failure is an explicit precondition result, not the final state: the same disposable database then runs preparation, recovers only its QA migration row with Prisma's `--rolled-back`, and applies the candidate SQL. The final constraint is queried in PostgreSQL. No shared DEV or production database is accessed.

## Event preparation certification and DEV inventory (2026-10-04)

| ID | Preconditions / action | Expected result | Priority / layer | Executor / result |
|---|---|---|---|---|
| PREP-11 | Event company has one Trailer/no PDV, dated Event, EVENTO command, two unlinked kitchen orders; prepare before candidate commerce migration | Both orders receive only confirmed PDV context; exact order/movement IDs, timestamps, snapshots and 0.125 quantity are preserved | P0 QA/integration | `qa:pdv-current-disposable` commerce gate; PASS |
| PREP-12 | Apply commercial migration and run commerce mapping; compare real-snapshot legacy hash; revalidate preparation after command receives PDV/occurrence; replay same/new preparation run | V1 evidence hash demonstrably differs; V2 accepts only confirmed target-owned command links; counts/checkpoint stay stable and old receipts are not rewritten | P0 QA/integration | commerce QA; PASS |
| PREP-13 | Remove/diverge commercial map or receipt, change target hash, or adulterate target | Typed block; no repair and no checkpoint advance | P0 QA/integration | commerce QA; PASS |
| PREP-14 | Fail after order write, then inspect failed order/map/receipt/batch/checkpoint directly | Order link rolls back to null; no partial evidence; prior checkpoint remains | P0 QA/integration | commerce QA; PASS |
| PREP-15 | Two calls race on one still-pending order with barrier; inspect `pg_stat_activity` while second waits on advisory lock | Single assignment/map and complete receipt sequences for both serialized runs | P0 QA/integration | commerce QA; PASS |
| PREP-16 | After CAIXA-only company has completed preparation, add a second PDV; retry and prepare a fresh movementless order | `KITCHEN_ORDER_CANONICAL_PDV_AMBIGUOUS`; no automatic unit selection or mutation | P0 QA/integration | commerce QA; PASS |
| INV-01 | Exact local DEV allowlist check before client generation/connection; read all tenants in RepeatableRead, transaction READ ONLY, with schema pinned to applied ledger | Counts and blockers omit PII; source validity is separate from additive target-map readiness; no writes | P0 read-only integration | `inventory:pdv-dev:readonly`; PASS, 55 tenants, ledger 85 migrations through `20260930150000_company_pix_key`; target map absent |

**Executed gates:** `qa:pdv-current-disposable` passed after the V1 hash-regression assertion: historical (86-migration compatible baseline), finance (90-migration candidate), and commerce (91-migration current bundle); no stage omitted. Commerce includes eight Event deletion/audit/concurrency tests (8 pass, 0 fail, 0 skipped). The pre-commercial Event fixture contains 2 kitchen orders and 1 stock movement (0.125); a real-read V1 payload hash diverged after commercial Comanda PDV assignment, while V2 revalidation on the same and a new run passed without changing prior receipts. Build/typecheck (`npm run build` / `tsc`), Prisma validation, pure/env tests (6 pass, 0 fail/skip), candidate manifest validation, and `git diff --check` passed.

**DEV origin inventory (read only):** 55 companies; 44 with no PDV and 4 with multiple PDVs; 1,090 commands (1,084 attributable, 6 insufficient); 79 attributable Events and 2 insufficient; 45 attributable Trailers and 2 conflicts; 765 stock movement rows; 607 payments, 6 receivables, 6 Event cash sessions and 47 operational cash sessions; 0 payment-session or tenant link conflicts detected. Of 134 planner blocks, 54 require manual resolution (49 multiple-PDV and 5 multiple-Trailer/no-PDV) and 80 are descendants blocked by a parent. `PdvMigrationMap` is absent because additive transformations have not run; this is target readiness, not source corruption. No DEV migration, seed, backfill, repair, or data write occurred.

Planner classification detail: commands 1,084 source attribution proven / 6 insufficient; Events 79 proven / 2 insufficient; PDVs 7 proven / 12 confirmed conflicts; Trailers 45 proven / 2 conflicts; kitchen orders 431 target transformation pending / 4 insufficient; stock movements 757 target transformation pending / 8 insufficient. Event and operational cash movement rows: 0. `BLOCKED_PARENT` descendants are reported separately (80 rows) and do not imply independent source corruption.

**Still NOT PROVEN:** multiple menus in integrated order flows, rankings, authenticated login/RBAC/API/UI, operational cutover and rollback, migration of real commerce/finance/stock data, cross-period reconciliation, interruption recovery on DEV, and legacy removal. The inventory does not authorize a write; manual review of source ambiguities is the next gate. `PROD_ACCESS_USED=NO`.

## Legacy EVENTO command links and current DEV decisions (2026-10-04)

This section supersedes PREP-11 and PREP-12 above. The EVENTO fixture uses stock quantity **0.375**; **0.125** belongs to the separate CAIXA fixture. Preparation evidence is contract V3, not V2. V3 hashes the command's original PDV link and its classified origin; it does not omit the link from source evidence. A legacy link is accepted only when the sole canonical PDV, tenant, Event/Trailer business maps, confirmed occurrence, and all linked stock movements agree. A commerce-written link additionally requires the confirmed preparation origin marker plus commercial map, batch, receipt, run/checkpoint, and matching target. Removing that evidence cannot downgrade the link to legacy.

| Scenario | Actual result |
|---|---|
| Pre-commercial EVENTO command already linked to its sole compatible PDV, with dated Event, confirmed occurrence/Trailer and coherent stock movement; no COMANDA commerce map | Old classifier reproduced KITCHEN_ORDER_COMMERCE_MAP_MISSING; V3 preparation accepted it. |
| Commercial migration, then preparation revalidation and replay under same/new run | Completed; order, command, movement IDs, timestamps, snapshots and Decimal quantities remained exact. EVENTO movements were 0.375 and 0.25; the separate CAIXA fixture was 0.125. |
| Wrong PDV, crossed tenant, second PDV ambiguity, missing/divergent commercial map/receipt/origin marker, target tamper | Specific blockers; no repair or checkpoint advance. |
| Rollback and first-assignment concurrency | Existing tests retained; rollback inspected the pending order and absent partial map/receipt/batch; PostgreSQL advisory-lock wait observed for concurrent calls. |

**Current gates:** npm run qa:pdv-commerce-disposable passed on the 91-migration disposable bundle; the eight Event deletion/audit/concurrency tests passed (8/8, 0 skipped). npx tsc -p backend/tsconfig.pdv-migration-scripts.json --noEmit passed. The two migration scripts appear in tsconfig.scripts.json's program, but broad npx tsc -p backend/tsconfig.scripts.json --noEmit remains nonzero due to existing implicit-any diagnostics in untouched inventory-pdv-unico-dev.ts and pdv-unico-planner.isolated.test.ts. Backend build and Prisma validation passed. No DEV writes or migrations occurred.

**DEV inventory, read only:** exact snapshot details and the five-company decision table are recorded in docs/architecture/pdv-unico-migracao-dev.md, section “Continuation: legacy EVENTO command links”. The five ambiguous root companies are distinct from 54 manual-resolution blocked rows and 80 blocked descendants. Decisions remain pending; no candidate PDV/Trailer was selected, and no record was classified as discardable. The additive map schema is absent in the DEV migration ledger, which is target readiness rather than source corruption.

Still pending: real-data decision/reconciliation for ambiguous tenants, API/UI and authenticated operation, multiple-menu integrated path, rankings, cutover/rollback and legacy removal. PROD_ACCESS_USED=NO.


## Kitchen preparation review fixes (2026-10-04)

This section supersedes the V3 preparation claims in PREP-11/PREP-12 and the preceding review addendum.

| ID | Preconditions / action | Expected result | Priority / layer | Executor / result |
|---|---|---|---|---|
| PREP-17 | Pre-commercial EVENTO orders cover command/order PDV (null,null), (null,canonical), (canonical,null), (canonical,canonical); run preparation | All four have hashed provenance maps; the already-correct order link is certified without an update | P0 QA/integration | Commerce disposable QA, 5 synthetic orders; PASS |
| PREP-18 | For orders whose PDV was already correct, compare source snapshot before/after preparation and commercial migration | IDs, status, timestamps, snapshots and exact stock movement rows/quantities remain unchanged | P0 QA/integration | Commerce disposable QA; PASS |
| PREP-19 | Completed preparation run is the map lastRunId; alter source to invalidate run, keep divergence, restore exact original content and retry | BLOCKED while changed; after restoration same run completes only after full checkpoint/evidence validation; checkpoint, batches and receipts are unchanged | P0 QA/integration | Commerce disposable QA; reproduced before fix and PASS after fix |
| PREP-20 | Prepare, run commercial migration, then revalidate/replay preparation with same and new run | All four PDV link combinations remain canonical; stable maps and source snapshots remain intact | P0 QA/integration | Commerce disposable QA; PASS |
| INV-02 | Summarize balances and movements with different PDVs, products, units and movement types | No quantity totals cross product/unit or movement type boundaries | P0 pure/unit | pdv-unico-dev-inventory-summary.test.mjs; PASS, 1 test |

**Executed:** qa:pdv-commerce-disposable passed using the pinned 91-migration QA bundle. It ran five synthetic EVENTO orders, two stock movements, all four command/order link combinations, preparation -> commercial migration -> revalidation/replay, same-run recovery after BLOCKED, and the existing rollback/concurrency/tamper and eight Event deletion/audit cases (8 pass, 0 fail, 0 skipped). V4's exact evidence and no-write behavior were asserted. The QA PostgreSQL resource used tmpfs and was removed.

**Typecheck:** focused noEmit for catalog migrator and kitchen preparation passed. The broad scripts typecheck remains a separate known failure from existing TS7006 implicit-any diagnostics in inventory-pdv-unico-dev.ts and pdv-unico-planner.isolated.test.ts; this round does not suppress or change them.

**Inventory and limits:** a pure helper test proves stock is grouped by PDV/product/unit, with movements also split by type. DEV inventory was not rerun. Previous ambiguous-company decisions remain pending. No synthetic result represents real-data migration. No cutover, ranking, cleanup or legacy removal is included. PROD_ACCESS_USED=NO.


## Integrated menu and session-price certification — 2026-10-04

This section supersedes the earlier “multiple menus in integrated order flows: NOT PROVEN” statement for the **synthetic database/consumer layer only**. It does not certify authenticated API or UI flows and does not represent migration of real business data.

| ID | Scenario / preconditions and action | Expected database / consumer result | Priority / layer | Executor and result |
|---|---|---|---|---|
| MENU-01 | One canonical PDV, unit product and chope product; catalog prices at unit, 500 ml and 1000 ml; two independent menus; run business then catalog scope | Existing product/menu/price IDs remain stable; 2 menus, 6 menu lines and exact distinct values survive | P0 QA/integration | `qa:pdv-commerce-disposable`; PASS |
| MENU-02 | Three Por Caixa sessions select menu A, menu B, or none; two EVENTO sessions have confirmed occurrences, one selects menu B and one has no selection; run session scope | `cardapioId` and occurrence are preserved; null selection stays null; product/volume rows and override values remain unchanged | P0 QA/integration | Commerce disposable PostgreSQL; PASS |
| MENU-03 | On selected sessions represent omitted override, SQL NULL, zero and positive override | Effective precedence is turno override > selected menu > catalog; zero remains an explicit override; omitted/NULL inherit | P0 QA/integration | Real session rows and consumers; PASS |
| MENU-04 | Query every selected session through `getCardapioTurno` for unit, 500 ml and 1000 ml as selected | Returned product/volume/price is exact; unselected sessions do not receive an invented menu | P0 consumer integration | Backend module against QA PostgreSQL; PASS |
| MENU-05 | Resolve unit and volume sales through `resolverItens`, with taps mounted where chope is sold; calculate totals in integer cents | Prices and quantities produce the exact expected cents; Por Caixa behavior is exercised from the real resolver | P0 consumer integration | `resolverItens` + QA transaction; PASS |
| MENU-06 | Complete same-run and new-run replay across business, catalog, sessions, finance and commercial. Then edit catalog and menu prices for the exact product/volume in a historical sale | Replays keep IDs and counts stable. A real consumer without a masking override returns the changed live price; the historical item and optional remain field-identical, including IDs, links, price, quantity, name and timestamps | P0 QA/integration + consumer | Commerce disposable QA; PASS after exact-product correction |
| MENU-07 | Link a menu item to a product from a different tenant and rerun the catalog scope | Specific `MENU_PRODUCT_TENANT_MISMATCH`; no map or target-link write is committed | P0 QA/integration | Commerce disposable QA; PASS |
| MENU-08 | Evaluate Por Caixa and EVENTO sessions without a selected menu | Price lookup falls back to catalog only for selected items; no menu is assigned automatically | P0 consumer integration | `getCardapioTurno` + `resolverItens`; PASS |
| MENU-09 | Keep taps capability explicit while adding test Tap/TapMontagem for chope consumer calls | Catalog configuration source hash remains identical through integrated replays | P0 QA/integration | Source-plan hash comparison in commerce suite; PASS |
| API/UI-MENU-01 | Authenticated login/RBAC/API response and browser flow for selecting multiple menus, checking volume prices, selling and viewing old sale snapshots | Must prove tenant scoping, API validation and visible prices/snapshots | P0 authenticated API + E2E | Multi-menu authenticated flow and UI **NOT PROVEN**; a separate single-menu Por Caixa API flow is certified in `API-CASH-01` below |

### Expected and observed prices

All figures are exact cents; totals multiply each resolved unit price by its requested quantity.

| Session / source | Product | Turn override | Menu | Catalog | `getCardapioTurno` / `resolverItens` result | Quantity / total |
|---|---|---:|---:|---:|---:|---:|
| Por Caixa, menu A | Chope 500 ml | omitted | 600 | 850 | 600 | 2 / 1,200¢ |
| Por Caixa, menu A | Chope 1000 ml | NULL | 1,000 | 1,300 | 1,000 | 1 / 1,000¢ |
| Por Caixa, menu A | Unit product | 0 | 400 | 625 | 0 | 1 / 0¢ |
| Por Caixa, menu B | Chope 500 ml | 875 | 700 | 850 | 875 | 2 / 1,750¢ |
| Por Caixa, menu B | Chope 1000 ml | NULL | 1,200 | 1,300 | 1,200 | 1 / 1,200¢ |
| Por Caixa, menu B | Unit product | 550 | 500 | 625 | 550 | 1 / 550¢ |
| EVENTO occurrence, menu B | Chope 500 ml | none | 700 | 850 | 700 | 1 / 700¢ |
| EVENTO occurrence, menu B | Chope 1000 ml | none | 1,200 | 1,300 | 1,200 | 1 / 1,200¢ |
| EVENTO occurrence, menu B | Unit product | none | 500 | 625 | 500 | 1 / 500¢ |
| EVENTO without menu | Chope 500 ml | none | — | 850 | 850 | 1 / 850¢ |
| EVENTO without menu | Unit product | none | — | 625 | 625 | 2 / 1,250¢ |
| Por Caixa without menu | Chope 500 ml | none | — | 850 | 850 | 1 / 850¢ |
| Por Caixa without menu | Unit product | none | — | 625 | 625 | 2 / 1,250¢ |

Observed case totals: menu A `2,200¢`; menu B with overrides `3,500¢`; EVENTO menu B `2,400¢`; each no-menu catalog case `2,100¢`. `getCardapioTurno` showed the 1000 ml no-menu EVENTO item because its source selected the beer family; the no-menu Por Caixa fixture selected 500 ml only. In both cases the resolver returned the tested selected prices.

**Snapshot evidence scope correction:** the prior MENU-06 fixture edited draft beer prices while comparing a historical unit-product item, so that assertion did not establish same-product price-change preservation. The corrected QA fixture records the historical `product.id`/unit-volume sale at 425¢ (quantity 2), its optional, and the old unit catalog/menu prices (625¢/500¢). After all replays it changes those exact unit prices to 777¢/888¢. `getCardapioTurno` and `resolverItens` without unit overrides return the new catalog/menu prices; the historical item and optional remain byte-equivalent, with explicit checks for IDs, product/volume, links, price, quantity, name and timestamps. No migrator replay runs after these deliberate edits.

**Gates actually run:** `npm run qa:pdv-commerce-disposable` passed on a disposable PostgreSQL container with the pinned 91-migration bundle; the suite includes 8 event delete/audit/concurrency tests (8 pass, 0 fail, 0 skipped). The environment-validator pure test passed (1/1). Focused scripts noEmit typecheck passed. The runner's temporary database lived on `tmpfs` and its container was removed. Current manifest: baseline `81810eab4e4ceba9f2ad9dcd8de37112fe1cd8a1`, schema SHA-256 `0d62f05d4612fa2ba5eece7b96e260b004302a8684aab2b675af59e2cf372fdc`, commercial SQL SHA-256 `3aaf567f8dddfd94250c5efee4bd37af4a8074243de000fb6ef2f8f9890cc3ab`, digest `129872e424c9ca8ee519957c14c94e4183f18349afbba3330568dc5c3248397b`. Previous manifests are unchanged.

**Not run / not proven:** broad scripts typecheck was not rerun in this slice; its prior known failures are TS7006 implicit-any diagnostics in untouched `inventory-pdv-unico-dev.ts` and `pdv-unico-planner.isolated.test.ts`. No backend build was needed because no backend `src` module changed. UI, real-data migration, free-sale policy for zero-price edits, operational cutover and legacy removal remain pending. Synthetic QA provides no migration authorization. `PROD_ACCESS_USED=NO`.

## Authenticated Por Caixa API certification (2026-10-04)

This fixture was added to the current 91-migration disposable commerce runner. It validates the exact QA URL before importing `buildApp` or runtime Prisma; runtime Prisma then queries `current_database()` and must report `cervejaria_qa_pdv_unico`. Two synthetic tenants were created. The primary tenant received a DONO and ATENDENTE whose passwords were hashed with the application's real `hashPassword`; the second tenant received a separate DONO. Requests use `buildApp` and Fastify `inject`; no public server is started and no authentication/tenant/RBAC hook is replaced.

| ID | Preconditions / action | Expected and observed API / database result | Priority / layer | Executor / result |
|---|---|---|---|---|
| API-CASH-01 | After synthetic business/catalog migration, primary tenant has one canonical PDV, two distinct menus and a unit product priced positively; taps, inventory and kitchen are disabled. Login DONO, open cash selecting menu A, GET turn menu, create command, launch 2 units, pay PIX and close cash. | `/api/auth/login` 200; `/api/operacao/caixa/abrir` 201; `/api/operacao/caixa/cardapio` 200; `/api/operacao/comandas` 201; `/api/operacao/comandas/:id/pedidos` 201; `/api/operacao/comandas/:id/pagamentos` 200; `/api/operacao/caixa/fechar` 200. DB: menu unit price 950¢; item price 950¢ × 2; command total 1900¢; PIX payment 1900¢ linked to the common session/owner; initial cash 500¢ and counted cash 500¢; counted PIX 1900¢; session FECHADO and command FECHADA. | P0 QA/authenticated integration | `pdv-unico-commerce-migrator.isolated.test.mjs`; PASS on disposable PostgreSQL |
| API-AUTH-01 | Call protected context without credential and with malformed token | Both return 401; counts of PDVs, sessions, commands, items and payments remain unchanged | P0 QA/authentication | Same runner; PASS |
| API-RBAC-01 | ATENDENTE calls `POST /api/operacao/pontos-venda`, which has the real `requireDono` guard | Returns 403; operational counts remain unchanged | P0 QA/authorization | Same runner; PASS for this route/role pair |
| API-TENANT-01 | DONO of tenant 2 reads primary tenant's turn menu and attempts to create a command for its PDV | Both return 404; operational counts remain unchanged | P0 QA/tenant isolation | Same runner; PASS for these IDs/routes |
| API/UI-MENU-01 | Browser flow, multiple-menu selection, client-facing order and historical snapshot display | UI and integrated authenticated multi-menu flow remain pending; only API-CASH-01's selected single menu and persisted price snapshot are proven | P0 E2E | NOT PROVEN |

**Executed:** `npm run qa:pdv-commerce-disposable` applied and exercised the current 91-migration pinned bundle on a temporary PostgreSQL container, passed the existing integrated commerce assertions and eight Event deletion/audit/concurrency tests (8/8, 0 skips), then printed `QA_AUTHENTICATED_CASH=PASS` and `PDV_COMMERCE_QA=PASS`. The same runtime Prisma client used by the app was checked against the QA database. The container was removed by the runner. No source module or operational policy changed in this delivery.

**Limits:** these results certify only synthetic rows and the specific real auth/login/requireDono/tenant guards exercised above. They do not establish global RBAC coverage, UI behavior, real-data migration, shared-DEV readiness or cutover approval. DEV and PROD were not accessed. `PROD_ACCESS_USED=NO`.
