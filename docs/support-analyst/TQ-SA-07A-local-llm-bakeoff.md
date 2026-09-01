# TQ-SA-07A — Hardware Validation & Local LLM Bake-off

## Boundary and status

This is an experimental local-only bake-off. The deterministic dossier remains the authority for incident class, severity, confidence, facts, evidence, correlation and grouping. No `LocalLlmAnalyzer` is implemented by this ticket, no production/Elastic/database service was contacted, and no model response becomes part of a dossier.

Status: **BENCHMARK COMPLETE — human review required before TQ-SA-07B.**

## Machine and Ollama inventory

| Item | Observed value |
| --- | --- |
| Windows | Windows 11 Pro, 10.0.26200 (build 26200) |
| CPU | AMD Ryzen 5 5600, 6 cores |
| RAM | 32 GB total; approximately 10.5 GB free before the initial GPU smoke test |
| GPU | AMD Radeon RX 6750 XT |
| VRAM | 12 GB (target-machine declaration; the Windows WMI adapter-RAM field is unreliable here) |
| AMD driver | 32.0.21045.5002 |
| Ollama model drive free space | 441.97 GiB before pulls |
| Ollama | 0.33.1; `http://127.0.0.1:11434/api/version` healthy |
| Relevant Ollama environment overrides | none observed |

Pre-existing models: `qwen3-coder:30b` (18 GB, out of scope) and `gemma4:12b` (7.6 GB). No model was removed.

GPU acceleration is proven for `gemma4:12b`: after a 8192-context smoke request, `ollama ps` reported **100% GPU** and 8.4 GB model size; `/api/ps` reported `size_vram=8,372,847,901`, equal to the loaded model size. This is `FULL_GPU`. Ollama did not expose a trustworthy backend name or processor field through `/api/ps`; `backend = UNCONFIRMED`. The smoke request took 16,604.922 ms total including 14,328.513 ms load.

## Candidate control

| Candidate | Exact registry tag | Local state | Digest / quantization |
| --- | --- | --- | --- |
| Qwen | `qwen3.5:9b-q4_K_M` | downloaded by SA-07A | `6488c96fa5fa…`; 6.6 GB; Q4_K_M; 9.7B |
| Gemma | `gemma4:12b` | pre-existing | `4eb23ef187e2…`; 7.6 GB; Q4_K_M; 11.9B |
| Phi | `phi4:14b` | downloaded by SA-07A | `ac896e5b8b34…`; 9.1 GB; Q4_K_M; 14.7B |

The exact tags were confirmed in the Ollama registry and pulled sequentially. No alternative tag, cloud model, MLX variant, or large model was substituted. No model was removed.

## Experimental contract

- `prompt-v1`, pt-BR, deterministic dossier as immutable authority.
- Native Node `fetch` to HTTP loopback-only Ollama; `/api/chat`, `stream: false`, no tools or web search.
- JSON schema: `executiveSummary`, `analysis`, conditional `hypotheses[]` with existing `supportingFactIds`, `gaps[]`, investigative `recommendedChecks[]`.
- `num_ctx=8192`, temperature 0.1, seed 42, `num_predict=800`, `think=false`, 60 s timeout.
- Sanitized fixture dossiers only, persisted under `SUPPORT_ANALYST_RUNTIME_DIR/benchmarks/<runId>/`.
- Thinking and raw Elastic documents are never persisted. Unsafe output stores only status and flags.

The deterministic validator rejects malformed/unknown schema fields, fact IDs not in the dossier, unsupported hypotheses, incompatible authority claims, absolute causal language, confirmed vulnerability claims, mutating checks, privacy patterns and invented release references. Natural-language cases outside those objective checks remain `NOT_REVIEWED` for humans.

## Method and rubric

Qualification runs the same prompt, schema and settings for `DATABASE_FAILURE`, `DATABASE_SLOW`, `APPLICATION_ERROR`, `AUTH_FAILURE`, `UNKNOWN`, and `SOURCE_FAILURE`. Finalists run all 12 SA-06 scenarios twice, separating cold and warm inference. Each model is unloaded with `keep_alive: 0` before switching.

