# PDV único: contrato e preparação da migração

Estado: planejamento e simulação em andamento. Nenhuma escrita de migração de negócio, unicidade global ou remoção de tabelas faz parte desta entrega.

## Origem das regras e fatos

Fatos fornecidos pelo usuário: lançar diretamente pelo portal, pontuar somente após entrega e escolher ocorrência ao abrir o caixa foram apresentados como propostas pendentes, não decisões aprovadas. Não foram usados como regras certificadas. A política de opcionais obrigatórios e opcionais também segue pendente.

Fatos medidos em DEV em 03/10/2026: contagens, IDs, estados, relações, flags e valores descritos abaixo. A consulta foi somente leitura em uma transação PostgreSQL `RepeatableRead`/`READ ONLY`, depois da validação da URL DEV. O relatório não imprime nomes de clientes, contatos, identificadores livres, observações ou credenciais. Datas financeiras por `pagoEm` são agrupadas pela data UTC da serialização; não há timezone local medido para convertê-las em dia operacional.

## Linha de base e tarefa

Baseline funcional anterior: `66ec008`. A tarefa TAP-76 foi lida antes da atualização: ID `20cf2ca0-90e6-428f-af2b-903ce1184f7a`, prioridade alta, rótulos `Quality` e `Product`, estado `In Progress`. O HEAD de entrada desta entrega era `8ccfaa1` (`feat: add deterministic PDV migration inventory`); a proteção de caixa/auditoria já havia sido entregue em commits anteriores. Este commit estende o planejador e o inventário; seu SHA e push serão registrados em TAP-76. O ticket permanece In Progress.

As alterações locais anteriores foram preservadas. `PROD_ACCESS_USED=NO`. Não foi aplicada migration nesta entrega.

## Fotografia DEV e reclassificação

O inventário mediu 55 empresas, 44 sem PDV e 4 com múltiplos PDVs. Há 0 comandas sem vínculo Evento/PDV, 0 comandos com divergência de tenant e 0 pagamentos com referência de sessão ausente, dupla ou fora da fotografia do tenant.

O planejador atual marca 116 linhas de entidade bloqueadas, com a causa explícita por código:

- 29 linhas exigem decisão manual porque a empresa tem mais de um PDV; pertencem a quatro empresas.
- 5 linhas exigem decidir entre mais de um trailer sem PDV canônico.
- 2 linhas de configuração (um mesmo tenant, duas tabelas) divergem: configuração operacional diz estoque/cozinha ligados e configuração do módulo diz ambos desligados.
- 80 linhas dependem de uma entidade bloqueada (`BLOCKED_PARENT`); são bloqueios propagados, não 80 novos conflitos de dados.
- 0 linhas foram classificadas como conflito de dados confirmado nesta fotografia. Testes puros cobrem referências ausentes, tenants cruzados, vínculos de destino divergentes e dependências bloqueadas.

O inventário anterior reportava 31 bloqueios sem grafo transitivo e tratava certas referências como bloqueadas por regra simplificada. Nesta revisão, quatro linhas anteriormente bloqueadas por essa regra tornaram-se mapeáveis: uma dívida ligada a uma comanda EVENTO válida e três comandas que também apontam para PDV. Isso não significa que os bloqueios novos sejam 116 problemas independentes: o total agora inclui dependentes impedidos pelas decisões de unidade e configuração.

**Cliente DEV A** (`cmr9yis3c0000hvu00q9fe7y1`): zero PDVs e um trailer; o plano propõe um ID de PDV a partir desse único trailer, sem gravá-lo. Há 156 clientes, 4 agendas, 21 ocorrências, 2 eventos avulsos, 3 pedidos de portal, 2.138 logs de auditoria, 156 estatísticas de cliente, 11 produtos, 1 cardápio, 5 taps e 123 montagens. São 445 comandas EVENTO: 433 fechadas com total de 2.204.000 centavos, 11 canceladas e 1 aberta. Pagamentos totalizam 2.202.500 centavos; uma conta a receber preserva 1.500 centavos em aberto. A conta (`cmuog31rf0047hv5c71qgduod`) mapeia via comanda e cliente existentes para o PDV proposto; seu saldo não foi alterado nem inventado. Há 4 caixas de Evento (1 aberto, 3 fechados), sem movimentos e sem sessão operacional.

