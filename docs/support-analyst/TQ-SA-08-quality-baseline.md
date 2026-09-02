# TQ-SA-08 — Quality baseline and blind A/B evaluation

## Status

`TECHNICAL COMPLETE / HUMAN REVIEW PENDING` after a local technical run. No human quality score, decision, shadow operation, deployment, daemon, training, RAG, or model/prompt tuning is performed by this ticket.

## Method

`golden-set-v1` contains exactly twelve sanitised synthetic scenarios: DATABASE_FAILURE, DATABASE_SLOW, APPLICATION_ERROR, AUTH_FAILURE, AUTHORIZATION_DENIED, REALTIME_AUTH_FAILURE, TELEMETRY_FAILURE, UNKNOWN, SOURCE_FAILURE, TRUNCATED_CONTEXT, MULTIPLE_TENANTS, and MULTIPLE_RELEASES. The runner fail-closes if this ordered set, expected deterministic class, facts, timeline, hypotheses, gaps, or checks drift.

Each scenario gets two real `gemma4:12b` attempts using frozen `prompt-v1`, `num_ctx=8192`, temperature `0.1`, seed `42`, `num_predict=800`, `think=false`, timeout 60 seconds, and keep-alive 5 minutes. The only comparison is the same deterministic dossier/context against that dossier plus a valid enrichment. There is no Elastic, production, database mutation, or retry because a response looks poor.

The deterministic side is rendered by `DeterministicBriefRenderer`: a template summary and direct projections of deterministic hypotheses, gaps and checks. It creates no facts and does not mutate the dossier.

## Artifacts and review

`npm run analyst:quality-run` requires `SUPPORT_ANALYST_LLM_ENABLED=true` and `SUPPORT_ANALYST_RUNTIME_DIR`. It writes `quality/<runId>/manifest.json`, `objective-metrics.json`, `interaction-map.json`, `blind-mapping.json`, and `human-review-packet.md`. Normal LocalLlmAnalyzer interactions continue to be persisted only at `llm/interactions.jsonl`; the quality run references their interaction IDs instead of duplicating them.

The packet exposes only `Variant A` and `Variant B`, selected reproducibly with `reviewSeed=42`; it contains no model, LLM, deterministic, latency, token, or guardrail labels. The separate mapping must not be supplied to reviewers. A validation or operational fallback is represented as `Variant indisponível devido a validação automática.`

Reviews are append-only JSONL at `quality/<runId>/reviews.jsonl`. `QualityReview V1` rejects unknown fields (including reviewer identity), restricts all score/choice enums, and sanitizes comments. Human ratings remain `NOT_REVIEWED` until explicitly supplied—no LLM scores an LLM. Run `npm run analyst:quality-summary -- <runId>` after reviews are appended; the summary reports blinded-pair results mapped back to source and never makes the final decision automatically.

## Measures

Objective metrics include attempts, valid enrichments/fallbacks, each guardrail category, latency median/p95, input/output tokens, tokens per second, processor/VRAM when Ollama supplies them, and structural consistency across the two attempts. Consistency compares status, validation flags, supporting fact IDs, hypothesis count, and check count only; it does not use embeddings.

The human packet asks for factual fidelity, summary, hypotheses, checks, clarity, investigation value, usefulness, pairwise preference, incremental value, next-action help, and perceived time saving. It distinguishes `MATERIAL_ANALYTICAL_VALUE` from `PRESENTATION_ONLY`. The eventual category breakdown includes Clear Evidence (database/application), Challenge (unknown/source/truncated/multi-tenant/multi-release/auth), and Security (auth/authz/realtime), with a separate telemetry interpretation check.

Potential post-review classifications are STRONG_VALUE, CONDITIONAL_VALUE, PRESENTATION_VALUE_ONLY, NO_MEANINGFUL_VALUE, or NEGATIVE_VALUE. `READY_FOR_SHADOW` can only be recommended after a human review demonstrates analytical value, acceptable stability, understood regressions, working fallback, and no critical authority/privacy/remediation failure. SA-08 does not start shadow operation.

## Objective corrections found by sanity checking

The frozen scenario count did not change. The check found two fixture/runtime defects that would otherwise invalidate the comparison:

- `REALTIME_AUTH_FAILURE` did not provide the classifier’s explicit realtime action. Its synthetic event now uses the existing safe `connection.denied` action.
- telemetry events ending in `.failed` were classified as generic application errors before the telemetry rule. The classifier now applies the dedicated telemetry rule before the generic failure rule.
- the privacy filter treated the safe `AUTHORIZATION_DENIED` class token as an authorization header. It now blocks header-shaped `Authorization:` data while allowing that allowlisted class.

These are objective semantic/implementation corrections, not model, prompt, setting, or validator optimization.
