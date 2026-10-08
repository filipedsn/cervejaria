# Configuração canônica do PDV — execução versionada — 2026-10-05

## Ocorrência opcional no fluxo Por Caixa — execução autenticada em snapshot Git

Código sob teste: `9316c9b68e16d9f8195ff63031fb443921432683` (tree `f3955957021cbc2cae33983ead4d09f200873804`). A cadeia `qa:pdv-current-disposable` passou sobre a materialização imutável do commit: 1.095 blobs verificados, 173 módulos de projeto importados do snapshot, zero imports do workspace, 100 dependências externas, Prisma `6.19.3`; 0 skips. Manifesto temporário e manifesto corrente: baseline `9316c9b`, 57 candidatos, digest `d8fd08b9941e763940864c03b1e82d5c3754e2081d3dfeb887667407fb0a4f13`. Evidência: [`pdv-unico-occurrence-context-qa-evidence.json`](pdv-unico-occurrence-context-qa-evidence.json). Estado local antes/depois idêntico; nenhuma consulta ou escrita em DEV compartilhado/PROD.

| ID | Pré-condição | Ação | Resultado esperado e observado | Camada/prioridade | Executor / estado |
|---|---|---|---|---|---|
| OCC-API-01 | Sessão Por Caixa; seleção omitida | Abrir caixa e consultar contexto | `sessao.ocorrenciaId=null`; API e banco concordam; nenhum evento/agenda é criado | integration/API P0 | `proveAuthenticatedCashApi`; executado no QA do snapshot `9316c9b` |
| OCC-API-02 | Ocorrência avulsa do mesmo tenant/PDV | Selecionar explicitamente e vender avulso | Sessão, comanda e pagamento herdam a mesma ocorrência; origem `CAIXA`; snapshot/preço e estoque mantêm regras anteriores | integration/API P0 | Executado no QA do snapshot |
| OCC-API-03 | Duas ocorrências datadas da mesma agenda e mesmo cliente | Abrir sessões em dias operacionais distintos, criar comandas e consumir | IDs de comanda separados; cada comanda/pagamento aponta sua sessão e ocorrência exatas | integration/API P0 | Executado no QA do snapshot |
| OCC-API-04 | Ocorrência ligada a agenda diferente | Portal abre comanda e lança pedido | Credencial real do portal; comanda herda ocorrência da sessão, sem novo motor; edição forçada de contexto bloqueia sem duplicar pedido/item | integration/API P0 | Executado no QA do snapshot |
| OCC-API-05 | Payload de operação/portal contém `ocorrenciaId` arbitrário | Tentar substituir o contexto | 400 e contagens de escrita não mudam | integration/API P0 | Executado no QA do snapshot |
| OCC-API-06 | Ocorrência pertence a outro tenant/PDV | Abrir caixa / validar seleção incompatível | 409 tipado, sem sessão parcial ou mutação de dados | integration/API P0 | Executado no QA do snapshot |
| OCC-API-07 | Contexto de comanda foi adulterado depois da abertura | Lançar pelo fluxo autenticado/portal | 409; histórico, pedidos e itens permanecem intactos; restauração explícita da fixture permite seguir | integration/API P0 | Executado no QA do snapshot |
| OCC-API-08 | Duas aberturas para o mesmo PDV/dia, ocorrências diferentes | Segurar lock, iniciar chamadas concorrentes e observar advisory wait no PostgreSQL | No máximo uma sessão é criada; retry não troca ocorrência persistida | integration/API/concurrency P0 | Executado no QA do snapshot |
| OCC-API-09 | Ativação canônica desligada | Abrir caixa sem ocorrência e tentar enviar ocorrência | Fluxo Por Caixa legado continua; seleção enviada é recusada e relação aditiva não é consultada | integration/API P0 | Executado no QA do snapshot |

**Lacuna de negócio:** política por status/data da ocorrência continua pendente. Os testes confirmam associação técnica por empresa/PDV, sem aprovar elegibilidade de ocorrência por status/data. **Não coberto por esta entrega:** UI, rankings/pontuação, migração real, cutover, operação em DEV/PROD e políticas de portal além das recusas listadas. Nenhum destes cenários é prova de ranking.

Validações adicionais: `npm run build` passou; testes puros focados de caixa/venda/comanda passaram 28/28. Três tentativas de snapshot anteriores não são PASS: `b491787` expôs incompatibilidade do teste de manifesto com candidato ausente em baseline histórico; `f6dbed9` expôs (1) ordem incorreta da fixture ao fechar sessões enquanto outra comanda da empresa seguia aberta e (2) prefixo `/api/public` ausente nas URLs do portal. Correções foram commitadas e a cadeia completa foi repetida na revisão `9316c9b`; só esta última é a certificação aceita.

## Evidência executada no commit `40fa92b7fa7c879b8ce23d3823ab0c51ede95bb6`

O gate principal foi `node scripts/run-pdv-unico-git-snapshot-qa.mjs --commit=40fa92b7fa7c879b8ce23d3823ab0c51ede95bb6 --evidence-out=<arquivo temporário>`. Materialização: 1.093 blobs Git verificados; manifesto QA do snapshot com 53 candidatos; import audit: 172 módulos do snapshot, zero módulos do workspace local, 100 dependências externas; sem checkout/worktree. `qa:pdv-current-disposable` completou stages histórico/FK, core/negócio, financeiro e comercial; sem skips. Evidência detalhada em [`pdv-unico-canonical-settings-qa-evidence.json`](pdv-unico-canonical-settings-qa-evidence.json). Esta prova usa fixtures sintéticas; não certifica migração real ou cutover.

| ID | Pré-condição | Ação | Resultado observado em QA | Camada/prioridade | Estado |
|---|---|---|---|---|---|
| CFG-API-01 | Um PDV e configuração válidos; parâmetros legados divergentes | Login DONO; PATCH, GET de configuração/contexto e operações | Fonte `CANONICAL_PDV`; mesa 0 e false preservados; parâmetros legados permanecem; venda/caixa existente funciona | integration/API P0 | Executado no snapshot `40fa92b` |
| CFG-API-02 | Tenant legado EVENTO, flag permanece true após migração sintética | Ler contexto e operar pelo fluxo Por Caixa | `operationMode=CAIXA`; abrir, selecionar cardápio, comandar, pagar PIX e fechar; total/pagamento persistidos 1.900 centavos | integration/API P0 | Executado no snapshot `40fa92b` |
| CFG-API-03 | Tenant originalmente CAIXA | Mesmo fluxo autenticado | Total/pagamento persistidos 800 centavos; sessão FECHADO | integration/API P0 | Executado no snapshot `40fa92b` |
| CFG-API-04 | Estoque muda sem confirmação; cozinha ativa com pedido RECEBIDO | PATCH capacidades | Estoque: 400 sem escrita; cozinha: 409 sem escrita parcial | integration/API P0 | Executado no snapshot `40fa92b` |
| CFG-API-05 | Comanda aberta com item de preparo a 1.000 centavos; parâmetro de cobrança muda | PATCH canônico, GET contexto, consultar comanda e tentar pagar | total persistido 0→1.000 centavos; snapshot e ledger não mudam; pagamento continua 409 com fechamento pendente false | integration/API P0 | Executado no snapshot `40fa92b` |
| CFG-API-06 | Parâmetros canônicos e legados divergentes para cobrança de cozinha | Lançar/preparar pedido com flag desligada e ligada | Desligada: legado calcula total 1.000/pending 0; ligada canônica false: total 0/pending 1.000 e pagamento 409; ligada true: total 1.000/pending 0 e pagamento 200 | integration/API P0 | Executado no snapshot `40fa92b` |
| CFG-API-07 | Usuário ATENDENTE, credencial ausente/inválida, segundo tenant | Chamar configurações e contexto | Sem/inválida 401; ATENDENTE 403; payload cross-tenant recusado; contagens/configs dos tenants sem alteração | integration/API P0 | Executado no snapshot `40fa92b` |
| CFG-API-08 | Configuração canônica ausente, PDV ausente ou múltiplos PDVs | GET/PATCH com ativação ligada | Bloqueio específico 409; nenhuma configuração é provisionada | integration/API P0 | Executado no snapshot `40fa92b` |
| CFG-API-09 | Ativação técnica QA desligada; PDV difere do legado | GET e PATCH da configuração operacional | Resposta e persistência usam legado; a linha canônica não é consultada/reescrita | integration/API P0 | Executado no snapshot `40fa92b`; relação ausente também foi testada na query legada anterior |
| CFG-API-10 | Ativação canônica ligada e tentativa de enviar modo EVENTO | PATCH modo | `CANONICAL_PDV_MODE_CHANGE_UNSUPPORTED`; Por Caixa permanece único motor | integration/API P0 | Executado no snapshot `40fa92b` |
| CFG-API-11 | Fixture com registros reais de cozinha | Cancelar comanda e desativar cozinha | Pedido só deixa de bloquear após cancelamento confirmado pela sequência/rota válida; estados inválidos seguem 409 | integration/API P1 | Executado no snapshot `40fa92b` |

**Código de aplicação e ensaios anteriores:** commits `1bf3cd8`, `2c72971`, `7016fc6` e `40fa92b` foram usados para corrigir/assertar a fixture; somente `40fa92b` concluiu a cadeia completa. As duas primeiras tentativas completas de QA pararam em expectativas inválidas da fixture sobre estados de pedido; as mudanças foram feitas antes de `40fa92b` e os reruns desse SHA passaram. Não contar esses primeiros runs como PASS.

**Ainda NÃO COMPROVADO:** UI; API autenticada fora dos endpoints e rotas exercitados; RBAC individual/global; ativação em ambiente compartilhado; consumo por empresa com mais de um PDV; resolução de ocorrência na abertura; ranking; operação independente de pedidos; cutover; migração real e remoção de legado.

## Histórico de regressão Git — commit `04d5e669` — 2026-10-05

The integrated disposable-QA PASS previously documented below was produced from the local working tree. Review of published baseline `17bfcc5` showed that candidate hashes for `backend/src/lib/comanda-service.ts`, `backend/src/routes/operacao/comandas.ts`, and `backend/src/routes/public.ts` matched working files, not Git blobs. Keep that record as historical evidence only; it does not certify versioned code.

**Executed in the prior snapshot:** `npm run qa:pdv-current-git-snapshot -- --commit=04d5e669c68e23a03d2a01fe728d448e85077431` passed. The immutable source revision was commit `04d5e669c68e23a03d2a01fe728d448e85077431`, tree `b23213964d2e9d57da020cd1fb1e9c2586dfb4c9`. The runner verified/materialized 1,092 tracked Git blobs, generated a 46-path candidate manifest (`ed33f7d6cb010cb86d00e5d1b9339b91a32ef26933962652acf35d881725071d`), then ran the full disposable regression. The import audit reported 171 snapshot modules and zero external workspace modules; 100 external modules were dependencies, Prisma `6.19.3`. The newer configuration certification above supersedes this SHA as current evidence.

The full `qa:pdv-current-disposable` stages passed, including the pre-additive real comanda query (table absent), legacy and canonical kitchen-charge outcomes, authenticated cash flow and rejection cases, commerce preparation/migration/replays, historical migration/core, finance and menu/snapshot checks. Reported stage markers included `PDV_FINANCE_QA=PASS`, `QA_AUTHENTICATED_CASH=PASS`, `PDV_COMMERCE_QA=PASS`, and final Git import audit PASS. The disposable PostgreSQL container and snapshot were removed; no skips were reported.

