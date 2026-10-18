# TQ-AUDIT-02 — Auditoria técnica geral do TAP Quiver / Support Analyst

**Data:** 2026-09-02  
**Escopo:** código, testes, workflows, documentos e histórico Git no checkout local. Nenhum serviço foi iniciado, nenhuma credencial foi usada, PROD/Elastic/Ollama não foram consultados e nenhum teste foi executado. A única alteração desta auditoria é este relatório.

## 1. Executive Summary

**Veredito:** o projeto está no caminho correto, com execução de alta efetividade. O TAP Quiver é um sistema local operacionalmente simples, com fronteiras de segurança e recuperação adequadas ao estágio. O Support Analyst tem um núcleo determinístico bem delimitado, leitura Elastic DEV somente, persistência local protegida e LLM opcional/fail-soft.

Ainda **não está pronto para iniciar shadow (NOT_READY)**, porque o runtime atual não liga continuamente fontes → correlação → incidentes → dossiês, nem fornece o runbook/critério de revisão humana operacional exigido pelo próprio SA-09. Isto é um blocker de integração/operação, não uma falha de arquitetura, segurança ou um motivo para expandir a plataforma.

Recomendação: **OPTION B — ajustar o roadmap e seguir**. Fechar um piloto deterministic-first, local e read-only; manter LLM desligado ou explicitamente secundário no início; só então avaliar política seletiva de LLM. Não iniciar SA-09 neste trabalho.

## 2. Historical Baseline

| Source | Purpose | Date/phase | Relevant |
|---|---|---:|---|
| `docs/observability/TQ-OBS-01-audit.md` | primeira auditoria de observabilidade, 12 gaps | 2026-08-29 | Sim |
| `docs/observability/TQ-OBS-03-reaudit.md` | reavaliação OBS e roadmap para Analyst | 2026-08-30 | Sim |
| `docs/support-analyst/TQ-SA-01-discovery-architecture.md` | arquitetura, riscos e roadmap SA | 2026-08-31, atualizado | Sim |
| `TQ-SA-02` a `TQ-SA-08`, `TQ-SA-HEALTH-01` | execução e decisões por iniciativa | 2026-08-31—09-02 | Sim |
| `TQ-SA-LEGACY-01/02` | risco e remoção do Agent legado | 2026-08-31 | Sim |
| `deploy/RECOVERY.md`, `deploy/README.md` | deploy, recovery e operação | atual | Sim |
| `.github/workflows/ci.yml` | gates CI | atual | Sim |
| `deploy/runtime/support-analyst/quality/...` | baseline SA-08 e revisão humana | 2026-09-02 | Sim |
| `docs/roadmap/pos-primeiro-dia.md` | backlog de produto pós campo | 2026-07-08 | Baixa: sem itens |

**Baseline Git inicial:** branch `main`; `HEAD` `2ab047091d8fee1ed97de90e6376fb5e15973774`; `origin/main` `9aaad565e67e5f66757c399e295cef1abacde401`; local **ahead 8**, behind 0; árvore inicialmente limpa. A divergência local contém SA-HEALTH-01, ainda não publicado no remoto.

## 3. First Audit Findings

### What the first audit said

`TQ-OBS-01` registrou 12 gaps: correlação UI→API, observabilidade HTTP do frontend, lifecycle realtime, ingestão de logs técnicos, diagnóstico Prisma, eventos semânticos de segurança, contexto de release, before/after de auditoria, business health, health de infraestrutura auxiliar, privacidade em texto livre e comprovação de entrega de alertas. Não encontrou P0 nem segredo literal versionado; score era 64/100.

## 4. Original Roadmap

| Roadmap item | Original goal | Priority | Dependency | Planned outcome |
|---|---|---|---|---|
| OBS-02 | corrigir lacunas que inviabilizavam diagnóstico | P1/P2 | OBS-01 | sinal HTTP, auth, release, logs e DB melhores |
| SA-02 | papel/API key Elastic mínimo DEV | P1 | ambiente autorizado | consumidor somente leitura |
| SA-03/04 | core isolado, normalização, fontes e correlação | P1 | SA-02 | eventos sanitizados e correlação limitada |
| SA-05/06 | incidentes/dossiê determinísticos e feedback | P1 | SA-03/04 | replay e persistência local segura |
| SA-07A/07B/08 | avaliar e integrar LLM local com guardrails | P2 | dossiê determinístico | enriquecimento opcional avaliado |
| HEALTH-01 | health local/checker/readiness | P1 antes de shadow | runtime modelado | base observável sem daemon |
| SA-09 | piloto shadow sem saída externa | P1 | HEALTH-01 aceito | runbook e revisão humana |

## 5. Execution Timeline

