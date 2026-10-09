# QA focado: restaurar agendamento cancelado — 2026-10-09

## Alteracao

A tela de detalhes agora oferece **Restaurar agendamento** apenas para ocorrencias canceladas restauraveis. A operacao mantem o ID, revalida vinculos, intervalo e conflitos dentro da transacao protegida pelo advisory lock do tenant/PDV, atualiza a mesma linha para `PROGRAMADA` e grava auditoria especifica com ator, instante e valores antes/depois. A auditoria do cancelamento anterior fica intacta.

Conflito ou intervalo incompleto devolve erro sem escrita e abre formulario com data/inicio/termino para ajuste. A tentativa conserva seu `requestId`; a transacao bem-sucedida persiste uma unica auditoria/recibo para o retry. Uma ocorrencia semanal restaurada nao reativa nem desarquiva a regra. Comandas, pagamentos, caixa, estoque e outras ocorrencias nao sao alterados.

## Validacao

- `backend`: `npm.cmd run build` — passou.
- `frontend`: `npm.cmd run build` — passou.
- `backend`: `node scripts/run-agenda-disposable-qa.mjs` — 24 verificacoes passaram contra PostgreSQL descartavel pelo `buildApp` real; container tmpfs removido. Cobriu rota/autenticacao, ID e auditoria, conflito sem escrita, complemento de horario legado, retry, ABERTA/FECHADA, vinculo de caixa, tenant/permissao e concorrencia de restauracao com nova reserva. Sem dados de clientes e sem migration.
- Raiz: `npx.cmd playwright test --config=playwright.agenda.config.ts` — 20 testes passaram, incluindo restauracao/conflicto em 390px e 768px, confirmacao visual, campos preservados, envio com a mesma chave e retorno do detalhe atualizado. Nenhum dialogo nativo.

## Capturas

- Celular: `artifacts/agenda-restore-conflict-mobile.png`.
- Tablet: `artifacts/agenda-restore-conflict-tablet.png`.

## Publicacao DEV

- SHA do commit/push e revisao servida: registrados abaixo apos o health check de DEV.


- URL verificada: `https://tapdev.quivercloud.com.br`.
- PROD: nao acessada; nao requer deploy de PROD por esta entrega (`PROD_DEPLOY_REQUIRED: no`).

## Reproducao manual em DEV

1. Acesse `https://tapdev.quivercloud.com.br`, entre com usuario com `agenda.manage` e abra Operacao > Agenda.
2. Consulte a data da ocorrencia cancelada, abra seus detalhes e selecione **Restaurar agendamento**.
3. Confirme. Se o intervalo tiver sido ocupado ou estiver incompleto, ajuste data, inicio e termino no formulario; a mensagem identifica a ocorrencia conflitante.
4. Envie novamente. O detalhe e a lista devem mostrar **Programada** na mesma ocorrencia. Se houver conflito, a linha continua **Cancelada** e os campos permanecem no formulario.
