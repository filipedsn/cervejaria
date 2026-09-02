# TQ-SA-PILOT-01 — foundation operacional mínima do piloto

## Status

`CLOSED` para a foundation local e offline. `TQ-SA-09` está **RELEASED FOR PLANNING**, não iniciado. A validação da fonte DEV autorizada continua `PILOT SOURCE VALIDATION PENDING`; esta entrega não consultou PROD nem usou credenciais.

## Entrega

`SupportAnalystRuntime` é um único processo Node foreground que compõe somente os componentes já existentes:

```text
alert source (read-only, bounded) -> normalize -> correlate -> incident
  -> deterministic dossier -> optional local LLM -> local persistence
  -> review queue + HealthTracker
```

Ele não cria daemon, Windows Service, fila, banco, Redis, worker distribuído, Scheduled Task, watchdog, auto-restart, Ops Panel ou stack de observabilidade.

Os comandos são `npm run analyst:pilot-once` e `npm run analyst:pilot-run`. Ambos deixam claro, pela saída e pelo código, que são `PILOT_READ_ONLY_NO_EXTERNAL_ACTIONS`. O primeiro roda exatamente um ciclo; o segundo permanece em foreground até `Ctrl+C`/`SIGTERM` e não inicia uma nova rodada antes de a atual terminar. Um ciclo lento espera o intervalo somente depois de concluir: ticks não acumulam.

## Limites e replay

O intervalo padrão é `SUPPORT_ANALYST_POLL_INTERVAL_MS=60000`. Cada consulta é uma `_search` já allowlisted na fonte Elastic DEV, com faixa `from/to`, `size`, source filter e máximo `SUPPORT_ANALYST_MAX_EVENTS=50` (nunca acima de 100). A primeira rodada olha no máximo cinco minutos (`SUPPORT_ANALYST_INITIAL_WINDOW_MS=300000`).

Depois de uma rodada completamente persistida, `state/source-watermark.json` é gravado por rename atômico. A próxima rodada relê uma sobreposição de dois minutos (`SUPPORT_ANALYST_OVERLAP_MS=120000`), limitada pela janela inicial. Isso tolera atraso de ingestão/clock e favorece reprocessamento seguro; IDs determinísticos e o `IncidentGrouper` suprimem eventos já vistos. Não há sistema de exactly-once nem paginação ilimitada.

O watermark só avança após persistir incidentes, dossiês, fila de revisão e estado local. Falha de fonte, processamento ou persistência não o avança. Duplicatas seguras são preferíveis à perda de evidência.

## Startup, fonte e fronteiras

Antes do polling, o comando valida config do Analyst, runtime, health e LLM; exige diretório local, URL/API key exclusiva, endpoint LLM loopback se habilitado, e chama um preflight `_search` bounded na fonte de alertas aprovada. O preflight não faz teste de escrita. Query proibida e resposta incompatível falham claramente; documentos rejeitados na normalização são contados e não avançam um evento aceito. Uma fonte/índice vazio pode ser lido sem erro e não prova que todos os campos/mappings de uma fonte ainda sem eventos estejam presentes: essa validação permanece parte da evidência DEV autorizada pendente.

`requireRuntimeElasticsearchConfig` continua recusando PRD incondicionalmente. A fonte operacional é `PilotElasticAlertSource`, que só chama `findAlertEvents` do cliente `ElasticReadOnlyClient`; não existem import, endpoint ou comando de escrita Elastic, aplicação/DB, GitHub, Telegram, deploy, shell de remediação ou restart.

## Modos LLM

`DETERMINISTIC_ONLY` é o padrão (`SUPPORT_ANALYST_LLM_ENABLED=false`). O dossiê determinístico é salvo e entra na fila sem qualquer chamada Ollama. Em `DETERMINISTIC_PLUS_LLM`, há no máximo uma inferência por vez, após o dossiê já existir. Resultado inválido, timeout, modelo/Ollama indisponível ou erro de interaction store preserva o dossiê e registra fallback; não altera fato, classe, severidade, confidence, evidência ou cursor. Não foi implementada `SELECTIVE_LLM_POLICY`.

## Health e revisão humana

O processo instancia o `HealthTracker` real, atualiza heartbeat a cada 30 s e registra início/fim/falha de ciclo, leitura Elastic, contadores, duração, dossiês e tentativas/resultados LLM. Ciclo vazio é `HEALTHY / idle`; ciclo iniciado sem terminar após o threshold de 300 s é `PROCESSING_STALLED`. O checker permanece externo e file-only: `npm run analyst:health-check` retorna `0` healthy, `1` degraded, `2` unhealthy e `3` unknown/configuration.

`review-queue.json` é um índice atômico e limitado (1 MiB), não uma cópia do dossiê. Cada item contém `dossierId`, `incidentId`, instante, classe, severidade, confidence, disponibilidade de enrichment e `PENDING`/`REVIEWED`. O comando existente de feedback marca o item como `REVIEWED` depois de gravar feedback `USEFUL`, `PARTIAL` ou `WRONG`; identidade do revisor não é armazenada.

## Validação executada

O teste offline `runtime.test.ts` executa fonte falsa -> normalização -> correlação -> incidente -> contexto -> dossiê -> stores -> health -> fila -> watermark. Ele também cobre reinício/replay, ciclo vazio, falha de fonte, LLM com falha e preservação do dossiê. Não envolve Elastic, Ollama, GPU ou PROD.

## Critério para planejar SA-09

O código agora suporta one-shot, loop bounded, fila de revisão, replay e parada cooperativa. Antes de iniciar SA-09, um responsável deve executar e registrar a validação read-only em DEV autorizado, a smoke de um ciclo e o drill manual de saúde/recovery do runbook. Não há autorização de PROD nesta decisão.