| Initiative | Planned | Implemented | Evidence | Current status |
|---|---|---|---|---|
| Observability hardening | OBS-02 | correlation/release/auth/Prisma/log changes | commits `5afa960`…`ff73f2f`; `TQ-OBS-03` | DONE/PARTIAL conforme gap |
| Legacy Agent retirement | legacy isolation | freeze e decommission | `fdc6d1c`, `c7e4d92`; legacy docs | DONE |
| SA core through dossiers | SA-03—06 | packages, sources, engine, stores, feedback | `36332ba`…`fe24487`; `src/` and tests | DONE |
| Local LLM | SA-07A/B | bake-off, local analyzer, validator, stores | `5104201`, `d6013c5`; SA-07 docs | DONE |
| Quality baseline | SA-08 | frozen scenarios and human review | `5c02dcc`, `9aaad56`; runtime quality packet | DONE |
| Health foundation | HEALTH-01 | file health model/checker/smoke | `2ab0470`; `src/health/` | DONE, integration pending |
| Shadow pilot | SA-09 | not started | SA-01/HEALTH-01 explicitly say blocked | NOT_DONE |

## 6. Evolution / Effectiveness Matrix

### A. First Audit → Current State Matrix

| Audit finding | Original severity | Planned action | Actual action | Current state | Effectiveness |
|---|---|---|---|---|---|
| G-01 UI/API correlation | High | propagate ID | correlation/release context added | RESOLVED | HIGH |
| G-02 frontend HTTP outcomes | High | instrument wrapper | outcome/duration/failure instrumentation | RESOLVED | HIGH |
| G-03 realtime lifecycle | High | auth + lifecycle signals | auth decisions covered, lifecycle remains | MITIGATED | MEDIUM |
| G-04 technical log ingestion | High | route Pino to Elastic | ingestion contract/tests added; target runtime not proven | MITIGATED | MEDIUM |
| G-05 Prisma diagnosis | High | error/latency classification | DB failures and observability added; no pool/lock detail | MITIGATED | MEDIUM |
| G-06 semantic auth/authz | Medium | safe events | semantic events and tests | RESOLVED | HIGH |
| G-07 release context | Medium | inject release | central release context and ingestion test | RESOLVED | HIGH |
| G-08 before/after | Medium | selective contract | no generic contract | STILL_OPEN | NONE |
| G-09 business health | Medium | selected business signals | partial transactions/kitchen/cash only | STILL_OPEN | LOW |
| G-10 auxiliary infra health | Medium | centralize actionable health | local scripts/host checks only | STILL_OPEN | LOW |
| G-11 free-text privacy | Medium | selective hardening | Analyst allowlists/redaction; app-wide proof absent | MITIGATED | MEDIUM |
| G-12 alert delivery/journeys | Medium | test delivery/thresholds | not continuously demonstrated | STILL_OPEN | NONE |

Counts: **12 findings; 4 resolved; 4 mitigated; 4 still open; 0 obsolete; 0 regressed.** `TQ-OBS-03` reported a narrower 10-item rollup; this audit preserves the original 12 IDs and re-evaluates current code.

### Return by initiative

| Initiative | Effort | Value | Risk reduction | Keep/adjust |
|---|---:|---:|---|---|
| correlation/auth/release observability | M | HIGH | high | KEEP |
| isolated deterministic Analyst | L | HIGH | high | KEEP |
| local stores/privacy boundaries | M | HIGH | high | KEEP |
| health foundation | S | HIGH | medium now/high for pilot | KEEP; wire it later |
| LLM bake-off + SA-07B | L | MEDIUM | safety/learning high, diagnosis incremental | ADJUST to selective use |
| rich benchmark/quality artifacts | M | MEDIUM | reduces uncertainty | KEEP, do not expand before pilot |

## 7. Roadmap Effectiveness

**ORIGINAL_ROADMAP_QUALITY: GOOD.** The order was effective: repair telemetry context, remove the unsafe legacy path, establish deterministic authority and privacy boundaries, then add optional LLM and health. It avoided enterprise infrastructure and did not start remediation.

**ROADMAP EFFECTIVENESS: YES.** The only required adjustment is to make the next step an operational integration slice, not more model work: one bounded continuous read-only loop, lifecycle/runbook, output location, human review cadence and stop/recovery procedure.

## 8. Current Architecture

```text
TAP Quiver PWA ─ HTTP/Socket ─► Fastify API + Prisma/PostgreSQL
     │                              │
     └─ audit/release/auth/technical telemetry ─► OTel Collector ─► Elasticsearch
                                                                      │ (DEV read-only API key)
Support Analyst CLI/smoke ─► sources ─► normalize ─► correlation ─► IncidentGrouper
                                                                  └► ContextBuilder ─► DeterministicDossier
                                                                                    ├► local JSON/Markdown/feedback
                                                                                    └► optional loopback Ollama
                                                                                         └► validator/fallback/interactions
HealthTracker ─► atomic heartbeat + health.json ─► external file-only checker

Deploy/recovery: PowerShell deploy + backup + manifest/release ledger + manual recovery; Analyst has no path to it.
```

**Important actual-state qualification:** `src/index.ts` implements `--dev-smoke`, incident/dossier replay and feedback CLI, but not a continuous orchestrator that connects all core stages. `HealthTracker` has hooks, but the documentation explicitly says a future loop must call them.

### Component map

