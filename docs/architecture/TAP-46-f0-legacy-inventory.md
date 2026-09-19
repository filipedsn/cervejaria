# TAP-46 — F0 Legacy Inventory

Status: concluded discovery (no functional changes)  
Scope: source tree, Prisma schema/migrations, DEV database aggregate counts, QA/E2E and Ops references.  
Out of scope: production data access, implementation, schema changes, migrations and endpoint changes.

## 1. Executive summary

The current split is not a persisted company-mode enum. `CERVEJARIA`, `QUIOSQUE` and `HIBRIDA` are derived from a combination of `ConfiguracaoQuiosque.ativo` and `ConfiguracaoQuiosque.exclusivo`:

- no active configuration: Cervejaria flow;
- active configuration + `exclusivo=true`: Quiosque-only flow;
- active configuration + `exclusivo=false`: Hybrid flow.

This is a material operational split, not merely a UI label. The event/trailer/tap flow and point-of-sale/cash/inventory/kitchen flow have different aggregates and persistence, while `Comanda` was partially unified in migration `20260813200000_unificar_comanda_quiosque`. The first safe convergence point is therefore a read-only operational profile, not table or endpoint consolidation.

### Classification totals

| Classification | Count | Meaning |
|---|---:|---|
| KEEP | 10 | Must survive as a domain/technical concept in the next model. |
| MIGRATE | 21 | Real behavior/data that must be read through capabilities or a new abstraction. |
| DEPRECATE | 8 | Legacy module/mode terminology or adapter behavior to retire after cutover. |
| REMOVE | 2 | Legacy-only mode presentation/decision after consumers have migrated. |
| UNKNOWN | 4 | Requires production distribution or product decision before classification. |
| DEAD_CODE_CANDIDATE | 0 | No confirmed dead legacy code; no removal is justified from static inspection alone. |

`PROD_DATA_DISCOVERY_REQUIRED=YES`: no production database was queried. F2 needs a separately authorized, read-only production distribution before defining backfill rules.

## 2. Database / Prisma inventory

Source of truth: `backend/prisma/schema.prisma`; migration history under `backend/prisma/migrations`.

| Object | Current use / consumers | Historical-data significance | Classification | Phase |
|---|---|---|---|---|
| `Cervejaria` | Tenant root for auth, branding, users, products, clients, operations and audit | Tenant FK for almost all business history | KEEP | F1+ |
| `ConfiguracaoQuiosque` | Enables quiosque; carries `ativo`, `exclusivo`, kitchen/inventory and UI config | Defines legacy derived mode | MIGRATE | F1/F2/F7 |
| `Trailer` | Event unit, tap owner, public QR URL parameter, trailer selector | Event, QR, tap and sales history | MIGRATE | F6 (only if justified) |
| `PontoVenda` | Unit for quiosque commandas, cash, stock and kitchen orders | Cash/stock audit and sales history | MIGRATE | F6 (only if justified) |
| `Evento` | Schedule, live operation, location, menu, QR and tap-mounting context | Event sales, portal and audit history | MIGRATE | F1/F6 |
| `Produto` / `Preco` | Event catalog; type/format, volume pricing, tap and event menu relations | Item, portal and price history | MIGRATE | F6, not early phases |
| `ProdutoQuiosque` | Unit-price catalog with `exigePreparo` and per-product stock rule | Item, stock, menu and cash history | MIGRATE | F6, not early phases |
| `Tap` / `TapMontagem` | Physical dispense resource attached to Trailer and operationally mounted per Evento | Tap and event audit history | MIGRATE | F1/F6 |
| `Comanda` / `ItemComanda` / `Pagamento` | Unified sale aggregate, branching by `origem`; foreign keys point to event or POS and product or quiosque product | Critical financial/customer history | KEEP | F3 |
| `PedidoCliente` / `PedidoClienteItem` | Public portal event orders, client session and event notification | Portal history | KEEP | F3/F6 |
| `PedidoQuiosque` / status history | Kitchen round within a POS comanda | Preparation and inventory history | MIGRATE | F3/F6 |
| `SessaoCaixaQuiosque` / movements / session products | Cash shift tied to POS and operational day | Financial/audit history | MIGRATE | F1/F3 |
| `EstoqueSaldoQuiosque` / `MovimentoEstoqueQuiosque` | Materialized stock and immutable-ish movements by POS/product | Stock reconciliation/audit | MIGRATE | F1/F3 |
| `Cardapio`, `EventoProduto` | Event menu and price context | Event availability and prices | KEEP | F3 |
| `CardapioQuiosque`, session menu tables | POS menu and shift price overrides | Cash-shift price context | MIGRATE | F3/F6 |
| `ComandaOrigem` | `EVENTO` or `QUIOSQUE` branch for current aggregate | Used by queries, closing, metrics and migrations | MIGRATE | F3/F7 |
| `ProdutoTipo`, `FormatoBebida` | Product traits; `CHOPE` drives tap behavior | Product semantics, not company mode | KEEP | F1/F6 |
| Quisoque-specific status/movement enums | Kitchen, cash and stock workflows | Historical enum values | MIGRATE | F3/F8 only after history strategy |
| `RecorrenciaTipo`, `EventStatus` | Schedule and live-operation state | Event history | KEEP | F1/F6 |
| `TransacaoTipo` values prefixed `QUIOSQUE_*` | Audit and observability contracts | Audit history / dashboards | DEPRECATE | F7/F8 |

