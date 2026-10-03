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
| MAP-01 | Um PDV, nenhum PDV com trailer único, múltiplos PDVs/trailers; links nulos e não nulos | Planejar uma entidade com ID existente e vínculos que mudam | ID preservado é independente de `mappingComplete`; `destinationEntity`, `canonicalPdvId`, `destinationLinks`, dependências e bloqueio são campos separados; nenhum plano incompleto passa `assertExecutablePlan` | P0 unit | `pdv-unico-migration-planner.test.ts` |
| MAP-02 | Comanda EVENTO com Evento ausente/bloqueado; comanda CAIXA/QUIOSQUE com PDV ausente | Planejar cada grafo | Bloqueio tipado com código/evidência; evento/PDV pai inválido bloqueia comanda | P0 unit/integration | Testes puros; fixture DEV isolada pendente |
| MAP-03 | Comanda bloqueada com itens, opcionais, pagamentos, dívida, pedido, sessão, movimento e montagem dependentes | Planejar grafo em ordem e ordem invertida | Bloqueios propagam pelo pai; dependência resolvida apenas por tipo/ID/tenant | P0 unit | Planner cobre propagação de cliente/pedido; fixture completa pendente |
| MAP-04 | Pagamento com nenhuma, uma, duas ou sessão de outro tenant; comanda e conta válidas/inválidas | Planejar relações financeiras | Ausência, dupla referência ou tenant cruzado bloqueia pagamento; valor, forma, data, IDs e saldo continuam originais | P0 unit/integration | Planner cobre sessões ausentes/duplas/cruzadas sintéticas; conflito atual DEV = 0 |
| MAP-05 | Comanda EVENTO com `eventoId` e `pontoVendaId` iguais ao destino, depois conflitantes | Planejar ambas | Vínculo duplo só passa quando ambos resolvem ao mesmo PDV; diferença real gera conflito com evidência | P0 unit/integration | Pure test; três vínculos do Cliente DEV B passam pelo grafo. Regressão QA isolada pendente |
| MAP-06 | Dívida EVENTO válida; dívida sem comanda/cliente/Evento/PDV pai | Planejar dívida e recebimentos | Origem EVENTO não bloqueia por si; preserva ID, principal, cliente, comanda, pagamentos e saldo. Pai ausente bloqueia | P0 unit/integration | Planner puro cobre relações; fixture de consulta QA pendente |
| MAP-07 | Produto, cliente ou pedido de outro tenant; produto/opcional/tap/pedido ausente | Planejar pedido, item e seus filhos | Pai cruzado/ausente bloqueia origem e dependentes; nenhum tenant é inferido por nome | P0 unit/integration | Planner puro cobre tenant de pedido/cliente/produto; fixtures de consulta pendentes |
| MAP-08 | Mesmos registros em ordens distintas, inclusive agenda/ocorrência e pais depois dos filhos | Reexecutar planejamento | Saída byte a byte estável e ordenada; ciclos/missing parents não passam | P0 unit | `pdv-unico-migration-planner.test.ts` |
| SNAP-01 | Venda sintética com cliente, autores, dinheiro, itens/opcionais, cancelamento, preparo/viagem e timestamps | Projetar saída redigida | IDs, centavos, volumes, quantidades e datas persistem na saída; nome/contato/observação não aparecem; data UTC fallback vem marcada não comprovada | P0 unit | `pdv-unico-snapshot.test.ts` |
| CFG-02 | Duas configurações coexistentes com flags estoque/cozinha iguais ou divergentes | Planejar convergência de configuração | Divergência fica `DECISAO_MANUAL`; nenhuma flag é escolhida automaticamente | P0 integration | DEV atual: 1 tenant/2 linhas bloqueadas; decisão pendente |

## Testes disponíveis e estado

