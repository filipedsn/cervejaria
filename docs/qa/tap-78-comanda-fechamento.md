# TAP-78 — Fechamento de comanda com cozinha pendente

## Contrato

A tela de detalhe da comanda lê `kitchenItemsChargeAtLaunch` e
`allowCloseComandaWithPendingKitchenOrders` de `GET /api/operacao/contexto`,
rota autenticada que calcula o perfil efetivo dentro do tenant do usuário.
Ela não consulta a rota administrativa
`GET /api/cervejaria/configuracao-operacional`, que permanece restrita ao dono.

O fechamento com pedido pendente só aparece quando o contexto foi carregado
com sucesso e ambos os parâmetros efetivos estão ativos. Enquanto a leitura
carrega ou falha, a tela mantém a ação bloqueada e explica o estado. O backend
continua exigindo `command.close` e `payment.receive` para registrar pagamento
e valida novamente os parâmetros no fechamento.

Fechar a comanda registra o pagamento e encerra a conta. Não avança o estado da
cozinha, não entrega pedidos e não repete movimentos de estoque. Os contratos
LEGACY e canônico continuam sendo resolvidos pelo perfil operacional existente.

## Layout

Os pedidos continuam separados por ID/senha. Cada senha tem cabeçalho compacto;
quantidade e produto dividem a linha, com valor e cancelamento à direita.
Opcionais, observação e indicação para viagem aparecem abaixo do produto quando
existem. O valor pendente na cozinha permanece visível. Controles de toque têm
ao menos 44px; em telas com largura a partir de 640px, Voltar e Fechar ficam
lado a lado.

Capturas mockadas de interface:

- [Celular — 390px](capturas/tap78-comanda-390px.png)
- [Tablet — 768px](capturas/tap78-comanda-768px.png)

## Verificações

- `npm run build --prefix frontend`
- `npm run build --prefix backend`
- Playwright `e2e/current-model/operacao-comanda-compact.spec.ts` contra Vite
  temporário em 5204; dados de comanda e contexto mockados, sem escrita em API.
- QA de fechamento usa `buildApp` e PostgreSQL descartável, com funcionários
  sintéticos e sessões independentes. O roteiro é
  `npm run qa:pdv-individual-permissions --prefix backend`.

Resultado de 09/10/2026: os dois testes Playwright passaram em 390px e 768px,
incluindo erro de contexto com fechamento indisponível e aviso distinto de
parâmetro desligado. O roteiro API/PostgreSQL descartável passou em modo
LEGACY: dois funcionários autenticados em sessões próprias fecharam
comandas com cozinha pendente; parâmetro desligado e falta de
`payment.receive` bloquearam sem escrita; pagamento de R$ 14,50 foi registrado,
pedido permaneceu `RECEBIDO`, estoque não mudou, tenant estrangeiro não herdou
a configuração e a rota administrativa retornou 403 ao funcionário. O runner
aplicou as migrações no banco temporário como preparação do schema; não foi
executado o QA integral de certificação de migração.

Capturas de interface são simuladas e não provam publicação em DEV/PROD nem
aceite de cliente. O aceite de acesso dos funcionários do cliente precisa ser
feito no ambiente autorizado, por eles, sem usar credenciais do dono.

## Release

`PROD_DEPLOY_REQUIRED: Yes` para publicar qualquer SHA desta correção.
O status de TAP-78 depende da evidência da validação API isolada e do registro
do SHA efetivamente servido em DEV. O aceite em produção pelo cliente permanece
pendente.