Objective metrics: schema validity, authority/unsupported/privacy/remediation flags, timeout/error rate, cold load, warm latency, generation tokens/s, token counts, `size_vram`, and processor split. Human fields begin as `NOT_REVIEWED`: summary, hypotheses, checks, Portuguese clarity and faithfulness (0–5). Proposed future weights: fidelity 25%, schema 20%, hypotheses 15%, checks 15%, Portuguese 10%, latency 10%, VRAM/offload 5%.

## Results and decision

Qualification completed 18 interactions (six common scenarios × three candidates). All models were then retained as finalists and completed 12 scenarios × two repetitions: 72 interactions. The finalist run took about 31 minutes; qualification plus finalist execution was about 37 minutes. Every model was observed as `FULL_GPU`; Ollama CLI reported the split as `100% GPU`. `/api/ps` did not expose a reliable backend name or processor field, so backend remains `UNCONFIRMED`.

| Metric | Qwen 3.5 9B | Gemma 4 12B | Phi-4 14B |
| --- | ---: | ---: | ---: |
| GPU / `size_vram` | FULL_GPU / 5.75 GB | FULL_GPU / 8.37 GB | FULL_GPU / 10.58 GB |
| Finalist interactions / valid schema | 24 / 24 | 24 / 24 | 24 / 9 |
| Authority / privacy / remediation flags | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| Causal / unsupported flags | 6 / 2 | 2 / 1 | 0 / 0 |
| Timeout rate | 0% | 0% | 62.5% (15/24) |
| Cold total / load | 27.77 s / 9.26 s | 28.87 s / 10.41 s | 39.62 s / 14.47 s (qualification; first finalist call timed out) |
| Median / p95 warm latency | 14.57 s / 29.93 s | 12.85 s / 18.13 s | 18.19 s / 45.08 s |
| Median generation throughput | 29.40 tok/s | 27.52 tok/s | 26.42 tok/s |
| Mean prompt / output tokens | 2044 / 374 | 2055 / 286 | 1498 / 375 |

Qwen was the fastest and used the least VRAM, but had recurring deterministic causal-language flags (including one in qualification) and two unsupported-reference flags. Gemma had the best warm latency and no timeout, but had two causal-language and one unsupported-reference flag in the finalist set. Phi had no detected unsupported-language flags when it completed, but 15/24 finalist attempts timed out and its 10.58 GB VRAM use leaves the least operating margin.

### Human-review samples

The generated, compact side-by-side samples for `DATABASE_FAILURE`, `AUTH_FAILURE` and `UNKNOWN` are in the ignored runtime file `benchmarks/llm-benchmark-2026-08-31T23-39-49-439Z-07dcc616/human-review-samples.md`. They include executive summary, hypotheses and checks only. In the critical `UNKNOWN` scenario, all completed responses retained insufficient-evidence wording; Phi timed out on both `DATABASE_FAILURE` repeats and one `AUTH_FAILURE` repeat. Human fields remain `NOT_REVIEWED` (summary, hypotheses, checks, Portuguese clarity and evidence faithfulness).

### Provisional technical ranking

1. **Gemma 4 12B — provisional technical candidate.** Best balanced latency/stability, full GPU operation and moderate VRAM use; its three deterministic language/reference flags require human review before any selection.
2. **Qwen 3.5 9B.** Strongest throughput and lowest VRAM, but repeated causal-language flags are a material factual-fidelity concern.
3. **Phi-4 14B.** Full GPU operation and clean completed outputs, but operationally unsuitable in this configuration because of systematic timeout rate and highest VRAM use.

This is not a final winner: a fourth model was not tested, no cloud model was used, and TQ-SA-07B is **not released**. The next action is human review of the generated samples and flags, especially Qwen/Gemma language fidelity and Phi timeout behavior.

## Implementation verification

The harness is isolated in `support-analyst/src/llm-benchmark/`; it does not alter the Analyst core or production workflow. Offline tests cover loopback-only enforcement, malformed/schema-invalid output, unknown fact IDs, authority/causal/vulnerability/remediation/privacy flags, metrics, unsafe output non-persistence and thinking non-persistence. CI never calls Ollama or downloads models.