**Cliente DEV B** (`cmsry9xrn0000hvlgopjxy0oo`): um PDV existente (`cmsry9xry0004hvlge0wgboza`) e um trailer; identidade do PDV preservada. Há 7 clientes, 1 agenda, 1 ocorrência, 1 evento avulso, nenhum pedido de portal, 1.487 logs de auditoria, 6 estatísticas de cliente, 34 produtos, 5 cardápios, 4 taps e sem montagens de tap. São 166 comandas CAIXA fechadas, total de 1.378.700 centavos; 22 canceladas e 1 aberta; mais 3 comandas EVENTO fechadas, total de 10.300 centavos. Os pagamentos somam 1.389.000 centavos em suas origens. Cinco dívidas somam 19.000 centavos originais e recebidos, saldo zero. Existem 40 sessões operacionais (4 abertas) e 2 sessões de Evento fechadas; nenhuma tem movimento manual. O estoque contém 31 saldos e 756 movimentos.

As três comandas com `eventoId` e `pontoVendaId` são `cmun1yl6p0005hvngyy5n41gc`, `cmundclqd0022hvyo48c2rp5e` e `cmundx61f0005hvygaaz5llwb`. A validação não se baseou apenas no tenant: nas três, o Evento aponta ao trailer do tenant, há um único PDV existente para o destino, o `pontoVendaId` da comanda é exatamente esse PDV e os itens apontam para produtos com controle de estoque habilitado. A configuração DEV também tem estoque ligado. O código em `backend/src/lib/comanda-service.ts` só preenche `Comanda.pontoVendaId` para Evento quando a configuração e o produto participam do estoque; antes de gravar, exige exatamente um PDV ativo do tenant. Todas as três linhas e seus itens agora têm destino completo, mantendo os IDs e ambos os vínculos históricos. A relação dupla é válida para o destino atual; não há evidência de corrupção.

Flags do Cliente DEV B ainda exigem decisão: `inventoryEnabled=true` e `kitchenEnabled=true` divergem de `controlaEstoque=false` e `temCozinha=false`. O planejador bloqueia as duas linhas de configuração com `CONFIGURATION_SOURCE_CONFLICT`; nenhuma escolha automática foi feita.

## Contrato do planejador

Cada resultado separa `destinationEntity {type,id}`, `canonicalPdvId`, `destinationLinks`, `dependencies`, `idPreserved` e `mappingComplete`. Uma identidade preservada não significa que seus FKs já estejam mapeados. Cada bloqueio contém código, categoria e evidência. As categorias são `CONFLITO_DADOS`, `DECISAO_MANUAL`, `INFORMACAO_INSUFICIENTE` e `LIMITACAO_PLANEJADOR`.

Os índices usam a chave composta por tipo e ID. O grafo valida existência dos pais, tenant, origem do PDV canônico, consistência entre vínculos de destino e bloqueios herdados. Comanda EVENTO requer Evento presente e validado; CAIXA/QUIOSQUE requer PDV comprovado. Pagamento requer comanda e cada sessão/conta vinculada; ContaReceber pode ter origem EVENTO se a comanda, Evento/PDV e cliente forem válidos. Itens, opcionais, pedidos, sessões, movimentos, estoque e montagens propagam bloqueios pelos pais. Um vínculo não validado não é aceito por um booleano fornecido pelo chamador. `assertExecutablePlan` rejeita destino nulo, dependência bloqueada ou mapa incompleto.

O plano é determinístico para coleções reordenadas, usa valores inteiros escalados para centavos e milésimos e não consulta nomes. `MANTER`/`REASSOCIAR` descrevem a proposta de identidade e de vínculos; não escrevem no banco.

## Fotografia interna e relatório redigido

