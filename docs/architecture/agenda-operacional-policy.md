# Agenda operacional — calendário, repetição e cancelamento

## Domínio

- `AgendaOperacional` é uma regra semanal. `OcorrenciaOperacional` é um agendamento datado, avulso ou associado à regra. Uma regra sem ocorrências não ocupa dias fictícios no calendário.
- Mês, Lista, marcações e contadores usam a mesma consulta do primeiro ao último dia do mês exibido. Tocar em um dia seleciona sua lista; Hoje volta ao mês e dia atuais. Consultar, navegar ou abrir painéis não escreve registros.
- O cadastro usa um formulário único, com nome, data, início, término e opção semanal. Início e término ficam visíveis e são obrigatórios para novas datas; somente local é opcional. A repetição exige primeira e última data, com janela máxima de 366 dias; somente a frequência semanal é suportada.
- O formulário inicia o início com o padrão existente de 18:00, permite alterá-lo e exige término posterior. A consulta não inventa horários ausentes; intervalos antigos incompletos podem ser completados por edição validada.

## Intervalos reservados por PDV

- Novos agendamentos e mudanças de data/horário exigem `horaInicio` e `horaFim`, no mesmo dia, com o término posterior ao início. Agenda operacional não oferece duração atravessando meia-noite.
- As ocorrências reservam intervalos semiabertos `[início, término)`: `inícioNovo < términoExistente && términoNovo > inícioExistente`. Horários adjacentes são aceitos; início igual, sobreposição parcial e contenção são recusados.
- A API valida somente ocorrências do tenant e PDV canônicos autorizados; `CANCELADA` não reserva. Arquivar ou interromper uma regra não libera ocorrências existentes, e ocorrências de regras arquivadas continuam na comparação.
- Toda mutação que reserva ou libera uma ocorrência obtém primeiro um advisory transaction lock comum do tenant/PDV. A leitura de conflitos e a gravação ocorrem na mesma transação. A geração semanal pré-valida todas as datas e aborta regra, ocorrências e recibo integralmente se uma conflitar. O lock por ocorrência/requisição permanece depois desse lock geral.
- Conflitos retornam HTTP 409 com `code: AGENDA_HORARIO_CONFLITO` e somente os dados seguros da ocorrência conflitante no escopo autorizado. Datas incompletas antigas bloqueiam o mesmo início; em qualquer outra comparação incerta na data, a API retorna `AGENDA_HORARIO_INCOMPLETO` até que o intervalo antigo seja completado.
- Edição de ocorrência mantém a própria linha fora da comparação. Mudanças apenas de nome/local em registro legado incompleto preservam seus horários ausentes; nova reserva, mudança de data/horário ou geração exige intervalo completo. O completar de uma ocorrência antiga passa pela mesma validação.
- Datas seguem o contrato local existente `AAAA-MM-DD`, persistido/consultado como data UTC sem hora. O QA cobre criação e geração pelas rotas novas e legadas, adjacência, conflitos, retry, rollback semanal, simultaneidade, legado incompleto, cancelamento e arquivo lógico.

## Salvamento e retry

`POST /api/operacao/agenda/agendamentos` recebe `requestId` UUID, `nome`, `data`, `horaInicio`, `horaFim` obrigatório em novo agendamento ou mudança de data/horário, `local` opcional, `repetirSemanalmente`, e, para repetição, `fim`. IDs existentes podem ser informados em `agendaId` ou `ocorrenciaId`, conforme o objeto editado.

