# TQ-SA-PRD-02 — capacidade do watch PRD do Support Analyst (WI-C, TAP-140)

**Data:** 2026-11-01
**Base:** `deploy/runtime/spec-wic-agente.md` (local) e decisão do Filipe registrada em `TQ-SA-PRD-access-spec.md` ("Capacidade ampliada").

## Identidade e escopo

O watch PRD roda no PC (DEV físico) e lê o Elastic PRD pela Tailscale com a API key `quiver-support-analyst-prd`, somente leitura. O corpo de criação da chave está em [`prd-readonly-role.json`](prd-readonly-role.json): role `support_analyst_prd_read`, sem privilégio de cluster, `read` + `view_index_metadata` e validade de **180 dias**.

| Padrão | Uso |
|---|---|
| `quiver-tap-alert-events` | alertas Kibana PRD (resumo diário) |
| `logs-technical*.otel-prd*` | surto de logs ERROR, contexto técnico |
| `logs-audit*.otel-prd*` | comando `jornada` |
| `traces-*.otel-prd*` | `jornada --correlacao` |
| `metrics-*.otel-prd*` | frescor da telemetria da API |
| `metrics-*.otel-infra*` | httpcheck do collector |
| `logs-*.otel-infra*` | opcional (pode não existir ainda) |

Continuam negados: `*otel-dev*`, `quiver-tap-alert-events-dev`, curingas amplos (`traces-*`, `metrics-*`, `logs-*`, `logs-generic*`), `.kibana*`, `.security*` e qualquer escrita. A lista é a mesma de `getPrivilegeScope('prd')` em `scripts/support-analyst/validator-policy.mjs`; um teste falha se o JSON e a política divergirem.

## Travas de execução

- PRD exige `SUPPORT_ANALYST_ALLOW_PRD=true`, `SUPPORT_ANALYST_CREDENTIAL_ENV=prd`, `SUPPORT_ANALYST_ENDPOINT_ENV=prd` e URL fora de loopback; DEV aceita só loopback.
- Com a chave de leitura, o runtime só faz `POST <índice>/_search` limitado. A única escrita é o batimento (abaixo), com outra chave. O validador (`validate-elastic-readonly.mjs`) também usa `_security/_authenticate`, `_resolve/index`, `_field_caps` e `_has_privileges`, todos de leitura.
- Credenciais ficam em `deploy/runtime/support-analyst-<env>.env` (ignorado pelo Git, ACL restrita). Modelo sem segredo: `support-analyst/support-analyst-prd.env.example`.

## Detectores (ciclo de 60 s)

| Detector | Severidade | Dispara após | Resolve após | Notifica |
|---|---|---|---|---|
| Rede do PC fora | SEV3 | 2 ciclos | 1 | não (pula ciclos) |
| Site fora do ar (visto de fora) | SEV1 | 3 | 2 | sim |
| Elastic PRD inacessível pelo PC | SEV2 | 3 | 2 | sim |
| Chave do analyst recusada (expirada?) | SEV2 | 1 | 1 | sim |
| Telemetria da API parou | SEV2 | 2 | 2 | sim |
| Collector PRD parou de enviar | SEV2 | 2 | 2 | sim |
| Caminho de alertas parado (poller não healthy) | SEV2 | 3 | 2 | sim (segurado se o collector estiver parado) |
| Surto de logs ERROR na API | SEV3 | 1 | 3 | sim |

Há lembrete a cada 60 min enquanto o alerta continua ativo, resumo diário às 8h (prova de vida) e um aviso INFO quando a versão no ar muda. O limite padrão é de 20 mensagens por hora.

## Batimento externo (TAP-169)

Ao fim de cada ciclo com rede, o watch grava um documento em `logs-support_analyst.heartbeat-prd` (horário, ambiente, quantidade de detectores disparados, se o ciclo foi pulado/silencioso e o `releaseSha` visto; nada pessoal). A gravação usa a chave `quiver-support-analyst-heartbeat-prd` ([`prd-heartbeat-writer-role.json`](prd-heartbeat-writer-role.json): só `create_doc`/`auto_configure` nesse data stream, 365 dias), em `SUPPORT_ANALYST_REMOTE_HEARTBEAT_API_KEY`; ela precisa ser diferente da chave de leitura. Falha ao gravar não interrompe o ciclo (aparece como `heartbeat: failed` no log). O template `quiver-tap-analyst-heartbeat` guarda 30 dias, sem réplica.

A regra `quiver-tap-analyst-heartbeat-missing-prd` (a cada 5 min, nenhum batimento em 15 min) vai pelo poller do VPS ao Telegram **uma vez por queda**, com mensagem de recuperação quando o PC volta. Como o PC às vezes é desligado (decisão do Filipe, 01/11), o aviso significa "PC desligado, sem internet ou analista parado", não necessariamente defeito. Configuração: `scripts/observability/setup-analyst-heartbeat.ps1 -Apply -ConfirmPrd`, depois `configure-kibana.ps1 -Target prd -ConfirmPrd` e `wire-alert-actions.ps1 -Target prd -ConfirmPrd -Apply`, e reinício da tarefa do analista.

## Partida com o Windows e janela pós-boot

`scripts/support-analyst/install-watch-task.ps1` registra a tarefa `QuiverTap-SupportAnalyst-Watch-PRD`. Ela dispara na partida do Windows (60 s depois) e no logon, roda como S4U (sem sessão aberta e sem guardar senha) e tem RestartCount 999 com intervalo de 1 min, sem limite de tempo e IgnoreNew.

A tarefa executa `support-analyst/dist`. Antes de cada partida, `run-analyst.ps1` recompila (`npm run build`) quando algum `src/*.ts` está mais novo que o `dist` e registra no log `build do analista: atual|recompilado|falhou`. Se a compilação falhar, ele segue com o `dist` anterior. Para trocar de versão: atualize a pasta e reinicie a tarefa. Como o processo roda na sessão da tarefa, um terminal sem elevação não consegue encerrá-lo; depois de `Stop-ScheduledTask`, o node antigo sai sozinho em poucos minutos e o novo assume o lock.

Ao subir, o processo espera o Elastic com backoff de 5, 10, 30 e 60 s e depois tenta a cada 60 s. Nesse período o estado local fica como "aguardando rede". Durante os primeiros 10 min após o boot (`SUPPORT_ANALYST_BOOT_QUIET_MINUTES`) nenhum alerta é enviado; os detectores continuam contando. Um lock com PID de processo morto é removido sozinho.

## Telegram sem dados pessoais

As mensagens `[ANALISTA]` levam só contagens, rotas-modelo (ids viram `:id`, sem query) e correlationIds. Nome, e-mail, IP, cidade e termo de busca nunca entram: o contexto passa por allow-list (`toSafeErrorContext`) e todo texto passa por `scrubPersonalData`. Testes unitários em `support-analyst/test/notify.test.ts` cobrem isso. Para investigar uma pessoa, use o comando `jornada` no PC; a saída fica só em arquivo local.