**Preservation check:** local fingerprint before and after was `38e158d76d13ee6597dc0906c9f69bbd9581610cd4086e31dc91dfa5b3a75720`; index stayed empty (SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`), working diff fingerprint stayed `d08b6a79d23281bfd5056f77fa76f5265a8cc33d0234c57d7cbf593ff6080b98`, and 9 pre-existing untracked files remained. No stash, checkout, restore or reset was used. QA only: `PROD_ACCESS_USED=NO`; shared DEV was neither queried nor written.

**Limits for that prior SHA:** this is synthetic PostgreSQL QA evidence for its pinned Git code, not proof of real-data migration or authorization to cut over. Its permanent manifest was normalized SHA-256 `357d20c9c96b578145fb2b661beb33310cabdad483454d8b186851c53d87d8da`, baseline `04d5e669c68e23a03d2a01fe728d448e85077431`, internal SHA `ed33f7d6cb010cb86d00e5d1b9339b91a32ef26933962652acf35d881725071d`. This permanent manifest has since been advanced to baseline `40fa92b` by the configuration certification above.

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

## API-CASH-02 — Isolamento de aumento de consumo por ocorrência (2026-10-05)

| Caso | Ação autenticada | Resultado / invariantes | Executor |
|---|---|---|---|
| Baseline anterior à correção | Sessão B; comanda historicamente vinculada a A; PATCH do item 1→2 | Reproduzido antes da correção em PostgreSQL QA descartável: HTTP 200, total 950¢→1.900¢, estoque 900→800. Prova autenticada da falha observável; o contador de zero consultas da revisão inicial foi apenas simulado. | API Fastify `inject` + PostgreSQL QA |
| Contexto incompatível | PATCH 1→2 com `ocorrenciaId` arbitrário no payload | HTTP 409; item/quantidade, opcionais e snapshots, total, pagamentos, pedidos/histórico, saldo e movimentos permanecem iguais | Mesmo runner; PASS |
| Contexto correto / estoque | PATCH 1→2 na sessão e ocorrência compatíveis | HTTP 200; total 950¢→1.900¢; uma unidade adicional debitada, um movimento adicional; snapshot e pagamentos preservados | Mesmo runner; PASS |
| Sem sessão aberta / tenant | Aumento sem sessão autorizadora; chamada cruzada por tenant | 400 sem escrita; tenant distinto recebe 404 | Mesmo runner; PASS |
| Fechamento concorrente | PATCH aguarda advisory lock do caixa; sessão fecha sob o lock | 1 waiter observado; depois do fechamento PATCH retorna 400 sem alterar comanda/pagamento. Cancelamento permanece possível e reverte estoque | Mesmo runner; PASS |
| Cozinha / histórico / modo legado | Aumento após envio e após entrega; transições de preparo; PATCH com ativação desligada | Aumentos bloqueados com 409; preparo e pagamento histórico seguem; cancelamentos/estornos pertinentes passam; modo legado aceita PATCH 200 sem consulta aditiva e ignora contexto enviado pelo cliente | Mesmo runner; PASS |

Implementação certificada no snapshot Git `5fcfd43d155992d2595d88c5ca5da9f9c3f5fea0` (`4812662919e93a1f2fffb9042ef7974e0ff64395`). `npm run build` passou; testes focados passaram 3/3; `npm run qa:pdv-current-git-snapshot` passou integralmente, com `PROD_ACCESS_USED=NO`, `devSharedAccess=NO`, fotografia imutável de 1.097 blobs e estado local preservado. Evidência estruturada: `pdv-unico-occurrence-context-qa-evidence.json`.

**Limites:** todas as escritas foram em PostgreSQL QA descartável em `tmpfs`; nenhum dado DEV/PROD foi lido ou escrito. A reprodução autenticada é sintética, não valida dados reais nem autoriza migration/cutover. Política de aumento negativo/correção histórica sem caixa aberto ainda requer decisão operacional; a implementação não bloqueia cancelamento, estorno ou confirmação histórica de preparo. UI, migração real e corte continuam pendentes.

## PDV representativo — fotografia DEV em QA descartável (2026-10-05)

**Origem e integridade:** o guard validou DEV antes da conexão; cliente Prisma gerado do schema do commit `66ec00886b65eaea8e437fae4e9a36f7be971b09` (`19ff5e65829bc6356fa8d06edbff9fd1527b1d1dd0bd5e35c58cda880479ae59`), 85 migrations no ledger até `20260930150000_company_pix_key`; leitura em `RepeatableRead` + `READ ONLY`. CIA Marítima foi resolvida para `cmr9yis3c0000hvu00q9fe7y1` e Churrasquinho do Thiago para `cmsry9xrn0000hvlgopjxy0oo`, ambos por nome/slug únicos do inventário. A fotografia sanitizada de 34 tabelas/10.738 linhas passou restauração em QA: IDs, FKs e todos os escalares comuns foram comparados; 0 arestas cruzadas. Foto/dados brutos não foram versionados. Campos anonimizados e meios de sanitização estão no JSON de evidência.

| Tenant | Domínio | Antes no DEV | Resultado QA |
|---|---|---|---|
| CIA Marítima | Negócio e catálogo/config | 0 PDV/1 Trailer; 4 agendas/21 ocorrências/2 avulsos; 11 produtos/18 preços/1 cardápio/2 linhas/5 taps/123 montagens | Completou; pausa após lote, retomada e replay sem duplicação. Regra existente derivou o PDV do único Trailer. |
| CIA Marítima | Sessões | 4 caixas Evento (3 fechadas/1 aberta), sem sessões Por Caixa | `OCCURRENCE_P2028`, Evento `cmurjbdem000lhv5ckg6urqqr`; transação interativa excedeu o limite padrão de 5.000 ms, observado em 5.421 ms; 0 lotes confirmados. |
| CIA Marítima | Financeiro/comércio/estoque | 445 comandas/1.098 itens; 432 pagamentos por forma totalizam 2.202.500¢; dívida 1.500¢ pendente; cozinha/estoque vazios | Não executados porque sessões não foram confirmadas. Histórico e valores ficaram intactos na restauração antes da destruição do QA. |
| Churrasquinho do Thiago | Negócio e catálogo/config | 1 PDV/1 Trailer; 1 agenda/1 ocorrência/1 avulso; 34 produtos/34 preços/5 cardápios/90 linhas/2 opcionais; 914 overrides em 40 sessões | Completou; pausa, retomada e replay sem duplicação; manteve o PDV já existente. |
| Churrasquinho do Thiago | Sessões | 2 caixas Evento, 40 sessões Por Caixa (36 fechadas/4 abertas) | `OCCURRENCE_P2028`, Evento `cmun03dp4000shva8frtvn08h`; transação interativa excedeu o limite padrão de 5.000 ms, observado em 8.401 ms; 0 lotes confirmados. |
| Churrasquinho do Thiago | Financeiro/cozinha/estoque | 173 pagamentos totalizam 1.389.000¢; 5 dívidas 19.000¢ principal/recebido/saldo 0; 431 pedidos/952 transições; 31 saldos e 756 movimentos (`UNIDADE`) | Financeiro, preparação e comércio não executados por dependência das sessões. Estoque ficou intacto na restauração QA. Movimentos preservados por tipo/unidade; sem somar unidades distintas. |
| Ambos | Auditoria/estatísticas | 2.141/1.623 logs; 156/6 estatísticas | Preservados e comparados na restauração QA; sem migrador implementado nesta sequência, portanto pendentes, não reportados como migrados. |

**Bloqueio prioritário:** a sequência business → catalog/config → sessions → finance → kitchen preparation → commerce inicia corretamente e business/catalog completam em ambos. O migrador de sessões revalida grafo/ocorrências dentro de uma interação com timeout padrão de 5 s; precisa reduzir leituras repetidas ou declarar um limite adequado ao volume. Não remendar dados. Financeiro, cozinha, comandas/pedidos/estoque permanecem dependentes e precisam ser repetidos depois da transformação do executor.

**Recuperação e regressão:** nos dois tenants, business/catalog foram pausados após um lote, retomados e reexecutados no mesmo run. O bloqueio de sessões ocorreu antes de lote, sem escrita parcial. A suíte sintética do snapshot executa rollback após escrita, pausa/retomada, replay, payload/destino divergentes e concorrência; esses testes não substituem a verificação ainda pendente desses casos para fotografia representativa. Uma ausência de transformador de auditoria/estatísticas permanece explicitamente pendente.

**Limites operacionais:** a migration target de 91 passos foi aplicada somente em PostgreSQL QA `tmpfs`; o container foi removido. Nenhuma escrita foi dirigida ao DEV e não houve acesso ao banco/aplicação PROD. Um `docker ps` usado para conferir o runner exibiu metadados de containers, incluindo nome/status/portas de PROD; isso excedeu a proibição sobre leitura de metadados, foi comunicado ao usuário e não se repetiu. Nenhum `inspect`, `exec`, conexão ou query PROD ocorreu.

**Próxima ação antes de qualquer aplicação em DEV:** corrigir/dimensionar o custo transacional de revalidação de sessões, repetir esta mesma foto sanitizada e reconciliar por IDs, vínculos, centavos, preços/overrides, histórico, movimentos e unidades em todas as fases dependentes; revisar discrepâncias. Backfill, cutover e autorização de escrita em DEV continuam pendentes. A foto sanitizada não prova literalidade de nome/contato/credenciais/observações anonimizados.


**Certificação do executor:** `qa:pdv-current-git-snapshot` PASS no commit `77e277f520d9806b6f10f4f3bf52f7a79de59cbb` (tree `c1a0373e67a899d53024d2705c4805fa900c0f7b`; manifesto `7bd8f4aeea58c50edced1e83a3a86755d97e3b3189c0a2ed9f03e89e5d4bad41`), com build backend, testes focados e auditoria do snapshot Git aprovados. Esta bateria sintética é distinta do ensaio representativo: ambos os tenants bloquearam em sessões antes do primeiro lote; financeiro, cozinha, comércio e estoque ainda não têm reconciliação representativa pós-migração.


## Reensaio representativo apos otimizacao de sessoes (2026-10-05)

A captura desta repeticao e nova; a fotografia temporaria anterior havia sido removida. O guard DEV fez leitura RepeatableRead + READ ONLY. Hash SHA-256 `a79450eef6d1b775487d80fafc015f67b59960faa053e470a86d2b7bc4eae2e3`, 8.386.723 bytes, 34 tabelas, 10.738 linhas, zero arestas cross-tenant. A captura anterior tinha o mesmo volume (diferenca: 0 tabelas/0 linhas), sem alegacao de identidade. Leitura: 1.767,75 ms/100 consultas. Dados brutos ficaram em temporario; credenciais viraram marcadores exclusivos de QA; campos pessoais/textuais estao listados no JSON.

A prova tem validacao completa do run/checkpoint, mapas, batches, recibos e conteudo real dos destinos. Resolvers de ocorrencia e catalogo reutilizam validacao somente na transacao atual; nao ha cache entre batches, transacoes ou runs. RepeatableRead e advisory locks permanecem. Sessoes usam batch limitado a 250, timeout 30 s e maxWait 10 s. Maior estagio unico no Churrasquinho: 12,197 s para validar checkpoint/maps/recibos.

| Tenant | Negocio | Catalogo/config | Sessoes | Financeiro | Cozinha/comercio/estoque |
|---|---|---|---|---|---|
| CIA Maritima | COMPLETED; pausa/retomada/replay | COMPLETED | COMPLETED; 4.607 ms/15 no primeiro batch; 7.398/23 na retomada; replay 2.439/4 | BLOCKED: `FINANCE_PAYMENT_SESSION_MISSING`, pagamento `cmrcmcnfp000khv2w2uyceipp`, zero batches | NAO EXECUTADOS por dependencia financeira |
| Churrasquinho do Thiago | COMPLETED; pausa/retomada/replay | COMPLETED | COMPLETED; 14.454 ms/53 no primeiro batch; retomada 94.909/989; replay 18.943/5 | BLOCKED: `FINANCE_PAYMENT_SESSION_MISSING`, pagamento `cmsthiwwu007ohvmo2o79k3g1`, zero batches | NAO EXECUTADOS por dependencia financeira |

Negocio, catalogo/config e sessoes confirmaram hashes de fotografia, ordem de checkpoint, mapas, recibos e destinos; pausaram, retomaram e repetiram o mesmo run sem duplicacao. No Churrasquinho, a retomada caiu de 166,7 s para 94,9 s; consultas de validacao de checkpoint de 63.219 para 37.449; confirmacao de catalogo de 34.186 para 20.502.

O pagamento sem sessao persistida e o primeiro bloqueio de dados/politica, nao timeout: nenhum batch financeiro foi confirmado. Nao houve reconciliacao pos-transformacao de pagamentos, dividas, recebimentos, caixa, pedidos/historico, comandas/itens/snapshots, saldos ou movimentos de estoque. A fotografia/restauracao pre-transformacao preservou IDs, relacoes, centavos, snapshots, 914 overrides e estoque por unidade, mas isso nao prova migracao/reconciliacao posterior. Quantidades de unidades distintas nao foram somadas.

Auditoria (CIA 2.141 / Churrasquinho 1.623 linhas) e estatisticas (156 / 6) foram restauradas e comparadas antes das migrations; nao ha transformador nesta sequencia. Permanecem PENDENTES, nao migradas.

**Resultados separados:** build backend PASS; testes FK simples/diferentes nomes, compostos, pai ausente e tenant incompativel PASS 5/5; regressao sintetica `qa:pdv-current-disposable` PASS; ensaio representativo BLOCKED, codigo 1. Fotografia Git do commit `b776f61dec5cd24b20777972079f32e58b5025c7` (tree `4e3791128617613e7fe4a63c73cbf7f8d9b8cda8`), 1.102 blobs/58 candidatos, manifesto SHA-256 `92a9c1fcd9d8d387c870c3f0c6d817e4cb667249e37ba8e55115a4e062c15ad8`. O agregado corretamente permaneceu BLOCKED apesar do PASS sintetico. Evidencia representativa esta neste JSON; relatorio do executor foi mantido somente em temporario.

**Decisao pendente:** estabelecer com proveniencia comercial o tratamento de pagamentos imediatos sem sessao. Nao associar por data/valor nem corrigir dados automaticamente. Apos decisao, repetir financeiro, cozinha antes do comercio, comercio e estoque. Auditoria/estatisticas, backfill DEV e cutover permanecem fora da prova. DEV teve zero escritas; PROD nao foi acessado, inclusive metadados.
## Payment session provenance classification (2026-10-05)

The representative payment inventory recaptured DEV through the existing guarded `inventory:pdv-dev:readonly` executor. The destination was not DEV: the connection was RepeatableRead and read-only, and the output photo was written only to OS temp. It used the pinned pre-commerce schema matching DEV's 85-migration ledger. Current photo SHA-256: `59ceb652b06f11d5061af5cb837db3f91e2ac608f9fc69ddec0d8aeb93288b4b`; previous photo was unavailable, so this capture is not called identical. It has the same reported row/payment counts and byte length as the earlier capture, but anonymization is salted per run and exact old-row comparison is unavailable. No personal fields, credential values, or free audit metadata are included in the committed evidence.

| Tenant | A exact reference | B proven no-session debt receipt | C immediate payment, origin unproven | D bad/dual references | Finance consequence |
|---|---:|---:|---:|---:|---|
| CIA Maritima | 2 / 13,600 cents | 0 | 430 / 2,188,900 cents | 0 | C blocks; all 430 are EVENTO, closed command, no debt link. |
| Churrasquinho do Thiago | 24 / 101,800 cents | 2 / 5,200 cents | 147 / 1,282,000 cents | 0 | C blocks; all 147 are CAIXA, closed command, no debt link. B is already supported as receivable history. |
| Total | 26 / 115,400 cents | 2 / 5,200 cents | 577 / 3,470,900 cents | 0 | Finance still BLOCKED before any committed batch. |

The structured row-level inventory is `paymentSessionReview.allPaymentCases` in `pdv-unico-representative-dev-qa-evidence.json`. It preserves payment and command IDs, tenant, origin, PDV/Event, paid/created/closed dates, form, exact cents, debt link, command state, both stored session references, resolved session details, and structured audit IDs/types/paths. Audit values that may contain user text are omitted.

All 579 payments with both session fields null are classified: 2 as B only because the exact payment ID appears in `SALE_PAYMENT_RECORDED` audit payload with explicit `sessaoCaixaId: null`, the matching receivable ID, and the established pending-receipt code path; 577 are C. Among those 577, 323 have an exact payment ID in audit but no session field in that snapshot, and 252 have no exact payment ID in audit. None of those audit records proves a cash session or authorized no-session policy. The 26 A links resolve within tenant and the command's Event/PDV. There are zero unresolved FK targets, cross-tenant/PDV/Event session mismatches, or dual references in this photo.

Tests added and run with Node's test runner: exact valid reference; exact proof of legitimate null; uncertain null; dual/missing/mismatched reference; receivable receipt with no session and exact cent conservation; and tenant isolation. These classifier tests are analysis safeguards only: they do not modify or weaken `pdv-unico-finance-transform.ts`. The transform allows receivable-linked null-session receipts but still blocks immediate payments without an exact session.

Current/historical provenance reviewed at code `461290a`: `fechar-comanda.ts` conditionally writes session FKs only when passed; event close/group and standalone sale callers pass the event cash session; current Por Caixa close passes the authorized operation session; pending receipts may store null and return `PENDURADO`; event receivable collection may omit a session and explicitly audit `FORA_DO_CAIXA`. Migrations `20260926120000_contas_receber_operacao` and `20260929160000_evento_cash_register` added nullable session links without historical link backfill. The later candidate FK migration from `sessaoCaixaId` to `quiosque.SessaoCaixaQuiosque` is not in DEV. The event session FK uses `ON DELETE SET NULL`, an additional reason current null cannot alone prove historical origin.

The decision proposal has three branches: (1) restore a session only from an exact immutable reference; none exists for the null-session rows; (2) preserve proven no-session history as null-session, keeping receivable and customer history and applying an explicit policy to cash reports; (3) keep C and any future D rows blocked until evidence or an explicit business policy exists. Current reporting must be accounted for: the Event cash summary includes only persisted event-session links, while Por Caixa close/dashboard code also temporally includes 147 null-session Churrasquinho payments (1,282,000 cents) in exactly one interval each. That is report behavior, not proven cash provenance. If business approves immediate historical no-session payments, add a per-payment durable provenance/disposition to the migration contract and reconcile all IDs/cent values once by tenant/origin/form/date/receivable. Explicitly decide whether the Por Caixa interval fallback is preserved, replaced by a distinct unassigned-history view, or corrected; do not convert its date-window match into a session FK. Do not create sessions, move cash, or unlock finance based on a date/value/Event match.

The row-level source photo is not versioned. Its new hash differs from the previous capture; old raw bytes are gone, so the comparison is aggregate only. Both source and target business identities were unique. The photo anonymizes user name/email/password hash, customer name/email/phone/birth date/observations, event location, and personal/free-text audit values; credentials were replaced with QA-only values.

The two B payments are fully settled debt receipts: 3,800 and 1,400 cents, each matching its account principal with zero balance. Their exact `SALE_PAYMENT_RECORDED` snapshots contain payment ID, account ID, and `sessaoCaixaId: null`. The historical route in `b7dcab3bc783643b4765484a348b92e8ac670f87` predates both records and stores null when no Por Caixa session was open, labels that case `PENDURADO`, and logs the payment-bearing summary. This supports B only for these two; immediate command-close records remain C even where a nearby date or exact payment ID appears in a close audit.

### Git snapshot import-audit regression

The snapshot runner now verifies the synthetic module expectations whenever the synthetic suite passes, even if the representative suite is BLOCKED or NOT_RUN. It separately records whether the representative entrypoint was observed or not reached; a successful representative run still requires its entrypoint. Aggregate certification remains BLOCKED on any required suite failure. The prior metric output used nested stages: phase-wrapper query counts are exclusive of child measurement scopes, and child counts are exclusive to their respective stages. Cross-scope comparisons do not represent total queries unless all exclusive scopes are accounted for.


## Payment classification certification update (2026-10-05)

The review code is certified from Git commit `cf18678ba3d9145cd8d58a41a1a7b0d145ebf3f1` (tree `a671be8878a33c53906e28ae3ee184281e05b6fd`), materializing 1106 tracked blobs from the exact commit. Aggregate snapshot result: **BLOCKED**. The synthetic regression passed (exit 0); the representative rehearsal remained blocked (exit 1). Module-origin audit passed: 5/5 expected synthetic modules and the representative entrypoint was observed. The runner preserved the local workspace fingerprint.

Finance stopped before its first batch for both tenants: CIA Marítima payment `cmrcmcnfp000khv2w2uyceipp` and Churrasquinho payment `cmsthiwwu007ohvmo2o79k3g1`, each `FINANCE_PAYMENT_SESSION_MISSING`. The complete classification remains 26 exact session references (115,400 cents), 2 evidenced no-session debt receipts (5,200 cents), 577 immediate payments without sufficient provenance (3,470,900 cents), and zero invalid/dual references. Kitchen, commerce and stock therefore remain unreconciled.

Metric counters are nested: phase-wrapper query totals exclude query counts attributed to child measurement scopes; each child counter is exclusive to its stage. Compare like-for-like scopes only. No financial readiness or cutover is approved. The remaining business decision is whether/how to preserve immediate no-session history and represent it in cash/PDV reporting; do not associate by date, amount, Event or sole candidate.


## Historical C disposition rehearsal (2026-10-05)

The approved C inventory is 577 payments: 323 have an exact payment ID in an audit record without a session reference, and 254 have no exact payment ID in audit. These counts are derived from the 577 row-level C records, excluding the two separately classified B debt receipts. The 26 A records retain their exact session references; B retains its receivable identity and existing provenance.

For this QA rehearsal, the existing Payment rows retain their IDs, financial fields and null session references. A nullable durable provenance enum records `CAIXA_NAO_COMPROVADA`; it does not assert that the receipt occurred outside cash. Authorization is pinned to all 577 row IDs and verified financial/context fields in the sanitized approved photo and inventory digest. New, changed, missing, cross-tenant or contradictory records remain blocked. No time-window match creates a session link.

On the canonical reporting path, payment totals use exact persisted session references. Unassigned historical payments appear in a separate informational total, included once in overall finance and customer history but excluded from session totals. When canonical mode is disabled, the existing legacy interval behavior remains. New immediate operational payments continue to require an open session; receivable collection rules remain specific to that flow.

The migration is additive and QA-only in this task. Implementation code is committed at `60b3d066c5ac15e2412a7d0b29b370630062da71`. No DEV migration, real backfill, cutover, deploy, or legacy removal is authorized. Representative financial reconciliation and dependent phases are pending the isolated QA run; TAP-76 remains In Progress.


## QA execution result (2026-10-06)

The exact Git snapshot was certified from commit `2b607a0de03d792ce782e0ffbbb34d729ac0e3bd` (tree `829d98be05a84533737d15a8f8d1703f97ce093c`), materializing and verifying 1,110 tracked blobs. The generated candidate manifest SHA-256 was `438664b622ca58b5e4cd12a1dd230052838a8bea2fb04c5e752495b446b09cad`. Local workspace state was unchanged by certification.

Synthetic business migration and the exact-session/legacy-fallback tests passed. Synthetic finance passed its restartable migration, approval-scope rejection, altered-payload rejection, tenant mismatch, C/A/B separation, payment/debt reconciliation, rollback, and replay checks. Finance fixture summary: 90 migrations, 6 payments, 2 receivables, 5 movements. The aggregate synthetic suite is BLOCKED by a separate commerce regression: `EVT-AUD-02` expects HTTP 200 but gets 500 from Prisma `P2022` (column absent) during event reversal. Seven of eight event deletion tests passed.

The representative QA copy restored and exactly reconciled all 10,738 rows across 34 photo tables. CIA Maritima business, catalog, and session phases each passed pause/resume/replay. Finance first batch returned RUNNING; the resume process remained CPU-active without a terminal result for 30 minutes. It was stopped, and its executor-owned disposable QA container was removed. No representative financial reconciliation result was produced: the 577 C payments, 26 A payments, and 2 B receipts were not certified in the destination. Churrasquinho and dependent representative kitchen/commerce phases were not reached. The migration runner remains unapproved for representative completion.

No DEV writes or migrations, production access, real backfill, cutover, deploy, or legacy removal occurred. TAP-76 remains In Progress. Next step: profile the representative finance resume and resolve the independent commerce fixture/schema blocker, then repeat the exact snapshot through both tenants and dependent phases.


## Historical finance preservation: completed QA rehearsal (2026-10-06)

This addendum supersedes the earlier blocked result above for the same approved photograph and records a new exact-Git run; earlier outcomes remain historical. The code snapshot was `2b611d6a430b1429d8a0fc9d526b1afdd965f29a` (tree `56ef9893be25fc6b1be1bb51b57d6606b73b91c8`), with 1,110 Git blobs materialized and verified. Synthetic and representative runs both passed; snapshot module-origin audit passed with 177 project modules, zero modules from the mutable workspace, and 100 external dependencies. The approved photo SHA-256 was `2071d444df091fe85438278ca1e6d2329d4e2106679b23143f0e863b8769d16b`: 34 tables, 10,738 rows, zero cross-tenant edges. The disposable QA database/container was removed by its executor. No shared DEV or PROD access was used.

The bundle/schema gate now applies `20261005180000_payment_historical_provenance` and generates Prisma Client from that applied candidate schema. EVT-AUD-02's P2022 column was `Pagamento.provenienciaHistorica`; it is present in the migration and commercial manifest. All nine isolated event-deletion/reversal regressions passed, including the expected 200 response and audit metadata after cascades. The synthetic finance suite passed 90 migrations, its migration/API regression fixtures, A/B/C separation, exact IDs and cents, rollback, replay, invalid/altered/cross-tenant approval rejection, and session/cash separation. Authenticated APIs in legacy and canonical modes passed for both historical origins, dashboard/session summary/received totals, new immediate-payment refusal without a session and with no partial writes, and a valid-session payment.

The representative restore exactly reconciled the 10,738 source-photo rows before running both tenants. Finance completed, paused/resumed and replayed for CIA Marítima (433 records; resume 50.5 s, replay 3.2 s) and Churrasquinho do Thiago (178 records; resume 39.5 s, replay 4.4 s). The 577 approved C payments retained IDs, cents and null session links with durable `CAIXA_NAO_COMPROVADA` provenance; they remained separate from session totals and were included once in common financial/customer history. The 26 A payments remained on their exact sessions; the two B receipts remained on their receivables. Finance reconciliation and dependent phases completed without inferred sessions or duplicate payment contribution. The approved evidence inventory still derives C as 323 rows with exact audit payment references plus 254 without, totaling 577. The full 605-payment photo remains reconciled by exact IDs and values; no authorization was regenerated to absorb differences.

| Representative dependent phase | CIA Marítima | Churrasquinho do Thiago |
|---|---:|---:|
| Business pause/resume/replay | completed | completed |
| Catalog pause/resume/replay | completed | completed |
| Sessions pause/resume/replay | completed | completed |
| Finance pause/resume/replay | completed; 433 rows | completed; 178 rows |
| Kitchen preparation before commerce | completed | completed; 431 rows, resume 241.0 s, replay 6.6 s |
| Commerce pause/resume/replay | completed; 1,549 rows, resume 288.1 s, replay 6.6 s | completed; 3,004 rows, 121 batches, resume 1,128.5 s, replay 13.6 s |
| Kitchen preparation revalidation/replay | completed | completed |

The largest observed commerce transaction was about 13.3 s, within the unchanged 30 s transaction limit; batch cursors and confirmed commits advanced throughout. Migration work was limited to the executor's isolated QA copy. Backend `npm run build` passed. Frontend `npm run build` passed (Vite reported the existing dynamic-import/chunk-size advisories). No real backfill, DEV migration, cutover, deploy, or legacy removal was performed. TAP-76 remains In Progress; product cutover and any future real-data execution remain separate gates.

## Turn revenue correction and finance revalidation (2026-10-06)

Certified code: `4b7e324c4bbebf0ecca18ffe1a8cc7531df7b6b9`, tree `c28b7a16aef0ebcbe27afdcb7d48675b2607d8c2`. The exact-Git runner verified 1,111 blobs; synthetic and representative QA passed independently; backend and frontend `npm run build` passed from the snapshot. The approved representative photo hash is `2071d444df091fe85438278ca1e6d2329d4e2106679b23143f0e863b8769d16b`.

| Focused check | Result |
|---|---|
| Reproduce 10,000-cent sale and 4,000/6,000-cent debt receipts in two sessions | Before fix, revenue was 10,000 cents in both turns; after fix it was `[10000, 0]`, with receipts `[4000, 6000]` counted once. |
| Pending sale, debt partials and quitation, immediate payment, receipt-only turn | Passed through authenticated API and PostgreSQL QA; pending principal stays on the original realization turn, while each receipt stays on its receiving session. |
| No-session command refusal | Passed exact before/after operational photo comparison: command, items, payments, total, states, timestamps, and relevant audit rows unchanged. |
| Historical A/B/C and common financial totals | Passed exact reconciliation; 26 A session links, two B receivables, and 577 C IDs/values/null sessions with `CAIXA_NAO_COMPROVADA` remained intact. |
| Finance replay after commerce, both tenants | Passed before subsequent kitchen revalidation; exact approved 605-payment IDs/values/classifications reconciled with no duplicate or omission. |
| Durable commerce-link proof guards | CIA Marítima blocked missing/altered map, missing/divergent receipt, and manually cleared command link. Churrasquinho had no approved C EVENTO row; that guard was marked not applicable, without substituting or altering inventory. |

The new realization-session field applies to new closed sales and is constrained to the same PDV. Historical sales were not assigned by timestamp. The exact Git snapshot synthetic and representative certifications were separate. Snapshot module audit: 177 project modules from the Git snapshot, zero from the mutable workspace. Manifest SHA-256: `77a4ebd2d5e6e19cef7851a17f70626b177d3ab65cdd3493922c367db29543cf`. Schema verification was not counted as a functional reversal scenario. QA used only the executor-created disposable database/container; DEV remained read-only via its existing guard and received no writes or migrations. PROD, including metadata, was not accessed. No backfill, cutover, deploy, or legacy removal was executed; TAP-76 remains In Progress.

## Canonical single-PDV provisioning and protection (2026-10-06)

Focused authenticated PostgreSQL disposable-QA execution passed against code/manifest commit `cb8776d`. The executor-created container was removed after the run. Assertions covered:

| Scenario | Result |
|---|---|
| Admin canonical provisioning and explicit setup | Company, owner, one PDV and its `ConfiguracaoPontoVenda` created atomically; explicit flags and setup metadata retained by their existing owners. |
| Retry and concurrency | Repeating setup or provisioning did not duplicate resources; two simultaneous admin provisioning requests produced one success and one conflict; concurrent first-PDV creation produced one PDV; concurrent second-PDV requests both returned 409. |
| Duplicate and authorization refusal | DONO second-PDV attempt returned `PDV_ALREADY_EXISTS` without changing the existing PDV/configuration. ATENDENTE got 403; cross-tenant access/write got 404; foreign-tenant body identifiers and canonical EVENTO engine change were rejected without writes. |
| Mid-transaction failure | Disposable QA trigger forced configuration insertion to fail; the company, owner and PDV were all rolled back. |
| New-tenant commerce | New tenant configured catalog and saved menu, opened cash, sold two units, received PIX and closed the session through Por Caixa. Configuration was read from the PDV. |
| Legacy close compatibility | Dropped `Comanda.sessaoCaixaRealizacaoId` in QA and generated a Prisma Client from a schema predating the column. Disabled-mode close succeeded and the payment retained its cash-session link. |
| Financial regression | Authenticated turn replay preserved a pending sale on its realization session; staged debt receipts 4,000/5,000/1,000 cents across sessions contributed only received totals, while the 10,000-cent sale principal appeared once. |

Provisioning code is in `355c0a8`; QA harness fixes and manifest refresh are `946246e`, `47eda63`, `1cb4e8c`, `a27110f`, and `cb8776d`. Exact-Git certification selected `5f97ca8c18e294f0a176694deae7d1181b005bf7` (tree `79bb40a34c3da79f36dfb3fb6aff2bba7f36c450`): 1,113 Git blobs materialized and verified, generated candidate manifest SHA-256 `68fd1ccf463b2743ef2befc6bfa5b968ba585a1609654e67a5c0d25bae1d5c25`, synthetic regression `PASS`, representative rehearsal `PASS`, 178 snapshot modules, zero workspace-source modules, Prisma 6.19.3, and executor temporary snapshot/containers removed. Backend and frontend `npm run build` passed on the exact functional source snapshot before the QA harness-only fixes; the frontend emitted the existing Vite chunk/dynamic-import advisories. Details and executor report are in [`pdv-unico-single-provisioning-qa-evidence.json`](./pdv-unico-single-provisioning-qa-evidence.json).

The creator inventory covered admin JSON and multipart routes, setup, the internal first-PDV helper, and `POST /api/operacao/pontos-venda`; no public company-creation route exists. Separate Trailer APIs are business functionality and are not used as a substitute PDV. The canonical setup UI presents Por Caixa as the only engine while preserving PDV editing and multiple saved menus. Canonical API writers share a tenant transaction advisory lock. No global uniqueness index was added because the approved legacy inventory includes companies with multiple PDVs. Do not remove, merge, or automatically choose those rows. The definitive constraint remains blocked until manual tenant/dependency adjudication, preservation plan, disposable-QA rehearsal, and proof that the final candidate set is zero-or-one PDV with valid configuration; then add the constraint in a separately approved migration. Direct database writers and any external scripts that bypass the API remain consumers requiring future audit.

No shared DEV was read or written in this delivery; no PROD access including metadata occurred. No migration or write ran outside executor-created disposable QA. No real backfill, cutover, deploy, or legacy removal occurred. TAP-76 remains In Progress.

## TAP ownership and Por Caixa draft assembly (2026-10-07)

| Gate | Result |
|---|---|
| Canonical provisioning without Trailer; TAPs can be listed, registered and configured by tenant/PDV | Passed in authenticated disposable QA; canonical UI has no Trailer selector. |
| Session-owned draft mount/swap and chope sale by volume | Passed through the Por Caixa session; tenant/PDV/product checks reject foreign references before writes. |
| Price snapshots and close | Passed with selected menu, shift and product/volume overrides preserved through sale, payment and session close. |
| Inventory effect | Passed; verified in the code's persisted inventory unit and movement ledger. |
| Swap and concurrency | Passed; earlier mounts and sales remain; concurrent requests cannot produce incompatible active mounts for the same context. |
| Capacity disabled and LEGACY mode | Passed; prior capacity behavior and old API/schema/client compatibility remain. Canonical activation with missing mapping returns an explicit blocker and does not fall back to Trailer. |
| History, replay, pause, rollback and tamper | Passed; mount history cannot cascade-delete, same-run replay verifies receipts/destinations, and injected failure rolls back all TAP ownership/map/checkpoint writes. |
| Approved representative TAP photo | Passed against the sanitized 34-table/10,738-row photo: all 9 TAPs and 123 `TapMontagem` records reconciled by ID and full content hash. CIA Marítima: 5/123; Churrasquinho do Thiago: 4/0. |
| Finance after commerce | Passed; all 605 approved payments remained exact, including 577 historical `CAIXA_NAO_COMPROVADA` payments. |

Exact Git certification used commit `7d40a2899907b9990d5fee7899ee35d2685d4007` and tree `2df20337a7dd6aeaafb01f46aff5f17fb978b534`. Backend TypeScript and frontend/Vite/PWA builds passed on that snapshot. Vite emitted the existing dynamic-import and main-chunk-size advisories. Synthetic and representative outcomes are recorded separately in [`pdv-unico-tap-synthetic-evidence.json`](./pdv-unico-tap-synthetic-evidence.json) and [`pdv-unico-tap-representative-evidence.json`](./pdv-unico-tap-representative-evidence.json). The representative evidence carries per-row source/destination IDs, number/product or mount history fields, and canonical content digests; completed-run replay verified the map and receipt for each source ID. Snapshot module audit observed 181 project modules from the selected Git snapshot and none from the mutable workspace. The executor removed its temporary QA snapshot and container.

`Tap.trailerId` remains only as a LEGACY physical/history bridge; `TapMontagem.eventoId` and existing occurrence/session relationships remain physical/history links. Canonical Por Caixa uses the session's PDV, and Evento never switches engine/catalog. The additive schema and old fields remain in place. This is QA certification only: no DEV read/write, PROD/metadata access, real backfill, cutover, deploy or legacy removal occurred. TAP-76 remains In Progress.

## Provisioning compatibility boundary during transition (2026-10-06)

The previous provisioning note described only the canonical-enabled behavior. Current execution coverage explicitly distinguishes the effective activation modes:

| Area | Activation on (`CANONICAL`) | Activation off (`LEGACY`, temporary) | Evidence |
|---|---|---|---|
| Admin JSON provision | Atomic company, owner, setup metadata, one PDV and additive PDV configuration; Por Caixa remains the sole engine. | Existing JSON response and company/owner/setup behavior; no default PDV or Trailer. | Authenticated disposable PostgreSQL QA. |
| Admin multipart adapter | One canonical PDV/configuration; explicit capability fields mapped to PDV/setup owners; no Trailer substitute. | Selected Trailer/default taps, selected first PDV, legacy operation projection, explicit flags and previous response retained. | Authenticated disposable PostgreSQL QA. |
| Internal `ativarModuloOperacao` | Creates PDV and its canonical configuration through the shared helper. | Creates the legacy operation projection and first PDV without the additive configuration delegate. | Old-schema/client PostgreSQL QA and activation-guard tests. |
| Setup/edit authority | `ConfiguracaoPontoVenda` owns operational settings; EVENTO motor change is rejected. | `ConfiguracaoOperacional` owns legacy settings; edits do not implicitly rewrite the PDV record. | Authenticated settings GET/PATCH tests in both modes. |
| Older Prisma schema/client | Not a supported canonical target; canonical activation requires its additive model. | Pre-model schema and generated client work with no model/table and zero additive delegate calls. | Pinned schema `06b23a9c`, executor-created PostgreSQL QA. |

Focused tests passed: 52 provisioning/activation/profile/config tests; old-client PostgreSQL compatibility for JSON, multipart and internal activation; authenticated APIs with enabled/disabled activation; existing PDV single-writer/duplicate lock, rollback, authorization, setup, close-before-column and financial-turn regressions. The initial full synthetic attempt caught an incorrect test assertion against a nonexistent `torneira` client delegate. The test was corrected to use the actual `Tap` model; it was a test harness defect, and the final exact Git snapshot synthetic and representative runs both passed.

Backend and frontend builds passed. Exact Git certification selected `1f74478a6fc69d1f06ee5aec478aced5bffb9672` (tree `b5054212c455c3803e5d3662aa5811f73627d253), verified 1,116 tracked blobs, and reported separate synthetic `PASS` and representative `PASS` results. The representative photo had 34 tables/10,738 rows; post-commerce finance revalidation and kitchen revalidation passed for CIA Marítima and Churrasquinho do Thiago; all 605 approved payment IDs/values/classes reconciled unchanged. The executor removed its QA containers and snapshot and confirmed the shared workspace fingerprint unchanged. Full results: [`pdv-unico-provisioning-compatibility-qa-evidence.json`](./pdv-unico-provisioning-compatibility-qa-evidence.json).

