# TQ-SA-PILOT-02 — acceptance operacional do Support Analyst

**Data:** 2026-09-02
**Status:** `BLOCKED — authorized source validation pending`
**Escopo executado:** gates offline, runtime fake-source, health local, review do runbook e inspeção estática. PROD não foi consultado; nenhuma credencial foi lida, criada ou persistida.

## Pre-check

| Item | Evidência |
|---|---|
| Branch / HEAD | `main` / `e78efcbe28a8c2ec4fea91bb136eb59d15cd16f3` no início da acceptance |
| origin/main | `9aaad565e67e5f66757c399e295cef1abacde401` |
| Ahead / behind | `2 / 0` |
| Commits locais | `2ab0470 feat(support): add analyst health model`; `e78efcb feat(support): add analyst pilot runtime` |
| Working tree inicial | somente `docs/audits/` não rastreado, preservado e não modificado |
| Credencial DEV | nenhuma disponível nesta sessão; nenhuma busca ou substituição por credencial privilegiada foi feita |

## Correção objetiva encontrada

O primeiro baseline de testes revelou uma corrida em `HealthTracker`: persistências atômicas disparadas por hooks próximos podiam concluir fora de ordem e deixar um snapshot anterior como último arquivo. O tracker passou a serializar a fila de persistência. Três execuções consecutivas dos 82 testes passaram depois da correção. Isto é uma correção de confiabilidade do runtime existente, não uma mudança arquitetural.

## Evidência de execução

`typecheck`, `test`, `build` e `analyst:validate` passaram após a correção. O total permanece **82 testes**. O E2E offline existente executa fonte falsa -> normalize -> correlate -> incident -> ContextBuilder -> deterministic dossier -> stores -> health -> review queue -> watermark. Ele também cobre restart/replay, ciclo vazio, source failure, LLM failure e preservação do dossiê.

O `analyst:health-smoke` foi executado em diretório temporário isolado, com LLM desligado: overall/process/elastic/processing `HEALTHY`, readiness determinística `READY`; `analyst:health-check` retornou **0**. Esse smoke é sintético e não é evidência de uma fonte Elastic autorizada.

Os testes de runtime confirmam ciclo sem eventos como `HEALTHY`/idle, um ciclo por vez, replay sem novo dossiê/item de review, falha de fonte sem watermark e LLM falhando sem bloquear o dossiê determinístico. Os testes de health cobrem heartbeat/snapshot stale com checker não saudável. Os stores testam lock, limite, corrupção e escrita atômica; o recovery foi exercitado apenas por harness/artefatos temporários, sem encher disco ou excluir dados operacionais.

Não foi iniciado `analyst:pilot-once`/`analyst:pilot-run` contra Elastic: isso exigiria `SUPPORT_ANALYST_ENV=dev`, endpoint e API key DEV exclusiva/autorizada, ausentes nesta sessão. Consequentemente não há índices reais, campos reais, duração/ciclos reais, dossiê real, fila real, feedback real, graceful stop real ou preflight real a registrar.

## Matriz de acceptance

| Acceptance | Result | Evidence |
|---|---|---|
| Baseline offline / fake-source E2E | PASS | 82 testes; runtime E2E completo offline |
| DEV source authentication e preflight | NOT_APPLICABLE | nenhuma identidade DEV autorizada disponível |
| Source contract / índices reais | NOT_APPLICABLE | nenhuma conexão Elastic realizada |
| Read-only boundary | PASS_WITH_LIMITATION | cliente usa somente `POST .../_search`; papel externo não verificado |
| One-shot e source->dossier reais | NOT_APPLICABLE | depende da fonte autorizada |
| Watermark / replay / dedupe | PASS | teste de runtime com overlap e reinício |
| Review queue / feedback | PASS_WITH_LIMITATION | queue e FeedbackStore validados por testes; sem dossiê real para drill humano |
| Health / idle / stale | PASS | smoke/check local e testes controlados |
| Continuous loop / graceful stop reais | NOT_APPLICABLE | requer fonte DEV autorizada; o E2E offline cobre ciclos isolados, não uma sessão foreground real |
| Source failure / filesystem recovery | PASS_WITH_LIMITATION | harness/limites atômicos; nenhum serviço/disco externo alterado |
| LLM fail-soft | PASS | teste offline; LLM permaneceu desligado na acceptance |
| Negative capabilities | PASS_WITH_LIMITATION | inspeção de design/testes; sem prova externa de papel Elastic |
| Runbook | CLEAR | pré-requisitos, start/stop, health, failure/recovery, review, LLM e caps são executáveis; a seção DEV depende da identidade autorizada |

## Conclusão e gate

`AUTHORIZED_SOURCE_VALIDATION: PARTIAL`. Há prova estática/offline de cliente bounded/read-only, preflight estrito e bloqueio PRD, mas não há prova de endpoint, autenticação, índice, dataset ou campos DEV autorizados.

`PILOT_OPERATIONAL_ACCEPTANCE: PASS_WITH_GAPS`. O runtime local é operável nos cenários isolados, porém a lacuna de fonte autorizada é bloqueante para shadow. Portanto:

```text
TQ-SA-PILOT-02: BLOCKED
TQ-SA-09: BLOCKED — do not start
```

Próximo passo recomendado: disponibilizar explicitamente uma identidade DEV exclusiva/read-only e executar, com o runbook, um `analyst:pilot-once`, uma janela curta de `analyst:pilot-run`, stop cooperativo e replay. Após isso, revisar o Functional Value Gate antes de iniciar qualquer ciclo técnico longo de SA-09.

## Limites de segurança desta acceptance

Elastic write: **NO**. DB access/write: **NO**. PROD: **NO**. Deploy, restart de serviço, GitHub, Telegram, shell de remediação e APIs externas: **NO**. Nenhum segredo, Authorization, body bruto Elastic, PII evidente, hostname/usuário ou caminho local sensível foi colocado neste documento.