### Legacy flags and derived decisions

| Field / expression | Consumers | Real domain target | Classification |
|---|---|---|---|
| `ConfiguracaoQuiosque.ativo` | route guard, context endpoint, admin, navigation | capability/profile availability | MIGRATE |
| `ConfiguracaoQuiosque.exclusivo` | admin derivation, redirects, layout, readiness | legacy presentation mode only | REMOVE |
| `controlaEstoque` | stock route guard, sales, readiness, configuration | inventory capability | MIGRATE |
| `temCozinha` | kitchen route guard, item/order creation, readiness | kitchen capability | MIGRATE |
| `ProdutoQuiosque.controlaEstoque` | stock movements/sale reversal | product-level stock rule | KEEP |
| `ProdutoQuiosque.exigePreparo` | kitchen queue and order status | product preparation trait | KEEP |
| `Cervejaria.usaCardapio` / `ConfiguracaoQuiosque.usaCardapio` | independent menu pricing toggles | product/pricing policy | UNKNOWN |
| `Cervejaria.exibirKpisComanda`, `comandasColunaUnica` | presentation | UI preference, not operation capability | KEEP |

## 3. Backend inventory

| File / area | Legacy dependency and current rule | Future dependency | Classification |
|---|---|---|---|
| `routes/admin.ts` | Receives `moduloCervejaria`/`moduloQuiosque`; creates default Trailer, activates quiosque and sets `exclusivo` | Establishment capability setup | MIGRATE |
| `lib/quiosque/modulo.ts` | `requireModuloQuiosque` gate and `ativarModuloQuiosque`; creates first POS | operational profile/capability guard | DEPRECATE |
| `lib/quiosque/capacidades.ts` | kitchen/stock toggles scoped to active quiosque; explicitly preserves mode | capability service | MIGRATE |
| `routes/quiosque/index.ts` | publishes context and protects all `/api/quiosque/*` routes | profile plus unit/capability guards | MIGRATE |
| `routes/quiosque/caixa.ts`, `lib/quiosque/caixa.ts` | cash shifts required by quiosque route context and POS | cash capability + unit + shift | MIGRATE |
| `routes/quiosque/estoque.ts`, `lib/quiosque/estoque.ts` | blocked unless tenant stock flag; product/POS movements | inventory capability + product rule + unit | MIGRATE |
| `routes/quiosque/cozinha.ts`, `lib/quiosque/cozinha.ts` | blocked unless kitchen flag; queue is `PedidoQuiosque` | kitchen capability + preparation order | MIGRATE |
| `routes/quiosque/comandas.ts`, `vendas.ts`, `lib/quiosque/venda.ts` | creates `origem=QUIOSQUE`, uses POS products and optional kitchen/stock | direct-sale operation | MIGRATE |
| `routes/eventos.ts`, `lib/evento-*` | event is planned/live sale context; requires Trailer | operation, schedule optional | MIGRATE |
| `routes/trailers.ts`, `lib/trailer-*` | physical event/tap unit and defaults | operational unit | MIGRATE |
| `routes/taps.ts`, `lib/tap-montagem.ts` | Tap must belong to Trailer; active mount must belong to Evento | taps capability + operational unit | MIGRATE |
| `routes/produtos.ts`, `comanda-service.ts` | event product/volume/tap sales | product traits and sale context | MIGRATE |
| `routes/public.ts`, `lib/portal-cliente.ts` | public portal is `cervejaria/:slug/trailer/:id`, resolves open event | public operation/unit portal | MIGRATE |
| `routes/comandas.ts`, `pagamentos.ts`, `vendas-avulsas.ts`, `lib/fechar-comanda.ts` | origin controls querying, audit type, metrics and client-stat behavior | operation kind; never module proxy | MIGRATE |
| `routes/onboarding.ts`, `lib/onboarding/readiness.ts` | calculates modules and derives mode from quiosque/exclusivo | profile-driven readiness | DEPRECATE |
| `routes/auth.ts`, `types/auth.ts`, tenant helpers | Cervejaria ID scopes tenant and roles | tenant remains technical root | KEEP |
| `lib/transacao-log.ts`, metrics, realtime | `QUIOSQUE_*` vs event-specific events | operation/capability dimensions | MIGRATE |