The disabled-mode branch is a short-lived compatibility bridge, not a permanent second architecture. At approved cutover, after migrating old callers and reconciling their response/projection use, remove LEGACY provisioning and old-client support. Pending consumers are legacy JSON/multipart callers and direct database writers/external scripts that bypass the API lock. Existing tenants with multiple PDVs remain untouched. A global uniqueness constraint stays blocked until their rows and dependent links are manually adjudicated/preserved, a QA resolution rehearsal passes, and the final candidate set is proven zero-or-one with valid canonical configuration; adding the constraint requires a separately approved migration. No DEV read/write, PROD or metadata access, non-QA writes/migrations, real backfill, cutover, deploy, or legacy removal occurred; TAP-76 remains In Progress.

## TAP review regression retest (2026-10-07)

The exact tested source is commit `941718a87f7df1f277c686395067a28e29739e90`, tree `2e5525a240f98835afee47b40fca315f0ba27460`. The exact-Git synthetic and approved representative QA results are independently PASS; the runner verified 1,123 tracked blobs, 182 snapshot project modules, zero workspace-source modules, and unchanged local workspace state. Backend build passed and focused `venda.test.ts` passed 17/17.

| Review gate | Executed result |
|---|---|
| Legacy sale with activation absent, PDV+Trailer session, matching Trailer TAP and null TAP PDV | Authenticated API listed and configured the legacy TAP, sold chope by volume, accepted payment and closed the session. Disabled path uses Trailer and makes no `Tap.pontoVendaId` query, including with an older schema/client. |
| Canonical TAP authority | Canonical mode uses session PDV; missing mapping blocks explicitly. Event/occurrence never chooses another motor/catalog. |
| Remove then GET/initialize repeatedly | Authenticated QA kept zero active mounts after removal. Explicit later mount succeeded. |
| Mount/close races | Concurrent initializer, swap/removal and close passed; no duplicate/incompatible active mounts, P2002/500, deadlock or post-close mutation. History, sales and snapshots remained intact. Validation occurs inside the lock-protected transaction. |
| Completed TAP migration evidence tampering | Separate PostgreSQL QA mutations to `completedSourceKeys`, `destinationId`, and `sourcePayload` each blocked replay without repairing evidence. Hook tampering and injected failure rolled back. Full run/version/photo/checkpoint/batch/cursor/hash/receipt/map/type/ID/last-run/destination validation passed. Ambiguous ownership/colliding number blocks without automatic choice. One atomic batch; no partial pause/resume contract. |
| Representative TAPs and mounts | Reconciled all 9 TAP IDs and 123 `TapMontagem` IDs by preserved content: CIA Marítima 5/123; Churrasquinho do Thiago 4/0. |
| Representative payments and dependent phases | Post-commerce finance and kitchen revalidation passed for both tenants. All 605 payment identities/values remained approved, including the 577 historical `CAIXA_NAO_COMPROVADA` rows. |
| Exact-Git manifest | Generated from the selected commit, not the mutable working tree: 89 candidates, digest `0469e116b9d52bd3d2b9d1d4ffd95b9a7095a10bfd928e0f6e25f7a0e7d574e4`. |

