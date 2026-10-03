# PDV único: contrato e preparação da migração

Estado: planejamento e simulação em andamento. Nenhuma escrita de migração de negócio, unicidade global ou remoção de tabelas faz parte desta entrega.

## Origem das regras e fatos

Fatos fornecidos pelo usuário: lançar diretamente pelo portal, pontuar somente após entrega e escolher ocorrência ao abrir o caixa foram apresentados como propostas pendentes, não decisões aprovadas. Não foram usados como regras certificadas. A política de opcionais obrigatórios e opcionais também segue pendente.

Fatos medidos em DEV em 03/10/2026: contagens, IDs, estados, relações, flags e valores descritos abaixo. A consulta foi somente leitura em uma transação PostgreSQL `RepeatableRead`/`READ ONLY`, depois da validação da URL DEV. O relatório não imprime nomes de clientes, contatos, identificadores livres, observações ou credenciais. Datas financeiras por `pagoEm` são agrupadas pela data UTC da serialização; não há timezone local medido para convertê-las em dia operacional.

## Linha de base e tarefa

Baseline funcional anterior: 66ec008. A entrega anterior foi commitada em cafec78d55a7ee8af1240092e972816fb921c790, partindo de ccd1f1f96b92843b42f319c4bb07a749fa99e9d2. Esta etapa parte de cafec78 e adiciona o primeiro schema de destino e o controle persistente de execucao, sem migrar dados de negocio, alterar consumidores ou remover legado. A TAP-76 foi relida: ID 20cf2ca0-90e6-428f-af2b-903ce1184f7a, prioridade alta, labels Quality e Product, status In Progress. O status permanece In Progress.

As alteracoes locais preexistentes foram preservadas; no commit do schema foi selecionado somente o delta aditivo, deixando de fora telefone normalizado e demais alteracoes alheias. PROD_ACCESS_USED=NO. A migration candidata foi aplicada somente ao PostgreSQL QA descartavel; nao foi aplicada migration ao DEV compartilhado ou PROD.

## Fotografia DEV e reclassificação

O inventário mediu 55 empresas, 44 sem PDV e 4 com múltiplos PDVs. Há 0 comandas sem vínculo Evento/PDV, 0 comandos com divergência de tenant e 0 pagamentos com referência de sessão ausente, dupla ou fora da fotografia do tenant.

O planejador atual marca 114 linhas de origem bloqueadas, com a causa explícita por código:

- 29 linhas exigem decisão manual porque a empresa tem mais de um PDV; pertencem a quatro empresas.
- 5 linhas exigem decidir entre mais de um trailer sem PDV canônico.
- Nenhuma linha de configuração é bloqueada apenas pela divergência entre flags explícitas e seus valores legados; a precedência operacional foi verificada e registrada abaixo.
- 80 linhas dependem de uma entidade bloqueada (`BLOCKED_PARENT`); são bloqueios propagados, não 80 novos conflitos de dados.
- 0 linhas foram classificadas como conflito de dados confirmado nesta fotografia. Testes puros cobrem referências ausentes, tenants cruzados, vínculos de destino divergentes e dependências bloqueadas.

O inventário anterior reportava 31 bloqueios sem grafo transitivo e tratava certas referências como bloqueadas por regra simplificada. Nesta revisão, quatro linhas anteriormente bloqueadas por essa regra tornaram-se válidas na origem: uma dívida ligada a uma comanda EVENTO válida e três comandas que também apontam para PDV. Mais duas linhas de configuração deixaram de ser bloqueadas porque a precedência efetiva está comprovada. As 114 linhas atuais são 34 bloqueios raiz de unidade (29 multi-PDV e 5 multi-trailer) e 80 dependentes, não 114 conflitos de dados independentes.

**Cliente DEV A** (`cmr9yis3c0000hvu00q9fe7y1`): zero PDVs e um trailer; o plano propõe um ID de PDV a partir desse único trailer, sem gravá-lo. Há 156 clientes, 4 agendas, 21 ocorrências, 2 eventos avulsos, 3 pedidos de portal, 2.138 logs de auditoria, 156 estatísticas de cliente, 11 produtos, 1 cardápio, 5 taps e 123 montagens. São 445 comandas EVENTO: 433 fechadas com total de 2.204.000 centavos, 11 canceladas e 1 aberta. Pagamentos totalizam 2.202.500 centavos; uma conta a receber preserva 1.500 centavos em aberto. A conta (`cmuog31rf0047hv5c71qgduod`) mapeia via comanda e cliente existentes para o PDV proposto; seu saldo não foi alterado nem inventado. Há 4 caixas de Evento (1 aberto, 3 fechados), sem movimentos e sem sessão operacional.

