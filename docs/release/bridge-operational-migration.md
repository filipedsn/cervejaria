# TAP Quiver — Bridge release: operational migration

## Purpose

Prepare and document the first release of the operational architecture that must precede further F8 physical removal. This bridge preserves every legacy field, model, migration and fallback.

## Scope

`ConfiguracaoOperacional` is the source of truth. `plannedOperationsEnabled=true` means `EVENTO`; `false` means `CAIXA`. `directSalesEnabled` remains a compatibility projection (`CAIXA = true`) and is not an independent capability. `PontoVenda.usaCaixa` is the explicit cash capability; `NULL` falls back to active `ConfiguracaoQuiosque.ativo` until materialized.

Current `ConfiguracaoQuiosque` responsibilities remain: `usaCardapio`, `quantidadeMesas`, activation/context/readiness and valid routes. Legacy operational compatibility remains in `ativo`, `exclusivo`, `controlaEstoque`, and `temCozinha`. No field or model is removed by this bridge.

## Preconditions and required versions

- Run from the bridge release branch based on the reconciled `origin/main`.
- Use synthetic DEV/QA tenants only; CIA Marítima is read-only compatibility smoke where applicable.
- Confirm backup gate, migration manifest, release artifact and supported rollback artifact before any future PROD execution.
- `MINIMUM_SUPPORTED_UPGRADE_BASELINE=UNDEFINED` unless an explicit version matrix is supplied by the release owner.

## Preflight and backup

Run `scripts/release/bridge-release-preflight.ps1 -DryRun` in DEV/QA. Capture JSON output. For a future PROD execution, take the approved backup before stopping the application. PROD execution is intentionally not performed in this preparation.

## Migration and backfills

1. Build and publish the release artifact.
2. Controlled stop when required.
3. Run `prisma migrate deploy`.
4. Run `npm run db:backfill-operational-enablement:dry-run --prefix backend`; verify zero writes.
5. Run `npm run db:backfill-operational-enablement --prefix backend`.
6. Run `npm run db:backfill-cash-register:dry-run --prefix backend`; verify zero writes.
7. Run `npm run db:backfill-cash-register --prefix backend`.
8. Run both execute commands a second time; `updated=0` is required.

Both backfills update only eligible `NULL` values, are retry-safe, and never overwrite explicit decisions. Backfill business logic remains outside SQL migrations.

## Reconciliation

Run `npm run db:reconcile-operational-materialization --prefix backend`. It is read-only and exits non-zero when operational mode is unmaterialized or an active PDV still requires the cash fallback.

Required counters: establishments, operational configs, materialized/unmaterialized operational mode, active PDVs, explicit cash capability and PDV cash fallback required.

## Publish, health and smoke

After reconciliation PASS, publish/restart, then verify health/readiness and run the current QA/API smoke and golden suites. Verify `tapquiver.legacy_fallback.hits` with only `kind` labels (`operational_config`, `direct_sales_compat`, `cash_capability`). The target is zero in exercised materialized flows; telemetry and database reconciliation are complementary.

## Failure handling and rollback

- Migration succeeds, backfill fails: keep the application on the compatibility path, inspect the error, and retry the idempotent backfill; do not drop legacy data.
- Backfill 1 succeeds, backfill 2 fails: retry cash backfill; operational materialization is retained and safe.
- Backfills succeed, restart fails: use the existing release recovery/rollback procedure; data remains compatible with the prior version.
- Application starts, reconciliation fails: stop promotion, keep compatibility fallbacks, correct forward, and rerun reconciliation.
- Rollback compatibility is `YES` for this bridge because no legacy field/model/fallback is removed and new columns remain nullable.

## Acceptance gates

| Gate | DEV | PROD | Evidence |
|---|---|---|---|
| BASELINE_RECONCILED | PASS | PENDING_PROD | origin/main SHA and PR #29 merge |
| CI_GREEN | PENDING | PENDING_PROD | PR checks |
| MIGRATIONS_VALIDATED | PENDING | PENDING_PROD | Prisma validation/migrate evidence |
| OPERATIONAL_BACKFILL_DRY_RUN | PENDING | PENDING_PROD | JSON counters, zero writes |
| OPERATIONAL_BACKFILL_IDEMPOTENT | PENDING | PENDING_PROD | second run updated=0 |
| CASH_BACKFILL_DRY_RUN | PENDING | PENDING_PROD | JSON counters, zero writes |
| CASH_BACKFILL_IDEMPOTENT | PENDING | PENDING_PROD | second run updated=0 |
| RECONCILIATION_PASS | PENDING | PENDING_PROD | read-only JSON result |
| SMOKE_PASS | PENDING | PENDING_PROD | QA/golden report |
| LEGACY_TELEMETRY_AVAILABLE | PASS | PENDING_PROD | OTel counter definition |
| LEGACY_FALLBACK_HITS_ZERO_DEV | PENDING | PENDING_PROD | exercised flow metric evidence |
| ROLLBACK_COMPATIBLE | PASS | PENDING_PROD | legacy retained |
| SENSITIVE_DATA_PASS | PASS | PENDING_PROD | low-cardinality `kind` only |

## F8 unlock criteria

After the future bridge PROD execution: `BRIDGE_DEPLOYED`, migrations, both backfills, reconciliation, current smoke, and rollback decision must be evidenced; exercised legacy fallback hits must be zero; upgrade compatibility must be resolved or explicitly bounded. No arbitrary soak duration is a gate. Physical F8 removal remains blocked until then.

## Evidence and explicit PROD-free boundary

Record branch, base SHA, commits, PR/CI, backfill counters, reconciliation, smoke, Elastic DEV evidence, runbook path and pending PROD gates in Plane. This preparation intentionally performs no PROD query, backup, migration, backfill, deploy, restart, health check or smoke.
