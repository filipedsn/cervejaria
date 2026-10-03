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

## Testes disponíveis e estado

- `backend/scripts/event-deletion.isolated.test.ts`: fixtures sintéticas isoladas para rotas, logs, tenant, regras anteriores, rollback e concorrência. O decorator de teste injeta tenant/user; não comprova login nem RBAC real.
- `backend/scripts/event-cash-fk.isolated.test.mjs`: prepara baseline antes da FK no banco QA vazio, insere sessão/movimento e usa Prisma Migrate para aplicar/registrar a migration no QA; verifica preservação, ação restritiva e catálogo da constraint. Não grava migration como aplicada em banco compartilhado.
- `backend/scripts/inventory-pdv-unico-env.test.ts` e `backend/scripts/isolated-qa-env.test.mjs`: testes puros da validação de destino antes de carregar Prisma.
- `backend/scripts/inventory-pdv-unico-dev.ts`: inventário read-only; não certifica migração nem reconciliação financeira.

A pasta local `20261002130000_comanda_category_order` foi confirmada vazia e removida. O harness não tem exceção por nome: qualquer diretório de migration sem `migration.sql` bloqueia. A sequência inteira (87 diretórios válidos, 0 incompletos) foi aplicada ao PostgreSQL QA isolado; a migration restritiva passou preservação de sessão/movimento, DELETE com histórico bloqueado, DELETE sem histórico permitido e verificação da constraint `confdeltype=r`. O executor valida o destino e executa os testes, mas não cria nem remove container/banco; o container QA usado nesta execução foi provisionado e removido fora do executor.

## Inventario, mapeamento e conciliacao

O inventario DEV e read-only e usa uma transacao `RepeatableRead` com `READ ONLY`. Lista IDs de empresa, PDV, trailer, agenda/ocorrencia/evento avulso, sessoes, comandas, itens/opcionais, pedidos, montagens de tap, pagamentos, contas a receber, movimentos financeiros, saldos e movimentos de estoque. Catalogo inclui produtos, cardapios, precos, volumes e opcionais. Nao imprime credenciais nem dados pessoais.

O planejador puro retorna `MANTER`, `CRIAR_DESTINO`, `REASSOCIAR` ou `BLOQUEADO`, com destino sugerido e evidencia por ID. PDV unico existente e preservado; empresa sem PDV com trailer unico pode apenas propor um destino. Multiplos PDVs, tenant divergente, vinculo insuficiente e origem ambigua bloqueiam associacao. Comanda EVENTO com `eventoId` e `pontoVendaId` simultaneos fica para investigacao; estoque pode usar o vinculo e a dupla relacao nao prova corrupcao. O planejador nao escreve no banco.

Conciliar total de comandas por origem/estado/data operacional, pagamentos por forma/data do recebimento incluindo negativos, valor original/recebimentos/saldo de dividas, sessoes e movimentos financeiros e estoque por produto/unidade. Centavos e quantidades usam inteiro escalado/BigInt; unidades distintas nao sao somadas. Operacao e recebimento mantem eixos de data separados. Toda variancia exige entidade/ID e causa comprovada ou `NOT PROVEN`.

Fixtures unitarias do planejador cobrem PDV unico, zero PDV com trailer unico, multiplas unidades, Evento+PDV de uso ambiguo, comanda sem vinculo suficiente, recebimento posterior, estorno negativo, duas ocorrencias da mesma serie e uma segunda serie, tenant conflitante, mapa repetivel e exatidao de centavos/quantidades. Cenario planejado nao equivale a executado/certificado. Identidade injetada nos testes de rota nao comprova login/RBAC real.

## Evidencia executada nesta entrega

- `event-cash-fk.isolated.test.mjs`: sequencia completa de migrations e migration restritiva passaram em PostgreSQL QA isolado vazio; sessao/movimento anterior preservados, DELETE direto com historico bloqueado, sem historico permitido e `confdeltype=r` confirmado.
- `event-deletion.isolated.test.ts`: 8 cenarios passaram, 0 skipped, incluindo bloqueio com caixa aberto/fechado, movimento preservado, tenant, agenda/comanda, auditoria, rollback e duas ordens de concorrencia com barreiras PostgreSQL.
- `pdv-unico-migration-planner.test.ts` e `inventory-pdv-unico-env.test.ts`: 10 testes unitarios passaram, incluindo guard DEV sem conectar e fixtures de mapa/financeiro/quantidades.
- `inventory-pdv-unico-dev.ts`: fotografia read-only DEV executada; nao e migrador nem certifica login/RBAC ou UI.

O runner QA exige banco PostgreSQL isolado e vazio; valida o destino antes da conexao e nao provisiona nem destroi container/banco. A migracao de negocio segue nao executada.

## Gates

**Rápido (PR):** build backend/frontend; unitários de domínio/preço/centavos/estados; lint/typecheck; validação de migrations; testes puros de guards. Sem skips silenciosos.

**Completo (DEV/QA):** gates rápidos; todos os cenários P0 de integração; matriz `CAP-00..17`; pagamentos, cancelamento parcial, dívida, estoque e cozinha; isolamento de tenant; duas ordens de concorrência com barreiras explícitas; relatório de contagens e valores reconciliados. Cada fixture obrigatória ausente torna o gate BLOQUEADO, nunca PASS.

**Pós-migração (QA isolado antes de release):** executar migrador duas vezes, hash/conciliação completa, interrupção e retomada, restore/rollback, regressão de UI/portal/PWA/realtime, auditoria e ausência de tabelas paralelas. Só evidência funcional observada permite aceite; batch DONE, skip, HTTP 200 e busca textual não certificam cenário.
