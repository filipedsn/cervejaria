# Medição de sincronização da cozinha

QA focado executado em PostgreSQL descartável com armazenamento tmpfs, app Fastify real, Socket.IO real e dois clientes conectados como sessões independentes. A cozinha acompanhou uma transição de status executada pela outra sessão. Nenhum serviço DEV/PROD ou pedido real foi usado.

## Amostra observada

12 transições alternadas entre `RECEBIDO` e `EM_PREPARO`; cada uma confirmou uma emissão e um recebimento pela sala `cervejaria:<tenant-qa>:cozinha`.

| Trecho | Mediana | p95 | Interpretação |
| --- | ---: | ---: | --- |
| Request HTTP até resposta após commit e emissão | 46,9 ms | 107,12 ms | Inclui autorização, transação e resposta da rota; não separa o tempo interno do commit. |
| Emissão Socket.IO até recebimento pela sessão da cozinha | 2,05 ms | 17,44 ms | Socket.IO local, sem espera pelo polling. |
| Recebimento pelo cliente relativo à resposta HTTP | -0,87 ms | -0,57 ms | Negativo significa que o evento chegou antes da resposta HTTP. |

Resultado: 12/12 eventos entregues, nenhuma espera pelo polling de 20 s e estado persistido correto ao final. O listener real do cliente invalida a query `['operacao-cozinha']` ao receber `operacao:pedido-novo`, `operacao:pedido-atualizado` e ao reconectar. O refetch resultante chama `GET /api/operacao/cozinha?incluirEntregues=true`.

## Revisão do fluxo

- Criação de pedidos operacionais, inclusão de itens, mudança de status e cancelamento emitem somente depois de concluir a transação. A criação faz uma leitura do pedido completo depois do commit antes de emitir.
- Em permissões individuais, a emissão usa a sala da cozinha. A inscrição exige usuário do tenant validado e `kitchen.read`; o modo legado conserva a sala antiga. O teste confirmou a sala e o recebimento por duas sessões.
- Não há debounce/throttle dos eventos da cozinha. A consulta usa polling de 20 s como recuperação, além de invalidação imediata por evento e reconexão.
- A mudança de status grava a resposta confirmada na query cache. A mutação também invalida a query no `onSettled`, enquanto o evento Socket.IO invalida a mesma chave. A amostra de servidor não mede se TanStack Query deduplica esses refetches concorrentes; o request duplicado no navegador e o tempo de renderização/reorganização não foram medidos com sucesso nesta execução.
- O grid protege geometria durante interação e mede novamente ao liberar. Não foi observada uma espera de transporte; nenhuma mudança de timer, polling, protocolo ou layout é justificada por esta amostra.

## Limitação e conclusão

A tentativa de instrumentar a tela em Playwright encontrou somente a cópia oculta do cartão usada pelo medidor de layout; a captura de refetch/renderização não atingiu uma amostra válida. Portanto, este registro não atribui a percepção de lentidão a renderização, não declara uma correção de latência de ponta a ponta e não altera código operacional. Para fechar a medição completa, a próxima amostra precisa observar o cartão visível no viewport operacional e correlacionar recepção do frame, início/fim do GET e atualização do DOM.

Comando reproduzível: `node backend/scripts/run-kitchen-realtime-latency-disposable-qa.mjs`.