**Cliente DEV B** (`cmsry9xrn0000hvlgopjxy0oo`): um PDV existente (`cmsry9xry0004hvlge0wgboza`) e um trailer; identidade do PDV preservada. Há 7 clientes, 1 agenda, 1 ocorrência, 1 evento avulso, nenhum pedido de portal, 1.487 logs de auditoria, 6 estatísticas de cliente, 34 produtos, 5 cardápios, 4 taps e sem montagens de tap. São 166 comandas CAIXA fechadas, total de 1.378.700 centavos; 22 canceladas e 1 aberta; mais 3 comandas EVENTO fechadas, total de 10.300 centavos. Os pagamentos somam 1.389.000 centavos em suas origens. Cinco dívidas somam 19.000 centavos originais e recebidos, saldo zero. Existem 40 sessões operacionais (4 abertas) e 2 sessões de Evento fechadas; nenhuma tem movimento manual. O estoque contém 31 saldos e 756 movimentos.

As três comandas com `eventoId` e `pontoVendaId` são `cmun1yl6p0005hvngyy5n41gc`, `cmundclqd0022hvyo48c2rp5e` e `cmundx61f0005hvygaaz5llwb`. A validação não se baseou apenas no tenant: nas três, o Evento aponta ao trailer do tenant, há um único PDV existente para o destino, o `pontoVendaId` da comanda é exatamente esse PDV e os itens apontam para produtos com controle de estoque habilitado. A configuração DEV também tem estoque ligado. O código em `backend/src/lib/comanda-service.ts` só preenche `Comanda.pontoVendaId` para Evento quando a configuração e o produto participam do estoque; antes de gravar, exige exatamente um PDV ativo do tenant. Todas as três linhas e seus itens agora têm destino completo, mantendo os IDs e ambos os vínculos históricos. A relação dupla é válida para o destino atual; não há evidência de corrupção.

No Cliente DEV B, `inventoryEnabled=true` e `kitchenEnabled=true` divergem dos valores legados `controlaEstoque=false` e `temCozinha=false`. A precedência já implementada resolve o comportamento atual: `deriveOperationalProfile` usa as flags explícitas de `ConfiguracaoOperacional` e só consulta `ConfiguracaoOperacao` como fallback; `comanda-service.ts` segue a mesma precedência para estoque; `/operacao/contexto` e `requireModuloOperacao` consomem o perfil para cozinha e caixa. A medição DEV mostrou `plannedOperationsEnabled=false`, logo o modo efetivo é `CAIXA` (Por Caixa), com um PDV ativo, estoque e cozinha efetivos ligados. A proposta é preservar esse comportamento na configuração alvo e reconciliar os campos legados depois; nenhuma flag foi sincronizada no banco nesta entrega. Cliente DEV A mede modo `EVENTO`, estoque/cozinha desligados e não tem linha legada de módulo divergente.

## Contrato do planejador

Cada resultado separa `sourceValidation`, `targetMapping` e `executionEligibility`; a política de ID (`PRESERVE_SOURCE_ID`/`REGENERATE_SOURCE_ID`) não implica que vínculos estejam mapeados. A validação da origem registra PDV canônico, dependências e bloqueio com código, categoria e evidência. O mapeamento alvo tem entidade, vínculos exigidos, transformação e motivo de incompletude. Todo resultado tem `executionEligibility=NOT_AUTHORIZED`; não há função `assertExecutablePlan` nem migrador de negócio.

O módulo compartilhado `pdv-unico-source-graph.ts` lê as linhas dentro da transação do chamador e constrói o grafo sem instanciar cliente na importação. O inventário e o teste QA chamam `readPdvPlanningSourceSnapshot` e `buildPdvPlanningGraph`. Os índices usam tipo/ID e validam existência, tenant, sessão de pagamento e bloqueios herdados. Pagamento com duas sessões é detectado a partir dos dois FKs observados, sem blocker fornecido pelo teste. ContaReceber de origem EVENTO é válida quando comanda/cliente existem; bloqueios de pagamento não mudam principal/saldo da dívida.

