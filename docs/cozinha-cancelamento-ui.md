# Feedback de cancelamento na cozinha

## Comportamento

A comanda mostra o estado do cancelamento no próprio item. Ao solicitar o cancelamento de item que já foi enviado à cozinha, o selo `Cancelamento solicitado` continua visível até a confirmação da cozinha; a tela não mantém uma faixa de sucesso separada.

Na cozinha, erros de confirmação de item e avisos de sincronização aparecem como notificações compactas sobre a tela, identificando o item ou a sessão concorrente. Essas notificações não ocupam espaço no fluxo da grade. Erros de preparo continuam no aviso geral existente. Erros das ações de cancelar pedido ficam na confirmação ou na notificação associada ao pedido.

## Concorrência e efeitos

A cozinha pode exibir um estado válido no momento do último carregamento que fique obsoleto quando outra sessão confirma o cancelamento. O backend responde `409` se a confirmação já foi feita. A interface então recarrega a fila: se o item já não estiver pendente, informa que a outra sessão confirmou e deixa a fila sincronizada; se ainda estiver pendente, preserva o erro junto à ação.

O backend segue responsável pelas permissões e pela validação. A solicitação do cancelamento bloqueia os itens da comanda e confere novamente o estado antes de aplicar o estorno de estoque. A confirmação também bloqueia e confere novamente o estado antes de gravar `canceladoEm`; uma confirmação concorrente não reaplica estoque ou estorno. A paginação e o feedback visual não alteram dados operacionais.

## Verificação focada

`e2e/current-model/kitchen-cancellation-feedback.spec.ts` cobre a retirada da faixa na comanda, a confirmação em outra sessão, erro real sem deslocamento da grade e duplo toque com uma única gravação simulada. Esses testes usam respostas de API simuladas e não criam pedidos nem executam efeitos operacionais reais.