- Nova repetição e suas datas são salvas na mesma transação, reutilizando `generateAgendaDates`. Uma falha em qualquer inserção ou na auditoria desfaz tudo.
- O gerador usa a unicidade existente por agenda/data e `skipDuplicates`. Preserva ocorrências existentes, inclusive canceladas; gerar o mesmo período não restaura agendamentos cancelados.
- Uma chave de tentativa, mantida no rascunho após erro, é serializada por advisory lock. Um recibo em `TransacaoLog`, com ID derivado de tenant/PDV/requestId, fingerprint e resultado, é persistido na mesma transação. Retry concorrente ou após perda da resposta retorna o mesmo resultado, sem criar outra regra ou datas. Reutilizar a chave com conteúdo diferente após sucesso é recusado.
- O recibo de salvamento reutiliza `TransacaoLog`, sem tabela ou enum adicional. Os registros usam `EVENTO_ATUALIZADO`, com `entidadeTipo` e `metadata.acao` específicos (`AGENDAMENTO_SALVO`, `AGENDAMENTO_CANCELADO`, `REPETICAO_INTERROMPIDA`, `REPETICAO_ARQUIVADA`). A falha de auditoria não é absorvida: causa rollback.
- Os endpoints antigos de criação/edição/geração continuam disponíveis para compatibilidade. O formulário novo usa a operação transacional; a navegação principal não expõe uma etapa Gerar datas.

## Repetições existentes

- Gestão secundária Repetições apresenta nome, dia, horário, estado e quantidade total de datas (fora do período consultado também). Zero é identificado como Ainda sem datas agendadas.
- Editar uma regra preserva seu ID e estado ativo/inativo. Alterações afetam somente futuras gerações; ocorrências existentes não são reescritas.
- Uma regra ativa pode salvar sua definição e agendar o período explicitamente informado, no mesmo fluxo. Desmarcar Agendar datas neste período salva apenas a definição.
- Regra inativa permite edição da definição, sem gerar datas e sem reativação automática. O formulário explica esse limite. Não foi criada uma ação de reativação na interface.
- Editar e Remover da lista são ações explícitas para regras ativas e inativas. Somente regras ativas oferecem Interromper repetição.
- `POST /agendas/:id/interromper` desativa a regra e impede novas gerações. Não cancela datas existentes. Interrupção, edição e todos os geradores compartilham o lock da regra.

## Arquivamento lógico

- `AgendaOperacional.archivedAt` é uma coluna nullable adicionada pela migração `20261009180000_agenda_archive`. É independente de `ativa`: remover da lista preserva o estado ativo/inativo.
- `POST /agendas/:id/arquivar` serializa pelo mesmo lock da regra e persiste arquivamento + auditoria na mesma transação. Retry não duplica auditoria.
- A consulta mensal exclui regras arquivadas de `agendas`, mas continua retornando suas ocorrências datadas. `GET /agendas/arquivadas`, com `agenda.manage`, oferece consulta secundária, sem ações de edição/geração/restauração.
- Todos os geradores, inclusive o endpoint legado e o salvamento transacional, recusam regra arquivada. O PATCH legado também não pode alterar uma regra arquivada.
- Arquivamento não exclui a regra, suas datas, mapas de migração, comandas, caixa, estoque ou auditoria anterior. A confirmação explica as consequências e o sucesso é mostrado visualmente.
- A quantidade de datas da regra é total em todos os períodos, incluindo canceladas. Zero não é inferido pela ausência de ocorrências no mês. A interface identifica uma contagem ausente como indisponível.

## Confirmações visuais

A Agenda reutiliza `Modal`, conforme os componentes de confirmação de eventos da aplicação. Descarte usa o título Descartar alterações? e ações Continuar editando/Descartar; cancelar, interromper e arquivar têm títulos e consequências específicas. O formulário fica suspenso durante a confirmação, mantendo os valores controlados. Recusar restaura campos e foco; descartar não envia requests. Escape recusa a confirmação e Tab fica dentro do painel. Voltar do navegador/navegação interna usa o mesmo fluxo visual via blocker do router. Não há `window.confirm`, `alert` ou handler de diálogo nativo de unload na Agenda. Fechar/recarregar a aba inteira não pode ser interceptado por um modal assíncrono; essa ação externa não mantém rascunho em disco.

## Edição e cancelamento de um agendamento