### Relevant conditional inventory

| Location | Current rule | Presumed domain rule | Future category |
|---|---|---|---|
| `routes/admin.ts:165-175` | derives `temCervejaria` from quiosque + `exclusivo` | show enabled establishment capabilities | LEGACY_ONLY |
| `lib/onboarding/readiness.ts:122-127,255` | derives CERVEJARIA/QUIOSQUE/HIBRIDA and suppresses brewery facts | calculate requirements of enabled operation | CAPABILITY |
| `lib/quiosque/modulo.ts:64-80` | denies all quiosque routes when no active configuration | route needs named capability | CAPABILITY |
| `routes/quiosque/estoque.ts` | 404 when stock is disabled | inventory capability | CAPABILITY |
| `routes/quiosque/cozinha.ts` | 404 when kitchen is disabled | kitchen capability | CAPABILITY |
| `routes/quiosque/caixa.ts` | cash session resolved by POS | cash belongs to unit/shift | UNIT |
| `routes/public.ts` | requires trailer and open event | public operation/unit must be active | OPERATION |
| `lib/fechar-comanda.ts` | changes behavior from `origem` | operation context, customer policy, payment | OPERATION |

## 4. Frontend inventory

| Route / component | Current dependency | Future dependency | Classification |
|---|---|---|---|
| `App.tsx` | `RequireModuloQuiosque`, `RequireModuloCervejaria`, capability guards and exclusive redirects | profile/capability/unit route guards | MIGRATE |
| `/quiosque/*` pages | separate POS, cash, stock, kitchen, menu and dashboard URLs | retain workflows; migrate navigation/guards | MIGRATE |
| `/eventos`, `/trailer`, `/comandas`, `/configuracoes` | event/trailer flow and tenant settings | operations and units | MIGRATE |
| `Layout.tsx`, `NavIcons.tsx`, `AccountMenu.tsx` | menu and settings target use `ativo/exclusivo` | capability-driven navigation | REMOVE |
| `useQuiosqueContexto.ts` | calls `/api/quiosque/contexto` and exposes legacy shape | operational profile hook | DEPRECATE |
| `EventoContext.tsx`, trailer selector/QR components | selected Trailer and open Evento | selected unit/operation | MIGRATE |
| `OperacaoPage.tsx` | kitchen/stock setting under quiosque | operation capabilities | MIGRATE |
| `AdminCervejariasPage.tsx` | module selector, badges and `modoEmpresa` | establishment setup/capabilities | REMOVE |
| `lib/onboarding.ts`, `OnboardingContext.tsx`, `OnboardingSurface.tsx`, checklist | `mode`, `selectedModule`, hybrid selector | capability readiness and next action | DEPRECATE |
| public portal `/c/:slug/t/:trailerId` | route and API contract name Trailer | public operational-unit portal | MIGRATE |

Route classification: public portal routes are public with a dedicated client session; all operational routes are authenticated tenant routes. Owner-only restrictions apply to settings, dashboards, reports and sensitive cash operations. Role is a separate concern and must not become a capability proxy.

## 5. Trailer x PontoVenda