| Component | Responsibility / I-O | Dependencies & persistence | Boundary / risk |
|---|---|---|---|
| TAP backend/frontend | POS, portal, realtime and business operations | Fastify, Prisma, Postgres, Socket.IO | Quiver-specific; tenant/auth boundary |
| Observability | structured audit/log/trace/release signals | OTel Collector, Elastic | telemetry/PII boundary; deployment proof pending |
| Sources/normalize | bounded ES read → allowlisted `NormalizedEvent` | fetch; no persistence | DEV-only, no write; mapping drift |
| Correlation/incidents | relations, grouping/class/severity/confidence | pure functions; optional local JSON store | generic core; false merge/split |
| Dossiers/feedback | evidence, facts, hypotheses, local review | atomic JSON/Markdown and JSONL | generic core; filesystem growth |
| Local LLM | sanitized optional enrichment | loopback Ollama, local files | non-authoritative; latency/model dependency |
| Health | heartbeat/snapshot/check | local files only | operationally useful but not yet wired |
| CI/deploy/recovery | gates and controlled releases | GitHub Actions, PowerShell/artifacts | separate from Analyst |

## 9. Functional Requirements

### TAP Quiver

| RF | Requirement | Code/tests/docs evidence | Status |
|---|---|---|---|
| TQ-RF-01 | staff/client authentication and authorization | `routes/auth.ts`, `app.ts`, realtime QA | IMPLEMENTED |
| TQ-RF-02 | tenant-isolated brewery operation | tenant predicates across routes/schema | IMPLEMENTED |
| TQ-RF-03 | events, comandas, items and closing | `routes/comandas.ts`, Prisma models | IMPLEMENTED |
| TQ-RF-04 | products, menus, taps and inventory | routes `produtos/cardapios/taps`, kiosk inventory | IMPLEMENTED |
| TQ-RF-05 | kiosk cash, sales and kitchen | `routes/quiosque/*`, cash/stock models | IMPLEMENTED |
| TQ-RF-06 | payments, clients and customer portal orders | `pagamentos/clientes/public.ts` | IMPLEMENTED |
| TQ-RF-07 | realtime notifications and rankings | Socket routes, `ranking.ts`, frontend | IMPLEMENTED; lifecycle observability PARTIAL |
| TQ-RF-08 | administration, reports, audit and company modes | `admin/relatorios/audit`, schema | IMPLEMENTED; common before/after PARTIAL |

### Support Analyst

| RF | Requirement | Code/tests/docs evidence | Status |
|---|---|---|---|
| SA-RF-01 | source reading and normalization | `sources/*`, `normalize/*`, tests | IMPLEMENTED (DEV only) |
| SA-RF-02 | correlation/group/class/severity/confidence/fingerprint/dedupe | `correlation.ts`, `incidents/*`, tests | IMPLEMENTED |
| SA-RF-03 | replay, ContextBuilder and deterministic dossier | `index.ts`, `dossiers/*`, tests | IMPLEMENTED |
| SA-RF-04 | feedback and quality evaluation | `feedback.ts`, `quality/*`, SA-08 artifacts | IMPLEMENTED |
| SA-RF-05 | local LLM, validator, fallback, interactions | `local-llm/*`, tests | IMPLEMENTED, optional |
| SA-RF-06 | health/external checker/readiness model | `health/*`, tests | IMPLEMENTED, not runtime-integrated |
| SA-RF-07 | continuous shadow operation | no loop/service/runbook yet | NOT_IMPLEMENTED |

## 10. Non-Functional Requirements

### D. RNF Matrix

| RNF | Expected behavior | Current state / evidence | Gap | Priority |
|---|---|---|---|---|
| Security | least privilege and safe boundaries | Analyst DEV-only config, loopback LLM, isolated legacy removal | runtime credential handling not observed | P1 before real target |
| Privacy | minimize/redact persisted and LLM data | allowlists, prohibited keys, size caps, tests | free-text regex cannot prove all PII | P2 |
| Reliability | deterministic replay and safe failures | pure core, atomic stores, fallback | no composed loop/restart recovery | P1 |
| Availability | usable single-machine recovery | deploy recovery/runbooks, health checker | Analyst runtime lifecycle absent | P1 |
| Performance | bounded local operations | source/context/input caps | live throughput target not defined | MONITOR |
| Scalability | bounded growth | 5 MiB incident, 10 MiB interactions caps | retention/rotation is manual | P2 |
| Observability | detect key failures | Quiver telemetry + Analyst health model | no live Analyst health producer | P1 |
| Maintainability | clear modules and docs | 59 source files, 21 tests, strong separation | duplicate benchmark/LLM validator surface | P3 |
| Testability | offline/pure/replay | injected fetch/clock, fixtures, CI | no end-to-end Analyst operational test | P1 |
| Operability | operator can start/inspect/recover | Quiver runbooks; Analyst checker/help | no Analyst pilot runbook | P1 |
| Portability | realistic local constraints | Node 20; Windows scripts, Elastic/Ollama optional | Windows/local FS coupling | LATER |
| Auditability | reconstruct dossier/enrichment decisions | IDs, hashes, versions, append-only records | release capture depends source signal | P2 |

Targets such as availability SLA, throughput and retention duration are **TARGET_NOT_DEFINED**; no enterprise target was invented.

## 11. Negative Requirements

