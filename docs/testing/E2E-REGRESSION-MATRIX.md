# E2E regression matrix

## TAP-98 release certification

The disposable, production-shaped release regression suite lives in `e2e/release/` and runs only through `npm run qa:release-e2e`. It uses a disposable PostgreSQL container and records case evidence under `artifacts/release-e2e/<releaseSha>/`. Release specs are excluded from the regular Playwright runner. See `docs/testing/release-regression/PLANO.md` for case scope and current certification report.

## Gamified category catalog

| ID | Scope | Gate | Spec / runner |
| --- | --- | --- | --- |
| GC01 | Category normalization and fallback | Unknown labels retain their name; feature is off unless explicitly enabled | `backend/src/lib/operacao/categorias.test.ts`, `catalogo-categorias.test.ts` |
| GC02 | Category permissions | `catalog.manage` authorizes; absence denies; POST and PUT use the shared guard | `backend/src/lib/operacao/catalog-permissions.test.ts` |
| GC03 | Additive migration | Preserves product IDs, text, and menu-product ID | `backend/scripts/run-pdv-gamified-category-qa.mjs` |
| GC04 | Historical transformation | Atomic replay, normalized collision blocks with no fusion, rollback removes only migration-owned rows | Same disposable PostgreSQL runner; transform/rollback SQL |
| GC05 | Tenant isolation | Composite FK rejects a product/category reference across tenants | Same disposable PostgreSQL runner |
| GC06 | UI | Create/edit category, save gamification flag, select category in product with explicit mocked APIs | `e2e/pdv-gamified-categories.spec.ts` |
| GC07 | Chope/rank invariance | No ranking route/aggregator change; no historical recalculation | Review gate plus unchanged `aggregateChopeRanking`; full review-SHA certification pending |

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

## TAP-68 operational mode transition matrix

Mode transitions are guarded server-side and the UI keeps the current selection
when the API rejects a request. `evento.status=ABERTO` is the active-event
condition; scheduled and closed events do not block returning to CAIXA.

| Case | Precondition | Requested transition | Expected result | Direct API / UI evidence |
| --- | --- | --- | --- | --- |
| T68-01 | CAIXA, open cash session | CAIXA -> EVENTO | BLOCKED, HTTP 409, `OPEN_CASH_REGISTER` | service test + UI error |
| T68-02 | CAIXA, no open cash | CAIXA -> EVENTO | ALLOWED | service test |
| T68-03 | EVENTO, active event (`ABERTO`) | EVENTO -> CAIXA | BLOCKED, HTTP 409, `ACTIVE_EVENT` | service test + UI error |
| T68-04 | EVENTO, scheduled event | EVENTO -> CAIXA | ALLOWED | service test |
| T68-05 | EVENTO, closed event | EVENTO -> CAIXA | ALLOWED | service test |
| T68-06 | Any guarded transition, concurrent requests | Same transition twice | no partial update; both requests observe guard | concurrency test |
| T68-07 | Any capability combination | Mode rejection | inventory/kitchen/taps/direct-sales flags unchanged | 16-case static matrix |

The static configuration oracle covers 16/16 combinations of mode, inventory,
kitchen and direct-sales flags. Scheduled-event, refresh/repeat and direct API
paths are included in the backend guard tests; no route can bypass the guard.