| Concern | Trailer | PontoVenda | Conclusion |
|---|---|---|---|
| Tenant ownership | `cervejariaId` | `cervejariaId` | convergible |
| Main operation | Event and tap operation | direct sales, cash shift, stock, kitchen | domain difference today |
| Required child | Evento and Tap | cash, stock, kitchen orders | mixed |
| QR | public URL and client session use Trailer | no QR implementation found | migrate QR to generic unit only after compatibility work |
| Sales | Evento-origin Comanda | QUIOSQUE-origin Comanda | unified aggregate, different context |
| Audit/reporting | event/tap transaction logs and dashboards | cash/stock/kitchen logs and dashboards | migrate dimensions, preserve history |

Both are operational units conceptually; neither table is safe to remove before F6/F8. `Tap.trailerId` and portal URLs are the strongest current technical coupling to Trailer.

## 6. Produto x ProdutoQuiosque

**Essential differences:** `Produto` has beverage format, chope/volume prices, event menu and tap relationships. `ProdutoQuiosque` has unit price, category, `exigePreparo`, per-product stock and ordering.

**Convergible differences:** active state, name, tenant ownership, product availability, price snapshots in `ItemComanda`, menus and reporting dimensions.

**Legacy differences:** separate model names, API namespaces and duplicated menu/template structures.

**Unknown:** whether a single product record must simultaneously expose unit and volume price variants, or whether variants become first-class. This is a F6 product decision, not an F1/F2 assumption.

## 7. Evento

`Evento` currently combines schedule/recurrence, location, live status, sales context, event menu, portal generation, QR availability, tap mounting, reporting and audit. It is an operation aggregate with planned-operation features, not merely an event label. Migrate its conceptual name only after F1 defines operation semantics; keep its persistence and QR contract in early phases.

## 8. Caixa

`SessaoCaixaQuiosque` is owned by `PontoVenda` and operational day, permits multiple shifts, stores opening/closing reconciliation and menu snapshot, and has manual movements/corrections with audit events. Consumers include cash routes, direct-sale flows, dashboards, reports and E2E/QA suites.

Risk: **CRITICAL** for financial reconciliation and sale closure. Future rule: cash is optional per operation; when enabled it requires a session for that unit/shift, and no artificial session may be introduced for valid non-cash flows.

## 9. Estoque

Global tenant flag `controlaEstoque` gates the feature. Product-level `ProdutoQuiosque.controlaEstoque` decides whether an item participates. `EstoqueSaldoQuiosque` and `MovimentoEstoqueQuiosque` are scoped to POS/product; sale, cancel/estorno, entry, loss, courtesy, internal use and adjustment are consumers.

Risk: **CRITICAL** for reconciliation. The tenant capability and product rule are separate and both must survive F1-F3.

## 10. Cozinha

Kitchen requires `temCozinha`; an item enters the queue only when `exigePreparo`. `PedidoQuiosque`, status history, realtime notifications, cancellation rules and preparation metrics implement the flow.

The dependency on the Quisoque namespace is technical legacy; the actual rule is a kitchen-capable operation selling preparation-required products. Risk: **HIGH**, because cancellation interacts with open/closed commandas and stock reversal.

## 11. Taps

Taps are physical resources currently constrained to Trailer. `TapMontagem` ties the active chope to an Evento, while public cardapio and orders validate tap/product/volume against an open event. This proves that the conceptual dependency is an operational unit plus operation, but the technical dependency is Trailer.

Risk: **HIGH**: preserve public QR, chope validation, mounting history and event reporting before changing this relation.

## 12. Comanda / Pedido

`Comanda` is already shared but `ComandaOrigem` remains a module proxy: it selects Event versus POS relations, product foreign key, closing/audit/metric behavior and day/number semantics. `PedidoCliente` is the public Event flow; `PedidoQuiosque` is the kitchen round for POS flow.

Origem usada como módulo: **SIM**.

## 13. TAP-6

| Classification | Inventory |
|---|---|
| KEEP_INFRA | `GET /api/onboarding/readiness`, React Query key/invalidation, context, auto/manual start, local dismiss, visual targets/tutorial. |
| MIGRATE_SEMANTICS | backend/frontend `OnboardingMode`, module readiness facts, mode derivation, `selectedModule`, next-action selection. |
| REMOVE | hybrid module picker and CERVEJARIA/QUIOSQUE/HIBRIDA UI copy after profile rollout. |

