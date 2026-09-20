# TQ-SA-PILOT-01 — runbook do primeiro piloto local

## Limite operacional

Este é um processo Node foreground, read-only e sem ações externas. Ele não é um Windows Service, não reinicia a si mesmo e não aciona Ops Panel, deploy, banco, Elasticsearch write, GitHub, Telegram ou shell de remediação. Não use PROD: o runtime o recusa.

O piloto só começa após uma identidade Elastic DEV exclusiva/read-only ser autorizada. Sem isso, registre `PILOT SOURCE VALIDATION PENDING`; não substitua por credencial privilegiada.

## Pré-requisitos e start

No diretório `support-analyst`, defina em sessão protegida:

```powershell
$env:SUPPORT_ANALYST_ENV = 'dev'
$env:SUPPORT_ANALYST_ES_URL = 'http://approved-dev-elasticsearch:9200'
$env:SUPPORT_ANALYST_ES_API_KEY = 'exclusive-read-only-key'
$env:SUPPORT_ANALYST_RUNTIME_DIR = 'C:\safe\support-analyst-pilot'
$env:SUPPORT_ANALYST_LLM_ENABLED = 'false'
```

Nunca salve API key em repositório, perfil PowerShell compartilhado, dossiê ou ticket. Os defaults são poll de 60 s, first window de 5 min, overlap de 2 min, no máximo 50 eventos, heartbeat de 30 s, stale de 90 s e processing-stall de 300 s. Só reduza limites em troubleshooting; `SUPPORT_ANALYST_MAX_EVENTS` nunca passa de 100.

1. Rode `npm run analyst:validate`.

Para o read-back PROD do TAP-61, o validator certificado exige a fase explicitamente: use `node scripts/support-analyst/validate-elastic-readonly.mjs --phase=predeploy` antes da bridge e `--phase=postdeploy` somente após a aplicação bridge iniciar. O modo `predeploy` valida o mapping estável já existente e não exige `attributes.event.action` nem `attributes.legacy.kind`; o modo `postdeploy` exige `attributes.event.action` e um positive control. A evidência de zero fallback é uma janela fechada com `attributes.event.action=legacy_fallback` e contagem zero. `attributes.legacy.kind` só é obrigatório quando houver hits de fallback para classificar.
2. Rode `npm run analyst:pilot-once`. Ele faz preflight `_search` bounded/read-only e uma rodada. Espere JSON com `mode: PILOT_READ_ONLY_NO_EXTERNAL_ACTIONS` e `outcome: COMPLETED`.
3. Inspecione `health/health.json`, `state/source-watermark.json`, `review-queue.json`, `incidents.json` e `dossiers/` em `SUPPORT_ANALYST_RUNTIME_DIR`.
4. Para observação controlada, rode `npm run analyst:pilot-run` em terminal mantido aberto.

Para habilitar enrichment, configure somente endpoint loopback e modelo local previamente aprovado. O modo `DETERMINISTIC_PLUS_LLM` continua seguro se Ollama falhar; comece o primeiro ciclo com LLM desligado.

## Stop e health

Use `Ctrl+C` no processo foreground. Ele deixa de iniciar novos ciclos, permite a conclusão cooperativa do ciclo em andamento, persiste clean shutdown/health e libera o lock. Não force kill salvo processo realmente travado; se isso ocorrer, trate como crash e siga recovery.

Execute de fora do processo:

```powershell
npm run analyst:health-check
npm run analyst:health-json
```

Exit code `0` é healthy, `1` degraded, `2` unhealthy e `3` unknown/configuration. Ciclo vazio é healthy/idle. `PROCESSING_STALLED` significa que um ciclo começou e não terminou no threshold; não é o mesmo que não haver eventos. Health é um artefato externo: snapshot/heartbeat ausente ou stale é unhealthy mesmo que o último JSON pareça saudável.

## Falhas e recovery conservador

| Sintoma | Ação manual |
|---|---|
| Elastic indisponível, 401/403, query proibida ou mapping incompatível | Pare o piloto, registre erro/horário, confirme URL, papel read-only, índice DEV e contrato; rode um novo `pilot-once` apenas após correção. Não teste escrita. |
| Ollama/modelo/timeout | Mantenha ou volte a `SUPPORT_ANALYST_LLM_ENABLED=false`; o dossiê determinístico continua válido. Não reinicie serviços pelo Analyst. |
| `PROCESSING_STALLED` ou heartbeat stale | Confirme se o processo existe, capture health e saída do terminal, pare com Ctrl+C se responsivo; se caiu, reinicie manualmente com `pilot-once` primeiro. |
| filesystem cheio, cap atingido ou store corrompido | Pare o processo. Copie o diretório inteiro para backup local, investigue capacidade/corrupção e só então archive/renomeie o arquivo problemático. Nunca delete automaticamente. Reexecute one-shot e confirme replay/dedupe. |
| crash | Preserve `health/`, `state/`, `incidents.json`, `review-queue.json` e saída de terminal. Reinicie manualmente com one-shot; a overlap pode reler eventos e o dedupe local é esperado. |

`llm/interactions.jsonl` recusa crescimento acima de 10 MiB. Quando atingir cap, pare, copie o arquivo para diretório de arquivo com data/permissões equivalentes, valide a cópia e renomeie manualmente o arquivo ativo antes de reiniciar. `incidents.json`/`state.json` são limitados a 5 MiB; faça backup, preserve os artefatos e investigue volume/retention antes de qualquer rotação manual. Dossiês e enrichments não devem ser apagados para “liberar” o piloto sem preservar evidência.

## Revisão humana

Abra `review-queue.json` e selecione itens `PENDING`, uma ou duas vezes ao dia em lote. Abra o JSON/Markdown em `dossiers/<incident-id>/`; enrichment LLM, se houver, fica separado em `enrichments/` e não substitui o dossiê determinístico.

Registre a avaliação:

```powershell
npm run feedback -- <dossierId> USEFUL --created-at 2026-09-02T12:30:00.000Z --comment 'Comentário sanitizado'
```

Os valores permitidos são `USEFUL`, `PARTIAL` e `WRONG`. O comando grava no FeedbackStore existente e marca a entrada da fila como `REVIEWED`. Não inclua identidade do revisor, PII, credenciais, SQL, payload bruto ou instruções de remediação no comentário.

## Critérios antes de SA-09

Registrar evidência de: one-shot e loop bounded; fonte->dossiê; fila de revisão; restart/replay seguro; parada; heartbeat/snapshot reais; detecção de source failure e stuck; LLM degradado sem bloquear core; limites de arquivo/consulta; e ausência de DB/Elastic write, APIs externas, GitHub, Telegram, shell, deploy/restart ou autoridade do modelo. SA-09 só pode ser planejado após a validação DEV read-only autorizada e esse drill; não é iniciado por este runbook.
