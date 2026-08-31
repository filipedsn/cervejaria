# TQ-SA-06 — Dossiê determinístico e feedback local

Status: concluído em 2026-08-31. O escopo é offline: não consulta Elasticsearch, não chama Ollama/Gemma, não usa GPU e não produz escrita externa.

## ContextBuilder e limites

`ContextBuilder` é um componente puro. Recebe `Incident`, eventos normalizados, relações de correlação e, opcionalmente, falhas de fonte e resumo de normalização. Não lê store, filesystem, relógio ou rede.

Ele reduz os eventos a uma timeline com somente campos permitidos: tempo, fonte, tipo/ação, severidade técnica, HTTP status/rota, categoria DB, motivo realtime, release, tenant técnico, nível/motivos de relação e `rawRef.index/id`. Não leva body, headers, stack, SQL, bindings, URL de alerta, IDs de actor/request/trace/correlation nem `_source`.

A seleção prioriza alertas, falhas DB, HTTP 5xx, disponibilidade, auth/authz, realtime, relações `DETERMINISTIC`, limites temporais da janela e, por fim, contexto adicional. A timeline tem no máximo 40 eventos; quando há mais, `contextStats` registra `totalEvents`, `selectedEvents` e `contextTruncated=true`, sem truncamento silencioso. Os demais limites são: facts 30, evidências 50, hipóteses 5, checks 10, releases 10, tenants 20 e cada JSON/Markdown até 1 MiB.

## Modelo e política do dossiê

`DeterministicDossier` V1 separa estritamente:

- `facts`: estruturas `{ factId, type, statement, evidenceRefs }`, produzidas apenas de dados explícitos e sempre com evidência.
- `evidence`: ponteiros compactos `{ evidenceId, eventId, rawRef, relationLevel, relationReasons }`; `rawRef.index/id` é permitido, mas URL Kibana e payload bruto não são.
- `hypotheses`: condicionais, com `basedOnFactIds` e `supportLevel` (`SUPPORTED` ou `LIMITED`), distinto de confidence do incidente.
- `gaps`: cobertura ausente, normalização rejeitada, truncamento, ausência de tenant/release, relação apenas fraca ou confidence baixa.
- `recommendedChecks`: verificações humanas e investigativas, nunca remediação.

Os tipos de fact incluem classe, severidade, confidence, ocorrências, janela, serviço, rota, release, tenant técnico, HTTP/DB/auth/realtime, disponibilidade e truncamento. A redação de tenant diz apenas que eventos estão associados a tenants técnicos; não afirma impacto comercial.

Hipóteses só usam regras pequenas e explícitas para DB connection, DB slow, 5xx/application e auth. `UNKNOWN` informa que não há evidência suficiente. O validador bloqueia linguagem causal absoluta em português e inglês, incluindo “caused by”, “root cause is”, “causou” e “causa raiz”. Os checks bloqueiam deploy, rollback, restart, migration, DELETE, UPDATE, kill e equivalentes; não executam ação alguma.

## Identidade, reprodução e snapshots

O caller fornece `generatedAt` explicitamente. Ele não entra no `contextHash`, portanto o replay é reproduzível para o mesmo contexto. O hash é `ctx1:sha256(canonical-json(DossierContext))`; a versão de snapshot do incidente é outro hash de seu estado relevante.

`dossierId` é `dos1:sha256(incidentId | contextHash)`. Assim, mesmo incidente e mesmo contexto reaproveitam o snapshot; nova evidência muda o hash e cria outro snapshot. `DossierStore` grava em `SUPPORT_ANALYST_RUNTIME_DIR/dossiers/<incidentId>/<dossierId>.json` e `.md`, com temporário, fsync e rename. Um snapshot existente precisa ter JSON e Markdown idênticos ao esperado; divergência ou par parcial falha fechado, sem update in-place.

O Markdown é uma apresentação factual de resumo, status, facts, evidence, timeline, hypotheses, gaps, checks e provenance. Conteúdo externo é escapado para não criar headings, HTML, links ou estrutura Markdown. A fronteira de privacidade é validada recursivamente antes da persistência e rejeita authorization, cookie, token, password, secret, connection string, SQL, bindings, body, stack, e-mail, telefone, actor ID, raw payload/source. `rawRef` é a exceção técnica documentada. URLs de alerta não são incluídas.

## Feedback humano

`DossierFeedback` V1 é local e independente do lifecycle do incidente. Aceita `USEFUL`, `PARTIAL` e `WRONG`, além das flags limitadas `CLASSIFICATION_WRONG`, `SEVERITY_WRONG`, `CORRELATION_WRONG`, `DUPLICATE_WRONG`, `MISSING_CONTEXT`, `UNSUPPORTED_CLAIM`, `RECOMMENDED_CHECKS_NOT_USEFUL` e `OTHER`.

`FeedbackStore` valida que o dossiê existe e faz append-only em `feedback.jsonl` com lock e fsync. Linhas são JSON válido, limitadas a 4 KiB e corrupção é detectada na leitura. O comentário é opcional, sanitizado, limitado a 1.000 caracteres; identidade do revisor não é recebida nem persistida. Feedback não altera classificador, severity, confidence, correlação, dedupe ou incidente.

Uso seguro:

```text
SUPPORT_ANALYST_RUNTIME_DIR=<diretório> npm run analyst:feedback -- <dossierId> PARTIAL --created-at 2026-08-31T12:04:00.000Z --flags MISSING_CONTEXT --comment "contexto insuficiente"
```

## Replay, saúde e limitações

`npm run analyst:dossier-replay` usa somente a fixture sintética do Incident Engine e mostra ID, classe, severidade, confidence, contagens e context hash. `--show-markdown` acrescenta a representação legível. Os contadores locais opcionais `dossiersGenerated`, `dossierFailures`, `feedbackRecorded` e `feedbackFailures` foram adicionados a `ProcessingHealth`; watchdog, daemon, health externo e analytics ficam fora deste ticket.

As fixtures e testes cobrem DB recorrente, UNKNOWN, truncamento, determinismo, facts/evidence, ausência de causação, checks seguros, privacidade, escaping, snapshots e feedback. Cobertura adicional por classe é incremental no baseline de qualidade SA-08. SA-07 poderá acrescentar uma camada LLM opcional, mas não muda a autoridade do dossiê determinístico nem suas fronteiras de privacidade.