## 14. Admin / establishment registration

`routes/admin.ts` and `AdminCervejariasPage.tsx` currently collect `moduloCervejaria` and `moduloQuiosque`. Cervejaria module creates a default Trailer and default Taps; Quiosque activation creates `ConfiguracaoQuiosque` plus a default PontoVenda; `exclusivo` is set to `!moduloCervejaria`.

This is the source of the legacy mode derivation and must migrate in F4. It must not be altered before the F1/F2 compatibility path exists.

## 15. QA, seeds and tests

| Classification | Suites / fixtures |
|---|---|
| KEEP | portal, multi-tenant, payment, sales, cash, stock, kitchen, tap mounting, event lifecycle and auth suites. |
| ADAPT | `hibrida-modulos.spec.ts`, `onboarding-readiness.spec.ts`, `onboarding-frontend.spec.ts`, quiosque context/capability tests, QA `cfg-tests.ts` and seed configuration matrix. |
| REMOVE_LATER | assertions whose only purpose is module naming, exclusive redirects or hybrid selection after equivalent capability coverage exists. |

Relevant assets include `backend/qa/lib/seed.ts`, `backend/qa/lib/cfg-tests.ts`, quiosque QA libraries, `e2e/quiosque-*.spec.ts`, `e2e/hibrida-modulos.spec.ts`, `e2e/onboarding-*.spec.ts`, portal E2E tests and frontend onboarding/quiosque unit tests.

## 16. Observability / Ops

`TransacaoTipo` contains `QUIOSQUE_*` audit types; business metrics use `cervejaria`/`quiosque` dimensions; realtime event names include `quiosque:*`. QA/observability tests and support analyst normalization consume audit/HTTP data. Product deployment, database and backup scripts use the historical repository/service naming but no deployment script was found to branch behavior on `exclusivo`.

Classification: audit, metrics and realtime names are **MIGRATE**; scripts and dashboards with only naming references are **UNKNOWN** until their production queries/dashboards are enumerated in F0 follow-up evidence.

## 17. DEV data counts

Read-only query against isolated `cervejaria_dev` at localhost:5434. No production access occurred.

| Measure | Count |
|---|---:|
| Tenants | 71 |
| Active Quiosque configurations | 23 |
| Derived quiosque-only (`exclusivo=true`) | 16 |
| Derived hybrid (`exclusivo=false`) | 7 |
| Tenants without active quiosque | 48 |
| Trailers / POS points | 56 / 36 |
| Events / Taps | 77 / 78 |
| Produtos / ProdutoQuiosque | 66 / 38 |
| Cash sessions / stock balances | 41 / 15 |
| Kitchen-capable tenants / inventory-capable tenants | 11 / 7 |
| Preparation products / stock-controlled products | 9 / 28 |
| Event-origin / Quiosque-origin commandas | 916 / 176 |
| Public portal orders / Tap mountings / open events | 84 / 161 / 50 |

The DEV distribution confirms all three legacy-derived profiles and material history in both sale paths. It is not a substitute for production distribution.

## 18. Dependency graph

```text
Cervejaria (technical tenant)
├─ ConfiguracaoQuiosque
│  ├─ ativo/exclusivo → admin badges + route guards + redirects + onboarding mode
│  ├─ controlaEstoque → stock routes + sale/reversal rules
│  └─ temCozinha → kitchen routes + order queue
├─ Trailer → Evento → TapMontagem → Tap → Produto/Preco
│              ├─ Comanda(EVENTO) → ItemComanda → Pagamento
│              └─ Public QR / client session → PedidoCliente
└─ PontoVenda → SessaoCaixaQuiosque → shift menu / cash movements
               ├─ EstoqueSaldo/Movimento → ProdutoQuiosque
               ├─ Comanda(QUIOSQUE) → ItemComanda → Pagamento
               └─ PedidoQuiosque → preparation status/history

Comanda.origim is the current bridge and a legacy module proxy.
```

## 19. Legacy catalog for F8

