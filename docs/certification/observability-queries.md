# Certification observability queries

The backend must receive and preserve `test.run.id`, `test.batch.id`,
`test.scenario.id`, `test.category`, and `test.synthetic=true` before these
queries can be accepted as evidence. Replace placeholders with a real run ID.

```esql
FROM logs-audit*.otel-dev*, logs-technical*.otel-dev*
| WHERE attributes.test.run.id == "<RUN_ID>"
| KEEP @timestamp, attributes.test.batch.id, attributes.test.scenario.id,
  attributes.event.action, attributes.event.outcome, attributes.correlationId,
  trace_id, attributes.http.response.status_code, message
| SORT @timestamp ASC
```

```esql
FROM logs-technical*.otel-dev*
| WHERE attributes.test.run.id == "<RUN_ID>"
  AND attributes.http.response.status_code >= 500
| KEEP @timestamp, attributes.test.scenario.id, attributes.correlationId,
  trace_id, message
```

```esql
FROM logs-audit*.otel-dev*, logs-technical*.otel-dev*
| WHERE attributes.test.run.id == "<RUN_ID>"
  AND (message LIKE "*password*" OR message LIKE "*authorization*")
| KEEP @timestamp, message, attributes.test.scenario.id
```
