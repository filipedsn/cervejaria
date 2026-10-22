# Cozinha em telas com scroll vertical

A fila da cozinha (TV e modo operacional) usa uma grade CSS contínua com scroll vertical manual. Não há paginação nem rotação automática.

## Comportamento

- A API e a tela ordenam a fila por `createdAt` crescente e usam o ID como desempate estável. A lista visual exclui pedidos entregues e cancelados, respeitando o filtro ativo.
- `auto-fill` reserva faixas de coluna (`--cozinha-card-min` / `--cozinha-card-max`). Todos os cartões da fila ficam no DOM; o grid rola com `overflow-y: auto`, `touch-action: pan-y` e `overscroll-behavior-y: contain`.
- Pedidos altos crescem no fluxo; o usuário rola a lista para ver o restante. Não há split em “continuações” por página.
- Cartões exibem todos os itens, opcionais e observações sem truncar silenciosamente.
- Durante toque, formulário, diálogo ou ação pendente, a posição de scroll (`scrollTop`) é preservada para não deslocar o cartão sob o dedo quando a fila atualiza.
- TV, tablet e modo operacional usam apenas scroll manual. Novos pedidos, atualizações, reconexão e passagem do tempo não alteram a página (não há páginas) nem forçam scroll.
- A barra inferior mostra a contagem (`N pedidos` + rótulo do filtro), sem botões Anterior/Próxima.
- Configurações → PDV → Cozinha mantém apenas os perfis visuais. Intervalos antigos no armazenamento local são descartados ao ler a preferência. O perfil continua isolado por tenant, usuário e dispositivo.

## Verificação

Playwright usa APIs simuladas e fixtures descartáveis em memória. A regressão de chegada/reconexão usa o cliente Socket.IO do frontend conectado a um servidor Socket.IO local real. A suíte cobre tablet horizontal/vertical, TV, pedidos extensos, compactação, atualização/reconexão sem deslocar o scroll, preferência local sem intervalo e contagem na barra.