The representative source photo SHA-256 is `2071d444df091fe85438278ca1e6d2329d4e2106679b23143f0e863b8769d16b` (34 tables, 10,738 rows, zero cross-tenant edges). Exact-Git evidence: [`tap76-synthetic-qa-evidence.json`](./tap76-synthetic-qa-evidence.json) and [`tap76-representative-qa-evidence.json`](./tap76-representative-qa-evidence.json). The integrated permanent manifest is [`pdv-unico-integrated-qa-manifest.json`](./pdv-unico-integrated-qa-manifest.json).

No DEV/shared access, PROD or metadata access, writes/migrations outside executor-owned disposable QA, real backfill, cutover, deploy or legacy removal occurred. `Tap.trailerId` remains as compatibility/history storage; existing `TapMontagem` event and session/occurrence links remain physical historical links. TAP-76 remains In Progress.

## Revisao de agenda canonica e selecao opcional na abertura — 2026-10-07

A gestao usa exclusivamente `AgendaOperacional` e `OcorrenciaOperacional` do PDV canonico, sem um segundo motor operacional. A recorrencia semanal e a ocorrencia avulsa sao mantidas por API autenticada; a geracao e explicita e idempotente por `agendaId/data`. GET e somente leitura. A abertura opcional aceita status `PROGRAMADA`/`ABERTA`, tenant e PDV corretos, e so aceita outra data apos `confirmarDataDiferente: true`. A interface exibe “Sem ocorrencia”, nome/data/tipo de recorrencia, confirmacao que zera ao trocar selecao e contexto persistido da sessao.

