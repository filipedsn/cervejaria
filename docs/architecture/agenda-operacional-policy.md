# Agenda operacional — calendário, repetição e cancelamento

## Domínio

- `AgendaOperacional` é uma regra semanal. `OcorrenciaOperacional` é um agendamento datado, avulso ou associado à regra. Uma regra sem ocorrências não ocupa dias fictícios no calendário.
- Mês, Lista, marcações e contadores usam a mesma consulta do primeiro ao último dia do mês exibido. Tocar em um dia seleciona sua lista; Hoje volta ao mês e dia atuais. Consultar, navegar ou abrir painéis não escreve registros.
- O cadastro usa um formulário único, com nome, data, horário e opção semanal. Término e local são opcionais em Mais detalhes. A repetição exige primeira e última data, com janela máxima de 366 dias; somente a frequência semanal é suportada.
- O horário é suportado pelas APIs e obrigatório no schema atual. O formulário inicia com o padrão existente de 18:00 e permite alterá-lo. A consulta não inventa horários ausentes.

## Salvamento e retry

`POST /api/operacao/agenda/agendamentos` recebe `requestId` UUID, `nome`, `data`, `horaInicio`, `horaFim`/`local` opcionais, `repetirSemanalmente`, e, para repetição, `fim`. IDs existentes podem ser informados em `agendaId` ou `ocorrenciaId`, conforme o objeto editado.

- Nova repetição e suas datas são salvas na mesma transação, reutilizando `generateAgendaDates`. Uma falha em qualquer inserção ou na auditoria desfaz tudo.
- O gerador usa a unicidade existente por agenda/data e `skipDuplicates`. Preserva ocorrências existentes, inclusive canceladas; gerar o mesmo período não restaura agendamentos cancelados.
- Uma chave de tentativa, mantida no rascunho após erro, é serializada por advisory lock. Um recibo em `TransacaoLog`, com ID derivado de tenant/PDV/requestId, fingerprint e resultado, é persistido na mesma transação. Retry concorrente ou após perda da resposta retorna o mesmo resultado, sem criar outra regra ou datas. Reutilizar a chave com conteúdo diferente após sucesso é recusado.
- Não há nova tabela, coluna, enum ou migração. Os registros de auditoria usam `EVENTO_ATUALIZADO`, com `entidadeTipo` e `metadata.acao` específicos (`AGENDAMENTO_SALVO`, `AGENDAMENTO_CANCELADO`, `REPETICAO_INTERROMPIDA`). A falha de auditoria não é absorvida: causa rollback.
- Os endpoints antigos de criação/edição/geração continuam disponíveis para compatibilidade. O formulário novo usa a operação transacional; a navegação principal não expõe uma etapa Gerar datas.

## Repetições existentes

- Gestão secundária Repetições apresenta nome, dia, horário, estado e quantidade total de datas (fora do período consultado também). Zero é identificado como Ainda sem datas agendadas.
- Editar uma regra preserva seu ID e estado ativo/inativo. Alterações afetam somente futuras gerações; ocorrências existentes não são reescritas.
- Uma regra ativa pode salvar sua definição e agendar o período explicitamente informado, no mesmo fluxo. Desmarcar Agendar datas neste período salva apenas a definição.
- Regra inativa permite edição da definição, sem gerar datas e sem reativação automática. O formulário explica esse limite. Não foi criada uma ação de reativação na interface.
- `POST /agendas/:id/interromper` desativa a regra e impede novas gerações. Não cancela datas existentes. Interrupção, edição e todos os geradores compartilham o lock da regra.

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
- Capturas `artifacts/agenda-*-calendar*.png` são fixtures de QA. Não representam dados de clientes.
- UI é verificada em Chromium emulado. Teclado/safe area nativos e instalação PWA em aparelhos físicos não foram certificados nesta bateria. Limite intencional: uma regra inativa pode ser editada, mas não voltar a gerar pela interface.