| ID | Type | Item | Classification | Consumers | Phase | F8 removal condition |
|---|---|---|---|---|---|---|
| LEG-01 | Flag | `ConfiguracaoQuiosque.exclusivo` | REMOVE | admin, app guards, layout, readiness | F7 | all consumers read profile/capabilities |
| LEG-02 | Derived mode | CERVEJARIA/QUIOSQUE/HIBRIDA | REMOVE | onboarding, admin badges/tests | F5/F7 | no UI/backend decision consumes mode |
| LEG-03 | Guard | `requireModuloQuiosque` | DEPRECATE | all quiosque routes | F3/F7 | named capability guards replace it |
| LEG-04 | API shape | `/api/quiosque/contexto` legacy fields | DEPRECATE | frontend context/layout | F3/F4 | profile endpoint adopted |
| LEG-05 | Entity | `ConfiguracaoQuiosque` as module switch | MIGRATE | backend/frontend/admin | F2/F7 | persistent capabilities own source of truth |
| LEG-06 | Entity | Trailer-only unit relation | MIGRATE | event/tap/QR | F6 | unit abstraction and QR compatibility proven |
| LEG-07 | Entity | PontoVenda-only unit relation | MIGRATE | cash/stock/kitchen | F6 | unit abstraction and financial reconciliation proven |
| LEG-08 | Enum | `ComandaOrigem` as module proxy | MIGRATE | closing/metrics/queries | F3/F7 | operation context replaces conditional branching |
| LEG-09 | Product model | `Produto` vs `ProdutoQuiosque` split | MIGRATE | sales/menus/items | F6 | product variant and pricing migration reconciled |
| LEG-10 | Audit | `QUIOSQUE_*` transaction names | DEPRECATE | audit/metrics/QA | F7/F8 | dashboards and retained history strategy approved |
| LEG-11 | UI | quiosque/brewery navigation labels | DEPRECATE | menu/account/config | F4/F7 | operation/capability navigation released |
| LEG-12 | Onboarding | `mode` / `selectedModule` | DEPRECATE | TAP-6 | F5 | capability next-action coverage green |

## 20. Dead code candidates

None confirmed. Static search shows active consumers for every legacy aggregate identified. A lack of a currently visible consumer is not sufficient grounds for removal because Prisma relations, migrations, public URLs, QA scripts and historical data remain relevant.

## 21. Real duplications

| Item | Type | Evidence |
|---|---|---|
| Product/menu persistence | DUPLICATION_REAL | `Produto`/`Cardapio` and `ProdutoQuiosque`/`CardapioQuiosque` duplicate tenant catalog concerns but differ in price and traits. |
| Sale/order flows | DOMAIN_DIFFERENCE | both create shared commandas, but event portal/tap flow differs materially from direct POS/kitchen flow. |
| Payment/close behavior | DUPLICATION_REAL | shared payment aggregate, but closing/metrics/audit branch by origin. |
| Dashboard/reporting | DUPLICATION_REAL | event and quiosque dashboards aggregate parallel concepts with different dimensions. |
| Kitchen and taps | DOMAIN_DIFFERENCE | preparation queue and dispense mounting are distinct operational capabilities, not duplicates. |

## 22. Risk register

- **CRITICAL:** tenant isolation; commandas/payments/closing; stock balance and reversal; public QR/client session; product history and pricing.
- **HIGH:** cash shifts; taps/mounting; event lifecycle; kitchen cancellation; onboarding semantic cutover; audit/realtime dimensions.
- **MEDIUM:** menus/cardápio toggles; navigation; dashboards; admin creation defaults.
- **LOW:** labels, badges and terminology after consumers have migrated.

## 23. Golden scenario coverage

| Legacy item | Golden scenarios |
|---|---|
| Trailer, Evento, Tap, TapMontagem | 1, 6, 8, 12, 14 |
| PontoVenda, cash session | 2, 8, 15, 17 |
| Kitchen and preparation products | 3, 5, 16 |
| Inventory flag/products/balances | 4, 5, 16 |
| Product split and pricing | 1–8, 13–16 |
| `exclusivo` and derived modes | 9, 10, 11 |
| Shared Comanda/Payment | 1–5, 8, 13, 15–17 |
| Public portal and client session | 1, 12, 14, 18 |
| Tenant scoping and audit | 9–18 |

## F0 completion gate

Database, backend, frontend, routes, tests/seeds, Ops/observability, dependency graph, classifications, removal conditions, risk register and DEV read-only evidence are present in this document. No functional implementation was performed. F1 remains blocked pending human review of this inventory.