**Casos acrescentados ao runner autenticado de PostgreSQL QA descartavel:** criar/editar recorrencia; criar avulsa; chamadas concorrentes e repetidas de geracao; quatro sabados distintos de novembro de 2026; leitura pelo usuario que opera caixa; escrita de gestao negada ao atendente; edicao cruzada entre tenants; GET sem escrita; abrir sem ocorrencia; PROGRAMADA/ABERTA na mesma data; outra data sem confirmacao/confirmada; FECHADA/CANCELADA recusadas com confirmacao; edicao da agenda apos vendas sem alterar sessao, comanda, snapshot, pagamento, saldo ou movimento de estoque; retry concorrente nao troca o vinculo da sessao. Resultados executados e SHA estao em `pdv-unico-agenda-qa-evidence.json`.

**Limite de produto:** ciclo de vida e transicoes de status da ocorrencia nao foram aprovados. A API desta entrega nao expoe alteracao de status. A regra esta separada em [`agenda-operacional-policy.md`](../architecture/agenda-operacional-policy.md). Nao contar atribuicao de consumo como evidencia de ranking. Resultados de UI devem ser reportados separadamente dos testes API/sinteticos.
## Resultado da entrega de agenda (2026-10-07)

- API autenticada e PostgreSQL descartavel: PASS. Cobre recorrencia semanal, avulsa, GET sem escrita, geracao repetida/concorrente idempotente, quatro sabados distintos, isolamento, autorizacao de leitura/gestao, preservacao de historico e regras de abertura/confirmacao. As assercoes estao em `backend/scripts/pdv-unico-commerce-migrator.isolated.test.mjs`.
- UI: Playwright Chromium PASS (2/2) com servidor Vite local e respostas da API interceptadas. Navegacao para gestao, submissao dos formularios de recorrencia/avulsa e selecao/confirmacao/reset foram exercitados. Nenhum backend compartilhado foi usado.
- Unitarios focados: 4/4; builds backend e frontend: PASS. O build frontend manteve os avisos existentes de imports dinamicos e tamanho do bundle.
- Certificacao exata por fotografia Git do commit `aebaa538b04057e7f424f846a093b501a24cdcef`: sintetica PASS; 1.129 blobs verificados, 181 modulos do snapshot e zero modulos do workspace mutavel. QA e snapshot temporarios removidos; fingerprint local inalterado.
- Ensaio representativo: NAO EXECUTADO, sem fotografia representativa fornecida. Este resultado nao certifica fotografia representativa.
- Sem PROD/metadados, DEV compartilhado, backfill real, cutover, deploy ou remocao de legado. TAP-76 permanece In Progress. Detalhes: [`pdv-unico-agenda-qa-evidence.json`](./pdv-unico-agenda-qa-evidence.json).

## Correcao UI de agenda no commit a00aa5d (2026-10-07)

Build frontend: PASS. Playwright Chromium isolado: 5/5 PASS no commit `a00aa5d595184b8bb139e32c530a544f385dc939`. Foram comprovados: editar recorrencia mesmo sem ocorrencias geradas; PATCH recusado mantem valores/ID e retry repete PATCH no mesmo ID; PATCH de recorrencia inativa omite `ativa`; avulsa recusada mantem nome/data; erro GET visivel e recuperavel sem limpar formulario; LEGACY sem montagem/consulta canonica; abertura noutra data bloqueada ate confirmacao, reset ao trocar selecao, payload confirmado e contexto persistido; “Sem ocorrencia” sem campos de associacao e contexto persistido vazio.

Os testes usaram somente Vite local com APIs simuladas. Todas as chamadas `/api` sem mock foram abortadas; o proxy Vite apontou para a porta 0, e o WebSocket foi fechado pelo mock. Esta e evidencia de UI, nao de API/PostgreSQL. O backend ficou inalterado; por isso nao se repetiu QA PostgreSQL. A bateria anterior continua associada somente a `aebaa538b04057e7f424f846a093b501a24cdcef` e nao foi atribuida a `a00aa5d`. Detalhes: [`pdv-unico-agenda-ui-correction-evidence.json`](./pdv-unico-agenda-ui-correction-evidence.json).

### Pedidos de cozinha independentes

