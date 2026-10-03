# PDV único: contrato e preparação da migração

Estado: primeira fatia do migrador de negocio implementada e ensaiada exclusivamente em PostgreSQL QA descartavel. Nenhuma migration, backfill ou escrita foi aplicada ao DEV compartilhado ou PROD; nao ha corte operacional nem remocao de legado.

## Origem das regras e fatos

Fatos fornecidos pelo usuário: lançar diretamente pelo portal, pontuar somente após entrega e escolher ocorrência ao abrir o caixa foram apresentados como propostas pendentes, não decisões aprovadas. Não foram usados como regras certificadas. A política de opcionais obrigatórios e opcionais também segue pendente.

Fatos medidos em DEV em 03/10/2026: contagens, IDs, estados, relações, flags e valores descritos abaixo. A consulta foi somente leitura em uma transação PostgreSQL `RepeatableRead`/`READ ONLY`, depois da validação da URL DEV. O relatório não imprime nomes de clientes, contatos, identificadores livres, observações ou credenciais. Datas financeiras por `pagoEm` são agrupadas pela data UTC da serialização; não há timezone local medido para convertê-las em dia operacional.

## Linha de base e tarefa

Baseline funcional anterior: 66ec008. A etapa de schema anterior foi commitada em cafec78d55a7ee8af1240092e972816fb921c790, partindo de ccd1f1f96b92843b42f319c4bb07a749fa99e9d2. Esta entrega parte de ed5380e67078255efb0bfeb34b832e9d4771a85f e implementa a primeira fatia do migrador somente em QA descartavel, sem alterar consumidores ou remover legado. TAP-76: 20cf2ca0-90e6-428f-af2b-903ce1184f7a, prioridade high, labels Quality/Product, status In Progress.

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

O planejador somente leitura separa `sourceValidation`, `targetMapping` e `executionEligibility=NOT_AUTHORIZED`. O executor desta fatia e separado e limitado ao escopo PDV/Trailer/agenda/ocorrencia em QA isolado; importar seus modulos nao cria Prisma nem conecta. Nenhum consumidor operacional ou rota Por Caixa mudou.

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
| `MigrationMap`/`MigrationRun` (proposta anterior) | IDs de todas as tabelas legadas | Chave `{sourceType, sourceId}`, destino, PDV, links, hash/versionamento, run/lote e checkpoint. | A proposta anterior previa tambem unicidade por run. O schema confirmado usa identidade global `UNIQUE(sourceType,sourceId)` e checkpoint por run/batch. |

Sequencia: schema e migration aditiva foram validados no QA. A primeira migracao de dados em escopo restrito PDV/agenda/ocorrencia foi ensaiada em QA nesta entrega. Configuracao/catalogo, reconciliacao, migracao dos demais dominios, corte e remocao de legado seguem etapas futuras; unicidade global de PDV nao foi aplicada.

## Execução reiniciável e gates futuros

Cada lote confirmado grava destino, mapa estavel e checkpoint atomicamente. O executor desta fatia compara hash/versionamento de payload e hash do conteudo de destino; conflitos bloqueiam sem sobrescrita. As etapas de negocio fora deste escopo ainda precisam dessa garantia na sua implementacao.

Gate rápido: unitários puros, typecheck de scripts, build e guards de ambiente. Gate completo: fixtures isoladas exigidas, todos os cenários P0, comparação financeira/estoque e duas ordens de concorrência. Gate pós-migração QA: duas execuções idempotentes, hashes/contagens iguais, interrupção/retomada, restore/rollback e regressão de API/UI/portal/realtime. Planejado não significa executado ou certificado.

QA descartável executado nesta entrega. O manifesto versionado [pdv-unico-qa-migration-manifest.json](../testing/pdv-unico-qa-migration-manifest.json) fixa base `ccd1f1f96b92843b42f319c4bb07a749fa99e9d2`, 86 migrations SQL e SHA-256 `78f4a3857d8fdbdb706843f3c3891b879bc096e8550bb3c89a1e83ed1ea9af60`. A migration local não rastreada `20261002120000_unique_normalized_customer_phones` não pertence ao commit-base, foi excluída pela composição Git explícita do manifesto e permaneceu intocada. O ensaio aplicou as 85 anteriores, criou a fixture de sessão/movimento, aplicou a 86ª restritiva e confirmou 86 linhas finalizadas; depois rodou exclusão/concorrência e o grafo real. O container temporário foi removido pelo próprio runner. Código sob teste: worktree baseado em `ccd1f1f`; a entrega inclui as alterações descritas neste documento e no plano de testes, que serão registradas no SHA após commit.

## Schema aditivo da primeira etapa

Migration candidata: 20261003210000_additive_pdv_operational_core. O PontoVenda existente permanece a entidade canonica; nao ha tabela paralela de unidade. A migration adiciona AgendaOperacional e OcorrenciaOperacional no schema quiosque, com FKs restritivas para empresa/PDV, FK composta de agenda para garantir mesmo tenant e PDV, unicidade de agenda/data, CHECK de dia semanal e status tipados. OcorrenciaOperacional.agendaId e opcional, permitindo realizacao avulsa.

