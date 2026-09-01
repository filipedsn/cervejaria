# TQ-SA-07B — LocalLlmAnalyzer

## Role and authority

`LocalLlmAnalyzer` is an optional local enrichment layer after a `DeterministicDossier` is complete. The dossier remains the official immutable record: the model has no authority over incident identity, grouping, class, severity, confidence, fingerprint, counts, releases, facts or evidence. It can only summarize, organize conditional hypotheses, expose gaps and propose non-mutating investigative checks.

The selected default model is `gemma4:12b` (the qualified `Q4_K_M` build). There is deliberately no Gemma → Qwen automatic fallback: every failure falls back to the deterministic dossier.

## Configuration and transport

| Variable | Default |
| --- | --- |
| `SUPPORT_ANALYST_LLM_ENABLED` | `false` |
| `SUPPORT_ANALYST_LLM_ENDPOINT` | `http://127.0.0.1:11434` |
| `SUPPORT_ANALYST_LLM_MODEL` | `gemma4:12b` |
| `SUPPORT_ANALYST_LLM_TIMEOUT_MS` | `60000` |
| `SUPPORT_ANALYST_LLM_NUM_CTX` | `8192` |

Only HTTP loopback `127.0.0.1`, `localhost`, or `::1` is accepted; LAN, remote hostname, HTTPS/cloud endpoints and malformed URLs fail closed. Inference uses Node 20 `fetch` against Ollama `/api/chat`, with `stream:false`, `think:false`, structured JSON, temperature `0.1`, seed `42`, `num_predict:800`, and explicit `keep_alive:5m`. The model is not kept indefinitely. Ollama model digest, quantization, processor and VRAM are recorded only when supplied by Ollama.

## Prompt, input, and validation

`prompt-v1` has one runtime source and requires pt-BR, deterministic authority, conditional hypotheses, no causal/root-cause or vulnerability assertions, no remediation, and no invented references. The input builder is pure and sends a field allowlist only: class, severity, confidence, counts, service/route, releases, tenant count, facts, deterministic hypotheses/gaps/checks and a limited timeline. It excludes raw Elastic, `_source`, raw references/event IDs, URLs, actor IDs, payloads, credentials, PII, local paths and hostnames. It has a 16 KiB defensive bound; it removes timeline then trailing lower-priority facts while retaining core authority fields and marks `inputTruncated`.

`LlmAnalysis` V1 contains an executive summary, analysis, conditional hypotheses with known fact IDs, gaps and recommended checks. The validator rejects malformed/schema-invalid or unknown fields, unknown support IDs, authority changes, causal language, vulnerability claims, remediations, privacy leakage and invented references. Privacy-invalid, malformed, schema-invalid, authority-invalid and remediation-invalid content is never used; privacy-invalid content is never persisted. Causal and unsupported-reference content is recorded only when safe for later human evaluation, but is not incorporated or automatically rewritten.

## Artifacts, retention, and health

Valid output is an immutable `LlmEnrichment` snapshot under `SUPPORT_ANALYST_RUNTIME_DIR/enrichments/<dossierId>/<enrichmentId>.json`, separate from the deterministic dossier. Its identity is execution/audit based (`interactionId` plus generation time), since LLM output can vary for identical inputs.

Append-only interaction records live at `SUPPORT_ANALYST_RUNTIME_DIR/llm/interactions.jsonl`; the 10 MiB defensive cap asks an operator to rotate the file and does not auto-delete history. Records include sanitized effective input and validated output when allowed, prompt/model/settings, context hash, durations, token counts/rate, validation and Ollama/GPU metadata. `thinking` is ignored and never persisted. These records are evaluation data only: no training, fine-tuning, LoRA, RAG, embeddings or vector database is implemented.

`LocalLlmAnalyzer.healthCounters()` exposes local-only `llmRequests`, `llmSuccesses`, `llmFallbacks`, `llmTimeouts`, `llmInvalidOutputs`, `llmGuardrailBlocks`, and `llmTotalDurationMs`. There is no daemon, health file, watchdog, Elastic query, database mutation, deployment or external action.

## Manual use and limitations

`npm run analyst:llm-status` is a read-only loopback availability check. `SUPPORT_ANALYST_LLM_ENABLED=true SUPPORT_ANALYST_RUNTIME_DIR=<local-dir> npm run analyst:llm-smoke` uses only the synthetic `DATABASE_FAILURE` fixture, validates and records it; it never calls Elastic or production. Ollama offline, a missing model, timeout, invalid response, guardrail block, input rejection, or recorder/enrichment failure returns explicit `FALLBACK` and leaves deterministic authority intact.

SA-08 remains the next task: replay, quality baseline and A/B comparison of deterministic output versus Gemma. It may refine model settings or validator evidence policy, but is not started here.