| Caso | Entrada | Resultado obrigatorio | Evidencia |
|---|---|---|---|
| KITCH-IND-01 | Churrasquinho marcado + batata comum | Dois pedidos na mesma comanda; entregar o churrasquinho libera somente seu valor | QA autenticado PostgreSQL descartavel |
| KITCH-IND-02 | `launchRegression` usa API autenticada por inclusão: dois produtos de preparo sem flag com cozinha ativa persistem/respondem com 1 pedido; dois marcados com cozinha desligada preservam 1 grupo com ambos `exigePreparo=false` e fila 404; produto sem preparo com flag verdadeira fica em 1 pedido e fora da fila; um preparo marcado + bebida LATA ficam em 1 pedido. Cada caso confere itens/vínculos, resposta, fila e exatamente uma movimentação/baixa por linha. | API autenticada + PostgreSQL QA descartável | PASS |
| KITCH-IND-03 | Duas linhas marcadas, linha comum e quantidade 3 | Um pedido por linha marcada; linha comum agrupada; quantidade da linha permanece 3 | Unitario + QA autenticado |
| KITCH-IND-04 | Preco, opcional, observacao, volume e paraViagem | Snapshot e opcionais preservados em seu pedido correto | QA autenticado |
| KITCH-IND-05 | Estoque, falha intermediaria, cancelamento e concorrencia de lancamento | Debito/estorno uma vez e apenas no pedido correto; falha reverte tudo; senhas unicas | QA autenticado PostgreSQL descartavel |
| KITCH-IND-06 | `assertEmissionBatch` cobre abertura com itens, inclusão posterior, venda avulsa e portal: observa `operacao:pedido-novo` no Socket.IO real, compara sala, IDs/itens e leitura PostgreSQL iniciada no instante do `emit`; rollback compara cursor de emissões sem evento novo. | Contrato de emissão + API autenticada + PostgreSQL QA descartável | PASS; não prova entrega ao navegador nem autenticação Socket.IO |
| KITCH-IND-07 | `assertRejectedWithoutOperationalWrites` compara fotos completas antes/depois: outro tenant não usa comanda/produtos (404) nem PDV (404); sessão B não acrescenta linhas à comanda A (409); payload não substitui ocorrência (400). Todas as recusas preservam comandas/pedidos/itens/opcionais/histórico/pagamentos/saldos/movimentos; split válido retorna 2 pedidos na mesma comanda, vinculada à ocorrência A. | API autenticada + fotografia PostgreSQL QA descartável | PASS |
| KITCH-IND-08 | Ativacao canonica desligada em schema pre-coluna | Nenhuma consulta a nova coluna; resposta e agrupamento legados | QA de compatibilidade de schema/client |
| KITCH-IND-09 | Cadastro/edicao e pedidos divididos | Flag default false; checkbox e pedidos separados visiveis | Playwright/UI isolada |

O runner comercial fixa migration candidata, schema e arquivos de serviço/rotas pelos hashes do commit-base. Evidência sintética, UI e representativa é registrada em categorias distintas; sem fotografia aprovada, representativo fica NAO EXECUTADO.

#### Matriz de comprovação desta entrega

| Critério | Teste/assertiva específica | Tipo de prova | Resultado |
|---|---|---|---|
| KITCH-IND-01 | `pdv-unico-commerce-migrator.isolated.test.mjs`: `independentCommandResponse.statusCode=201`, dois pedidos persistidos; após `ENTREGUE`, irmão permanece `RECEBIDO` e total/aberto são `[10,20]` | API autenticada + PostgreSQL descartável | PASS |
| KITCH-IND-02 | `launchRegression` usa API autenticada por inclusão: dois produtos de preparo sem flag com cozinha ativa persistem/respondem com 1 pedido; dois marcados com cozinha desligada preservam 1 grupo com ambos `exigePreparo=false` e fila 404; produto sem preparo com flag verdadeira fica em 1 pedido e fora da fila; um preparo marcado + bebida LATA ficam em 1 pedido. Cada caso confere itens/vínculos, resposta, fila e exatamente uma movimentação/baixa por linha. | API autenticada + PostgreSQL QA descartável | PASS |
| KITCH-IND-03 | `snapshotLaunch.statusCode=201`; `snapshotOrdersBeforeFlagEdit.length=3`; duas linhas marcadas em pedidos independentes, linha comum no grupo e Churrasquinho marcado com quantidade 3 | API autenticada + PostgreSQL descartável | PASS |
| KITCH-IND-04 | Assertivas de banco conferem produto, preço, volume, quantidade, observação, `paraViagem`, `pedidoCozinhaId` e snapshots distintos de opcionais; editar flag preserva por igualdade profunda pedido/item/opcional/histórico | API autenticada + snapshots PostgreSQL | PASS |
| KITCH-IND-05 | Rollback injeta falha e compara comandas, itens, opcionais, pedidos, histórico, saldos e movimentos. Concorrência espera dois waiters observáveis em `pg_stat_activity`; confere quatro números únicos, pedidos/itens, movimentos e delta de saldo. Cancelamento estorna apenas as linhas do grupo. | Transação/concorrência PostgreSQL + API autenticada | PASS |
| KITCH-IND-06 | `assertEmissionBatch` cobre abertura com itens, inclusão posterior, venda avulsa e portal: observa `operacao:pedido-novo` no Socket.IO real, compara sala, IDs/itens e leitura PostgreSQL iniciada no instante do `emit`; rollback compara cursor de emissões sem evento novo. | Contrato de emissão + API autenticada + PostgreSQL QA descartável | PASS; não prova entrega ao navegador nem autenticação Socket.IO |
| KITCH-IND-07 | `assertRejectedWithoutOperationalWrites` compara fotos completas antes/depois: outro tenant não usa comanda/produtos (404) nem PDV (404); sessão B não acrescenta linhas à comanda A (409); payload não substitui ocorrência (400). Todas as recusas preservam comandas/pedidos/itens/opcionais/histórico/pagamentos/saldos/movimentos; split válido retorna 2 pedidos na mesma comanda, vinculada à ocorrência A. | API autenticada + fotografia PostgreSQL QA descartável | PASS |
| KITCH-IND-08 | `pdv76-precolumn-api.isolated.test.mjs`: login real, GET/PUT produto, lançamento Por Caixa agrupado, pagamento e fechamento no singleton da aplicação, ativação canônica desligada e sem as duas colunas novas; sem P2022 e sem campo novo nas respostas | Processo isolado + API autenticada + PostgreSQL descartável sem colunas | PASS |
| KITCH-IND-09 | `e2e/independent-kitchen-orders.spec.ts`: editar produto marcado preserva payload; mostrar os dois pedidos; entregar um mantém o irmão pendente; ambos e seus itens continuam visíveis nos detalhes | Playwright Chromium com mocks explícitos; UI simulada | PASS |

**Resultado da certificação:** o snapshot Git exato `fe472bb4c63c9b60f50464bf271a7382d7849c99` (árvore `4375bfdbc6a40da5192bcd528d7e4d7763448cc2`) passou `qa:pdv-current-disposable`: 1.136 blobs, 97 candidatos no manifesto temporário, 182 módulos do projeto e zero imports do workspace. A suíte comercial passou com KITCH-IND-02, 06 e 07. O manifesto permanente aponta para a mesma revisão, SHA-256 `196b3fbe7fdd30802a1d9d5a60293ab23b010474aedef0626b1e46f67fd1e8b7`. Evidência completa em [`pdv76-independent-kitchen-qa-evidence.json`](./pdv76-independent-kitchen-qa-evidence.json).

UI: Playwright Chromium 1/1 PASS na revisão `ff7f75ef271cddd9726234529c08d9c322401b2e`, com Vite local na porta 5198, APIs explicitamente mockadas e chamadas não mockadas bloqueadas; essa prova é simulada e separada de API/PostgreSQL. Ensaio representativo: NOT_RUN; nenhum conjunto representativo foi fornecido. Sem acesso a PROD/DEV compartilhado ou metadados, backfill real, cutover, deploy, rankings, RBAC ou remoção de legado; migração completa não foi declarada.

## Permissoes individuais: verificacao da primeira fatia (2026-10-07)

Matriz: [../architecture/pdv-individual-permissions-action-matrix.md](../architecture/pdv-individual-permissions-action-matrix.md).

| Caso | Assertiva | Tipo | Resultado |
|---|---|---|---|
| Owner e lista vazia | Owner tem todas as chaves; atendente novo nao recebe permissoes automaticamente | API autenticada + PostgreSQL descartavel | PASS |
| Conceder/revogar | Mesmo cookie ganha e perde acesso imediatamente | API autenticada + PostgreSQL descartavel | PASS |
| Escopo/validacao | Chave desconhecida, autoedicao, alteracao do owner e tenant cruzado sao rejeitados | API autenticada + PostgreSQL descartavel | PASS |
| Sem efeito ao negar | cash.open negado nao cria sessao; cash.open sozinho nao permite fechar valores | API autenticada + PostgreSQL descartavel | PASS |
| Valores restritos | GET de sessao omite troco, totais e movimentos; fechamento negado mantem fechadoEm nulo | API autenticada + PostgreSQL descartavel | PASS |
| Migration | Backfill preserva cash.open observado e deriva discount.apply do booleano legado true/false | PostgreSQL descartavel, replay controlado | PASS |
| Compatibilidade | Login, /me e usuarios funcionam sem coluna quando ativacao esta desligada | API autenticada + PostgreSQL descartavel | PASS |
| Interface | Carrega, altera, salva e reabre lista; owner ve acesso integral sem controles | Playwright Chromium com API simulada | PASS 1/1 |
| Acao de backend | Pagina dashboard concede e revoga na mesma sessao; endpoint financeiro negado antes da escrita | API autenticada + PostgreSQL descartavel | PASS |
| Conservacao geral de venda/estoque | Nao exercitada por um ciclo completo de venda/estorno nesta fatia | QA financeiro adicional | PENDENTE |
| Ensaio representativo | Sem fotografia representativa fornecida | QA representativo | NAO EXECUTADO |

Comandos executados: backend npm run qa:pdv-individual-permissions (PASS, PostgreSQL tmpfs isolado em 127.0.0.1); npm run build backend (PASS); npm run build frontend (PASS); Playwright Chromium 1/1 em Vite local com API interceptada (PASS). Esta prova nao e deployment nem ensaio representativo. O QA tambem verificou que recusar o fechamento preserva a sessao aberta; nao cobre todos os fluxos de conservacao financeira/estoque.

Certificacao exata do Git: PASS no commit 968f1655f3696d3fd730189346cc473bac55931f, tree e25936eca09a33ae2d93d1aea962d7492e05c3d5. Resultado sintetico PASS; 1,142 blobs verificados, zero imports do workspace, estado local inalterado. Ensaio representativo NAO EXECUTADO. Evidencia: [pdv-individual-permissions-qa-evidence.json](./pdv-individual-permissions-qa-evidence.json).

## Correcao e recertificacao da primeira fatia de permissoes (2026-10-07)

Esta secao substitui o estado de cobertura parcial descrito acima para as rotas e ciclos aqui nomeados. Fonte de acoes/permissoes: [matriz atualizada](../architecture/pdv-individual-permissions-action-matrix.md). Evidencia exata: [pdv-individual-permissions-exact-qa-evidence.json](./pdv-individual-permissions-exact-qa-evidence.json); manifesto da fatia: [pdv-individual-permissions-qa-manifest.json](./pdv-individual-permissions-qa-manifest.json).

