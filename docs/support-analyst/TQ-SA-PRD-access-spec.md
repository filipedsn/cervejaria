# TAP Quiver — PROD Support Analyst access specification

Status: specification only. No PROD user, role, or API key is created by this change.

## Purpose

TAP-61 needs bounded read-only evidence from the PROD technical log stream. The proposed logical identity is `quiver-support-analyst-prod`, separate from `quiver-support-analyst-shadow-dev`.

## Minimum capability

The initial identity is limited to:

- cluster privileges: none;
- index/data-stream pattern: `logs-technical*.otel-prd*`;
- index privileges: `read`, `view_index_metadata`;
- query fields: `@timestamp`, `data_stream`, `resource.attributes.service.name`, `attributes.event.action`, `attributes.legacy.kind`, `trace_id`, and `span_id` when present.

Audit logs, alert events, traces, metrics, generic logs, Kibana indices, and backing-index patterns are outside the TAP-61 capability. They require a separately approved capability.

The PROD negative privilege check must also deny `logs-technical*.otel-dev*`, `logs-audit*.otel-dev*`, and `quiver-tap-alert-events-dev`, as well as the other non-TAP-61 patterns. This prevents a PROD key from reading DEV data even if its role is accidentally broadened.

The identity must explicitly lack `write`, `index`, `create`, `create_doc`, `delete`, `manage`, `manage_security`, `manage_index_templates`, `all`, and equivalent mutable privileges.

The validator's PROD `_source` list is query minimization performed by tooling; it is not Elasticsearch Field Level Security. No FLS is configured by this PR. PROD queries return only timestamp/routing, service name, event action, legacy kind, and trace/span identifiers. DEV retains its broader existing support allowlist.

## Two-phase validation contract

PROD validation requires an explicit phase: `--phase=predeploy` or `--phase=postdeploy` (the equivalent `SUPPORT_ANALYST_VALIDATION_PHASE` environment variable is accepted). Missing or invalid PROD phase fails closed.

`predeploy` proves authentication, endpoint and credential classification, technical stream resolution, namespace/mapping fields that already exist, bounded read-back, cross-environment isolation, and read-only privileges. It does not require future bridge fields such as `attributes.event.action` or `attributes.legacy.kind`.

`postdeploy` additionally requires searchable `attributes.event.action` and a positive technical control. The zero-fallback query filters `attributes.event.action=legacy_fallback`; zero hits pass without requiring `attributes.legacy.kind`. When fallback hits exist, every hit must expose an allowed `attributes.legacy.kind` (`operational_config`, `direct_sales_compat`, or `cash_capability`), otherwise validation fails. No PROD probe is emitted by the validator.

## Authentication and safety gates

Use the existing API-key mechanism. Runtime accepts only `SUPPORT_ANALYST_ES_API_KEY`; it must not fall back to basic auth, Collector, Alert Poller, Agent, or DEV credentials.

PROD validation requires all of the following explicit markers:

```text
SUPPORT_ANALYST_ENV=prd
SUPPORT_ANALYST_ALLOW_PRD=true
SUPPORT_ANALYST_CREDENTIAL_ENV=prd
SUPPORT_ANALYST_ENDPOINT_ENV=prd
SUPPORT_ANALYST_ES_URL=<approved PROD endpoint>
```

Missing, ambiguous, or mismatched markers fail closed. The validator performs only authenticate, resolve/field-capability, bounded search, and privilege-inspection requests; it never provisions or mutates Elastic resources.

## Provisioning action required

An authorized Elastic administrator must separately create/authorize the API key with the role descriptor above, place the secret in the approved non-versioned secret store, and provide the logical identity and endpoint classification to the release operator. TAP-61 can then run the PROD read-back validator and discover the actual technical data stream/namespace before any release write.

## Release identity separation

`RELEASE_SHA` remains the bridge runtime SHA `c195c77a18a254e992047693c51b108e80754db6`. A later merge commit for this validator-only PR is `TOOLING_SHA`; it must be used for support/release tooling only. The application artifact must continue to be built from `RELEASE_SHA`, never from `TOOLING_SHA` merely because the validator changed.
