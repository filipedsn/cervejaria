# QA do cancelamento concorrente da cozinha

Este QA usa o fluxo HTTP registrado por `buildApp` e um PostgreSQL 17 descartável em contêiner, com o diretório de dados em tmpfs e porta publicada somente em `127.0.0.1`. A URL é validada pelo guarda de QA isolado; o processo remove variáveis de banco e de PROD herdadas antes de iniciar o app. A estrutura vazia é preparada com `prisma db push --skip-generate` usando o schema já commitado. Isso só provisiona o banco efêmero para os testes e não executa QA de migração.

Execute em `backend`:

```powershell
npm run qa:kitchen-cancellation-disposable
```

## Resultado do ensaio

- Duas requisições `PATCH` de sessões autenticadas diferentes chegaram simultaneamente ao advisory lock da comanda. O teste consultou `pg_stat_activity` e observou as duas aguardando o lock antes de liberá-lo. O resultado foi um `200` e um `409` com a mensagem específica de cancelamento já confirmado; o segundo fluxo havia carregado o estado pendente antes da espera.
- O estado inicial era item ativo, pedido `RECEBIDO`, comanda aberta em R$ 25, saldo 4, um movimento `SAIDA_VENDA`, nenhum pagamento, movimento de caixa ou log transacional. O pedido sintético é preparado como uma venda já lançada; não representa pedido de cliente.
- A solicitação de cancelamento gerou o selo pendente e um único `ESTORNO_VENDA`, elevando o saldo de 4 para 5. A confirmação concorrente marcou o item como cancelado, o pedido como `CANCELADO` e recalculou a comanda para R$ 0, sem novo movimento de estoque, pagamento, estorno financeiro ou movimento de caixa. Retry retornou `409` e preservou exatamente o mesmo estado.
- Um usuário sem permissão recebeu `403`; um usuário de outro tenant recebeu `404`; e confirmar item sem cancelamento pendente recebeu o `409` específico. Nos três casos, item/pedido/comanda, pagamentos, saldo, movimentos e logs transacionais permaneceram sem alterações.
- Os hooks HTTP emitiram eventos de auditoria para as mutações e recusas. O fluxo não cria `TransacaoLog`; o contador persistido permaneceu em zero, sem duplicação. Os eventos HTTP do ensaio foram visíveis no log estruturado do app.
- A interface trata o `409` específico após sincronizar o estado atualizado. Outro `409` preserva o erro localizado e não mostra a mensagem de confirmação concorrente. A sincronização remove da grade o item já confirmado, sem banner deslocando cartões; a solicitação na comanda conserva o selo no item.

## Validação executada

- `node scripts/run-kitchen-cancellation-disposable-qa.mjs`: 2/2 cenários de integração passaram; a barreira observou 2 conexões esperando no lock.
- `npx playwright test e2e/current-model/kitchen-cancellation-feedback.spec.ts --config=playwright.current.config.ts`: 5/5 testes passaram com APIs/realtime simulados, servindo somente o frontend local em `127.0.0.1:5204`.
- `npm run build --prefix frontend`: passou. O Vite mostrou somente os avisos já existentes de chunk grande e import misto de `auth-session.ts`.
- `npm run build --prefix backend`: passou.
- O teste transacional usou PostgreSQL 17 em tmpfs, porta local `55439`; contêiner destruído ao final. Não houve acesso a DEV ou PROD.
- SHA testado: `e3a3fce5379ee417cbf2e653bbea131db94db33e`. O commit contém somente o runner/teste descartável, sua entrada npm, a regressão de interface e a documentação inicial; nenhum código operacional foi alterado. Push para `origin/main` confirmado. Esta atualização registra o push.

## Comando de preparo concorrente

A causa reproduzida foi a combinacao de duplo toque antes de a UI desabilitar o cartao e um comando atrasado sem estado de origem, que podia aproveitar uma transicao de retorno valida. A grade mantinha a posicao antiga durante a interacao, mas tambem mantinha os controles antigos habilitados.

