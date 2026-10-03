# PDV único: contrato e migração em DEV

Estado: implementação em andamento. Este documento não autoriza execução em PROD nem certifica a migração.

## Contrato aprovado em 03/10/2026

- Uma empresa tem exatamente um PDV. Criar empresa, PDV e configuração em uma transação; `PontoVenda.cervejariaId` terá unicidade no banco após reconciliar duplicados em DEV.
- O núcleo Por Caixa é o fluxo operacional único. Agenda e ocorrência são metadados opcionais do turno. A ocorrência é escolhida na abertura; itens de venda preservam sua origem, mesmo se a agenda for alterada ou uma dívida for recebida depois.
- Portal lança consumo diretamente na comanda. O ranking usa itens entregues, exclui cancelados e estornados e conserva consumo ainda não pago.
- Preço: ajuste do turno, depois preço do cardápio, depois preço padrão do produto. Item vendido guarda preço, volume, categoria e medida aplicados no momento da venda.
- Cliente é único no PDV. A origem é uma dimensão do histórico, não uma identidade separada.

## Estado do código em 03/10/2026

HEAD `66ec008`; 31 arquivos modificados antes deste trabalho, além de arquivos não versionados. O schema ainda possui `Trailer`, `SessaoCaixaEvento`, `MovimentoCaixaEvento`, `EventoProduto`, modos `CAIXA/EVENTO`, catálogo e ranking específicos de evento. `PontoVenda.cervejariaId` não é único. Existem `Cardapio` e `CardapioProduto` reutilizáveis, mas categoria continua texto em `Produto`.

As identidades Churrasquinho do Thiago e CIA Marítima foram confirmadas por consulta read-only ao banco DEV. A escrita futura deve usar IDs e vínculos verificados, nunca apenas nomes.

Inventário read-only em DEV: 55 empresas, 44 sem PDV e 4 com múltiplos PDVs. A CIA Marítima tem 0 PDV, 1 Trailer, 27 eventos (4 agendas, 21 ocorrências), 445 comandas de Evento e 4 caixas de Evento. O Churrasquinho tem 1 PDV, 1 Trailer, 3 eventos, 3 comandas de Evento, 2 caixas de Evento, 192 comandas de Caixa e 40 caixas de operação. Há dados de QA entre as demais empresas; a unicidade global não pode ser aplicada até que cada caso seja reconciliado sem descarte.

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
