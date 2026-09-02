# TQ-SA-HEALTH-01 — Support Analyst health model

## Status

`CLOSED`. This is a local, file-based observability foundation. It does not start a daemon, use a database, contact production Elasticsearch, integrate the Ops Panel, create a watchdog, or restart anything.

## Contract and domains

`SupportAnalystHealthSnapshot` V1 is written atomically to `<SUPPORT_ANALYST_RUNTIME_DIR>/health/health.json`. It has the five explicit domains `process`, `elastic`, `processing`, `llm`, and `quality`; each uses only `HEALTHY`, `DEGRADED`, `UNHEALTHY`, or `UNKNOWN`. It also exposes bounded counters, stable reason codes, progress timestamps, and `deterministicShadowReady`, `llmShadowReady`, and `shadowReadiness`.

The heartbeat is atomically written to `<SUPPORT_ANALYST_RUNTIME_DIR>/health/heartbeat.json`; it contains only schema version, start time, heartbeat time, Analyst version, and an optional supplied git SHA. It contains no hostname, username, credentials, raw Elasticsearch data, errors, stacks, tokens, or PII.

Defaults are `SUPPORT_ANALYST_HEALTH_ENABLED=true`, heartbeat every 30 seconds, heartbeat stale after 90 seconds, snapshot stale after 120 seconds, and processing-stall evaluation after 300 seconds. All use an injected clock in the model/tests.

## Rules

Process is unhealthy for missing/stale heartbeat, fatal state, clean shutdown, or no start. Elastic is healthy following a recent successful read; a subsequent recent failed read is degraded, while no successful read or a stale success is unhealthy. Only the pre-existing read-only credential can be used by callers; the health evaluator makes no network call.

Processing records cycles, event normalization, incident/dossier counts and durations. A completed empty source poll is healthy idle. A cycle that starts but does not complete beyond the threshold is unhealthy, which distinguishes idle from stuck.

An LLM disabled with `SUPPORT_ANALYST_LLM_ENABLED=false` is `HEALTHY` with `disabled` detail. A reachable/model failure makes only LLM unhealthy and overall degraded because the deterministic pipeline remains the authority. Since-start quality is intentionally simple: no attempts is `UNKNOWN`; timeout >=25%, fallback >=50%, invalid output >=20%, or guardrail blocks >=20% makes it degraded. These conservative V1 thresholds do not make quality unhealthy and reference the SA-08 baseline only as documentation.

Process, Elastic, or processing unhealthy makes overall unhealthy. Otherwise an unhealthy LLM or degraded Elastic/processing/quality makes overall degraded. `deterministicShadowReady` requires healthy process, Elastic and processing. `llmShadowReady` additionally requires enabled/healthy LLM and non-degraded quality. This hands off to SA-09 without beginning it.

## External read-only commands

`npm run analyst:health-status` prints a compact current snapshot. `npm run analyst:health-check` is deliberately independent of in-memory Analyst state: it reads only the two health files, checks their freshness, and returns `0` healthy, `1` degraded, `2` unhealthy, or `3` unknown/configuration error. `npm run analyst:health-json` emits the current JSON. `npm run analyst:health-smoke` creates a synthetic local healthy-idle snapshot only; it makes no Elastic or Ollama request and starts no daemon.

The checker treats absent/stale artifacts as unhealthy even if their last recorded overall value was healthy. Its output uses stable codes such as `HEARTBEAT_STALE`, `HEALTH_SNAPSHOT_STALE`, `ELASTIC_UNREACHABLE`, `PROCESSING_STALLED`, `LLM_UNREACHABLE`, and `QUALITY_INSUFFICIENT_DATA` rather than raw error text.

## Fail-soft and limitations

All health writes are bounded atomic JSON writes. A write failure is swallowed by `HealthTracker`, so deterministic source processing continues. The system does not use PID-only health, WMI, Prometheus, SQLite, auto-restart, kill/restart actions, scheduled-task recovery, or an Ops Panel change. Existing source smoke uses only DEV when explicitly configured; no production Elasticsearch validation was made.

The real hooks are now used by `SupportAnalystRuntime` in `TQ-SA-PILOT-01`: cycle start/completion/failure, source read, dossier counters and optional LLM analyzer attempt/result. HEALTH-01 itself remains a file-only model and still does not create a watchdog/restart. TQ-SA-PILOT-01 supplies the separate foreground loop/runbook foundation; SA-09 is released only for planning, not started.