A consulta DEV carrega os campos necessários em memória para a futura migração, inclusive timestamps, IDs de autores, vínculos, snapshots dos itens e opcionais, contagens e troco por forma, overrides do cardápio, referências de correção de movimento, histórico de transição de pedidos, agendas, exceções, eventos, clientes, dívidas e pagamentos. Valores Decimal são serializados como centavos ou milésimos sem `Number`.

A saída diagnóstica inclui IDs e valores necessários à reconciliação, mas omite nome/telefone/email/data de nascimento/observações de clientes, descrições livres e observações de itens, pedidos, movimentos e fechamento de caixa. Campos pessoais selecionados pela consulta permanecem somente na fotografia transitória interna e não são impressos nem gravados em arquivo.

Dia operacional usa primeiro `Comanda.diaOperacional`, depois a data do Evento e, por último, uma data UTC de `createdAt` marcada `UTC_FALLBACK_UNVERIFIED`/`UTC_FALLBACK_ONLY`. Esse fallback não é apresentado como data operacional comprovada. O saldo de dívida é derivado do valor original menos recebimentos observados; nenhuma sessão, baixa, recebimento ou saldo é criado pelo planejador.

## Desenho concreto do schema final (proposta, não aplicada)

| Entidade alvo | Fonte principal | Campos preservados/derivados e vínculo | Constraints propostas |
|---|---|---|---|
| `PontoVenda` canônico | `Cervejaria` + `PontoVenda`/`Trailer` | ID preferencialmente preservado; `cervejariaId`, nome/estado operacional. Sem escolher por nome. | `UNIQUE(cervejariaId)` somente após decisão e reconciliação de todos os múltiplos PDVs; FK tenant restritiva para histórico. |
| `ConfiguracaoOperacional` | `ConfiguracaoOperacional`, `ConfiguracaoOperacao` | Um registro por PDV; flags diretas preservadas e conflitos guardados em relatório de decisão. Taps/estoque/cozinha explícitos. | `UNIQUE(pontoVendaId)`, flags não nulas com defaults definidos após produto aprovar os conflitos. |
| `AgendaOperacional` | Evento semanal sem `serieId` + séries legadas | `id`, recorrência, dia da semana, hora, trailer/PDV, estado e timestamps. | FK `pontoVendaId`; índice por PDV/dia/estado; ID de origem único no mapa de migração. |
| `OcorrenciaOperacional` | Evento datado, avulso, ou ocorrência com `serieId` | `id`, `agendaId?`, data, horas, estado, cardápio, timestamps e exceções; ocorrências distintas permanecem distintas. | `UNIQUE(agendaId,data)` quando agenda presente; FKs compostas asseguram tenant/PDV coerente; sem cascade que apague histórico financeiro. |
| `SessaoCaixa` comum | `SessaoCaixaOperacao` + `SessaoCaixaEvento` | `id`, `pontoVendaId`, `ocorrenciaId?`, `origemHistorica`, dia operacional com fonte/evidência, estado, troco, contagens, autores/datas, cardápio/overrides e movimentos. | FK restritiva a PDV/ocorrência; sessão/movimento não são apagados em cascata; índice para sessão aberta por PDV/dia; constraint parcial de uma sessão aberta somente após reconciliar estado atual. |
| `CategoriaGamificada` | categorias/configuração futura + produto atual | Categoria estável, métrica `UNIDADE`/`VOLUME`, flag de participação e regra de pontos aprovada. | FK de item por ID; tenant coerente; nenhuma regra de momento de pontuação assumida. |
| `Comanda`/`ItemComanda` snapshots | `Comanda`, itens, catálogo/cardápios/preços | Origem histórica, cliente, PDV, ocorrência opcional, total/desconto, produto/volume/quantidade/preço, opcionais, preparo, cancelamento/viagem e timestamps. Snapshot da categoria, métrica e preço no item; campos livres preservados apenas no destino protegido. | FKs restritivas para financeiro; vínculo tenant validado; snapshot não muda quando catálogo ou agenda muda. |
| `Pagamento`, `ContaReceber`, `MovimentoFinanceiro` | `Pagamento`, `ContaReceber`, sessões e movimentos | Valores originais/recebidos/troco, forma, timestamps, autores, dívida original, cliente, comanda, sessão, origem histórica e encadeamento de correções. Saldo calculado por recebimentos, nunca fabricado. | Decimal(12,2) ou centavos inteiros; referências a sessão/comanda restritivas; movimento corretivo referencia original e não substitui linha original. |
| `MigrationMap`/`MigrationRun` | IDs de todas as tabelas legadas | Chave `{sourceType, sourceId}`, entidade destino, PDV, vínculos, hash/versionamento de payload, run/lote e checkpoint. Guardar também IDs preservados para prova de idempotência. | `UNIQUE(runId,sourceType,sourceId)` e `UNIQUE(sourceType,sourceId)` no mapa ativo; gravação transacional com lote. |