- `backend/scripts/event-deletion.isolated.test.ts`: fixtures sintéticas isoladas para rotas, logs, tenant, regras anteriores, rollback e concorrência. O decorator de teste injeta tenant/user; não comprova login nem RBAC real.
- `backend/scripts/event-cash-fk.isolated.test.mjs`: prepara baseline antes da FK no banco QA vazio, insere sessão/movimento e usa Prisma Migrate para aplicar/registrar a migration no QA; verifica preservação, ação restritiva e catálogo da constraint. Não grava migration como aplicada em banco compartilhado.
- `backend/scripts/inventory-pdv-unico-env.test.ts` e `backend/scripts/isolated-qa-env.test.mjs`: testes puros da validação de destino antes de carregar Prisma.
- `backend/scripts/pdv-unico-snapshot.test.ts`: verifica IDs, centavos, quantidades, volumes, estados e timestamps serializados e a exclusão de PII na saída.
- `backend/scripts/pdv-unico-planner.isolated.test.ts`: fixture sintética de fotografia via Prisma, exige QA isolado e valida `RepeatableRead`, relações Evento+PDV, dívida e pagamento ambíguo. Está implementado, mas a execução ainda não foi comprovada.
- `backend/tsconfig.scripts.json`: verificação TypeScript para scripts de inventário/plano e testes, fora do `backend/tsconfig.json` normal.
- `backend/scripts/inventory-pdv-unico-dev.ts`: inventário read-only; não certifica migração nem reconciliação financeira.

A pasta local `20261002130000_comanda_category_order` foi confirmada vazia e removida. O harness não tem exceção por nome: qualquer diretório de migration sem `migration.sql` bloqueia. A sequência inteira (87 diretórios válidos, 0 incompletos) foi aplicada ao PostgreSQL QA isolado; a migration restritiva passou preservação de sessão/movimento, DELETE com histórico bloqueado, DELETE sem histórico permitido e verificação da constraint `confdeltype=r`. O executor valida o destino e executa os testes, mas não cria nem remove container/banco; o container QA usado nesta execução foi provisionado e removido fora do executor.

## Inventario, mapeamento e conciliacao

O inventario DEV e read-only e usa uma transacao `RepeatableRead` com `READ ONLY`. Lista IDs de empresa, PDV, trailer, agenda/ocorrencia/evento avulso, sessoes, comandas, itens/opcionais, pedidos, montagens de tap, pagamentos, contas a receber, movimentos financeiros, saldos e movimentos de estoque. Catalogo inclui produtos, cardapios, precos, volumes e opcionais. Nao imprime credenciais nem dados pessoais.

O planejador puro retorna `MANTER`, `CRIAR_DESTINO`, `REASSOCIAR` ou `BLOQUEADO`. Cada linha separa identidade de destino, PDV canônico, FKs, dependências, preservação de ID, conclusão do mapa e bloqueio `{code, category, evidence}`. Os índices são por tipo/ID; pais inexistentes, tenant diferente e bloqueios dos pais propagam. `assertExecutablePlan` recusa destino obrigatório nulo ou dependência incompleta. Uma empresa sem PDV e com trailer único recebe apenas um PDV proposto. O planejador não escreve no banco nem escolhe por nome.

O inventário atual encontrou três comandas do Cliente DEV B com Evento e PDV. Todas mapeiam para o mesmo PDV porque há um único PDV no tenant, o Evento aponta ao trailer do tenant, o `pontoVendaId` da comanda é esse PDV e os itens apontam a produtos com controle de estoque habilitado. `comanda-service.ts` confirma que o vínculo é escrito quando estoque e produto participam; requer exatamente um PDV ativo. A dívida de origem EVENTO do Cliente DEV A também mapeia via comanda e cliente válidos.

Conciliar total de comandas por origem/estado/data operacional, pagamentos por forma/data do recebimento incluindo negativos, valor original/recebimentos/saldo de dividas, sessoes e movimentos financeiros e estoque por produto/unidade. Centavos e quantidades usam inteiro escalado/BigInt; unidades distintas nao sao somadas. Operacao e recebimento mantem eixos de data separados. Toda variancia exige entidade/ID e causa comprovada ou `NOT PROVEN`.