### E. Negative Requirements Matrix

| Prohibition | State | Evidence |
|---|---|---|
| write DB / application | ENFORCED | Analyst package has no Prisma/backend import or endpoint |
| write Elasticsearch | ENFORCED | `ElasticReadOnlyClient` only `POST .../_search`; DEV role docs |
| deploy/rollback/restart/shell arbitrary | ENFORCED | no deploy/process-shell module in Analyst (quality CLI’s `execFile` is a local artifact action, not remediation) |
| Telegram/GitHub/remediation | ENFORCED | no connector/import; SA-01/07 docs prohibit it |
| remote/cloud LLM | ENFORCED | config accepts HTTP loopback only |
| class/severity/confidence/facts/evidence by LLM | ENFORCED | deterministic dossier authority, validator and tests |
| LLM required for output | ENFORCED | disabled/default and `FALLBACK` paths |
| source/prompt injection treated as instruction | MITIGATED | allowlisted projected input and schema/validator; raw text may enter sanitized dossier statements |

No violation was found. “Not implemented” is distinguished from protection: most prohibited capabilities are absent and blocked structurally; Elasticsearch protection also relies on the external API-key role in the target environment.

## 12. Requirements Traceability

### C. Requirements Traceability

| RF | Requirement | Code | Tests | Docs | Status | Risk |
|---|---|---|---|---|---|---|
| SA-RF-01—06 | deterministic Analyst core | `support-analyst/src/*` | 69 named tests across 10 suites | SA-03—08, HEALTH-01 | IMPLEMENTED | low/medium |
| SA-RF-07 | shadow loop and operation | absent | absent | SA-01 and HEALTH-01 identify it as future | NOT_IMPLEMENTED | high |
| TQ-RF-01—08 | operational POS capabilities | backend routes/schema/frontend | backend unit, realtime QA, E2E scripts | README/manual/deploy | IMPLEMENTED/PARTIAL as §9 | medium |

## 13. Architecture Boundaries

Dependency audit: **GOOD** inside the Analyst. Source, deterministic core, dossier, LLM and health communicate via types/dependency injection; there is no circular import indicated by the module map. The only notable coupling is `LocalLlmAnalyzer` reusing benchmark client/validator/prompt schema, **ACCEPTABLE/TECH_DEBT** because it prevents validator drift but makes experimental and runtime layers less independent. No shared mutable cross-process state exists beyond bounded local files.

## 14. Deterministic Core

`NormalizedEvent`, correlation, grouping, classifier, severity/confidence, fingerprints, context and dossier are deterministic under supplied inputs/times: tests explicitly cover immutable input, stable event IDs, ordering, duplicate IDs, conflicts, release split, inactive closing and replay. IDs/correlation take precedence over temporal fallback; explicit-ID conflict blocks promotion. Risks retained: temporal STRONG/PROBABLE matches can false-merge when source context is sparse; fingerprints intentionally split across release; source coverage is DEV-proven, not PRD-proven. These are **MITIGATED**, not eliminated.

## 15. LLM Architecture and Safety

`LocalLlmAnalyzer` runs only after `DeterministicDossier`. Input is an allowlist capped at 16 KiB, excludes raw refs, IDs, URLs, payloads and secrets. The prompt demands pt-BR, non-authoritative conditional output; validator rejects malformed schema, unsupported facts, authority, causal/vulnerability/remediation and privacy violations. Failure returns deterministic fallback. Interaction records include prompt version, model/digest, hashes, metrics and allowed output; `thinking` is excluded.

Conclusion: **OPTIONAL, NON_AUTHORITATIVE, NON_REMEDIATING, LOCAL, FAIL_SOFT = confirmed.** SA-08 is **PARTIALLY_JUSTIFIED**: 95.83% availability, no critical guardrail violation, but only 50% analytical value and 16.7% material value in 12 synthetic scenarios; median/p95 latency was 21.74/34.53 s. A future `SELECTIVE_LLM_POLICY` can be added at the analyzer call site without large refactor.

## 16. Security

TAP uses Fastify helmet/CORS/cookie/JWT, scoped tenant access and route predicates; CI has isolated realtime-security QA. Analyst rejects legacy/privileged Elastic env names, rejects PRD runtime regardless of a future-looking env gate, uses exclusive API-key config and loopback-only LLM. Security assessment: strong for the current local stage. External-role enforcement and real runtime file permissions remain **INSUFFICIENT_EVIDENCE** because no target environment was contacted.

## 17. Privacy

Flow reviewed: source → normalized event → incident → context → dossier → LLM input → interaction → quality/feedback → health. Source normalization is allowlisted; alert text is sanitized/truncated; stores forbid secret/PII-shaped fields; LLM input has a second privacy gate; feedback excludes reviewer identity; health excludes hostname/user/credentials. Residual risk is unrecognized PII inside otherwise allowed free text/stack-derived text. Current choice (minimize and redact rather than retain raw logs) is appropriate.

## 18. Reliability