Transformações alvo comprovadas como contrato: `Trailer → PontoVenda` pelo destino canônico resolvido; `Evento` semanal sem pai de série → `AgendaOperacional`; Evento datado/avulso ou ligado a série → `OcorrenciaOperacional` com `agendaId` quando aplicável; `SessaoCaixaEvento → SessaoCaixa` compartilhada, com `contextoOperacional=CAIXA`, `ocorrenciaId` e `origemHistorica=EVENTO`; comanda mantém a origem histórica do consumo em `origemHistorica`. Não se cria um segundo motor de caixa. Transformações financeiras/catalogais ainda não definidas permanecem `targetMapping=INCOMPLETE`. Nenhum plano é elegível para escrita nesta etapa.

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
| `MigrationMap`/`MigrationRun` (proposta anterior) | IDs de todas as tabelas legadas | Chave `{sourceType, sourceId}`, entidade destino, PDV, v?nculos, hash/versionamento de payload, run/lote e checkpoint. | A proposta anterior inclu?a chave por execu??o. A migration candidata implementa `UNIQUE(sourceType,sourceId)` global e checkpoints de run/batch; n?o existe unicidade dependente do run. |

Sequência aditiva: (1) schema novo e mapa de origem, sem consumidores; (2) índices/FKs sem cascata e constraints inicialmente validadas em QA; (3) backfill idempotente por lotes com checkpoint/hash; (4) reconciliação completa e repetição do migrador; (5) alternância de leitura/escrita e teste de rollback; (6) decisão explícita de corte; (7) só após gates, migration destrutiva removendo estruturas antigas. Nenhuma dessas migrations de negócio foi criada ou aplicada aqui. A unicidade global de PDV segue proposta e não foi aplicada.

## Execução reiniciável e gates futuros

Cada lote futuro deve carregar snapshot/hash versionado, usar chave de origem estável, persistir mapa/checkpoint junto com os registros e comparar payload antes de repetir. Interrupção deve retomar do último lote confirmado. Conflito, tenant cruzado, pai ausente, sessão financeira ambígua, diferença de centavos ou payload alterado bloqueia o lote para reconciliação humana. Não se cria pagamento, recebimento, saldo, sessão, vínculo ou dia operacional por aproximação.

Gate rápido: unitários puros, typecheck de scripts, build e guards de ambiente. Gate completo: fixtures isoladas exigidas, todos os cenários P0, comparação financeira/estoque e duas ordens de concorrência. Gate pós-migração QA: duas execuções idempotentes, hashes/contagens iguais, interrupção/retomada, restore/rollback e regressão de API/UI/portal/realtime. Planejado não significa executado ou certificado.

QA descartável executado nesta entrega. O manifesto versionado [pdv-unico-qa-migration-manifest.json](../testing/pdv-unico-qa-migration-manifest.json) fixa base `ccd1f1f96b92843b42f319c4bb07a749fa99e9d2`, 86 migrations SQL e SHA-256 `78f4a3857d8fdbdb706843f3c3891b879bc096e8550bb3c89a1e83ed1ea9af60`. A migration local não rastreada `20261002120000_unique_normalized_customer_phones` não pertence ao commit-base, foi excluída pela composição Git explícita do manifesto e permaneceu intocada. O ensaio aplicou as 85 anteriores, criou a fixture de sessão/movimento, aplicou a 86ª restritiva e confirmou 86 linhas finalizadas; depois rodou exclusão/concorrência e o grafo real. O container temporário foi removido pelo próprio runner. Código sob teste: worktree baseado em `ccd1f1f`; a entrega inclui as alterações descritas neste documento e no plano de testes, que serão registradas no SHA após commit.

## Schema aditivo da primeira etapa

Migration candidata: 20261003210000_additive_pdv_operational_core. O PontoVenda existente permanece a entidade canonica; nao ha tabela paralela de unidade. A migration adiciona AgendaOperacional e OcorrenciaOperacional no schema quiosque, com FKs restritivas para empresa/PDV, FK composta de agenda para garantir mesmo tenant e PDV, unicidade de agenda/data, CHECK de dia semanal e status tipados. OcorrenciaOperacional.agendaId e opcional, permitindo realizacao avulsa.

SessaoCaixaQuiosque (Por Caixa existente) recebe ocorrenciaId e origemHistorica opcionais. O FK composto valida empresa/PDV da ocorrencia e e RESTRICT. Rotas e motor de caixa nao mudaram; nenhum caixa paralelo foi criado e nenhuma venda/sessao historica recebeu ocorrencia automaticamente. A exclusao de agenda, ocorrencia ou PDV com historico relacionado e restrita; nao ha cascade das novas relacoes.

