# PDV único: contrato e migração em DEV

Estado: implementação em andamento. Este documento não autoriza execução em PROD nem certifica a migração.

## Modelo alvo e propostas pendentes

- Uma empresa tem exatamente um PDV. Criar empresa, PDV e configuração em uma transação; `PontoVenda.cervejariaId` terá unicidade no banco após reconciliar duplicados em DEV.
- O núcleo Por Caixa é o fluxo operacional único. Agenda e ocorrência são metadados opcionais do turno. Os itens de venda devem preservar sua origem, mesmo se a agenda for alterada ou uma dívida for recebida depois.
- Propostas pendentes de aprovação formal do produto: portal lançar diretamente; pontuar ranking após entrega, excluindo cancelados/estornados e mantendo dívida; escolher ocorrência na abertura do caixa, sem transferência posterior. Nenhuma delas é aceite implementado.
- Preço: ajuste do turno, depois preço do cardápio, depois preço padrão do produto. Item vendido guarda preço, volume, categoria e medida aplicados no momento da venda.
- Cliente é único no PDV. A origem é uma dimensão do histórico, não uma identidade separada.

## Estado do código em 03/10/2026

Baseline anterior ao commit `cca17e2`: HEAD `66ec008`; 31 arquivos modificados antes daquele trabalho, além de arquivos não versionados. O commit `cca17e2` adicionou guardas de aplicação contra apagar caixas existentes e o primeiro inventário DEV; não eliminou a corrida entre verificação e exclusão. Esta entrega prepara a sincronização transacional e uma migration restritiva, ainda sem aplicar. O schema ainda possui `Trailer`, `SessaoCaixaEvento`, `MovimentoCaixaEvento`, `EventoProduto`, modos `CAIXA/EVENTO`, catálogo e ranking específicos de evento. `PontoVenda.cervejariaId` não é único. Existem `Cardapio` e `CardapioProduto` reutilizáveis, mas categoria continua texto em `Produto`.

O usuário informou o papel operacional de Churrasquinho do Thiago e CIA Marítima. A consulta read-only ao banco DEV confirmou as empresas e as contagens abaixo; não comprovou todos os vínculos financeiros e de estoque. A escrita futura deve usar IDs e vínculos verificados, nunca apenas nomes.

Inventário read-only em DEV, medido pelo script inicial: 55 empresas, 44 sem PDV e 4 com múltiplos PDVs. A CIA Marítima tem 0 PDV, 1 Trailer, 27 eventos (4 agendas, 21 ocorrências), 445 comandas com vínculo a Evento e 4 caixas de Evento. O Churrasquinho tem 1 PDV, 1 Trailer, 3 eventos, 3 comandas com vínculo a Evento, 2 caixas de Evento, 192 comandas com vínculo a PDV e 40 caixas de operação. A contagem inicial de comandas por vínculo podia sobrepor origens. O inventário corrigido conta por `Comanda.origem`: Churrasquinho tem 3 de Evento e 189 de Caixa; 3 comandas têm ambos os vínculos e foram listadas separadamente para investigação. Há dados de QA entre as demais empresas; a unicidade global não pode ser aplicada até que cada caso seja reconciliado sem descarte.

## Entregas e ordem de corte

1. Inventariar somente DEV, confirmar empresas, PDVs, trailers, eventos, turnos, comandas, pagamentos, contas, estoque e auditoria. Capturar contagens e somas em centavos por empresa, origem e ocorrência. Resolver registros sem origem comprovada antes da escrita.
2. Criar o modelo de destino com `PontoVenda` único por empresa; configuração explícita; agenda e ocorrência separadas; turno com ocorrência opcional; catálogo, cardápio, categorias e snapshots de venda no PDV. Introduzir constraints e índices em migrações aditivas antes de remover colunas antigas.
3. Adaptar os fluxos de empresa, caixa, comanda, cozinha, portal, pagamento e estoque ao destino. Reutilizar o núcleo Por Caixa. Cada escrita nova deve ter uma única fonte de verdade. Cobrir seleção do cardápio e precedência de preço.
4. Migrar DEV em lotes transacionais reiniciáveis. Preferir o ID de origem quando livre; gravar mapa durável `{tipo, id_origem, id_destino}` somente para IDs alterados. Fazer upsert pelo identificador de origem e conferir payload antes de aceitar repetição. Nunca criar pagamento, saldo ou associação por aproximação.
5. Reconciliar por entidade e por empresa/ocorrência: contagem, valores brutos e líquidos em centavos, pagamentos por forma, dívida original/recebida/pendente, estornos, movimentos de caixa, saldos e movimentos de estoque por unidade, clientes e ranking. Falhas bloqueiam o corte e deixam o lote rastreável.
6. Executar duas vezes em DEV e provar igualdade de contagens e hashes de saída. Testar recuperação após interrupção entre lotes, mantendo os IDs e vínculos. Só então trocar consumidores, remover tabelas e código substituídos em migração de corte e executar regressão funcional completa.

## Condições para corte

- Operação com e sem ocorrência; duas ocorrências da mesma agenda isoladas e seus acumulados mensal/geral corretos; recorrências diferentes isoladas; recortes mensal/geral do PDV e histórico do cliente.
- Taps, estoque e cozinha ligados/desligados; preço, volume, opcionais, preparo, entrega e cancelamento parcial; pagamentos, pendências, estornos e portal.
- Comparações em centavos sem diferença inexplicada. Diferenças e registros órfãos vão a relatório de exceções, não a preenchimento automático.
- Ensaio de restauração e rollback antes do corte destrutivo. Migrations históricas permanecem; nenhuma tabela substituída vazia é aceita como estado final.

`PROD_DEPLOY_REQUIRED: YES` para a implementação futura; esta preparação permanece restrita a DEV.

## Proteção inicial preparada nesta entrega

Exclusão e reversão de Evento passaram a usar a mesma chave `pg_advisory_xact_lock` que a abertura e os movimentos do caixa de Evento. A leitura das sessões, as demais validações e o `DELETE` ficam na mesma transação. O registro de exclusão e a notificação ocorrem somente após o commit. A rota de movimento também confirma o tenant dentro da transação.

A migration `20261003180000_restrict_event_cash_history` troca a FK de `SessaoCaixaEvento.eventoId` de `ON DELETE CASCADE` para `ON DELETE RESTRICT`. Foi criada e validada no schema, **não aplicada**. Após autorização para uma entrega de migração em DEV, verificar antes da aplicação se há referências órfãs, aplicar somente em DEV, consultar `pg_constraint.confdeltype` (`r` para RESTRICT) e repetir os testes de exclusão e concorrência. Ela impede que outro caminho de código apague sessões por cascata; não converte nem remove dados.

Testes read-only em DEV cobrem caixas abertos e fechados, isolamento de tenant, agenda sem caixa, preservação das sessões e ausência de novo registro `EVENTO_EXCLUIDO` no bloqueio. Três rotas aguardaram o mesmo lock em teste concorrente. O DEV observado não tinha `MovimentoCaixaEvento`; a preservação de um movimento real e a corrida de criação de uma primeira sessão contra exclusão ainda não foram comprovadas. Nenhuma migração de dados foi executada.