| Ponto | Reproducao | Correcao | Teste e resultado |
|---|---|---|---|
| Rotas alternativas de Evento | Inventario encontrou GET/abrir/movimentos/fechar e recebimento de divida em `evento-caixa.ts` sem as chaves individuais. | GET pode expor status sem valores e sanitiza detalhes; abrir, movimentos, fechar e leitura/recebimento de divida agora exigem as respectivas permissoes. Ativacao desligada preserva resposta e autoridade legadas. | Usuario sem permissao, permissao isolada, dono e tenant cruzado; fotos de sessao/movimentos/pagamentos antes/depois das recusas. Ciclos de abertura, movimento, recebimento e fechamento autorizados persistiram. PASS. |
| Cancelamento por caminhos alternativos | DELETE legado/operacional removia item e PATCH operacional permitia reduzir quantidade, caminho que cancela parte da venda. | Chave `command.item.cancel` separada de `command.cancel`; reducao compara quantidade atual apos lock, dentro da transacao. Aumentos continuam sem essa permissao. | DELETE legado e operacional, PATCH de reducao e cancelamento integral sem chave foram recusados; foto profunda provou quantidade, total, opcionais, saldo/estoque e ledger sem escrita. Reducao autorizada persistiu estorno; aumento continuou permitido. PASS. |
| Migration e concessoes | `command.cancel` era backfill para todo ATENDENTE, embora cancelamento integral Por Caixa fosse owner-only. | Migration candidata agora backfilla `command.item.cancel`; `command.cancel` fica concessao explicita. Nenhuma migration historica consolidada foi alterada. UI separa os dois seletores. | Rehearsal de empregados preexistentes com `podeDarDescontoOperacao=true/false`: item-removal preservado, `discount.apply` derivado corretamente e cancelamento integral nao concedido. Novo funcionario inicia sem chaves. PASS. |
| Realtime e revogacao | Antes, `join:evento` permitia sala com payload financeiro amplo; socket conectado nao reagia a revogacao. | Salas financeiras e operacionais separadas para empresa/evento; payload operacional de cozinha sem valores; atualizacao de permissao reconcilia sockets conectados, sem nova infraestrutura. | Socket.IO real no servidor QA local: ingresso e entrega autorizados, concessao de valores, revogacao mantendo socket/session ID, evento financeiro subsequente ausente, isolamento entre empresas e notificacao de cozinha mantida. PASS. |
| Contexto sem valores | Sanitizacao do GET de caixa Por Caixa removia junto a ocorrencia e o dia, aparentando inexistencia de vinculo. | Preserva ocorrencia persistida, nome/data/status e dia operacional, sem totais, troco ou movimentos. | Sessao QA ligada a ocorrencia: funcionario sem `cash.values.read` viu o vinculo correto, sem campos financeiros. PASS. |
| Certificacao exata | `qa:pdv-current-disposable` nao incluia a suite individual; runner permissivo poderia usar migrations do workspace e teste positivo so recusava 403. | Script atual inclui explicitamente `qa:pdv-individual-permissions`; runner usa schema/migrations do commit Git selecionado, exclui arquivos nao rastreados e falha diante de diretorio de migration incompleto. Positivos verificam status, resposta e persistencia. | `qa:pdv-current-git-snapshot -- --commit=14bda482767592bc284b9cfbd51472166fb18740` PASS; suite individual PASS e ciclos autorizados de venda, pagamento, divida, fechamento, cancelamento/estorno e estoque executados em PostgreSQL descartavel. Recusas foram comparadas sem escrita. Ensaio representativo: NOT_RUN. |

## Resultado da certificacao desta correcao

Codigo certificado: `14bda482767592bc284b9cfbd51472166fb18740`; tree `b66d09be093aa623e29f2ae818d96cb0d41e1878`; 1.143 blobs rastreados materializados do Git e zero modulos importados do workspace mutavel. `qa:pdv-current-disposable` passou e incluiu a suite individual de permissoes; os ciclos financeiros e de estoque desta fatia passaram. O runner registrou workspace inalterado. Ensaio representativo permanece NOT_RUN. Nenhum acesso a PROD/metadados ou DEV compartilhado, backfill real, cutover ou deploy ocorreu. Isto certifica a fatia nomeada e nao declara RBAC completo.

## Realtime: compatibilidade de salas e payload de cozinha (2026-10-07)

Revisao corrigida e certificada: `b06e09b2d0972b988863507dbe55dc42bbb1f8a6`, tree `8d2d523b7bf8af31e17436558a0f380f39d75ec1`.

| Reproducao observada antes da correcao | Correcao | Prova na revisao certificada |
|---|---|---|
| Com `PDV_INDIVIDUAL_PERMISSIONS_ENABLED` desligada, `joinScopedStaffRoom` e o ramo ADMIN ainda escolhiam salas `:financeiro`, enquanto `emitScoped` enderecava as salas legadas sem sufixo. `leave:evento` tambem nao removia a sala legada. O teste anterior so exercitava flag ligada. | Staff e ADMIN agora entram na sala legada quando a flag esta desligada; `leave:evento` remove esse mesmo canal. Com flag ligada, salas financeiras/operacionais e reconciliacao de revogacao continuam separadas. | Socket.IO real: servidor observado antes da emissao; empresa/evento receberam do emissor real exatamente uma vez; `leave:evento` interrompeu somente a assinatura do Evento; tenant cruzado nao recebeu evento; ADMIN conservou ingresso legado da empresa e o comportamento sem ingresso em Evento. Com flag ligada, concessao/revogacao moveu o mesmo socket e a notificacao operacional continuou. PASS. |
| `notificarPedidoNovo`/`resumoPedidoCozinha` publicavam o array `itens`, enquanto a sanitizacao olhava apenas `itensComanda` e entregava lista vazia. A fixture anterior fabricava `itensComanda`, escondendo o formato real. | A projecao aceita o array real `itens` e conserva o contrato consumido pelo frontend (`itensComanda`), IDs, nomes, quantidades, observacoes, para viagem e nomes/quantidades dos opcionais. Precos dos opcionais e itens so seguem na sala financeira. | Lancamento autenticado persistido com opcional: socket restrito recebeu itens/opcionais sem campos de preco e o socket do owner recebeu valores financeiros completos. Mudanca de status usou o notifier real e preservou os dois contratos. Falha por estoque insuficiente reverteu pedido e saldo sem emitir `pedido-novo`. PASS. |

Certificacao Git final: `qa:pdv-current-git-snapshot -- --commit=b06e09b2d0972b988863507dbe55dc42bbb1f8a6 --evidence-out=../docs/testing/pdv-individual-realtime-regressions-qa-evidence.json`; sintetica PASS, `qa:pdv-individual-permissions` explicitamente incluida e PASS, 1.145 blobs Git materializados, zero import de codigo do workspace mutavel e fingerprint local inalterado. Manifesto candidato: 97 arquivos, SHA-256 `cba419363e2996cf7bf768ff42f589105a5b36608b1876c03de2e2c504713299`. Ensaio representativo NOT_RUN. Evidencia: [`pdv-individual-realtime-regressions-qa-evidence.json`](./pdv-individual-realtime-regressions-qa-evidence.json); manifesto permanente da fatia atualizado para o mesmo commit. A certificacao e limitada a esta fatia e nao declara RBAC completo. Nao houve PROD/metadados, DEV compartilhado, backfill real, cutover ou deploy; TAP-76 permanece In Progress.

## Permissoes individuais dos modulos restantes — 2026-10-07

Codigo de aplicacao e testes: commit `8eca66cf376043228a76e754a0214b18f09ea07e`, tree `cdedc8e4207a44872c244e83be4846454d1f8319`. Evidencia Git exata em [`pdv-unico-module-permissions-qa-evidence.json`](./pdv-unico-module-permissions-qa-evidence.json); manifesto em [`pdv-individual-permissions-qa-manifest.json`](./pdv-individual-permissions-qa-manifest.json). A cadeia completa `qa:pdv-current-git-snapshot` passou: 1.147 blobs materializados e comparados ao commit, 97 candidatos no manifesto QA, 185 modulos do snapshot importados, zero imports do workspace mutavel, 100 dependencias externas, Prisma 6.19.3, sem skips. `qa:pdv-individual-permissions` passou em PostgreSQL descartavel. O teste isolado de UI Playwright passou (1/1), com todas as chamadas API interceptadas; builds backend e frontend passaram. Ensaio representativo continua `NOT_RUN`; nenhuma migration real, escrita em DEV compartilhado, acesso a PROD, cutover ou deploy ocorreu.

| Grupo | Provas executadas no snapshot | Resultado e limite |
|---|---|---|
| Comandas/vendas | `command.read` e `command.operate` separados; leitura nao libera abertura; operacao nao libera leitura; aumento e remocao continuam distintos; venda autorizada com pagamento necessario; outras rotas antigas de comanda e pedido cobertas; objeto de outro tenant retorna 404. | API/PostgreSQL PASS; efeitos de estoque de venda nao exigem `inventory.adjust`. Pagamento, fechamento e cancelamento permanecem chaves existentes. |
| Cozinha | `kitchen.read` nao libera transicao; `kitchen.operate` autoriza transicao e revogacao impede a proxima; cancelamento/estorno seguem `kitchen.cancel` + `sale.refund`; pedido estrangeiro retorna 404. | API/PostgreSQL PASS; pedido independente de cozinha e seus contratos continuam cobertos pela cadeia comercial/realtime existente. UI foi verificada por build, mas a simulacao nao percorreu todos os botoes. |
| Estoque | Leitura negada sem chave; movimento manual de entrada negado sem alterar saldo/ledger; venda autorizada atualiza estoque sem `inventory.adjust`; PDV de outro tenant retorna 404. | API/PostgreSQL PASS. Entrada, saida, ajuste e inventario usam a mesma chave; a simulacao nao percorreu cada formulario visual. |
| Catalogo/cardapios | Sem `catalog.manage`, edicao de preco e negada sem escrita; com a chave, preco persiste e snapshot vendido permanece 10; outro tenant retorna 404; selecionar cardapio na abertura continua sem a chave de edicao. | API/PostgreSQL PASS. Produto, disponibilidade, opcionais, templates e preco do turno compartilham `catalog.manage`. UI de todos esses formularios nao foi exercitada na simulacao. |
| Clientes | Identificacao/find-or-create do checkout continua liberada; lista administrativa exige `clients.manage`; merge e exclusao seguem 403 sem autoridade de dono; registro estrangeiro retorna 404. | API/PostgreSQL PASS. Os caminhos autenticados do portal nao recebem guardas de funcionario; o portal nao foi navegando nesta simulacao de UI. |
| TAPs | Sem chave, montagem retorna 403 sem novo historico; com `taps.operate`, montagem ativa persiste; Evento estrangeiro retorna 404; fotos de sessoes, movimentos e pagamentos antes/depois permanecem iguais. | API/PostgreSQL PASS. Cadastro administrativo de TAP segue owner-only. |
| Agenda | `agenda.manage` ausente impede criacao; com a chave a agenda persiste; revogacao impede criacao de ocorrencia; agenda de outro tenant retorna 404; caixa, movimentos e pagamentos nao mudam. | API/PostgreSQL PASS somente com configuracao canonica de agenda ativa. Leitura GET permanece fora da permissao de escrita. Nenhuma politica de ciclo de vida/status foi criada. |
| Migracao de permissoes | Rehearsal da migration aplicada no banco descartavel; atendente existente recebe apenas acessos antes disponiveis; funcionario novo segue vazio. | PASS. Catalogo e agenda, antes owner-only, nao recebem concessao automatica. |

O Playwright simulou a tela de equipe, salvou/reabriu as permissoes e confirmou que `command.read` e `command.operate` aparecem como seletores independentes. A simulacao de UI nao percorreu todas as telas operacionais, portanto os botoes/estados visuais especificos de cada modulo permanecem `NAO COMPROVADOS` por UI; a autorizacao de API foi exercitada. Esta entrega protege as rotas e acoes nomeadas na matriz, nao declara RBAC global completo. TAP-76 continua In Progress, sem mudanca de titulo ou estado.

## Correcao das lacunas individuais - certificacao corrente (2026-10-07)

Esta secao substitui o estado corrente descrito acima; as entradas antigas permanecem historicas. Codigo/testes certificados: `5b7062f308edcb25f029850e451c7f452a142aed`, tree `d81b42616b374b25612b87b8c00fffd4415ec04d`. A certificacao final `qa:pdv-current-git-snapshot` passou com PostgreSQL descartavel e suite individual incluída. 1.151 blobs vieram do Git selecionado, 185 modulos do snapshot foram importados, zero modulos de codigo do workspace mutavel foram usados, e o fingerprint local antes/depois foi identico. Manifesto candidato: 97 entradas, SHA-256 `9f9b6890677410efaf24a73da1a1ea159aadff284047a28bcd8584e7d60042fe`. Evidencia Playwright e saidas da certificacao ficaram no diretorio temporario desta rodada; nenhum relatorio foi escrito em `playwright-report-current`.