Strengths: idempotent content IDs, replay-safe pure core, input order sorting, atomic rename writes, fsync for append logs/feedback, locks, corruption/size rejection, bounded source queries, and deterministic fallback. Failure isolation is good: Elastic/Ollama/filesystem errors cannot mutate TAP. Weakness: incident/dossier persistence has components but no production-like transactional orchestrator sequencing; atomic files cannot make a multi-file cycle atomic. Resolve this in the pilot integration slice, not with a database rewrite.

## 19. Observability

Quiver can expose API, DB, auth/realtime denial, release and technical signals through OTel/Elastic; the original audit gaps were materially reduced. Analyst health model detects heartbeat stale, process fatal/clean stop, Elastic last read, stalled processing, LLM state and quality rates. It cannot presently detect a real Analyst stuck/dead process because there is no continuous process using `HealthTracker`. Elastic/Ollama unavailability is modeled and tested; no live health telemetry was inspected.

## 20. Performance

| Area | Assessment |
|---|---|
| Quiver API/DB/realtime | MONITOR; no current evidence of a blocker |
| Elastic source/grouping/persistence | NO_CONCERN for bounded local shadow; queries and files are capped |
| LLM/GPU | MONITOR; 21.74 s median and 34.53 s p95 make it unsuitable for synchronous operator-critical flow |
| Analyst loop | FIX_BEFORE_SHADOW only for cadence/back-pressure/timeout behavior, not capacity engineering |

## 21. Scalability

Current design is right-sized for a single Windows machine and low-volume shadow. Limits protect individual files and context, but interaction logs stop at 10 MiB and require manual rotation; incident store stops at 5 MiB. Concurrent LLM inference, long retention, many tenants/events and filesystem cleanup policies are undefined. Classify as **LATER** until pilot volume proves a need; define simple caps/rotation in the runbook before shadow.

## 22. Maintainability

Code is readable and purpose-based. The Analyst has small modules, explicit contracts, injected fetch/clock and comprehensive local docs. Main maintainability risk is documentation/history moving faster than assembled runtime: several docs describe completed components while `index.ts` still exposes separate commands rather than the promised composed process. This is important drift, but cheap to correct when the operational slice is designed.

## 23. Testability

Strong: Node 20 tests are offline; fixtures cover source/PII/correlation/incident/dossier/LLM/quality/health; injected dependencies cover fetch and clock; replays have fixed time. CI tests Analyst with no Elastic, Ollama or GPU. Major blind spot: no test runs an operational polling cycle over a local fake source through durable incident/dossier outputs and restart/recovery. Do not chase coverage percentage.

## 24. Operability

**TAP Quiver: YES_WITH_RUNBOOK.** Deploy/recovery documents startup, readiness, backup, controlled migration, pause and manual recovery.  
**Support Analyst: NO for shadow operation today.** Individual replay/smoke/health commands exist, but an unfamiliar operator has no approved daemon lifecycle, schedule, artifact retention, failure response, review queue or stop procedure. This is intentionally outside HEALTH-01 and must be supplied before SA-09.

## 25. DevSecOps

`.github/workflows/ci.yml` pins Node 20 and runs frontend build, Prisma validation/build/unit tests, Ops Panel unit tests, Analyst typecheck/test/replay/build and isolated realtime QA. Analyst CI neither downloads a model nor calls Ollama/Elastic. Good proportional gates. Missing: dependency/SCA secret scanning is not evidenced; treat as **LATER/P2** unless an existing organizational gate exists outside repo. Backend build historically documented pre-existing TS issues, but workflow currently runs it; current pass status was not queried.

## 26. Health

**HEALTH-01 implementation: CLOSED; operational integration: IN_PROGRESS.** File artifacts are bounded/atomic and checker exit codes are explicit. Heartbeat defaults to 30 s, stale after 90 s; snapshot stale after 120 s; processing stall 300 s. It intentionally has no watchdog/restart/daemon/Ops Panel. This is the correct scope; wiring it to a bounded loop and an external scheduled check is enough for pilot, without new observability stack.

## 27. Failure Modes

### FMEA simplified

| Failure | Detection | Impact | Fallback | Recovery | Risk |
|---|---|---|---|---|---|
| Analyst process crash/restart | health files stale (once loop exists) | no new dossiers | none; TAP unaffected | restart per runbook | P1 |
| Elastic unavailable/forbidden | source error + health | incomplete context | deterministic source failure/fallback | credential/connectivity check | P1 |
| Ollama down/model missing/GPU busy/timeout | analyzer status + health | no enrichment | deterministic dossier | retry next cycle; no restart required | P2 |
| invalid LLM output | validator/interactions | discarded enrichment | deterministic dossier | inspect later | P2 |
| filesystem full/corrupt/limit reached | write/read errors | local history stops | source processing should continue | rotate/repair per runbook | P1 |
| stale health | checker | false/unknown readiness | unhealthy result | inspect process/artifacts | P1 |
| false correlation/grouping | reason codes/confidence/tests | misleading dossier | review feedback; conservative fallback | tune after evidence | P2 |
| interaction cap | explicit store error | LLM record/enrichment failure | fallback | manual rotate | P2 |
| target mapping/retention drift | onboarding/query failure | loss of evidence | fail closed | validate source contract | P1 |

## 28. Complexity / Overengineering

