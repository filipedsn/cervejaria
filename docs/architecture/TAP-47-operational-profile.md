# TAP-47 — F1 Operational Profile

## Contract

`getOperationalProfile(tenantId)` is a reusable, read-only backend service in `backend/src/lib/operational-profile.ts`. It returns `null` for an unknown tenant and otherwise returns:

```ts
{
  tenantId: string,
  capabilities: {
    cashRegister: boolean,
    inventory: boolean,
    kitchen: boolean,
    taps: boolean,
    directSales: boolean,
    plannedOperations: boolean,
  },
  operationalUnits: { trailers: number, pointsOfSale: number },
  operations: { planned: number, openPlanned: number, openCashRegisters: number },
  legacy: {
    compatibilityOnly: true,
    quiosqueEnabled: boolean,
    exclusivo: boolean | null,
  },
}
```

There is intentionally no company `mode`, CERVEJARIA/QUIOSQUE/HIBRIDA value, or fixed/agendado/ambos enum. The `legacy` block is diagnostic compatibility data and is not a business-rule input for new consumers.

## Legacy-to-capability mapping

| Capability | Current evidence and derivation | F2 classification |
|---|---|---|
| `cashRegister` | active `ConfiguracaoQuiosque` plus active `PontoVenda`; current direct sale asserts an open `SessaoCaixaQuiosque` | PERSIST_REQUIRED — optional cash needs an explicit independent future signal |
| `inventory` | active config plus `controlaEstoque`; product-level stock remains a separate rule | DERIVABLE |
| `kitchen` | active config plus `temCozinha`; `exigePreparo` remains product-level | DERIVABLE |
| `taps` | count of active `Tap`, scoped to tenant | DERIVABLE |
| `directSales` | active config plus active `PontoVenda`; no event is required by its current sale route | DERIVABLE |
| `plannedOperations` | count of active `Trailer`, the current prerequisite unit for `Evento` | DERIVABLE |

`cashRegister` is the only F1 persistence requirement: the approved future model allows direct sales without cash, while the legacy direct-sale implementation always requires a cash session. The other capabilities can safely remain derived during F2 while explicit-capability persistence is introduced only where it unlocks a new supported combination.

## CIA Maritima DEV golden profile

Read-only DEV validation against the refreshed dump returned:

```text
plannedOperations=true; taps=true; directSales=false
cashRegister=false; inventory=false; kitchen=false
trailers=1; pointsOfSale=0; planned events=22; active taps=5
```

The golden test is tenant-scoped and also verifies that active POS units belonging to QA tenants do not appear in CIA Maritima's profile. The test uses only the `cia-maritima` slug, never personal data.

## QA capability matrix

| Capability combination | F1 validation source |
|---|---|
| planned operations + taps | CIA Maritima DEV golden test |
| direct sales + cash register | `qa-cfg-quiosque-00` DEV fixture |
| direct sales + inventory | `qa-cfg-quiosque-10` DEV fixture |
| direct sales + kitchen | `qa-cfg-quiosque-01` DEV fixture |
| direct sales + inventory + kitchen | `qa-cfg-quiosque-11` DEV fixture |
| planned operations + direct sales + cash | `qa-cfg-hibrida-00` DEV fixture |

These DEV golden tests validate read-only profile derivation only. They are explicitly opt-in with `RUN_DEV_GOLDEN_PROFILE_TESTS=1`, so CI's isolated database does not pretend to be the refreshed DEV dump. Dedicated QA tenants remain the execution source for end-to-end sale, stock, kitchen and cash behavior; this F1 service does not modify those flows.

## Read-only, isolation and performance

The reader uses one `prisma.cervejaria.findUnique({ where: { id: tenantId } })` with filtered child relations. It has no transaction, raw SQL, write delegate, cache or side effect. All aggregates originate from tenant-owned relations, preventing cross-tenant aggregation. This avoids capability-by-capability queries and N+1 reads.

## TAP-6 future adaptation

TAP-6 keeps its readiness transport, cache and tutorial infrastructure. F5 will replace module mode/selection with operational-profile capabilities plus missing operational requirements. TAP-6 was not changed in F1.

## Rollout

`FEATURE_FLAG_REQUIRED=NO` for F1: the service has no registered consumer and cannot alter production behavior. F2 must reassess the flag when any consumer is cut over.

`PROD_ACCESS_USED=NO` and `PROD_PROFILE_DISCOVERY_REQUIRED=NO`.
