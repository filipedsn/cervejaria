# PDV único: contrato e migração em DEV

Estado: implementação em andamento. Este documento não autoriza execução em PROD nem certifica a migração.

## Modelo alvo e propostas pendentes

- Uma empresa tem exatamente um PDV. Criar empresa, PDV e configuração em uma transação; `PontoVenda.cervejariaId` terá unicidade no banco após reconciliar duplicados em DEV.
- O núcleo Por Caixa é o fluxo operacional único. Agenda e ocorrência são metadados opcionais do turno. Os itens de venda devem preservar sua origem, mesmo se a agenda for alterada ou uma dívida for recebida depois.
- Propostas pendentes de aprovação formal do produto: portal lançar diretamente; pontuar ranking após entrega, excluindo cancelados/estornados e mantendo dívida; escolher ocorrência na abertura do caixa, sem transferência posterior. Nenhuma delas é aceite implementado.
- Preço: ajuste do turno, depois preço do cardápio, depois preço padrão do produto. Item vendido guarda preço, volume, categoria e medida aplicados no momento da venda.
- Cliente é único no PDV. A origem é uma dimensão do histórico, não uma identidade separada.

## Baseline, commits e fatos pendentes

Baseline anterior a preparacao: `66ec008`. A solicitacao inicial em `cca17e2` chegou com 31 arquivos locais previamente modificados; essas alteracoes foram preservadas. `e9fa363` adicionou serializacao transacional e FK restritiva. `76569b5` corrigiu auditoria para manter o ID historico em `entidadeId`/metadados sem FK para Evento removido e persistir o log na mesma transacao. `76569b5` e o HEAD de entrada, nao esta entrega. Esta revisao e o commit seguinte na linha principal; seu SHA fica registrado no TAP-76.

Fatos fornecidos pelo usuario: portal com lancamento direto, pontuacao apos entrega e escolha de ocorrencia na abertura foram explicitamente classificados como propostas pendentes. Este documento nao os trata como regra aprovada. Nenhuma migracao de dados de negocio foi executada; tabelas antigas permanecem.

## Fotografia read-only de DEV em 03/10/2026

A medicao foi feita em transacao PostgreSQL `RepeatableRead` e `READ ONLY` no destino DEV local autorizado. O guard valida parsing da URL, host/porta e nome exato `cervejaria_dev` antes de importar o modulo que instancia Prisma. A saida nao inclui credenciais, nomes de clientes ou contato pessoal.

Totais medidos: 55 empresas; 44 sem PDV; 4 com mais de um PDV; 31 associacoes bloqueadas pelo planejador; 0 comandas sem evento/PDV; 0 comandos com divergencia de tenant e 0 pagamentos com referencia de sessao ausente/dupla. O mapa completo por ID pode ser refeito com `backend/scripts/inventory-pdv-unico-dev.ts --detail` (ou `--all` para todas as empresas); nao cria destino nem grava dados.

CIA Maritima (`cmr9yis3c0000hvu00q9fe7y1`): 0 PDVs, 1 trailer, configuracao operacional taps=true/estoque=false/cozinha=false e configuracao do modulo Operacao ausente; 4 agendas, 21 ocorrencias, 2 eventos avulsos, 11 produtos, 1 cardapio, 5 taps e 123 montagens. Ha 445 comandas de origem EVENTO: 433 FECHADA com total persistido de 2.204.000 centavos, 11 CANCELADA e 1 ABERTA. Pagamentos somam 2.202.500 centavos e uma conta a receber EVENTO mantem saldo de 1.500 centavos: o total fecha exatamente, mas a divida continua BLOQUEADA para associacao automatica por ter origem EVENTO. Ha 4 caixas de Evento (1 aberto, 3 fechados), sem movimento; nenhuma sessao operacional.

Churrasquinho do Thiago (`cmsry9xrn0000hvlgopjxy0oo`): 1 PDV (`cmsry9xry0004hvlge0wgboza`) preservado, 1 trailer, 34 produtos, 5 cardapios, 4 taps. Flags explicitas directSales=true/taps=false/estoque=true/cozinha=true conflitam com fallback do modulo Operacao ativo/controlaEstoque=false/temCozinha=false/exclusivo=true, exigindo decisao antes de consolidar configuracao. Ha 1 agenda, 1 ocorrencia e 1 evento avulso. Comandas: 166 CAIXA FECHADA (1.378.700 centavos), 22 CAIXA CANCELADA, 1 CAIXA ABERTA e 3 EVENTO FECHADA (10.300 centavos). Recebimentos CAIXA por forma somam os mesmos 1.378.700 centavos; pagamentos EVENTO somam 10.300 centavos. Cinco dividas somam 19.000 centavos de origem, recebimentos 19.000 e saldo zero. Ha 40 sessoes operacionais (4 abertas) e 2 de Evento (fechadas), sem movimentos. Estoque tem 31 saldos por produto e 756 movimentos; os detalhes preservam Decimal em milesimos por produto/unidade, sem somar unidades incompativeis. Tres comandas de origem EVENTO tem simultaneamente `eventoId` e `pontoVendaId`; ficam para investigacao (o vinculo pode servir ao estoque), nao sao classificadas como corrupcao.