- Detalhes permitem editar somente `PROGRAMADA` sem comandas ou qualquer sessão/histórico de caixa. A edição preserva ID e associação à regra; editar esta data não altera a regra semanal.
- `POST /ocorrencias/:id/cancelar` muda somente `PROGRAMADA` sem vínculos operacionais para `CANCELADA`, com auditoria na mesma transação. Não exclui fisicamente; repetir o cancelamento não duplica auditoria.
- `ABERTA`, `FECHADA` e registros com qualquer histórico de caixa/comanda são bloqueados, com motivo textual. Sessões fechadas também contam como histórico. Nenhum caixa, comanda, pagamento, estoque ou registro histórico é alterado pelo cancelamento.
- Em agendamento semanal, Cancelar este agendamento e Interromper a repetição são ações distintas. As confirmações explicam que interrupção preserva as datas já existentes.
- Todas as escritas validam `agenda.manage` (ou a restrição de proprietário quando as permissões individuais estão desligadas), tenant e PDV canônico. Referências a IDs estrangeiros são recusadas.

## Concorrência com caixa

A abertura mantém o advisory lock existente por tenant/PDV/dia operacional e, quando escolhe uma ocorrência canônica, adquire também o lock por tenant/PDV/ocorrência antes da revalidação transacional. Edição/cancelamento adquirem esse mesmo lock de ocorrência antes de consultar status e vínculos. O lock por ocorrência protege também quando o caixa é aberto em outro dia operacional.

Se a associação vencer, cancelamento aguarda e encontra o histórico, sendo recusado. Se cancelamento vencer, abertura revalida o status e recusa `CANCELADA`. Cancelamento não adquire lock de dia, evitando inversão na ordem de locks. Os fluxos LEGACY não usam a nova associação nem consultam a agenda canônica.

Caixa pode abrir sem ocorrência. Seleção explícita continua aceitando somente `PROGRAMADA` ou `ABERTA` do tenant/PDV canônicos. Data diferente exige a confirmação existente. As regras de caixa e motores Por Caixa, Tap, Trailer e Evento legado permanecem em seus contratos atuais.

## Limites de política

Esta aprovação cobre cancelar somente agendamento programado sem história e interromper uma regra. Não define abertura, fechamento ou reabertura de ocorrências, cancelamento de operações em andamento, cancelamento em lote da série, transferência de caixas, novas frequências ou reativação pela interface.

## Verificação focada

- `npm.cmd run build --prefix frontend` e `npm.cmd run build --prefix backend`.
- `npx.cmd playwright test --config=playwright.agenda.config.ts`: APIs simuladas, 390px/768px, Mês/Lista, Hoje, seleção, navegação, vazio/erro/retry, formulário único, período semanal, envio único, rascunho/descarte, edição, bloqueios, interrupção, LEGACY e permissão. Viewport reduzido simula o espaço disponível com teclado, verificando rodapé e overflow.
- Em `backend`: `node scripts/run-agenda-disposable-qa.mjs`. PostgreSQL 17 exclusivo em container rotulado, porta local permitida e armazenamento tmpfs; schema provisionado somente nesse banco, sem rodar migração/cutover. Verifica rollback com falha real de inserção, retries concorrentes, auditoria, edição/inatividade, histórico, escopo/permissão e disputa transacional com vínculo ao caixa. Remove seu container ao terminar.
- O runner agora usa `buildApp` real, autenticação JWT/sessão persistida, prefixo completo `/api/operacao/agenda` e os hooks de módulo/permissão reais; não registra o router isoladamente nem substitui autenticação/contexto por stubs.
- Aplicação mínima em DEV: `node scripts/apply-agenda-archive-dev.mjs` em `backend`. Usa o runner de ambiente existente e credenciais de migração DEV, com validação de alvo exato `cervejaria_dev:5434` e bundle temporário contendo somente esta migração. Migrações locais de outros trabalhos não são aplicadas.
- O launcher DEV informa o SHA Git no backend/frontend; `/api/health` mostra `releaseSha` e `startedAt` para verificar o processo efetivamente servido. O SHA identifica a base Git do início do processo; alterações locais preservadas continuam presentes no workspace DEV.
- Capturas `artifacts/agenda-*-calendar*.png` são fixtures de QA. Não representam dados de clientes.
- UI é verificada em Chromium emulado. Teclado/safe area nativos e instalação PWA em aparelhos físicos não foram certificados nesta bateria. Limite intencional: uma regra inativa pode ser editada, mas não voltar a gerar pela interface.
