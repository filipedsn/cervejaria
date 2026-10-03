# Plano de testes: PDV único

Status: plano de cobertura; cenários marcados **planejado** não são implementados nem certificados. O teste isolado atual de exclusão/reversão cobre apenas os IDs EVT-DEL, EVT-AUD e EVT-CON indicados abaixo. Nenhuma linha deste plano autoriza migrar dados ou remover tabelas.

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
| MIG-01 | Mapa de origem vazio, parcial e completo; interrupção em cada lote | Simular e migrar repetidamente | Sem duplicação; IDs e vínculos estáveis; hashes e contagens repetidos idênticos | P0 integration | Migrador ainda não existe |
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

The planner contract separates sourceValidation (source graph), targetMapping (target entities/links and transformation completeness), and executionEligibility (always NOT_AUTHORIZED in this delivery). ID preservation is distinct from link transformation. Trailer maps to PDV; recurring Evento definition maps to an operational agenda; each dated/series occurrence maps to an operational occurrence linked to its agenda. Event cash maps to the existing single Por Caixa session concept, retaining occurrence and historical Event origin; commands retain historical origin. Undefined transforms remain incomplete. No second cash engine or business writer exists.

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

NOT PROVEN: real login/RBAC E2E, full DEV source-to-target coverage, financial/stock reconciliation, migration restart/recovery, ranking isolation by occurrence/recurrence, and all 8 capability combinations with/without occurrence. Synthetic route identity is not auth proof. Planning rows are not proof of migration.
## Gates

**Rápido (PR):** build backend/frontend; unitários de domínio/preço/centavos/estados; lint/typecheck; validação de migrations; testes puros de guards. Sem skips silenciosos.

**Completo (DEV/QA):** gates rápidos; todos os cenários P0 de integração; matriz `CAP-00..17`; pagamentos, cancelamento parcial, dívida, estoque e cozinha; isolamento de tenant; duas ordens de concorrência com barreiras explícitas; relatório de contagens e valores reconciliados. Cada fixture obrigatória ausente torna o gate BLOQUEADO, nunca PASS.

**Pós-migração (QA isolado antes de release):** executar migrador duas vezes, hash/conciliação completa, interrupção e retomada, restore/rollback, regressão de UI/portal/PWA/realtime, auditoria e ausência de tabelas paralelas. Só evidência funcional observada permite aceite; batch DONE, skip, HTTP 200 e busca textual não certificam cenário.