Fixtures unitárias cobrem referências válidas e ausentes, evento/comanda/dívida, sessões de pagamento ausentes/duplas/cruzadas, dependências bloqueadas, PDV cruzado, Cliente/Produto/Pedido de outro tenant, vínculo Evento+PDV igual/divergente, destino obrigatório, reordenação e centavos. Uma fixture sintética exercita a saída de venda, incluindo snapshots de item/opcional, autores, valores e timestamps, com campos PII excluídos. Isso não certifica todos os modelos da fotografia. Cenário planejado não equivale a certificado. Identidade injetada nos testes de rota não comprova login/RBAC real.

## Evidencia executada nesta entrega

- `event-cash-fk.isolated.test.mjs`: sequencia completa de migrations e migration restritiva passaram em PostgreSQL QA isolado vazio; sessao/movimento anterior preservados, DELETE direto com historico bloqueado, sem historico permitido e `confdeltype=r` confirmado.
- `event-deletion.isolated.test.ts`: 8 cenarios passaram, 0 skipped, incluindo bloqueio com caixa aberto/fechado, movimento preservado, tenant, agenda/comanda, auditoria, rollback e duas ordens de concorrencia com barreiras PostgreSQL.
- `pdv-unico-migration-planner.test.ts`, `pdv-unico-snapshot.test.ts`, `inventory-pdv-unico-env.test.ts` e `isolated-qa-env.test.mjs`: 12 testes passaram, 0 falharam/skiparam; os guards são puros e não conectam.
- `tsc --noEmit -p tsconfig.scripts.json`: passou; `npm run build` backend: passou.
- `inventory-pdv-unico-dev.ts`: fotografia DEV read-only executada. Mediu 116 linhas bloqueadas: 29 por escolha entre PDVs, 5 por trailers múltiplos, 2 de configuração em conflito e 80 dependentes propagados. 0 conflitos de dados confirmados, 0 pagamentos com conflito de sessão, 0 comandas sem tenant/destino e 0 tenants divergentes. Não são 116 problemas independentes.
- Os três vínculos Evento+PDV e a dívida EVENTO do Cliente DEV A ficaram completos pelo planejador. A divergência de configuração do Cliente DEV B segue para decisão manual.
- `pdv-unico-planner.isolated.test.ts`: **NÃO COMPROVADO**. Não havia listener local na porta QA `55439`; o runner de FK atual ainda copia diretórios de migration não rastreados, incluindo `20261002120000_unique_normalized_customer_phones`, então não foi iniciado para evitar aplicar essa mudança local de unicidade em QA.

O runner QA exige banco PostgreSQL isolado e vazio; valida o destino antes da conexao e nao provisiona nem destroi container/banco. A migracao de negocio segue nao executada.

## Gates

**Rápido (PR):** build backend/frontend; unitários de domínio/preço/centavos/estados; lint/typecheck; validação de migrations; testes puros de guards. Sem skips silenciosos.

**Completo (DEV/QA):** gates rápidos; todos os cenários P0 de integração; matriz `CAP-00..17`; pagamentos, cancelamento parcial, dívida, estoque e cozinha; isolamento de tenant; duas ordens de concorrência com barreiras explícitas; relatório de contagens e valores reconciliados. Cada fixture obrigatória ausente torna o gate BLOQUEADO, nunca PASS.

**Pós-migração (QA isolado antes de release):** executar migrador duas vezes, hash/conciliação completa, interrupção e retomada, restore/rollback, regressão de UI/portal/PWA/realtime, auditoria e ausência de tabelas paralelas. Só evidência funcional observada permite aceite; batch DONE, skip, HTTP 200 e busca textual não certificam cenário.
