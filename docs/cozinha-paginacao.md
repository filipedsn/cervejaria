# Cozinha em telas com paginação

A regressão vinha de três pontos: `auto-fit` recalculava as colunas usando somente os cartões da página visível e esticava o cartão solitário da última página; os cartões de TV mostravam apenas o primeiro item e recortavam observações; e uma interação interrompida ao perder foco podia manter a medição pausada. A medição também montava cópias completas dos cartões para cada item, incluindo conteúdo e temporizadores desnecessários.

## Comportamento

- A API e a tela ordenam a fila por `createdAt` crescente e usam o ID como desempate estável. A lista visual exclui pedidos entregues e cancelados, respeitando o filtro ativo.
- `auto-fill` reserva a mesma largura de coluna em todas as páginas. O paginador mede a altura real com a largura útil do viewport, orientação e perfil ativos; pedidos altos viram continuações por item quando necessário. Ao remover um pedido, a fila é recomposta na ordem original e a página atual é limitada ao total existente.
- Cartões exibem todos os itens, opcionais e observações sem truncar silenciosamente. Continuações mostram sua parte, preservam o número total de pedidos e mantêm a ação de preparo no pedido inteiro. A medição só cria cópias individuais quando um pedido excede a altura disponível.
- A medição não rearranja cartões durante toque, formulário, diálogo ou ação pendente. Pointer up/cancel, perda de captura, perda de foco e retorno da aba liberam uma interação interrompida. A atualização mantém os cartões sob o dedo e o aviso de novos pedidos sem mudar a página atual.
- O modo TV percorre páginas em intervalo fixo, pausa com a aba oculta ou durante interação e retoma ao voltar. O modo operacional/tablet tem navegação manual.
- O resumo mostra o primeiro item e os complementos. Detalhes apresentam um item por parte, incluindo complementos e observações do item e do pedido; as ações de preparo continuam ligadas ao pedido inteiro.
- Perfil visual e intervalo ficam em Configurações → PDV → Cozinha. O armazenamento local é separado por tenant, usuário e identificador deste navegador; não guarda permissões.

## Verificação

Playwright usa APIs simuladas e fixtures descartáveis em memória. A regressão de chegada/reconexão usa o cliente Socket.IO do frontend conectado a um servidor Socket.IO local real. Nenhuma ação de teste é enviada à fila de clientes. A suíte cobre tablet horizontal (1180×820), tablet vertical (820×1180), TV (1920×1080), três páginas, dimensões/overflow, conteúdo extenso, compactação, chegada durante ação, retomada após ocultar a aba, navegação manual, desaparecimento da última página e isolamento de preferência visual.

Capturas revisadas das três páginas em tablet horizontal e TV estão em `artifacts/kitchen-pagination/regression-after/`. As capturas anteriores que reproduzem largura variável e informações ocultas estão em `artifacts/kitchen-pagination/regression-before/`.