- A tela agora trava os controles do pedido de forma sincrona pelo ID estavel. Enquanto a geometria permanece congelada, a grade aplica imediatamente o disabled e os handlers atuais aos cartoes/continuacoes daquele ID.
- A API revalida status e tenant sob o lock existente. Repetir exatamente o status confirmado retorna o estado atual sem novo historico, notificacao ou efeitos; expectedStatus rejeita comando obsoleto. Conflito incompativel preserva 409 e a tela sincroniza a fila antes de exibir erro associado ao numero do pedido.
- PostgreSQL descartavel: 3/3 cenarios passaram. Duas sessoes autenticadas foram observadas esperando no advisory lock; ambas retornaram 200 para o mesmo EM_PREPARO, com exatamente uma linha de historico. Retry do mesmo alvo retornou 200 sem nova linha. Iniciar atrasado depois de PRONTO e transicao incompativel retornaram 409, sem alterar o estado. Voltar, PRONTO, ENTREGUE e retorno explicito de ENTREGUE para PRONTO produziram somente o historico esperado. Pagamentos, saldo, movimentos de estoque e caixa permaneceram iguais.
- Playwright de cozinha: 8/8 regressions passaram com frontend isolado em 127.0.0.1:5204 e Socket.IO/API simulados. Incluiu duplo toque durante request, chegada durante a acao, paginacao, reconexao, retomada apos aba oculta, pedido longo e medicoes sem corte/overflow.
- Builds de frontend e backend passaram. Avisos existentes do Vite: chunk principal acima de 500 kB e import misto de auth-session.ts.
- Nenhum pedido real, PROD ou banco de DEV foi usado no QA. O PostgreSQL de teste foi removido ao final. O DEV sera verificado apos publicar este commit; TAP-76 permanece In Progress.

## Atualização visível da comanda e resumo financeiro

- A comanda agora invalida seus dados ao receber `operacao:comanda-atualizada` e ao reconectar o Socket.IO. Não usa polling periódico.
- PostgreSQL 17 descartável + `buildApp` + Socket.IO real + duas sessões de navegador: 4/4 cenários passaram. A sessão da cozinha solicita e confirma pelo HTTP real; a sessão da comanda recebe os eventos na sala do tenant, refaz a consulta e remove o selo “Cancelamento solicitado”. Uma segunda solicitação ocorre enquanto as sessões estão desconectadas; a comanda refaz a consulta ao reconectar e mostra o selo correto. A confirmação não duplicou estorno de estoque, pagamento ou movimento de caixa.
- Playwright: 30/30 passaram nos projetos 390px e 768px. Matriz cobre fonte de configuração LEGACY/CANONICAL_PDV, cobrança da cozinha ao lançar ligada/desligada, itens recebidos/prontos/entregues, opcionais, itens cancelados e com cancelamento pendente, desconto, saldo em aberto, fechamento/pagamento e mensagem WhatsApp.
- `npm run build --prefix frontend` e `npm run build` em `backend` passaram. Permanecem os avisos do Vite sobre chunk principal e import misto de `auth-session.ts`.
- A API de fechamento foi exercitada em PostgreSQL descartável com caixa aberta: oito combinações LEGACY/CANONICAL_PDV cobriram `kitchenItemsChargeAtLaunch` e `allowCloseComandaWithPendingKitchenOrders`. Só a combinação com as duas opções ativas fechou a comanda (200); as demais responderam 409 sem pagamento, fechamento, movimento de caixa ou efeito extra de estoque. No fechamento permitido, o pedido continuou `RECEBIDO`. No tenant CANONICAL, usuário sem `command.close`/`payment.receive` recebeu 403 e não gerou efeitos.
- A verificação de desconexão observa a consulta do detalhe da comanda: não houve nova consulta enquanto o socket estava desconectado; a atualização perdida apareceu após reconectar e refazer a consulta.
- O PostgreSQL era temporário em tmpfs, vinculado somente a `127.0.0.1` e removido ao fim do ensaio. Nenhum pedido real ou PROD foi usado. A verificação pré-publicação encontrou somente a migration `20261009140000_cancel_delivered_comanda_item` pendente no DEV; ela foi aplicada pelo runner `development` antes da reinicialização. A verificação posterior confirmou `Database schema is up to date!`. API e frontend DEV servem o código `e3d0d7273e0985b43f66cddc77ea9cd359915af4`. TAP-76, TAP-78 e TAP-82 permanecem In Progress.
