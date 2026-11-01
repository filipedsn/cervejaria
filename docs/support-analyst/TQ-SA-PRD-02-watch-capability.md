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
- O runtime só faz `POST <índice>/_search` limitado; não existe caminho de escrita. O validador (`validate-elastic-readonly.mjs`) também usa `_security/_authenticate`, `_resolve/index`, `_field_caps` e `_has_privileges`, todos de leitura.
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
| Surto de logs ERROR na API | SEV3 | 1 | 3 | sim |

Há lembrete a cada 60 min enquanto o alerta continua ativo, resumo diário às 8h (prova de vida) e um aviso INFO quando a versão no ar muda. O limite padrão é de 20 mensagens por hora.

## Partida com o Windows e janela pós-boot

`scripts/support-analyst/install-watch-task.ps1` registra a tarefa `QuiverTap-SupportAnalyst-Watch-PRD`. Ela dispara na partida do Windows (60 s depois) e no logon, roda como S4U (sem sessão aberta e sem guardar senha) e tem RestartCount 999 com intervalo de 1 min, sem limite de tempo e IgnoreNew.

Ao subir, o processo espera o Elastic com backoff de 5, 10, 30 e 60 s e depois tenta a cada 60 s. Nesse período o estado local fica como "aguardando rede". Durante os primeiros 10 min após o boot (`SUPPORT_ANALYST_BOOT_QUIET_MINUTES`) nenhum alerta é enviado; os detectores continuam contando. Um lock com PID de processo morto é removido sozinho.

## Telegram sem dados pessoais

As mensagens `[ANALISTA]` levam só contagens, rotas-modelo (ids viram `:id`, sem query) e correlationIds. Nome, e-mail, IP, cidade e termo de busca nunca entram: o contexto passa por allow-list (`toSafeErrorContext`) e todo texto passa por `scrubPersonalData`. Testes unitários em `support-analyst/test/notify.test.ts` cobrem isso. Para investigar uma pessoa, use o comando `jornada` no PC; a saída fica só em arquivo local.
