# Cozinha em telas com paginação

A tela anterior mantinha todos os pedidos em uma única grade rolável, com colunas fixas e cartões de altura variável. Em TVs e tablets, isso desperdiçava a área livre da tela e escondia pedidos abaixo da dobra; reduzir o tamanho dos textos ou recortar os cartões também escondia informações de preparo.

## Comportamento

- A API e a tela ordenam a fila por `createdAt` crescente e usam o ID como desempate estável. A lista visual exclui pedidos entregues e cancelados, respeitando o filtro ativo.
- O paginador mede a altura real dos cartões, a largura útil, a orientação e o número de colunas; usa linhas inteiras e mantém a ordem ao compactar. O cartão seguinte preenche a página assim que couber. A página atual é limitada ao total existente.
- A medição não rearranja cartões enquanto existe toque/foco, diálogo ou ação pendente. O aviso de novos pedidos permanece no cabeçalho e não muda a página atual.
- O modo TV percorre páginas em intervalo fixo, pausa com a aba oculta ou durante interação e retoma ao voltar. O modo operacional/tablet tem navegação manual.
- O resumo mostra o primeiro item e os complementos. Detalhes apresentam um item por parte, incluindo complementos e observações do item e do pedido; as ações de preparo continuam ligadas ao pedido inteiro.
- Perfil visual e intervalo ficam em Configurações → PDV → Cozinha. O armazenamento local é separado por tenant, usuário e identificador deste navegador; não guarda permissões.

## Verificação

Playwright usa respostas de API simuladas e fixtures descartáveis em memória. Nenhuma ação de teste é enviada para a fila de clientes. O cenário cobre tablet horizontal (1180×820), tablet vertical (820×1180), TV (1920×1080), três páginas, overflow de viewport, detalhes, compactação, chegada durante ação, retorno após ocultar a aba, navegação manual, desaparecimento da última página e isolamento da preferência visual.

Capturas das três páginas para cada formato estão em `artifacts/kitchen-pagination/`.