Sequência aditiva: (1) schema novo e mapa de origem, sem consumidores; (2) índices/FKs sem cascata e constraints inicialmente validadas em QA; (3) backfill idempotente por lotes com checkpoint/hash; (4) reconciliação completa e repetição do migrador; (5) alternância de leitura/escrita e teste de rollback; (6) decisão explícita de corte; (7) só após gates, migration destrutiva removendo estruturas antigas. Nenhuma dessas migrations de negócio foi criada ou aplicada aqui. A unicidade global de PDV segue proposta e não foi aplicada.

## Execução reiniciável e gates futuros

Cada lote futuro deve carregar snapshot/hash versionado, usar chave de origem estável, persistir mapa/checkpoint junto com os registros e comparar payload antes de repetir. Interrupção deve retomar do último lote confirmado. Conflito, tenant cruzado, pai ausente, sessão financeira ambígua, diferença de centavos ou payload alterado bloqueia o lote para reconciliação humana. Não se cria pagamento, recebimento, saldo, sessão, vínculo ou dia operacional por aproximação.

Gate rápido: unitários puros, typecheck de scripts, build e guards de ambiente. Gate completo: fixtures isoladas exigidas, todos os cenários P0, comparação financeira/estoque e duas ordens de concorrência. Gate pós-migração QA: duas execuções idempotentes, hashes/contagens iguais, interrupção/retomada, restore/rollback e regressão de API/UI/portal/realtime. Planejado não significa executado ou certificado.

O teste sintético Prisma `pdv-unico-planner.isolated.test.ts` foi adicionado, mas está **NÃO COMPROVADO** nesta entrega porque não havia serviço local na porta QA `55439`. O executor atual do teste FK copia diretórios de migration do workspace sem filtrar arquivos não rastreados; o workspace mantém uma migration local não rastreada de unicidade de telefone. Não iniciar esse executor até o baseline QA excluir migrations locais não rastreadas, para não aplicar alteração de unicidade fora do escopo.

## Proteção de exclusão/reversão já existente

Exclusão e reversão de Evento compartilham o advisory transaction lock usado pela abertura e pelos movimentos do caixa. A checagem de sessão, validações restantes e `DELETE` estão na mesma transação. `TransacaoLog` persiste nessa transação antes do commit, com o ID removido em `entidadeId`/metadados sem FK inválida; qualquer bloqueio ou rollback remove também o log. Resposta de sucesso, Socket.IO e notificações externas só são emitidos depois do commit.

A migration `20261003180000_restrict_event_cash_history` troca a FK de `SessaoCaixaEvento.eventoId` para `ON DELETE RESTRICT`. Foi aplicada apenas ao PostgreSQL QA isolado em execução anterior e **não** a DEV compartilhado ou PROD. O teste confirmou preservação de sessão/movimento, DELETE direto bloqueado com histórico, DELETE sem histórico permitido e `confdeltype='r'`. Validar DEV só em entrega futura autorizada, após inspecionar órfãos e aplicar exclusivamente no destino DEV autorizado.

`PROD_ACCESS_USED=NO`. `PROD_DEPLOY_REQUIRED: YES` para implementação futura; esta entrega é preparação/simulação.
