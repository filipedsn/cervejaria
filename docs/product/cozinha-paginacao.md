# Cozinha em telas com paginação

A página extra aparecia porque a grade de medição esticava todos os cartões de uma linha até a altura do maior cartão. O algoritmo recebia alturas iguais para os cartões curtos e concluía que a próxima coluna estava cheia, embora houvesse espaço real abaixo deles. A grade oculta agora mede cada cartão com altura independente. O empacotamento usa essa geometria real por coluna.

## Comportamento

- A API e a tela ordenam a fila por `createdAt` crescente e usam o ID como desempate estável. A lista visual exclui pedidos entregues e cancelados, respeitando o filtro ativo.
- `auto-fill` reserva a mesma largura de coluna em todas as páginas. O paginador mede a altura real de cada cartão e distribui pedidos em colunas independentes, na ordem da fila. Quando o próximo cartão não cabe em nenhuma coluna disponível, inicia outra página. A escolha entre colunas igualmente livres é determinística.
- Pedidos altos viram continuações por item quando necessário. Ao adicionar ou remover pedidos, a fila é recomposta pela ordem de chegada e a página atual é limitada ao total existente.
- Cartões exibem todos os itens, opcionais e observações sem truncar silenciosamente. Continuações mostram sua parte, preservam o número total de pedidos e mantêm a ação de preparo no pedido inteiro. A medição só cria cópias individuais quando um pedido excede a altura disponível.
- A medição não rearranja cartões durante toque, formulário, diálogo ou ação pendente. Pointer up/cancel, perda de captura, perda de foco e retorno da aba liberam uma interação interrompida. A atualização mantém os cartões sob o dedo e o aviso de novos pedidos sem mudar a página atual.
- TV, tablet e modo operacional usam navegação manual. Novos pedidos, atualizações, reconexão e passagem do tempo não trocam a página. Com uma página, os botões de navegação não são exibidos.
- Configurações → PDV → Cozinha mantém apenas os perfis visuais. Intervalos antigos no armazenamento local são descartados ao ler a preferência; não guardam nem restauram timers. O perfil continua isolado por tenant, usuário e dispositivo, sem permissões.

## Verificação

Playwright usa APIs simuladas e fixtures descartáveis em memória. A regressão de chegada/reconexão usa o cliente Socket.IO do frontend conectado a um servidor Socket.IO local real. Nenhuma ação de teste é enviada à fila de clientes. O cenário de masonry usa o mesmo viewport 1440×900 antes e depois, com um pedido de três itens e cinco curtos; assertivas comparam as posições, alturas, larguras, limites e sobreposição dos seis elementos. A suíte cobre tablet horizontal/vertical, TV, pedidos extensos, compactação, atualização/reconexão sem deslocamento, navegação manual e preferência local sem intervalo.

Capturas antes/depois do caso de seis pedidos (1440×900) estão em `artifacts/kitchen-pagination/masonry-before/` e `artifacts/kitchen-pagination/masonry-after/`. As capturas das três páginas em tablet horizontal, tablet vertical e TV estão em `artifacts/kitchen-pagination/regression-after/`.
