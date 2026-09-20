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
- `MINIMUM_SUPPORTED_UPGRADE_BASELINE=UNDEFINED` unless an explicit version matrix is supplied by the release owner. `UPGRADE_BASELINE_REQUIRED_BEFORE_PHYSICAL_F8_REMOVAL=YES`.

## Preflight and backup

Run `scripts/release/bridge-release-preflight.ps1 -DryRun` in DEV/QA. Capture JSON output. For a future PROD execution, take the approved backup before stopping the application. PROD execution is intentionally not performed in this preparation.

Migration validation evidence for this preparation: `prisma migrate status` found 56 migrations and reported the DEV schema up to date; `prisma migrate deploy` reported no pending migrations. The commands used the existing DEV owner URL from `.env.development`; no PROD URL was loaded.

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

For the DEV evidence window, query `logs-technical*.otel-dev*` using the existing DEV read-only Analyst credential and filter `data_stream.namespace=dev`, `resource.attributes.service.name=quiver-tap-api-dev`, and the event fields `body.text=legacy_fallback`, `attributes.event.action=legacy_fallback`, or `attributes.legacy.kind`. The bridge also emits the same event through the OTel logs API. Do not treat stdout as Elastic evidence.

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
| CI_GREEN | PASS | PENDING_PROD | PR #30 checks |
| MIGRATIONS_VALIDATED | PASS | PENDING_PROD | 56 migrations; status up to date; deploy no pending |
| OPERATIONAL_BACKFILL_DRY_RUN | PASS | PENDING_PROD | DEV JSON counters, zero writes |
| OPERATIONAL_BACKFILL_IDEMPOTENT | PASS | PENDING_PROD | second run updated=0 |
| CASH_BACKFILL_DRY_RUN | PASS | PENDING_PROD | DEV JSON counters, zero writes |
| CASH_BACKFILL_IDEMPOTENT | PASS | PENDING_PROD | second run updated=0 |
| RECONCILIATION_PASS | PASS | PENDING_PROD | read-only DEV result: 131/131 and 87/87 |
| SMOKE_PASS | PASS | PENDING_PROD | synthetic TQ-F02B smoke |
| LEGACY_TELEMETRY_AVAILABLE | BLOCKED | PENDING_PROD | metric export is not queryable; structured-log probe also returned zero hits in `logs-technical*.otel-dev*` |
| LEGACY_FALLBACK_HITS_ZERO_DEV | BLOCKED | PENDING_PROD | materialized path produced no local hit; positive/zero Elastic windows cannot be proven until ingestion/queryability is restored |
| ROLLBACK_COMPATIBLE | PASS | PENDING_PROD | legacy retained |
| SENSITIVE_DATA_PASS | BLOCKED | PENDING_PROD | code emits only allowlisted kinds, but Elastic end-to-end payload evidence is pending |

## F8 unlock criteria

After the future bridge PROD execution: `BRIDGE_DEPLOYED`, migrations, both backfills, reconciliation, current smoke, and rollback decision must be evidenced; exercised legacy fallback hits must be zero; upgrade compatibility must be resolved or explicitly bounded. No arbitrary soak duration is a gate. Physical F8 removal remains blocked until then.

## Evidence and explicit PROD-free boundary

Record branch, base SHA, commits, PR/CI, backfill counters, reconciliation, smoke, Elastic DEV evidence, runbook path and pending PROD gates in Plane. This preparation intentionally performs no PROD query, backup, migration, backfill, deploy, restart, health check or smoke.

Current DEV observability finding: the collector repeatedly reports `version_conflict_engine_exception` for generic metrics batches targeting `.ds-metrics-generic.otel-dev-2026.09.19-000005` (`otelcol.signal=metrics`). The error is not attributed to `tapquiver.legacy_fallback.hits`, and no safe exporter/template correction was made. The application control log (`incoming request`/`request completed`) is queryable in `.ds-logs-technical.otel-dev-*`. A direct OTLP probe without explicit data-stream routing was accepted by the receiver (`HTTP 200`, `partialSuccess={}`) but produced no Elastic document; the same probe with explicit `data_stream.type=logs`, `data_stream.dataset=technical` and `data_stream.namespace=dev` was indexed successfully in `.ds-logs-technical.otel-dev-*`. The bridge now emits one canonical Pino technical record with flat ECS fields and environment-derived routing (`event.action`, `legacy.kind`, `data_stream.*`); local unit/build/CI validation passes, but the controlled application event still produced no Elastic document in DEV. Canonical evidence is therefore **not selectable yet**: neither METRIC nor STRUCTURED_LOG is currently end-to-end queryable. Keep TAP-60 In Progress and do not unlock physical F8 removal.

