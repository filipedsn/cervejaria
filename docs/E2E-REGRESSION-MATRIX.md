# E2E regression matrix

## Operational configuration truth table

The current product axes are `plannedOperationsEnabled` (CAIXA=false, EVENTO=true),
`tapsEnabled`, `inventoryEnabled`, and `kitchenEnabled`. `directSalesEnabled`,
`PontoVenda.usaCaixa`, and `ConfiguracaoQuiosque` are compatibility data and are
explicitly excluded from the product matrix.

| IDs | Mode | Taps | Inventory | Kitchen | First nav | Visible capability surfaces | Hidden capability surfaces | Spec |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C01-C04 | CAIXA | 0 | 0/1 | 0/1 | Caixa | Caixa, Comandas; enabled Estoque/Cozinha only | Estabelecimento, Quiosque, Híbrida, Venda avulsa; disabled capability routes | `operational-capability-matrix.spec.ts` |
| C05-C08 | CAIXA | 1 | 0/1 | 0/1 | Caixa | Caixa, Comandas; taps in operational flows; enabled Estoque/Cozinha only | Estabelecimento, Quiosque, Híbrida, Venda avulsa; disabled capability routes | `operational-capability-matrix.spec.ts` |
| E01-E04 | EVENTO | 0 | 0/1 | 0/1 | Eventos | Eventos, Comandas; enabled Estoque/Cozinha only | Caixa, Estabelecimento, Quiosque, Híbrida, Venda avulsa; disabled capability routes | `operational-capability-matrix.spec.ts` |
| E05-E08 | EVENTO | 1 | 0/1 | 0/1 | Eventos | Eventos, Comandas; taps in operational flows; enabled Estoque/Cozinha only | Caixa, Estabelecimento, Quiosque, Híbrida, Venda avulsa; disabled capability routes | `operational-capability-matrix.spec.ts` |

Each ID is emitted as an individual Playwright test and saves a deterministic
fixture-only screenshot in the test artifact directory.

The grouped rows above are summarized by the following exact oracle. Each row
is an individual Playwright case; the expected order is compared positionally.

| ID | Mode | Taps | Inventory | Kitchen | Expected order | Disabled direct routes |
| --- | --- | --- | --- | --- | --- | --- |
| C01 | CAIXA | 0 | 0 | 0 | Caixa → Comandas | `/quiosque/estoque`, `/quiosque/cozinha` |
| C02 | CAIXA | 0 | 0 | 1 | Caixa → Comandas → Cozinha | `/quiosque/estoque` |
| C03 | CAIXA | 0 | 1 | 0 | Caixa → Comandas → Estoque | `/quiosque/cozinha` |
| C04 | CAIXA | 0 | 1 | 1 | Caixa → Comandas → Cozinha → Estoque | none |
| C05 | CAIXA | 1 | 0 | 0 | Caixa → Comandas | `/quiosque/estoque`, `/quiosque/cozinha` |
| C06 | CAIXA | 1 | 0 | 1 | Caixa → Comandas → Cozinha | `/quiosque/estoque` |
| C07 | CAIXA | 1 | 1 | 0 | Caixa → Comandas → Estoque | `/quiosque/cozinha` |
| C08 | CAIXA | 1 | 1 | 1 | Caixa → Comandas → Cozinha → Estoque | none |
| E01 | EVENTO | 0 | 0 | 0 | Eventos → Comandas | Caixa, `/quiosque/estoque`, `/quiosque/cozinha` |
| E02 | EVENTO | 0 | 0 | 1 | Eventos → Comandas → Cozinha | Caixa, `/quiosque/estoque` |
| E03 | EVENTO | 0 | 1 | 0 | Eventos → Comandas → Estoque | Caixa, `/quiosque/cozinha` |
| E04 | EVENTO | 0 | 1 | 1 | Eventos → Comandas → Cozinha → Estoque | Caixa |
| E05 | EVENTO | 1 | 0 | 0 | Eventos → Comandas | Caixa, `/quiosque/estoque`, `/quiosque/cozinha` |
| E06 | EVENTO | 1 | 0 | 1 | Eventos → Comandas → Cozinha | Caixa, `/quiosque/estoque` |
| E07 | EVENTO | 1 | 1 | 0 | Eventos → Comandas → Estoque | Caixa, `/quiosque/cozinha` |
| E08 | EVENTO | 1 | 1 | 1 | Eventos → Comandas → Cozinha → Estoque | Caixa |

## Certification rules

- CAIXA always has **Caixa** as the first operational navigation item.
- EVENTO always has **Eventos** as the first operational navigation item and no competing Caixa mode.
- A disabled kitchen or inventory capability has neither an operational navigation entry nor an enabled workflow.
- An active point of sale in CAIXA is cash-capable from `ConfiguracaoOperacional`; legacy `usaCaixa` cannot create a dead end.
- No UI may expose “Quiosque”, “Híbrida”, or “Venda Avulsa” as an operational mode.
- “Estabelecimento” is not an operational-navigation item in any configuration.

## Existing-suite disposition

| Spec family | Disposition | Purpose |
| --- | --- | --- |
| `quiosque-capacidades.spec.ts` | REUSE | UI capability configuration and first-PDV journey |
| `quiosque-pdv*.spec.ts` | REUSE | PDV, cash and continuous-sale journeys |
| `quiosque-estoque-critico.spec.ts` | REUSE | inventory workflow |
| `quiosque-cozinha-cancel.spec.ts` | REUSE | kitchen lifecycle |
| `operational-capability-matrix.spec.ts` | NEW | exhaustive 16-combination configuration guard |