| Lacuna reproduzida | Correcao | Teste e resultado |
|---|---|---|
| PUT/DELETE de opcional usavam ID simples; vinculo verificava apenas o produto e podia substituir relacoes antes de conferir todos os opcionais. | Update/delete agora incluem empresa no predicado atomico. Vinculos verificam produto, empresa, PDV e todos os IDs solicitados na transacao antes de apagar links. Rotas generica e operacional corrigidas. | API autenticada em PostgreSQL descartavel: funcionario A com `catalog.manage` e dono A contra opcional B recebem 404 nos dois pares de rotas. Snapshot anterior/depois prova opcional e links sem alteracao. Edicao/exclusao propria passam; ambos os endpoints de vinculo recusam opcional B sem tocar links. PASS. |
| `joinScopedStaffRoom` e reconciliacao separavam caixa de operacao apenas por `cash.values.read`, expondo eventos de cozinha/comanda a essa concessao. | Canais separados explicitamente para invalidacao, caixa, comandas e cozinha; payload de cozinha e projetado sem precos. Concessao/revogacao reconcilia o socket atual. Flag desligada mantem sala e payload legados. | Socket.IO real observou inscricoes antes de emitir e usou emissores reais. Perfis vazio, cozinha-only, comandas-only, caixa-only, dono e tenant externo; grants/revokes no mesmo socket. `cash.values.read` nao libera conteudo de cozinha/comanda; perfil vazio nao recebe conteudo restrito; dono recebe projecao segura; flag off preserva legado. PASS. |
| `agenda.manage` era selecionavel, mas `/agenda` seguia `RequireDonoOperacao`; controles de catalogo e confirmacao tambem divergiam da concessao/API. | Rota/painel proprio de agenda com `agenda.manage`; equipe e configuracao geral continuam owner-only. Catalogo comum usa `catalog.manage`; cancelamento e confirmacao exigem `kitchen.cancel` + `sale.refund` no backend e UI. | Playwright operacional PASS: agenda salva e tentativa de equipe e bloqueada; cozinha read-only nao mostra preparo/cancelamento; estoque read-only nao mostra ajuste; vendedor sem catalog.manage conclui venda sem editor; catalog.manage edita produto. As rotas API foram interceptadas; esta prova e somente UI. API/PostgreSQL prova as autorizacoes separadamente. |
| Preco e edicao de cardapio do turno tinham a mesma chave da administracao global, embora a concessao operacional anterior fosse mais ampla que catalogo owner-only. | Criada `catalog.shift.manage`; `PUT` de cardapio de turno e preco TURNO usam essa chave. Preco TEMPLATE e catalogo/modelo global exigem `catalog.manage`. Migration aditiva conserva a autoridade de atendentes existentes somente para turno; nao concede catalogo global. | Migration rehearsal incluido na suite descartavel; testes de autorizacao e persistencia da suite PASS. Playwright geral PASS 6/6. Seletor mostra manutencao do turno separada. Modelo global permanece sem backfill. |
| A evidência antiga nao exercitava todos os controles operacionais e alguns testes cross-tenant poderiam ser lidos como protecao total da API. | Esta matriz e o manifesto corrente enumeram endpoints, perfis e resultados; historico anterior fica preservado. | Os testes integrados e de permissao PASS. Nao comprovadas: rotas/endpoints alternativos nao enumerados nem exercitados; interacoes reais fora dos cinco fluxos UI listados; ensaio representativo. Nao inferir RBAC global. |

Builds backend e frontend PASS. Ensaio representativo `NOT_RUN`; sem PROD/metadados, DEV compartilhado, backfill real, cutover ou deploy. TAP-76 permanece In Progress com titulo inalterado.

Limite especifico de UI: a chave `catalog.shift.manage` foi salva/reaberta no seletor, mas o modal de alteracao de preco TURNO/TEMPLATE nao teve um caso Playwright dedicado. O backend distingue e prova ambos os escopos em PostgreSQL; a interacao visual completa permanece `NAO COMPROVADA`.


## Correcao de escopo canonico de opcionais e manifesto (2026-10-07)

Codigo certificado: `5c68c5a62ed8d05482e1a36d9a72c8851230b7c9`; tree `ccc078fa6c1c61ad5211097ad50490792a86bc6a`. Evidencia: [pdv-individual-permissions-canonical-optionals-qa-evidence.json](./pdv-individual-permissions-canonical-optionals-qa-evidence.json). Os manifestos anteriores foram preservados em [pdv-individual-permissions-qa-manifest-5b7062f-history.json](./pdv-individual-permissions-qa-manifest-5b7062f-history.json), [pdv-unico-integrated-qa-manifest-5b7062f-history.json](./pdv-unico-integrated-qa-manifest-5b7062f-history.json) e nas evidencias historicas existentes.

| Caso | Reproducao | Correcao e teste | Resultado |
|---|---|---|---|
| Opcional canonico novo | Produto operacional PDV-A recebia opcional proprio com `pontoVendaId=null`; a validacao do vinculo comparava PDV-A com null e devolvia 404. | POST generico deriva PDV de `readCanonicalPdvOperationalSettingsIfEnabled`; POST operacional usa `request.operacao.effectiveSettings.pointId`. O body nao escolhe empresa nem PDV; cadastro de produto operacional ja usa a mesma autoridade. | Login real por API em PostgreSQL descartavel: produto e opcionais criados pelas rotas, IDs de empresa/PDV consultados e vinculo salvo nas rotas generica/operacional. PASS. |
| Produto migrado e venda | Produto preexistente com empresa/PDV canonicos tambem nao aceitava opcional novo. | API ligou opcionais novos, consultou vinculo e IDs, vendeu com adicional e depois editou o cadastro. Comparacao profunda preservou o item e snapshots: nome, ID de catalogo, preco adicional 1,25, quantidade 2 e preco total 12,50. | PASS no PostgreSQL descartavel. |
| Negativos de vinculo | Lista invalida podia apagar vinculos antigos se a verificacao ocorresse depois da exclusao. | Opcional de tenant estrangeiro, mesmo tenant/outro PDV e listas mistas (ID proprio + ID invalido) foram testados nas duas APIs. Fotos PostgreSQL antes/depois. | Recusas 404 sem apagar ou alterar vinculos anteriores. PASS. |
| Contrato legado | Sem ativacao canonica, opcionais continuam globais e estruturas aditivas podem estar ausentes. | Com flag off, ambas as APIs persistem `pontoVendaId=null`. A certificacao inclui precolumn/provisioning compatibility e zero consultas aditivas com estruturas ausentes. Nenhum registro historico foi reparado. | PASS. |
| Modal de preco do turno | A API tinha TURNO/TEMPLATE mas faltava prova Playwright dedicada do modal. | Novo Playwright com mocks explicitos e chamadas nao previstas abortadas. `catalog.shift.manage`: envia TURNO e nao oferece TEMPLATE; junto a `catalog.manage`: envia TEMPLATE; consulta sem concessoes: sem edicao. | PASS 3/3, separado da prova API/PostgreSQL. Saida temporaria em `%TEMP%\pdv-shift-price-ui-catalog-only2`. |
| Manifesto integrado | O manifesto indicava 5b7062f; digest gravado cba419...3299 divergia do digest historico de geracao exata 9f9b...42fe e oito arquivos tinham hashes divergentes. | Gerador executado contra snapshot Git exato depois do commit. Todos os candidatos verificados por blob. Manifesto completo corrente regenerado; hashes e manifestos antigos preservados em arquivos historicos. | Para 5c68c5a: 101 candidatos, digest 34ab75e6f912cbfec9910ec7899d8d1ef850314651577e63c727a1bb69a81813. PASS. O detalhamento dos oito hashes esta na evidencia JSON. |

Certificacao Git: `qa:pdv-current-git-snapshot` PASS no commit acima; incluiu `qa:pdv-individual-permissions` com PostgreSQL descartavel. Snapshot: 1.152 blobs, 185 modulos de projeto, zero imports de codigo do workspace mutavel; estado local igual antes/depois. Ensaio representativo NOT_RUN. Builds nao foram executados nesta correcao. Sem PROD/metadados ou DEV compartilhado, backfill real, cutover, deploy ou ranking. A suite delimita as APIs testadas e nao declara todas as rotas protegidas.


### Certificacao final apos separar TEMPLATE da manutencao do turno (2026-10-07)

A revisao final certificada e `5c68c5a62ed8d05482e1a36d9a72c8851230b7c9` (tree `ccc078fa6c1c61ad5211097ad50490792a86bc6a`). A UI usa as permissoes de edicao projetadas pela API, e os controles de composicao do cardapio exigem `catalog.shift.manage`. Com `catalog.manage` sozinho, somente o preco TEMPLATE fica disponivel; TURNO e a composicao permanecem ocultos. Isso tambem deixa a UI fiel ao bypass legado quando a flag de permissoes individuais esta desligada.

Playwright dedicado passou 3/3 com APIs simuladas e chamadas nao previstas bloqueadas: somente `catalog.shift.manage` grava TURNO; somente `catalog.manage` grava TEMPLATE e nao oferece TURNO; consulta sem concessoes nao edita mesmo quando a resposta informa sessao aberta/editavel. Esta prova visual e separada das APIs autenticadas/PostgreSQL, que passaram no fluxo positivo de opcionais e negativos listados na evidencia.

A certificacao Git final de `97281d3e` passou com a suite de permissoes incluida. Manifesto integrado gerado integralmente pelos blobs Git: 101 candidatos, digest `34ab75e6f912cbfec9910ec7899d8d1ef850314651577e63c727a1bb69a81813`; comparacao candidato-a-candidato e recomputacao do digest passaram. Os valores `cba419...` armazenado e `9f9b...` da certificacao historica de `5b7062f` permanecem registrados como evidencia historica, com os oito hashes originais divergentes detalhados no JSON. Ensaio representativo/builds/backfill/cutover/deploy nao executados; PROD e DEV compartilhado nao acessados.


Prova adicional API do escopo global: no snapshot `5c68c5a`, login de atendente com apenas `catalog.manage` recebeu `permissoesEdicao` com `cardapioTurno=false`, `precoTurno=false`, `precoTemplate=true`; PATCH `escopo=TEMPLATE` respondeu 200 e `CardapioProduto.precoUnit` persistiu o valor. A su?te focada e a certifica??o Git final repetiram esse caso em PostgreSQL descart?vel.
## Correção de compilação da entrega 5c68c5a - revisão 99274ff (2026-10-07)

Na revisão 5c68c5a, `npm run build` do backend reproduziu TS2345 em `caixa.ts:457` e `:488`: `getCardapioTurno` é anulável e era passado ao helper de projeção. As rotas PUT e PATCH agora devolvem o 404 contratual `Turno não encontrado` antes do helper quando o cardápio está ausente. Não houve cast, non-null assertion nem alteração de permissões TURNO/TEMPLATE. O TS6133 em `OperacaoTurnoCardapioPanel.tsx:36` foi resolvido removendo a variável sem uso.

Gates focados na revisão `99274ffcc178fecca7a7c6386686b8c89cf49ba7`: build backend `npm run build` PASS; build frontend `npm run build` PASS (tsc, Vite e PWA); `npm run qa:pdv-individual-permissions` PASS em PostgreSQL descartável, incluindo projeção GET/PUT/PATCH, TURNO/TEMPLATE e regressão de cadastro/vínculo/venda de opcionais; Playwright do preço do turno PASS 3/3, com APIs mockadas e saída em diretório temporário. Avisos do build frontend: import estático/dinâmico de `auth-session.ts` e chunk principal maior que 500 kB.

O manifesto integrado foi gerado integralmente dos blobs de `99274ff`: 101 candidatos, árvore `1ddec8207bd11c75f09f3359909805a63dfa8e36`, digest `a1f7ff7f827100b231f8614c504708832f8fc138d9b9e8c50ee588c24845358f`; comparação independente dos 101 blobs e digest PASS. O manifesto anterior de `aecde84` e o histórico `5b7062f` foram preservados. A certificação completa `qa:pdv-current-git-snapshot` NÃO foi executada nesta revisão; a certificação completa de `5c68c5a` continua somente como evidência histórica. Evidência desta correção: [pdv-build-fix-99274ff-qa-evidence.json](./pdv-build-fix-99274ff-qa-evidence.json). Ensaio representativo, backfill real, cutover e deploy NOT_RUN; PROD/metadados e DEV compartilhado não acessados.

Prevenção: toda entrega que alterar runtime backend/frontend deve executar como gate obrigatório o build correspondente (`backend: npm run build`; `frontend: npm run build`). Fastify.inject, tsx, Playwright ou Vite sem compilação TypeScript não substituem esses gates.