Transport isolation update (2026-09-20): a temporary Fastify process using the same backend/Pino/EDOT bootstrap emitted the automatic `incoming request` and `request completed` records plus `legacy_fallback` in one request. A broad query over the real technical log data stream and the synthetic resource identifier returned zero documents for both. The runtime is configured for EDOT Pino instrumentation (`--import @elastic/opentelemetry-node`), `ELASTIC_OTEL_NODE_ENABLE_LOG_SENDING=true`, `OTEL_LOGS_EXPORTER=otlp`, and OTLP HTTP `127.0.0.1:4318`; however, this current-process probe does not prove delivery to Elastic. Classification is `APPLICATION_PINO_TO_ELASTIC_FAIL`, not `LEGACY_EVENT_SPECIFIC_FAILURE`. Do not change `legacy_fallback` or the metrics pipeline until the application Pino transport/collector receipt is independently observed.

Broad diagnostic ES|QL used for the same-process probe:

```esql
FROM logs-technical.otel-dev*
| WHERE @timestamp >= TO_DATETIME("2026-09-20T03:12:35Z")
  AND @timestamp < TO_DATETIME("2026-09-20T03:13:10Z")
  AND resource.attributes.service.name == "quiver-tap-api-dev"
  AND resource.attributes.service.instance.id == "obs-probe-20260920-a"
| KEEP @timestamp, data_stream, resource, attributes, body, trace_id, span_id
| SORT @timestamp ASC
```

## Application OTLP technical-log transport (2026-09-20)

Classification: `B — OTEL_LOGS_PROVIDER_EXISTS_BUT_PINO_NOT_CONNECTED`.

The EDOT preload initializes trace, metric and log providers. Trace and metric exporters remain the existing OTLP configuration; metrics were not changed. EDOT Pino sending is configured, but the application/Pino probe did not reach Elastic. The technical evidence path is therefore `recordLegacyFallback` -> `emitTechnicalTelemetry` -> one dedicated `LoggerProvider` with one `BatchLogRecordProcessor` and OTLP/HTTP log exporter. It is initialized once at application startup and shut down with the existing SIGINT/error lifecycle. It does not replace general Pino logging and it emits no Pino duplicate for `legacy_fallback`.

The provider resource and record carry the collector-required routing: `data_stream.type=logs`, `data_stream.dataset=technical`, and `data_stream.namespace` derived exclusively by `getObservabilityEnv()` (`dev` outside production, `prd` only in production). The only current business event is `legacy_fallback`; `legacy.kind` is compile-time restricted to `operational_config`, `direct_sales_compat`, or `cash_capability`. The synthetic probe action accepts only a generated `probe.id`. No arbitrary payload, PII, credential, cookie, token, or request body is accepted.

The direct helper probe `tq-otel-helper-probe-20260920-c` was emitted with the real DEV OTLP endpoint and provider shutdown/flush. A broad DEV query found it in `.ds-logs-technical.otel-dev-2026.09.19-000002`; the previous zero was caused by querying `attributes.probe.id.keyword`, which is not the mapped field, and by checking too early during collector batching. The SDK console exporter independently printed the expected LogRecord, including resource-level routing. No log-export error appeared in Collector logs (only the pre-existing generic-metrics `version_conflict_engine_exception`).

The follow-up probe `tq-otel-helper-probe-20260920-d` used the same helper, waited eight seconds, then called the controlled diagnostic flush and shutdown. It was indexed successfully with one hit. `forceFlush` is exposed only for controlled probes/tests and is not called per request.

Helper probe ES|QL:

```esql
FROM logs-technical.otel-dev*
| WHERE attributes.probe.id == "tq-otel-helper-probe-20260920-d"
| KEEP @timestamp, data_stream, resource.attributes.service.name, attributes.event.action, attributes.probe.id, trace_id, span_id
| SORT @timestamp ASC
```

Positive legacy proof ES|QL (not executed in this diagnostic pass):

