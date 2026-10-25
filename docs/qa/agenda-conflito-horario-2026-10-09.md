# Agenda DEV — prevenção de sobreposição por PDV

> Registro histórico de 09/10/2026: os resultados e URLs públicas abaixo refletem o DEV disponível na data. O DEV oficial atual é local: frontend `http://localhost:5202`, API `http://localhost:3002`. Para repetir hoje, use localhost.

## Causa

O contrato anterior aceitava `horaFim` ausente e o serviço gravava ocorrências sem consultar outras reservas da data. As rotas de criação avulsa e geração legada também gravavam fora dessa validação. Por isso dois envios que começavam às 18h podiam persistir no mesmo PDV.

## Alteração

- O formulário mostra início e término como obrigatórios. Conflitos HTTP 409 ficam no próprio formulário como `Conflito com {nome} em DD/MM/AAAA, das HH:mm às HH:mm.`; os dados ficam preenchidos para uma nova tentativa.
- O backend valida `horaFim > horaInicio` e intervalos semiabertos `[início, término)`. Não aceita intervalo atravessando meia-noite.
- O lock advisory transacional comum do tenant/PDV é adquirido antes da consulta de conflitos e da gravação nas rotas de salvamento, geração, edição, cancelamento, interrupção e arquivo. O salvamento semanal pré-valida todas as datas na mesma transação e reverte regra, ocorrências e recibo quando alguma data conflita.
- As rotas alternativas `/ocorrencias` e `/agendas/:id/gerar` usam o mesmo lock e a mesma validação. Identidade do tenant e PDV vem do contexto autorizado da requisição.
- Agendamentos cancelados deixam de reservar horário. Interrupção/arquivamento da regra não cancela nem libera as ocorrências já criadas.
- Registros antigos incompletos permanecem intocados. Mesmo início é bloqueado; outra reserva na mesma data recebe `AGENDA_HORARIO_INCOMPLETO`, pois o conflito não pode ser decidido com segurança. Uma edição apenas de nome/local preserva os horários ausentes; completar ou mudar data/horário é validado.
- Nenhuma migration foi necessária. Não foram alterados os registros “Igarapé” ou “teste”. Os testes usam apenas PostgreSQL descartável e APIs simuladas.

## Validação

- `npm.cmd run build` em `backend`: aprovado.
- `npm.cmd run build` em `frontend`: aprovado; avisos atuais de tamanho do bundle e importação dinâmica permaneceram.
- `node scripts/run-agenda-disposable-qa.mjs` em `backend`: **21 verificações aprovadas**, usando PostgreSQL descartável e `buildApp` real. Inclui início igual, sobreposição parcial, contenção, adjacência, edição própria, edição conflitante, cancelamento, regra arquivada, geração alternativa, rollback semanal, retry, duas criações simultâneas, tenant/PDV, permissão, horário ausente e intervalo atravessando meia-noite. O container PostgreSQL temporário foi removido.
- `npx.cmd playwright test --config=playwright.agenda.config.ts`: **18 testes aprovados**, APIs simuladas, larguras 390px e 768px. Início/término aparecem no formulário; conflito mantém os campos e permite nova tentativa livre. A bateria também cobre LEGACY e permissão.
- Capturas da mensagem no formulário: `docs/evidence/agenda-conflict-mobile.png` e `docs/evidence/agenda-conflict-tablet.png`.

## DEV e repetição manual

O commit funcional `9e50e73f88398a7f3a5109a549df2850456e01dc` foi enviado a `origin/main`. Os processos backend/frontend DEV foram reiniciados juntos pelos scripts locais existentes. A primeira verificação pública do ajuste retornou `releaseSha=9e50e73f88398a7f3a5109a549df2850456e01dc` e `startedAt=2026-10-09T18:11:17.338Z`; o stamp do módulo frontend público continha o mesmo SHA e o componente servido continha o código/mensagem de conflito. As duas rotas de escrita consultadas sem sessão (`POST /api/operacao/agenda/agendamentos` e `POST /api/operacao/agenda/ocorrencias`) retornaram 401, sem executar gravações.

Para uma repetição atual, confirme a revisão em `http://localhost:3002/api/health` e abra a PWA em `http://localhost:5202` depois de copiar qualquer rascunho.

Para reproduzir o caso de duas reservas às 18h, use um PDV de teste e uma data futura que você controla:

1. Cadastre uma ocorrência avulsa das 18:00 às 20:00 e salve.
2. Na mesma data, tente cadastrar outra das 18:00 às 19:00. A Agenda deve manter o formulário aberto e mostrar o conflito com nome/data/intervalo da primeira.
3. Ajuste a segunda para 20:00–22:00 e salve; horários adjacentes são permitidos.

Não use as ocorrências existentes chamadas “Igarapé” ou “teste” para este roteiro. Os probes públicos anteriores à atualização não enviaram gravações. Não há migration nem mudança de infraestrutura PROD.
