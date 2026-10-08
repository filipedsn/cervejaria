# Matriz de acoes e permissoes individuais do PDV unico

Atualizado em 2026-10-07. Inventario das operacoes atuais de Cervejaria, Evento e Por Caixa/Quiosque. As fatias certificadas persistem permissoes por usuario, consultam a autoridade no backend em cada requisicao, editam a lista na tela Funcionarios e protegem as rotas mapeadas. A flag PDV_INDIVIDUAL_PERMISSIONS_ENABLED=1 ativa a lista. Desligada, a politica legada permanece e a coluna aditiva nao e consultada.

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
| command.item.cancel | Remover item ou reduzir quantidade, incluindo caminhos legados e Por Caixa | Backend + UI |
| command.cancel | Cancelar comanda inteira vazia no fluxo Por Caixa; concessão explícita, sem backfill para atendente | Backend + UI |
| kitchen.cancel + sale.refund | Cancelar pedido pago e confirmar estorno; as duas chaves sao exigidas juntas | Backend |
| dashboard.read | Painel consolidado da cervejaria e painel operacional | Backend + rota/navegacao |
| event.dashboard.read | Painel do evento | Backend + rota/navegacao |
| reports.read | Resumo, relatorios financeiros e exportacao CSV | Backend + rota/navegacao |
| command.read | Consultar filas/listas/detalhes de comandas e pedidos recebidos | Backend + rota/navegacao |
| command.operate | Abrir comandas, incluir itens, aumentar quantidade, aceitar/recusar pedido de cliente e efetuar venda com as permissoes de pagamento requeridas | Backend + rota/navegacao; nao concede consulta, fechamento, pagamento ou cancelamento |
| kitchen.read | Consultar fila e TV da cozinha | Backend + rota/navegacao |
| kitchen.operate | Transicionar preparo, pronto e entrega | Backend + botoes; nao concede cancelamento/estorno |
| inventory.read | Consultar saldos de estoque por PDV | Backend + rota/navegacao |
| inventory.adjust | Entrada, saida, ajuste e inventario manual | Backend + botoes; nao e exigida para efeitos de venda autorizada |
| catalog.manage | Manter produto/preco/disponibilidade, opcionais, cardapio/template e precos do turno | Backend + rota/navegacao; selecao de cardapio na abertura do caixa segue livre |
| clients.manage | Lista e manutencao de clientes administrativos | Backend + rota/navegacao; busca de checkout continua separada |
| taps.operate | Montar, trocar, remover e ativar Tap em evento ou turno | Backend + UI; cadastro/configuracao de Tap continua owner-only |
| agenda.manage | Criar/editar agenda e ocorrencia e gerar ocorrencias | Backend; sem politica de ciclo de vida |
| event.menu.manage | Selecionar/editar cardapio de evento | Backend + UI; separado de catalog.manage |

O papel persistido DONO recebe todas as chaves. Somente owner da propria empresa edita funcionarios; autoedicao, edicao de owner, tenant cruzado e chaves desconhecidas sao rejeitados. Lista vazia significa nenhuma permissao. Novos funcionarios iniciam vazios. Migration preenche para ATENDENTE as chaves cujo acesso anterior estava disponivel por tenant/PDV: operacao e consulta de comanda, cozinha, estoque manual, manutencao comum de cliente, montagem de Tap e cardapio de evento. `discount.apply` deriva de `podeDarDescontoOperacao`. Produto/template de catalogo e agenda, antes owner-only, nao recebem concessao automatica. Cancelar item, cancelar comanda, cancelamento/estorno e recebimento/fechamento permanecem em chaves separadas.

## Inventario de acoes e caminhos alternativos