Totais de comanda representam consumo/venda por dia operacional ou data do evento. Pagamentos sao recebimentos por `pagoEm`; os eixos permanecem separados. As consultas detalhadas mantem valores negativos/cancelados e permitem conciliacao por entidade, origem, estado e datas correspondentes; nao ha afirmacao de reconciliacao global fora dos valores explicitamente comparados acima.

Os 31 bloqueios globais incluem quatro empresas com multiplos PDVs, empresas sem destino unico, a divida EVENTO da CIA e os tres vinculos duplos do Churrasquinho. A migracao nao pode escolher unidade pelo nome nem consolidar esses registros. Os papeis/propostas vieram do usuario; as contagens sao fatos medidos em DEV.

## Regras deterministicas source-to-target

Cada linha do mapa tem tipo/ID de origem, acao, destino sugerido e evidencia. O planejador puro nao escreve no banco. `MANTER` preserva ID/vinculo valido; `CRIAR_DESTINO` e somente proposta (empresa sem PDV e exatamente um trailer); `REASSOCIAR` exige vinculo explicito e unico; `BLOQUEADO` exige reconciliacao humana. IDs repetidos permanecem deterministas e ordenados. Eventos usam `trailerId` e preservam `serieId`, ID de ocorrencia e evento avulso. Comandas sao classificadas por `Comanda.origem`; FKs sao validados contra tenant. Pagamentos permanecem ligados a comanda e sua origem; conta preserva valor original e recebimentos tardios. Saldos/movimentos de estoque permanecem no ID de PDV/produto e Decimal/unidade original.

Antes do futuro migrador, exportar fotografia e mapa com hash; em cada lote transacional usar chave de origem estavel, upsert e comparacao de payload; persistir checkpoint/mapa junto ao lote; reconciliar centavos e quantidades exatas; retomar do ultimo lote confirmado. Divergencia, tenant cruzado, referencia ausente ou payload diferente bloqueia o lote, sem inventar pagamento, saldo, vinculo ou associacao.
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

A migration `20261003180000_restrict_event_cash_history` troca a FK de `SessaoCaixaEvento.eventoId` de `ON DELETE CASCADE` para `ON DELETE RESTRICT`. O ensaio copiou migrations válidas para um diretório temporário, implantou o baseline em container PostgreSQL QA descartável, inseriu sessão e movimento e usou `prisma migrate deploy` para aplicar e registrar a migration; **não foi aplicada em DEV compartilhado nem PROD**. Após autorização para uma entrega de migração em DEV, verificar antes da aplicação se há referências órfãs, aplicar somente em DEV, consultar `pg_constraint.confdeltype` (`r` para RESTRICT) e repetir os testes de exclusão e concorrência. Ela impede que outro caminho de código apague sessões por cascata; não converte nem remove dados.

O executor `backend/scripts/run-isolated-qa.mjs test` requer `PDV_ISOLATED_QA=1`, URL exata `127.0.0.1:55439/cervejaria_qa_pdv_unico` e banco isolado vazio. Ele aplica migrations baseline no container QA, insere sessão/movimento sintéticos, executa o SQL restritivo em transação e depois testa as rotas com fixtures isoladas. O harness não registra essa migration como aplicada em um banco compartilhado. A validação de login/RBAC real não faz parte dessa prova.

O teste de FK preservou IDs e valores de sessão/movimento anteriores à alteração, bloqueou DELETE direto de Evento com caixa, permitiu DELETE sem caixa e conferiu `pg_constraint.confdeltype='r'`. Os testes de rota passaram para Evento ABERTO com caixa aberto/fechado, bloqueio de tenant, regras anteriores, logs pós-commit, rollback e as quatro ordens de corrida com barreiras PostgreSQL. A migração de negócio e a reconciliação de dados permanecem não executadas.