**ARE WE OVERENGINEERING THIS SYSTEM? No.** Most layers represent real safety boundaries: deterministic core vs LLM, privacy filtering, append-only review and independent health checker. Findings:

| Finding | Decision | Rationale |
|---|---|---|
| benchmark and runtime share validators/client | KEEP | prevents safety schema divergence |
| three local stores plus health files | KEEP | distinct retention/immutability semantics |
| duplicate `llm-benchmark` versus `local-llm` prompt path | SIMPLIFY later | extract shared contract only after pilot stabilizes |
| local Markdown snapshots | KEEP | human-readable audit/review value |
| manual log cap/rotation | SIMPLIFY | one documented rotation procedure, not a retention subsystem |
| broad Ops/observability scripts | REMOVE_LATER only if unused evidence appears | no proof of deadness |

## 29. Technical Debt

### F. Technical Debt

| ID | Area | Debt/evidence | Risk | Impact | Effort | Recommendation |
|---|---|---|---|---|---|---|
| TD-01 | Analyst runtime | no continuous composed loop (`src/index.ts`; HEALTH-01 limitation) | high | high | M | MUST before shadow |
| TD-02 | Operability | no SA shadow runbook/review cadence | high | high | S | MUST before shadow |
| TD-03 | Source contract | DEV proven, PRD explicitly blocked | medium | high | S | validate authorized pilot target, read-only |
| TD-04 | FS retention | incident/interaction cap needs manual rotation | medium | medium | S | document limits/recovery now |
| TD-05 | Correlation | temporal fallbacks may merge/split | medium | medium | M | measure feedback in pilot |
| TD-06 | LLM module | benchmark/runtime coupling | low | low | S | LATER after stable policy |
| TD-07 | Quiver observability | lifecycle realtime/business health/infrastructure gaps | medium | medium | M | LATER, selective |
| TD-08 | Docs | status says HEALTH closed while pilot gate acceptance undefined | medium | medium | XS | record gate decision in pilot plan |

## 30. Documentation Drift

| Severity | Divergence | Evidence |
|---|---|---|
| IMPORTANT | health is closed as a model, but not attached to continuous runtime | `TQ-SA-HEALTH-01` limitation vs `src/index.ts` |
| IMPORTANT | SA roadmap says SA-09 blocked until “HEALTH-01 CLOSED review accepted,” but acceptance authority/record is not defined | SA-01 roadmap |
| MINOR | legacy docs describe historical Agent/Ops routes that were removed | LEGACY-01 vs LEGACY-02 |
| MINOR | deploy README’s historical non-blocking backend-build wording may lag current CI workflow | `deploy/README.md`, workflow |

## 31. Product Coupling

The Analyst is intentionally coupled to Quiver in its Elastic field mappings, allowed indices, signal classes, release/tenant vocabulary and source fixtures. This is appropriate before shadow. Coupling is not to the application database, app process or deployment controls. Quiver-specific connectors should remain adapters rather than being generalized prematurely.

## 32. Generic Core vs Quiver-specific

### I. Generic vs Quiver-specific

| Component | Generic | Quiver-specific | Generalization effort |
|---|---|---|---|
| Sources | bounded/read-only pattern | Elastic indices/field mappings | M |
| NormalizedEvent | event identity, privacy shape | source field names/classes | M |
| correlation/incident | engine and evidence levels | rules/fingerprint dimensions | M |
| dossier/feedback | mostly generic | Portuguese text/facts/rules | S |
| LLM/validator/quality | mostly generic safety pattern | prompt/scenarios | M |
| health | generic local health model | naming/config | S |

## 33. Productization Potential

**MEDIUM.** The deterministic incident/dossier/feedback/LLM-boundary/health core is reusable; connectors, taxonomy, config, deployment, UI and operating model are Quiver-specific. Productization should not begin now: it would impose multi-tenant configuration, connector contracts, credential provisioning and support obligations before one real shadow validates the value.

## 34. Training Data Readiness

**PARTIALLY_READY.** Interactions can capture sanitized input, output, promptVersion, model/digest, context hash, validation, metrics and human reviews. Missing for training-quality data: a stable ideal-answer/approved-label schema, sufficiently diverse real incidents, reviewer calibration, data retention/consent policy, dataset split and promotion governance. Synthetic quality artifacts are useful evaluation seed, not training corpus.

## 35. LoRA Readiness

**NOT_READY.** Do not train. Needed later: materially more curated real/sanitized examples; ideal answers distinct from model output; independent train/validation/test split; class balance and hard negatives; holdout regression set; privacy/retention approval; baseline comparison; promotion/rollback criteria. The current interaction record is a good future ingredient, not sufficient evidence.

## 36. What Worked

1. Replacing rather than reusing the unsafe legacy Agent removed ES writes, GitHub, shell and remediation coupling.
2. Establishing deterministic authority before LLM made safety and fallback straightforward.
3. Privacy by allowlist plus defensive persistence checks is stronger than relying on prompt wording.
4. Small offline fixtures/replays made correlation, grouping and health testable without infrastructure.
5. Observability fixes for correlation/auth/release made the Analyst’s source model credible.

## 37. What Did Not Pay Off

