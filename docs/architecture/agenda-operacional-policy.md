# Agenda operacional — política de edição e status

## Aprovado para a entrega de TAP-76

- `AgendaOperacional` representa recorrência semanal; `OcorrenciaOperacional` representa uma data específica e pode ser avulsa.
- A geração semanal é explícita para um período, idempotente por agenda/data e preserva cada ocorrência já criada.
- Editar uma recorrência altera somente a definição usada em gerações futuras. Ocorrências existentes, sessões, comandas, snapshots de venda, pagamentos, estoque e cozinha não são reescritos nem transferidos.
- Caixa pode abrir sem ocorrência. Seleção explícita aceita somente `PROGRAMADA` ou `ABERTA` do tenant e PDV canônicos. Data diferente do dia operacional requer confirmação explícita. `FECHADA` e `CANCELADA` não podem ser associados a novas sessões.
- As rotas de consulta não geram ocorrências e não alteram estados. Não há efeito de agenda sobre o motor Por Caixa, cardápio, preço, parâmetros, Tap, Trailer ou Evento legado.

## Ainda sem política aprovada

Não está definido quem pode abrir, fechar, reabrir ou cancelar uma ocorrência, quais transições são válidas, quais efeitos uma mudança de status tem sobre uma recorrência, nem quando/como uma agenda deve ser desativada ou reativada após ocorrências já geradas. Esta entrega não cria rotas de alteração de status ou de ciclo de vida; os estados existentes são preservados. Qualquer política futura exige decisão explícita e não deve inferir transferência/fechamento de caixas ou comandas.

## Apresentação da agenda em telas menores

- A consulta de ocorrências é o conteúdo principal, agrupado pela data. O período é editável sob demanda e permanece selecionado ao abrir cadastros, editar recorrências e gerar datas.
- Cadastro avulso, cadastro/edição semanal e geração são painéis modais; abrir/fechar os painéis e consultar a agenda não executam escrita nem geram datas.
- A geração é uma ação deliberada iniciada na recorrência escolhida e usa o período explicitamente exibido. A API idempotente continua sendo a única responsável por criar as ocorrências semanais.
- A lista de recorrências é recolhível e independente do resultado de ocorrências no período. A ausência de ocorrências não significa ausência de recorrências.
- A interface não cria transições de status ou horários que não vieram da API. Os contratos, permissões, isolamento de tenant/PDV e usos LEGACY permanecem inalterados.
