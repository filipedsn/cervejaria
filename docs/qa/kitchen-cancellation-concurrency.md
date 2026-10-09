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
- SHA testado e push serão registrados ao finalizar o commit da prova.