**NONE conclusively.** The LLM effort has limited direct analytical return so far, but the bake-off/quality work produced a justified decision boundary and zero critical guardrail failures. Its next increment should be selective policy after pilot evidence, not further broad model work.

## 38. New Risks Created

Evolution introduced manageable new risks: local runtime artifact growth; manual rotation; model/GPU latency and availability; prompt/validator maintenance; config surface; and risk of humans over-trusting polished LLM phrasing. The deterministic authority, caps, fallback and labels mitigate these, but the runbook must make them visible.

## 39. Current Risk Register

### G. Risk Register

| # | Risk | Probability | Impact | Priority | Mitigation |
|---:|---|---|---|---|---|
| 1 | no composed loop means no actual shadow evidence | HIGH | HIGH | P1 | build bounded read-only pilot integration |
| 2 | no operational runbook/reviewer cadence | HIGH | HIGH | P1 | define start/stop/recovery/review |
| 3 | target Elastic contract differs from DEV | MEDIUM | HIGH | P1 | authorize/read-only validate target before pilot |
| 4 | filesystem cap/corruption blocks persistence | MEDIUM | HIGH | P1 | cap/rotate/backup/recovery procedure |
| 5 | stale/missing health not externally acted on | MEDIUM | HIGH | P1 | scheduled file checker and response rule |
| 6 | false temporal correlation/grouping | MEDIUM | MEDIUM | P2 | review feedback and conservative confidence |
| 7 | LLM latency/unavailability | MEDIUM | MEDIUM | P2 | keep optional and fail soft |
| 8 | PII in allowed free text | LOW | HIGH | P2 | redaction tests/review and minimal projection |
| 9 | realtime/business health blind spots | MEDIUM | MEDIUM | P2 | add only signals with owner/runbook |
| 10 | alert delivery not continually proven | MEDIUM | MEDIUM | P2 | periodic delivery check when operational need exists |

## 40. Architecture Scorecard

### H. Architecture Scorecard

| Dimension | Score / 10 | Rationale |
|---|---:|---|
| Architecture | 8 | clean isolated boundaries; runtime assembly missing |
| Functional Fit | 8 | Quiver broad POS coverage; Analyst core complete but no shadow loop |
| Security | 8 | tenant/auth controls and Analyst least privilege design |
| Privacy | 8 | layered minimization; free text residual |
| Reliability | 7 | deterministic/atomic/fallback; composed recovery absent |
| Observability | 8 | strong foundation; Analyst live lifecycle absent |
| Maintainability | 8 | modular/tested/docs; small drift |
| Testability | 9 | offline, pure, replayable fixtures |
| Operational Simplicity | 7 | Quiver runbooks good; Analyst pilot runbook absent |
| LLM Safety | 9 | local, optional, validated, no authority |
| Reusability | 6 | core reusable, connectors/taxonomy coupled |
| DevSecOps | 7 | sound CI/gates; no evidenced SCA/secret scan |

## 41. Maturity Assessment

**Current maturity: LEVEL 2 — controlled local system.** The Analyst is more than a prototype because its contracts, persistence, negative boundaries, replay, quality and health model are implemented and tested. It is not LEVEL 3 because no genuine shadow runtime/runbook/operational evidence exists. The next-level gaps are exactly TD-01—05, not HA, Kubernetes, RAG or training.

## 42. Shadow Acceptance Criteria

**Functional:** a bounded local loop reads only approved target sources; normalization/correlation/incident/dossier outputs are repeatable; dossiês are stored locally; a human review queue/cadence is defined.  
**Non-functional:** health heartbeat/snapshot is live; external checker detects stale/unhealthy state; source/query/time/file/LLM limits are documented; failure keeps TAP untouched.  
**Negative:** verified read-only identity; no DB/Elastic write, GitHub, Telegram, deploy, shell or remediation path; LLM cannot alter deterministic authorities and may be disabled.

## 43. Shadow Readiness

**NOT_READY.** Security and core logic are ready enough, but actual operation is absent. This conclusion is stricter than SA-08’s `YES_AFTER_HEALTH_01`: SA-08 assessed quality after health model completion; this audit additionally requires the real operating loop, explicit acceptance and runbook before the word “shadow” is operationally true.

## 44. Shadow Blockers

1. Bounded, continuous, read-only source→incident→dossier orchestration is not implemented.
2. HEALTH-01 is not connected to that loop; current healthy smoke is synthetic/local.
3. Shadow runbook, artifact retention/rotation, failure recovery and human review cadence are undefined.
4. The approved pilot environment/source contract and read-only identity need operational validation (not necessarily PROD).

## 45. Current Roadmap Verdict

**CURRENT_DIRECTION: ADJUST.** Continue the architecture, but replace “more LLM/data/training work” with a thin operational pilot foundation. SA-09 remains not started and blocked. HEALTH-01 is NOW only insofar as its acceptance/integration must be completed; its design should not be expanded.

## 46. Proposed Roadmap

### J. Current Roadmap vs Proposed Roadmap

