# Operação certificada: CAIXA e EVENTO

## Objetivo

O produto possui um único modo operacional por vez: CAIXA ou EVENTO. As
capabilities de torneiras, estoque e cozinha são independentes.

## CAIXA

Selecione **Por caixa** em Configurações → Operação. O primeiro item
operacional da navegação é **Caixa**. Se não existir PDV, use o CTA da tela do
Caixa para criar um; não é necessário editar banco nem configurar um modo
legacy. Depois abra o caixa para operar comandas e vendas.

## EVENTO

Selecione **Por operações / eventos**. O primeiro item operacional é
**Eventos**. Crie ou agende a operação e inicie-a antes de executar o fluxo de
vendas. Caixa não aparece como modo concorrente.

## Capabilities

Estoque e Cozinha aparecem somente quando habilitados. Torneiras não criam uma
aba operacional própria: a capability é exercida dentro dos fluxos de operação
que usam torneiras. Configurações do estabelecimento continuam dentro das telas
de Configurações; “Estabelecimento”, “Quiosque”, “Híbrida” e “Venda Avulsa” não
são modos ou destinos operacionais.

## Erros comuns

- Caixa fechado: abra o caixa pelo botão apresentado na própria tela.
- Evento sem operação ativa: inicie uma operação válida antes de vender.
- Estoque ou cozinha desabilitados: habilite a capability em Configurações → Operação.

## Evidência

A matriz completa está em [E2E-REGRESSION-MATRIX.md](../testing/E2E-REGRESSION-MATRIX.md).
Cada combinação C01–C08 e E01–E08 possui teste Playwright individual e
 screenshot fixture-only no artefato do lote.

## Protecao de transicao (TAP-68)

O backend rejeita CAIXA -> EVENTO quando existe sessao de caixa `ABERTO` e
rejeita EVENTO -> CAIXA quando existe evento `ABERTO`. A resposta e HTTP 409
com mensagem acionavel; a UI mostra o erro e preserva o modo atual. Eventos
agendados ou fechados nao bloqueiam a transicao. Cada bloqueio emite o evento
de auditoria `operational_mode_change_blocked` com tenant, modos e razao.

As transicoes sao serializadas por advisory lock quando executadas no cliente
Prisma real. O bloqueio ocorre antes do upsert, portanto chamadas diretas de
API e tentativas concorrentes nao deixam configuracao parcial. A matriz e os
casos T68-01 a T68-07 estao em [E2E-REGRESSION-MATRIX.md](../testing/E2E-REGRESSION-MATRIX.md).
