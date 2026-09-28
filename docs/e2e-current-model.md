# E2E — modelo operacional atual

O comando canônico para validar o modelo atual é `npm run test:e2e:current`. Ele usa o projeto Playwright isolado `playwright.current.config.ts`, não depende do `auth.setup.ts` global nem dos usuários `qa-cfg-*`, e cria empresas sintéticas pelo endpoint atual `/api/admin/cervejarias/provision`. Os recursos operacionais (ponto de venda, trailer, produtos, taps e saldos) são criados explicitamente pelos endpoints vigentes. A execução é protegida contra alvo de produção.

## Cobertura implementada

- Matriz 2 modos (CAIXA/EVENTO) × taps × estoque × cozinha (16 combinações), verificando configuração persistida, controles de navegação e bloqueio/liberação dos endpoints de estoque e cozinha.
- Venda autenticada com usuário real ATENDENTE em CAIXA e EVENTO: porção com opcional e observações, chope 300 ml associado ao tap, preços 300/500/700 ml expostos, baixa de estoque de unidade e de litros, cozinha com bloqueio de pagamento até entrega e pagamento dividido entre dinheiro, PIX, débito e crédito.
- Portal de cliente por QR de ponto de venda (CAIXA): cria sessão pública, lança chope 500 ml, verifica saldo, registra pagamento e reconcilia no fechamento do caixa.
- Portal do cliente por evento: lista as três medidas disponíveis, cria pedido pendente, confirma como atendente, verifica que o estoque só baixa na confirmação, fecha a comanda e confere receita e formas de pagamento no resumo executivo.
- CAIXA: conta integral pendente com cliente/telefone, recebimento posterior, saldo quitado e fechamento com conciliação por meio de pagamento.
- Toda a massa é sintética; cada empresa é desativada no `afterAll`. A suíte não acessa nem altera produção.
- No fluxo EVENTO, confirma ainda o registro persistido das transações de criação do evento, pedido pelo portal, itens, pagamento/fechamento da comanda e fechamento do evento. WhatsApp é testado em navegador com `wa.me` interceptado, sem disparo externo.

## Fronteiras ainda não certificadas

Esta reconstrução é deliberadamente incremental. A suíte atual ainda não certifica venda efetiva de 700 ml e seu efeito no estoque, cancelamento/estorno de estoque, vendas avulsas, concorrência/idempotência, isolamento entre empresas nem cobertura de observabilidade por transação para todo o fluxo CAIXA e suas métricas/logs externos. Esses casos devem ser adicionados como cenários atuais explícitos antes de declarar a certificação E2E completa; testes históricos/legados não contam como evidência para eles.

`npm run test:e2e` e `npm run test:e2e:current` agora executam o gate canônico atual; `npm run test:e2e:compat` mantém os testes históricos disponíveis em separado. Os testes de `e2e/` fora de `e2e/current-model/` não contam como evidência do novo modelo. Não foram removidos nem alterados por esta reconstrução.
