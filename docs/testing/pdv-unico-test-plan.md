# Plano de testes: PDV único

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
