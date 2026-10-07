# Matriz de acoes e permissoes individuais do PDV unico

Atualizado em 2026-10-07. Inventario das operacoes atuais de Cervejaria, Evento e Por Caixa/Quiosque. A primeira fatia persiste permissoes por usuario, consulta a autoridade no backend em cada requisicao, edita na tela Funcionarios e protege as rotas financeiras selecionadas. A flag PDV_INDIVIDUAL_PERMISSIONS_ENABLED=1 ativa a lista. Desligada, a politica legada permanece e a coluna aditiva nao e consultada.

## Permissoes implementadas

| Chave | Acao agrupada e dependencias | Aplicacao |
|---|---|---|
| cash.open | Abrir sessao; nao concede leitura de valores | Backend + UI |
| cash.values.read | Ler valores, movimentos e fechamento | Backend + UI; sem ela a sessao e sanitizada |
| cash.movement.write | Suprimento/sangria; corrigir tambem exige cash.values.read | Backend + UI |
| cash.close | Fechar caixa; tambem exige cash.values.read | Backend + UI |
| payment.receive | Receber pagamentos em comandas e vendas | Backend + UI operacional |
| debt.receive | Receber conta pendente | Backend + UI operacional |
| command.close | Fechar comanda; pagamento exige payment.receive | Backend + UI |
| discount.apply | Aplicar desconto; continua condicionado ao booleano legado durante a transicao | Backend + UI |
| command.cancel | Cancelar comanda vazia ou item pelo fluxo de cancelamento legado | Backend + UI para comanda vazia |
| kitchen.cancel + sale.refund | Cancelar pedido pago e confirmar estorno; as duas chaves sao exigidas juntas | Backend |
| dashboard.read | Painel consolidado da cervejaria e painel operacional | Backend + rota/navegacao |
| event.dashboard.read | Painel do evento | Backend + rota/navegacao |
| reports.read | Resumo, relatorios financeiros e exportacao CSV | Backend + rota/navegacao |

O papel persistido DONO recebe todas as chaves. Somente owner da propria empresa edita funcionarios; autoedicao, edicao de owner, tenant cruzado e chaves desconhecidas sao rejeitados. Lista vazia significa nenhuma permissao. Novos funcionarios iniciam vazios. Migration preenche o conjunto observado para atendentes; discount.apply deriva de podeDarDescontoOperacao. Nao ha concessoes implicitas para dependencias.

## Inventario de acoes e caminhos alternativos

| Acao de negocio | Endpoints relevantes | Telas | Regra atual observada | Permissao proposta / estado |
|---|---|---|---|---|
| Abrir caixa | POST /api/operacao/caixa/abrir | Caixa do dia | Atendente podia operar no Por Caixa | cash.open / IMPLEMENTADO |
| Ver valores, registrar movimento, corrigir e fechar caixa | GET /api/operacao/caixa, GET sessoes/:id, POST movimentos, movimentos/:id/corrigir, fechar | Painel caixa, resumo de turno | Atendente via agregado; movimentos eram operacionais | cash.values.read, cash.movement.write, cash.close; dependencias acima / IMPLEMENTADO |
| Lancar itens e consultar comanda | /api/operacao/comandas/* | Comandas e detalhe | Escopo tenant/PDV e regras do turno | Sem chave nova nesta fatia / PENDENTE |
| Fechar, descontar e cancelar comanda; lote | /api/operacao/comandas/:id/{pagamentos,desconto,cancelar}, /api/operacao/comandas/fechar-grupo, /api/comandas/:id/{desconto,cancelar}, /api/pagamentos/comandas/:id/fechar e /fechar-grupo | Comanda, checkout e comandas em lote | Variantes Por Caixa e legadas diferiam; desconto usava booleano legado; cancelar vazio no Por Caixa era owner-only | command.close + payment.receive quando recebe; discount.apply + booleano; command.cancel. Guardas aplicadas tambem nas rotas alternativas e lote / IMPLEMENTADO |
| Venda avulsa e pagamento | POST /api/operacao/vendas; POST /api/vendas-avulsas | Venda avulsa operacional e Evento | Regras de caixa/Evento e desconto legado | payment.receive; desconto tambem requer discount.apply / IMPLEMENTADO |
| Receber divida/conta | POST /api/operacao/contas-pendentes/:id/pagamentos | Contas pendentes | Operacao podia receber | debt.receive / IMPLEMENTADO |
| Estornar venda/pagamento | PATCH cozinha/pedidos/:id/status e confirmar-cancelamento | Cozinha e detalhe do pedido | Sem estorno generico independente; cancelamento de pedido pago pode estornar estoque/venda | kitchen.cancel + sale.refund juntas nesse fluxo; estorno generico nao existe / PARCIAL |
| Transicionar status da cozinha | PATCH cozinha/pedidos/:id/status | Fila TV/cozinha | Transicoes ordinarias disponiveis a cozinha | Sem nova chave; cancelamento exige kitchen.cancel / PARCIAL |
| Entrada, saida e ajuste de estoque | /api/operacao/estoque/* | Estoque | Regras tenant/PDV atuais | inventory.adjust cobrira movimento de estoque agrupado / PENDENTE |
| Produto, preco, disponibilidade, catalogo e cardapio | /api/operacao/produtos/*, /api/produtos/*, /api/cardapio/* | Catalogo e cardapios | Administracao usa regras atuais; operacao consulta catalogo | catalog.manage cobrira produto/preco/cardapio / PENDENTE |
| Buscar, criar e editar clientes | /api/clientes/* | Clientes, checkout e CRM | Regras de tenant/CRM atuais | clients.manage; busca de cliente segue escopo de tenant / PENDENTE |
| Montar TAP, volume e venda | /api/taps/* | Taps e evento | Contexto PDV/sessao e regras atuais | taps.operate cobrira montagem e operacao / PENDENTE |
| Agendas e ocorrencias | /api/operacao/agendas/*, /api/operacao/ocorrencias/* | Agenda operacional | Leitura operacional; escrita owner-only | agenda.manage para operacao de agenda; transicoes de ciclo de vida precisam decisao / PENDENTE |
| Configuracao do tenant, PDV, financeiro e cozinha | /api/cervejaria/* e /api/operacao/configuracao/* | Configuracoes | Owner-only | Manter owner-only; sem nova permissao individual |
| Equipe e permissoes | /api/usuarios/* | Configuracoes > Equipe | Owner administra equipe; desconto era booleano legado | Owner atual + validacao de lista / IMPLEMENTADO |
| Painel consolidado, evento, relatorios, exportacao e realtime | /api/cervejaria/dashboard, /api/operacao/dashboard, /api/eventos/:id/dashboard, /api/relatorios/*, transacoes CSV e Socket.IO join:evento | Dashboards e relatorios | Consolidados/relatorios eram owner-only; atendente podia ver painel de evento; sala realtime transmitia financeiro | dashboard.read, event.dashboard.read, reports.read; sala evento exige cash.values.read / IMPLEMENTADO |

A interface nao mostra seletores para as permissoes pendentes. O catalogo nao cria uma chave por endpoint. As pendencias nesta tabela sao sugestoes de agrupamento e nao autorizam novo item Plane. Ensaio representativo, migracao real, corte e deploy nao foram executados.