SessaoCaixaQuiosque (Por Caixa existente) recebe ocorrenciaId e origemHistorica opcionais. O FK composto valida empresa/PDV da ocorrencia e e RESTRICT. Rotas e motor de caixa nao mudaram; nenhum caixa paralelo foi criado e nenhuma venda/sessao historica recebeu ocorrencia automaticamente. A exclusao de agenda, ocorrencia ou PDV com historico relacionado e restrita; nao ha cascade das novas relacoes.

O controle implementado contem PdvMigrationRun, PdvMigrationBatch e PdvMigrationMap. O mapa tem chave unica global por sourceType+sourceId, destino, empresa/PDV, versao/hash do payload e run/lote mais recentes. Cada recibo de lote fixa tambem o hash do conteudo do destino para validar reuso.

O migrador desta primeira fatia grava destino, mapa, lote confirmado e checkpoint em uma unica transacao por lote. A retomada valida o prefixo e reusa destinos verificados. Dominios fora desta fatia ainda nao possuem migrador.

Nao ha unicidade global de PontoVenda por empresa nem novos FKs obrigatorios em comandas, vendas ou sessoes legadas. Agenda representa recorrencia e nao escolhe modo de operacao; ocorrencia representa uma data. Politicas de portal, pontuacao, escolha de ocorrencia, categorias e catalogo seguem fora desta etapa.

### Ensaio da migration candidata em QA descartavel

O manifesto historico da FK [pdv-unico-qa-migration-manifest.json](../testing/pdv-unico-qa-migration-manifest.json) permaneceu sem alteracoes: base ccd1f1f96b92843b42f319c4bb07a749fa99e9d2, 86 migrations, hash 78f4a3857d8fdbdb706843f3c3891b879bc096e8550bb3c89a1e83ed1ea9af60. O candidato usa [pdv-unico-core-qa-manifest.json](../testing/pdv-unico-core-qa-manifest.json), base cafec78d55a7ee8af1240092e972816fb921c790, hash do SQL 95f1b4535510615d9355f9d018f87849ae71cbf955bdc95ec7b232ce8dacd719 e hash do schema selecionado no indice Git 53d7ffb037c43da4031b3de64798d32681a492ec3998e5ac9e831bcfc427eba7. O bundle foi 86 migrations historicas mais este SQL candidato (87 total). A migration local nao rastreada de telefone ficou fora do conjunto e intacta.

Prisma validate e generate executaram contra o schema candidato selecionado no indice; o client foi gerado em pasta exclusiva da execucao e usado nos testes. A migration preservou ID, tenant, PDV, estado, troco e movimento anterior; criou ocorrencia avulsa e recorrente; rejeitou empresa/PDV inconsistentes, dia semanal invalido e ocorrencia repetida; DELETE da ocorrencia com sessao e da agenda com ocorrencia falhou por RESTRICT. O mapa conservou ID/destino ao retomar em outro run, recusou duplicar origem e recusou associar batch a run diferente. Run, batch, mapa e checkpoint de uma transacao com falha foram totalmente revertidos. Cinco constraints/checks efetivos e validados foram consultados no catalogo.

No mesmo QA passaram novamente os 8 testes de exclusao/auditoria/concorrencia (zero skips) e PDV-GRAPH-QA-01. O log de exclusao real, com eventoId/comandaId nulos, entidadeId original e metadata, entrou na fotografia tenant-wide e no grafo; a contagem e os IDs foram comparados. O runner removeu o container tmpfs/loopback e os clients temporarios depois do processo. Nenhum dado ou migration foi escrito no DEV compartilhado.

## Proteção de exclusão/reversão já existente

Exclusão e reversão de Evento compartilham o advisory transaction lock usado pela abertura e pelos movimentos do caixa. A checagem de sessão, validações restantes e `DELETE` estão na mesma transação. `TransacaoLog` persiste nessa transação antes do commit, com o ID removido em `entidadeId`/metadados sem FK inválida; qualquer bloqueio ou rollback remove também o log. Resposta de sucesso, Socket.IO e notificações externas só são emitidos depois do commit.

A migration `20261003180000_restrict_event_cash_history` troca a FK de `SessaoCaixaEvento.eventoId` para `ON DELETE RESTRICT`. Foi aplicada apenas ao PostgreSQL QA isolado em execução anterior e **não** a DEV compartilhado ou PROD. O teste confirmou preservação de sessão/movimento, DELETE direto bloqueado com histórico, DELETE sem histórico permitido e `confdeltype='r'`. Validar DEV só em entrega futura autorizada, após inspecionar órfãos e aplicar exclusivamente no destino DEV autorizado.

`PROD_ACCESS_USED=NO`. `PROD_DEPLOY_REQUIRED=NO` para esta entrega QA-only; uma ativacao operacional futura exigira release e gates explicitos.