```esql
FROM logs-technical.otel-dev*
| WHERE attributes.event.action == "legacy_fallback"
  AND attributes.legacy.kind IN ("operational_config", "direct_sales_compat", "cash_capability")
| KEEP @timestamp, data_stream, resource.attributes.service.name, attributes.event.action, attributes.legacy.kind, trace_id, span_id
| SORT @timestamp ASC
```

Zero-window ES|QL (not executed in this diagnostic pass):

```esql
FROM logs-technical.otel-dev*
| WHERE @timestamp >= TO_DATETIME("2026-09-20T03:35:31Z")
  AND attributes.event.action == "legacy_fallback"
| STATS legacy_fallback_hits = COUNT(*)
```

Delivery proof: `OTLP_LOG_PROTOCOL=http/json` (the installed JSON HTTP exporter), host `127.0.0.1`, port `4318`, path `/v1/logs`, effective endpoint `http://127.0.0.1:4318/v1/logs`, no custom headers, exporter timeout default, and batch processor defaults. The direct probe and application exporter use the same endpoint semantics. Application dataset is `technical`; the Collector materializes the known `technical.otel` data stream. `MISROUTED_DOCUMENT_FOUND=NO`. `FORCE_FLUSH_RESULT=PASS`; `LONG_LIVED_PROBE_RESULT=PASS`; `OTLP_EXPORT_ATTEMPTED=YES`; `OTLP_EXPORT_RESULT=HTTP accepted and indexed`. Dedicated provider exports independently; no global-provider interference was observed. Collector internal metrics were not exposed on mapped ports, so no counter delta is claimed.

| Field | Direct OTLP / application exporter | Match |
|---|---|---|
| Protocol | HTTP JSON | YES |
| Host / port | `127.0.0.1:4318` | YES |
| Path | `/v1/logs` | YES |
| Resource service | `quiver-tap-api-dev` | YES |
| Application dataset / materialized stream | `technical` / `technical.otel` | YES |
| Namespace | `dev` | YES |
| Routing type | `logs` | YES |

`CANONICAL_LEGACY_FALLBACK_EVIDENCE=STRUCTURED_OTEL_LOG` is now end-to-end proven for the helper transport. `LEGACY_TELEMETRY_AVAILABLE=PASS`; positive legacy proof, reconciliation and zero-fallback proof remain pending and must run in that order. `SENSITIVE_DATA_PASS=PASS` for the helper document. `METRICS_VERSION_CONFLICT_RELATED_TO_LOG_BLOCKER=NO`; `METRICS_ISSUE_BLOCKS_BRIDGE=NO`.

## DEV gate closure after delivery proof (2026-09-20)

The synthetic `operational_config` positive control emitted through `recordLegacyFallback` was indexed with one hit in `.ds-logs-technical.otel-dev-2026.09.19-000002`. The read-only reconciliation then returned `131/131` operational modes materialized, `87/87` PDV cash capabilities explicit, and `fallbackRequired=0`. No backfill or data restoration was needed because the probe changed no database state.

The synthetic TQ-F02B DEV smoke returned `TQ-F02B SMOKE PASS`. A new zero window after that smoke queried the same technical stream and returned `legacy_fallback` hits `0`.

Positive legacy ES|QL:

```esql
FROM logs-technical.otel-dev*
| WHERE attributes.event.action == "legacy_fallback"
  AND attributes.legacy.kind IN ("operational_config", "direct_sales_compat", "cash_capability")
| KEEP @timestamp, data_stream, resource.attributes.service.name, attributes.event.action, attributes.legacy.kind, trace_id, span_id
| SORT @timestamp ASC
```

Zero-window ES|QL used after TQ-F02B smoke:

```esql
FROM logs-technical.otel-dev*
| WHERE @timestamp >= TO_DATETIME("2026-09-20T04:01:35Z")
  AND attributes.event.action == "legacy_fallback"
| STATS legacy_fallback_hits = COUNT(*)
```

DEV gates now proven: `LEGACY_TELEMETRY_AVAILABLE=PASS`, `LEGACY_FALLBACK_POSITIVE_PROOF=PASS`, `LEGACY_FALLBACK_HITS_ZERO_DEV=PASS`, `SENSITIVE_DATA_PASS=PASS`, `RECONCILIATION_PASS=PASS`, and `SMOKE_PASS=PASS`. PROD remains untouched.