| Phase | Goal / why | Scope | Exit criteria |
|---|---|---|---|
| NOW — Pilot foundation | make shadow real and safely operable | bounded loop, health hooks, approved read-only source, local outputs | repeatable local/authorized smoke; stale/failure visible; no external write |
| NEXT — Controlled shadow | learn from real incident signals | scheduled shadow, review cadence, false merge/value log | documented human review results and recovery drill |
| NEXT — Selective LLM decision | spend GPU only where helpful | policy based on scenario/value/latency, always fallback | measured improvement over deterministic baseline |
| LATER — data curation/historical comparison | prepare future learning | sanitized labeled corpus and retention policy | enough curated real samples and holdout plan |
| LATER — LoRA / Telegram / GitHub | only after value and governance are proven | separate design and gates | explicit new authority approval |

Roadmap review: HEALTH-01 **NOW** (integration only); SA-09 **NEXT** after blockers; selective LLM **NEXT**; human feedback evolution **NEXT**; dataset/historical comparison/training/LoRA **LATER**; Telegram/GitHub **NOT_NOW**.

## 47. Decision Matrix

| Option | Benefits | Risks/cost | Recommendation |
|---|---|---|---|
| A — follow current roadmap literally | preserves momentum | could treat health-model completion as operational readiness | No |
| B — adjust then follow | converts strong core into evidence-producing shadow | M effort, no architecture change | **YES** |
| C — simplify before continuing | removes minor duplication | delays real evidence; no critical excess found | No, defer simplification |
| D — pause Analyst | avoids runtime work | loses validated learning and observability leverage | No |

## 48. What Should Not Change

Preserve: isolated Analyst package; deterministic facts/class/severity/confidence; local-only optional LLM; validator/fallback; no remediation/external outputs; source/input allowlists; bounded files; offline CI; single-machine pragmatic deployment; manual human decision for destructive recovery.

## 49. What Must Change

Before shadow, add only the composed pilot operating path, attach health to it, define an external checker response and produce an operator/reviewer runbook. Validate the read-only source contract in the authorized pilot environment. These are requirements, not suggestions to make the system enterprise-grade.

## 50. What Can Wait

Business-health expansion, full Socket lifecycle telemetry, comprehensive infra monitoring, generic before/after, new dashboards, alert delivery automation, generalized connectors/productization, RAG/embeddings/vector DB, fine-tuning/LoRA, cloud/remote LLM, Telegram/GitHub and any remediation can wait.

## 51. Final Recommendation

Proceed with a small **deterministic-first controlled shadow foundation**. Keep the LLM non-blocking and initially selective/off. Do not change the current architecture materially. After at least one bounded, reviewed shadow period, use collected evidence—not synthetic ambition—to decide selective LLM, signal expansion or dataset curation.

## Evidence policy and audit limits

Important conclusions cite current files/modules/docs/history above. This is a repository audit, not proof that services are running or that PRD has a given configuration. In particular: live CI status, target Elastic permissions/mappings/retention, filesystem ACLs, real traffic/volume, real customer workflow outcomes and real recovery execution are **INSUFFICIENT_EVIDENCE**. Files/modules inspected include all Analyst source/test suites, CI workflow, deploy/recovery documentation, backend route/schema inventory, security/observability references and all listed historical SA/OBS documentation. Approximate effort: ~4 hours of repository evidence review (no runtime validation).

**Final Git baseline:** branch `main`; HEAD `2ab047091d8fee1ed97de90e6376fb5e15973774`; `origin/main` `9aaad565e67e5f66757c399e295cef1abacde401`; ahead 8/behind 0. Working tree now contains only this untracked audit report.

DECISION SUMMARY

ARE WE ON THE RIGHT PATH: YES

EXECUTION EFFECTIVENESS: HIGH

ORIGINAL ROADMAP QUALITY: GOOD

ROADMAP CHANGE REQUIRED: YES — prioritize pilot integration/runbook before further LLM work

CURRENT DIRECTION: ADJUST

FUNCTIONAL FIT: 8/10

NON-FUNCTIONAL FIT: 8/10

NEGATIVE REQUIREMENTS FIT: 9/10

CURRENT MATURITY: LEVEL 2 — controlled local system

SHADOW READINESS: NOT_READY

RECOMMENDATION: OPTION B — adjust roadmap and build deterministic-first pilot foundation

BLOCKERS: composed loop; health wiring; runbook/review cadence; authorized read-only source validation

TOP 5 EFFECTIVE IMPROVEMENTS: correlation/release/auth telemetry; legacy retirement; deterministic core; privacy boundaries; offline replay/health tests

TOP 5 REMAINING RISKS: no operational loop; no runbook; source-contract drift; filesystem recovery; stale health response

NEXT 3 PRIORITIES: bounded loop + health; pilot runbook/reviewer cadence; authorized read-only source validation

SIMPLIFICATION OPPORTUNITIES: defer benchmark/runtime extraction; document one filesystem rotation procedure

DO NOT DO NOW: SA-09 start, Telegram/GitHub, remediation, RAG/embeddings, training/LoRA, HA/platform expansion

PRODUCTIZATION POTENTIAL: MEDIUM

TRAINING DATA READINESS: PARTIALLY_READY

LORA READINESS: NOT_READY