## Migrador reiniciavel da primeira fatia (QA descartavel)

O commit de baseline confirmado e `ed5380e67078255efb0bfeb34b832e9d4771a85f`. O novo manifesto `pdv-unico-migrator-qa-manifest.json` fixa os SHA-256 do schema/SQL lidos por `git show`, os hashes dos manifestos anteriores, nove arquivos de codigo ensaiados e seu digest proprio `cc8af07b155bfca5a7120d688b4693d5fc32702ba1582672b55099373adc679e`. Os candidatos de schema e migration desta entrega sao explicitamente vazios. O ensaio nao depende do indice Git ou schema de trabalho. A cadeia tem 86 migrations historicas mais o SQL aditivo imutavel do baseline (87 total).

`runPdvBusinessMigration` usa `readPdvPlanningSourceSnapshot` e `buildPdvPlanningGraph` compartilhados. Seu escopo registrado no run e `PDV_AGENDA_OCORRENCIA_V1` para uma empresa, com tipos PDV, TRAILER e EVENTO e contagens explicitas. PDVs existentes sao mantidos; multiplos PDVs ou mais de um Trailer bloqueiam com motivo tipado. Sem PDV, exatamente um Trailer cria PontoVenda com o ID do Trailer, nome, atividade e timestamps; o mapa Trailer aponta para esse destino estavel. A identificacao por mapa permite reconhecer o PDV derivado na retomada sem conta-lo como um novo PDV legado.

Evento semanal sem pai de serie vira agenda, exigindo dia da semana. Evento de serie vira ocorrencia com vinculo a agenda confirmada. Evento nao recorrente datado vira ocorrencia avulsa. Data ausente bloqueia. Nome, localizacao, horarios, data, status e createdAt/updatedAt sao transformados sem defaults inventados. Estados: Evento ABERTO/FECHADO vira ocorrencia ABERTA/FECHADA; definicao de agenda vira ativa=true/false. Campos de origem sem equivalente nesta fatia: identificador do Trailer, cardapioId, encerradoEm, comandasContadorDesde, portalGeneration, exclusoes de datas da serie e dados comerciais/financeiros. Permanecem na origem e nao sao declarados migrados.

Cada lote usa advisory transaction lock PostgreSQL por empresa/escopo. Criacao/reuso do destino, mapa, recibos de hash do conteudo, confirmacao do lote e avanco do checkpoint pertencem a mesma transacao. O run so fica COMPLETED depois de confirmar todas as origens contadas em seu escopo declarado; isso nao representa migracao completa do produto. Retomada valida o prefixo ja confirmado. Mudanca de versao/payload, dependencia nao confirmada, mapa divergente, destino ausente/adulterado ou origem fora do tenant bloqueia sem sobrescrever e sem avancar aquele checkpoint. Conflito de unicidade nao e tratado como sucesso. Interrupcao apos criar destino dentro do lote provoca rollback de destino, mapa e lote; a retomada reutiliza o ultimo lote confirmado.

O executor de escrita valida a URL QA exata allowlisted antes de carregar/instanciar Prisma. Importacao nao inicia execucao nem conexao. O inventario continua leitura; nao houve mudanca de rota ou comportamento de Por Caixa.

### Evidencia executada

Manifesto e blobs verificados: schema `53d7ffb037c43da4031b3de64798d32681a492ec3998e5ac9e831bcfc427eba7`; SQL `95f1b4535510615d9355f9d018f87849ae71cbf955bdc95ec7b232ce8dacd719`. QA descartavel criou empresa com PDV, empresa sem PDV com Trailer unico, agenda semanal, duas datas recorrentes e ocorrencia avulsa. Reexecucao em novo run preservou contagens; interrupcao apos dois lotes retomou do checkpoint; falha entre criacao do PDV e mapa reverteu tudo. Multiplos PDVs/Trailers, data ausente e tenant incompativel foram bloqueados por codigo. Payload alterado e destinos agenda/PDV adulterados foram bloqueados sem sobrescrita/avanco daquele registro. Duas execucoes concorrentes completaram sob trava sem duplicar destinos nem perder checkpoint. O container e os clients temporarios foram removidos. Contagens da fixture sem PDV: antes 0/0/0 (PDV/agenda/ocorrencia), depois 1/1/3; novo run: novamente 1/1/3, com 5 mapas e lotes acumulados de 3 para 6. Pausa apos 2 lotes confirmou 1 PDV, 1 agenda e 0 ocorrencias; retomada concluiu 5 registros de origem em 3 lotes. Para PDV existente: 1 antes e 1 depois. Falha intralote deixou 0 destino/mapas/lotes e a retomada concluiu.

Nao foram migrados caixa/sessoes, pagamentos, dividas, comandas, catalogo, estoque, configuracoes ou auditoria. Proxima fatia: definir e ensaiar transformacao de configuracao/catalogo, mantendo reconciliacao financeira/estoque, politica de produto, corte e rollback como gates posteriores.
