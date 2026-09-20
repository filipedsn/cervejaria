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

The identity must explicitly lack `write`, `index`, `create`, `create_doc`, `delete`, `manage`, `manage_security`, `manage_index_templates`, `all`, and equivalent mutable privileges.

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