| Acao de negocio | Endpoints relevantes | Telas | Regra atual observada | Permissao proposta / estado |
|---|---|---|---|---|
| Abrir caixa | POST /api/operacao/caixa/abrir | Caixa do dia | Atendente podia operar no Por Caixa | cash.open / IMPLEMENTADO |
| Ver valores, registrar movimento, corrigir e fechar caixa | GET /api/operacao/caixa, GET sessoes/:id, POST movimentos, movimentos/:id/corrigir, fechar | Painel caixa, resumo de turno | Atendente via agregado; movimentos eram operacionais | cash.values.read, cash.movement.write, cash.close; dependencias acima / IMPLEMENTADO |
| Consultar comandas e pedidos | GET /api/operacao/comandas/*, GET /api/comandas/*, GET /api/pedidos/eventos/:eventoId/pedidos | Listas, detalhe e caixa de entrada | Escopo tenant/PDV e regras do turno | `command.read` / PROTEGIDA; migration preserva consulta existente |
| Abrir comanda, lancar/incluir itens, aumentar quantidade e aceitar/recusar pedido | POST /api/operacao/comandas/*, /api/comandas/*, /api/pedidos/:id/{confirmar,recusar}; vendas autenticadas | Comandas, Por Caixa, Evento, pedidos recebidos e venda avulsa | Operacao por tenant/PDV | `command.operate`; venda paga tambem requer `payment.receive`; desconto permanece `discount.apply`; efeitos automaticos de estoque nao exigem `inventory.adjust` / PROTEGIDA; backfill para atendentes |
| Fechar, descontar e cancelar comanda inteira; lote | /api/operacao/comandas/:id/{pagamentos,desconto,cancelar}, /api/operacao/comandas/fechar-grupo, /api/comandas/:id/{desconto,cancelar}, /api/pagamentos/comandas/:id/fechar e /fechar-grupo | Comanda, checkout e comandas em lote | Cancelamento integral vazio no Por Caixa era owner-only | command.close + payment.receive quando recebe; discount.apply + booleano; command.cancel só para autoridade explicitamente concedida / IMPLEMENTADO |
| Remover item ou reduzir quantidade | DELETE /api/comandas/:id/itens/:itemId; DELETE/PATCH /api/operacao/comandas/:id/itens/:itemId | Detalhe de comanda | Remoção de item existia para atendente; redução parcial também cancela parte da venda | command.item.cancel; redução validada contra quantidade atual sob locks/transação / IMPLEMENTADO |
| Venda avulsa e pagamento | POST /api/operacao/vendas; POST /api/vendas-avulsas | Venda avulsa operacional e Evento | Regras de caixa/Evento e desconto legado | payment.receive; desconto tambem requer discount.apply / IMPLEMENTADO |
| Caixa de Evento: ler/abrir/movimentos/fechar | GET/POST /api/eventos/:id/caixa/* | Caixa de Evento | Rota alternativa de Evento não recebia as guardas da rota Por Caixa | Leitura sem valores sanitizada; cash.open, cash.movement.write; cash.close + cash.values.read / IMPLEMENTADO |
| Receber divida/conta | GET/POST /api/operacao/contas-pendentes/* e /api/eventos/:id/contas-pendentes/* | Contas pendentes | Leitura e recebimento precisam da mesma autoridade | debt.receive / IMPLEMENTADO |
| Estornar venda/pagamento | PATCH cozinha/pedidos/:id/status e confirmar-cancelamento | Cozinha e detalhe do pedido | Sem estorno generico independente; cancelamento de pedido pago pode estornar estoque/venda | kitchen.cancel + sale.refund juntas nesse fluxo; estorno generico nao existe / PARCIAL |
| Consultar fila/TV e avancar preparo/entrega | GET cozinha; PATCH status ordinaries | Fila e TV | Leitura e transicao estavam abertas no modulo autenticado | `kitchen.read` e `kitchen.operate` separados; cancelamento/estorno especificos / PROTEGIDA; migration preserva atendentes |
| Consultar estoque e movimentacao manual | GET e POST entrada/saida/ajuste `/api/operacao/estoque/*` | Estoque | Regras de tenant/PDV | `inventory.read` e `inventory.adjust` separados; efeito automatico de venda fora do ajuste manual / PROTEGIDA; migration preserva atendentes |
| Minimo/alerta de estoque | PUT `/api/operacao/estoque/minimo` | Cadastro de estoque | Owner-only | Continua EXCLUSIVA DO DONO |
| Produto, preco, disponibilidade, opcionais, cardapio/template e preco do turno | `/api/operacao/produtos/*`, `/api/produtos/*`, `/api/cardapios/*`, `/api/operacao/cardapios/*`, `/api/operacao/caixa/cardapio*` | Catalogo, turno e cardapios | Produto/template eram owner-only; consulta/leitura tem consumidores de venda | `catalog.manage` em manutencao; explicitamente concedivel, sem backfill; selecao na abertura de caixa continua sem chave / PROTEGIDA |
| Menu particular de evento | POST evento com cardapio, PUT `/api/eventos/:id/cardapio` | Evento e cardapio | Acesso anterior por tenant | `event.menu.manage`, backfill para atendentes; separado de manutencao de produto / PROTEGIDA |
| Buscar/identificar cliente no checkout; portal autenticado | `/api/clientes/find-or-create`, `/api/public/*` e `/api/cliente/*` | Checkout e portal do cliente | Fluxo de venda autenticado | FORA DO ESCOPO destas permissoes; permanece acessivel nos contratos de venda/portal |
| Lista e manutencao administrativa de clientes | GET/POST/PATCH `/api/clientes/*` | Clientes/CRM | CRUD comum por tenant; merge/exclusao eram owner-only | `clients.manage` para CRUD comum, backfill; merge e exclusao continuam EXCLUSIVAS DO DONO |
| Montar/trocar/remover/ativar Tap em evento ou turno | `/api/eventos/:id/taps/*`, `/api/operacao/caixa/taps/*` | Evento e caixa | Operacao aberta por tenant/PDV | `taps.operate`, backfill para atendentes / PROTEGIDA |
| Cadastrar/editar/excluir Tap e trailer | `/api/taps/*` | Configuracao | Owner-only | Continua EXCLUSIVA DO DONO |
| Consultar agendas/ocorrencias existentes | GET `/api/operacao/agendas/ocorrencias` | Agenda operacional | Leitura por tenant/PDV | FORA DO ESCOPO da permissao de escrita |
| Manter agendas/ocorrencias e gerar ocorrencias | POST/PATCH agendas/ocorrencias/gerar | Agenda operacional | Owner-only | `agenda.manage` explicitamente concedivel; sem backfill / PROTEGIDA; sem novas transicoes de status |
| Configuracao do tenant, PDV, financeiro e cozinha | /api/cervejaria/* e /api/operacao/configuracao/* | Configuracoes | Owner-only | Manter owner-only; sem nova permissao individual |
| Equipe e permissoes | /api/usuarios/* | Configuracoes > Equipe | Owner administra equipe; desconto era booleano legado | Owner atual + validacao de lista / IMPLEMENTADO |
| Painel consolidado, evento, relatorios, exportacao e realtime | /api/cervejaria/dashboard, /api/operacao/dashboard, /api/eventos/:id/dashboard, /api/relatorios/*, transacoes CSV e Socket.IO join:evento/join:cervejaria/leave:evento | Dashboards e relatorios | Salas legadas eram emitidas sem sufixo quando a flag estava desligada; salas financeiras/operacionais separam projeções quando ligada. `resumoPedidoCozinha` publica `itens`, enquanto a projeção operacional precisava manter o contrato frontend `itensComanda`. | Chaves dashboard.read, event.dashboard.read, reports.read e cash.values.read; salas legadas/split, projeção de itens/opcionais sem valores e reconciliação no mesmo socket / IMPLEMENTADO; certificado em `b06e09b2d0972b988863507dbe55dc42bbb1f8a6` |

A interface mostra seletores para as chaves protegidas, e a API permanece autoridade. Acoes owner-only e fora de escopo estao justificadas acima. O catalogo nao cria uma chave por endpoint. A matriz continua delimitada as acoes mapeadas: qualquer caminho ainda sem politica testada deve ser marcado NAO COMPROVADA; nao declara RBAC global completo. Ensaio representativo, migracao real, corte e deploy nao foram executados.

## Certificacao da extensao dos modulos

Commit de codigo/testes `8eca66cf376043228a76e754a0214b18f09ea07e`; cadeia Git exata e PostgreSQL descartavel PASS. A evidencia detalhada esta em [`pdv-unico-module-permissions-qa-evidence.json`](../testing/pdv-unico-module-permissions-qa-evidence.json) e o manifesto em [`pdv-individual-permissions-qa-manifest.json`](../testing/pdv-individual-permissions-qa-manifest.json). Playwright isolado confirmou seletores independentes de consulta/operacao de comandas; a simulacao nao percorreu todos os botoes de cada modulo. Portanto, a API das acoes listadas esta protegida, mas a cobertura visual de cada consumidor segue `NAO COMPROVADA`. `command.item.cancel`/fechamento/pagamento/estorno continuam em chaves preexistentes. A migration concede somente operacoes cujo acesso de atendente ja estava disponivel; catalogo e agenda continuam sem concessao automatica. TAP-76 segue In Progress.