O controle minimo contem PdvMigrationRun, PdvMigrationBatch e PdvMigrationMap. O mapa tem chave unica global por sourceType+sourceId, destino polimorfico, empresa/PDV, versao de transformacao, payloadHash, run/batch mais recentes. FK composta garante que batch e run associados coincidem. Run e batch guardam checkpoint; cada batch confirma status, cursor e hash. Essa identidade continua igual entre execucoes; payload divergente deve ser comparado pelo futuro migrador e bloqueado para reconciliacao, nunca sobrescrito silenciosamente.

Futuro migrador: numa unica transacao, criar/reutilizar o destino e conferir seu payload; inserir ou atualizar o mapa por sourceType+sourceId; gravar o batch CONFIRMED e atualizar o checkpoint do run. Commit/rollback deve abranger os tres efeitos. Uma retomada rel? o ultimo checkpoint confirmado e faz upsert pelo ID de origem estavel. Esta entrega nao implementa esse gravador.

Nao ha unicidade global de PontoVenda por empresa nem novos FKs obrigatorios em comandas, vendas ou sessoes legadas. Agenda representa recorrencia e nao escolhe modo de operacao; ocorrencia representa uma data. Politicas de portal, pontuacao, escolha de ocorrencia, categorias e catalogo seguem fora desta etapa.

### Ensaio da migration candidata em QA descartavel

O manifesto historico da FK [pdv-unico-qa-migration-manifest.json](../testing/pdv-unico-qa-migration-manifest.json) permaneceu sem alteracoes: base ccd1f1f96b92843b42f319c4bb07a749fa99e9d2, 86 migrations, hash 78f4a3857d8fdbdb706843f3c3891b879bc096e8550bb3c89a1e83ed1ea9af60. O candidato usa [pdv-unico-core-qa-manifest.json](../testing/pdv-unico-core-qa-manifest.json), base cafec78d55a7ee8af1240092e972816fb921c790, hash do SQL 95f1b4535510615d9355f9d018f87849ae71cbf955bdc95ec7b232ce8dacd719 e hash do schema selecionado no indice Git 53d7ffb037c43da4031b3de64798d32681a492ec3998e5ac9e831bcfc427eba7. O bundle foi 86 migrations historicas mais este SQL candidato (87 total). A migration local nao rastreada de telefone ficou fora do conjunto e intacta.

Prisma validate e generate executaram contra o schema candidato selecionado no indice; o client foi gerado em pasta exclusiva da execucao e usado nos testes. A migration preservou ID, tenant, PDV, estado, troco e movimento anterior; criou ocorrencia avulsa e recorrente; rejeitou empresa/PDV inconsistentes, dia semanal invalido e ocorrencia repetida; DELETE da ocorrencia com sessao e da agenda com ocorrencia falhou por RESTRICT. O mapa conservou ID/destino ao retomar em outro run, recusou duplicar origem e recusou associar batch a run diferente. Run, batch, mapa e checkpoint de uma transacao com falha foram totalmente revertidos. Cinco constraints/checks efetivos e validados foram consultados no catalogo.

No mesmo QA passaram novamente os 8 testes de exclusao/auditoria/concorrencia (zero skips) e PDV-GRAPH-QA-01. O log de exclusao real, com eventoId/comandaId nulos, entidadeId original e metadata, entrou na fotografia tenant-wide e no grafo; a contagem e os IDs foram comparados. O runner removeu o container tmpfs/loopback e os clients temporarios depois do processo. Nenhum dado ou migration foi escrito no DEV compartilhado.

## Proteção de exclusão/reversão já existente

Exclusão e reversão de Evento compartilham o advisory transaction lock usado pela abertura e pelos movimentos do caixa. A checagem de sessão, validações restantes e `DELETE` estão na mesma transação. `TransacaoLog` persiste nessa transação antes do commit, com o ID removido em `entidadeId`/metadados sem FK inválida; qualquer bloqueio ou rollback remove também o log. Resposta de sucesso, Socket.IO e notificações externas só são emitidos depois do commit.

A migration `20261003180000_restrict_event_cash_history` troca a FK de `SessaoCaixaEvento.eventoId` para `ON DELETE RESTRICT`. Foi aplicada apenas ao PostgreSQL QA isolado em execução anterior e **não** a DEV compartilhado ou PROD. O teste confirmou preservação de sessão/movimento, DELETE direto bloqueado com histórico, DELETE sem histórico permitido e `confdeltype='r'`. Validar DEV só em entrega futura autorizada, após inspecionar órfãos e aplicar exclusivamente no destino DEV autorizado.

`PROD_ACCESS_USED=NO`. `PROD_DEPLOY_REQUIRED: YES` para implementação futura; esta entrega é preparação/simulação.
