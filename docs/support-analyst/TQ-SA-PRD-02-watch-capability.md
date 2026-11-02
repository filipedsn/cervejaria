# TQ-SA-PRD-02 — capacidade do watch PRD do Support Analyst (WI-C, TAP-140)

**Data:** 2026-11-01
**Base:** `deploy/runtime/spec-wic-agente.md` (local) e decisão do Filipe registrada em `TQ-SA-PRD-access-spec.md` ("Capacidade ampliada").

## Identidade e escopo

Desde o TAP-171 o watch PRD roda no contêiner `quiver-tap-support-analyst` do VPS e lê o Elastic PRD pela rede Docker do Elastic (`http://elasticsearch:9200`) com a API key `quiver-support-analyst-prd-vps`, somente leitura e criada no próprio VPS. As chaves antigas do PC (`quiver-support-analyst-prd` e `quiver-support-analyst-heartbeat-prd`) foram revogadas em 2026-11-02 junto com a remoção do agente do PC. O corpo de criação da chave está em [`prd-readonly-role.json`](prd-readonly-role.json): role `support_analyst_prd_read`, sem privilégio de cluster, `read` + `view_index_metadata` e validade de **180 dias**.

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
| Rede do analista fora | SEV3 | 2 ciclos | 1 | não (pula ciclos) |
| Site fora do ar (visto de fora) | SEV1 | 3 | 2 | sim |
| Elastic PRD inacessível pelo analista | SEV2 | 3 | 2 | sim |
| Chave do analyst recusada (expirada?) | SEV2 | 1 | 1 | sim |
| Telemetria da API parou | SEV2 | 2 | 2 | sim |
| Collector PRD parou de enviar | SEV2 | 2 | 2 | sim |
| Caminho de alertas parado (poller não healthy) | SEV2 | 3 | 2 | sim (segurado se o collector estiver parado) |
| Surto de logs ERROR na API | SEV3 | 1 | 3 | sim |

Há lembrete a cada 60 min enquanto o alerta continua ativo, resumo diário às 8h (prova de vida) e um aviso INFO quando a versão no ar muda. O limite padrão é de 20 mensagens por hora.

## Batimento externo (TAP-169)

Ao fim de cada ciclo com rede, o watch grava um documento em `logs-support_analyst.heartbeat-prd` (horário, ambiente, quantidade de detectores disparados, se o ciclo foi pulado/silencioso e o `releaseSha` visto; nada pessoal). A gravação usa a chave `quiver-support-analyst-heartbeat-prd` ([`prd-heartbeat-writer-role.json`](prd-heartbeat-writer-role.json): só `create_doc`/`auto_configure` nesse data stream, 365 dias), em `SUPPORT_ANALYST_REMOTE_HEARTBEAT_API_KEY`; ela precisa ser diferente da chave de leitura. Falha ao gravar não interrompe o ciclo (aparece como `heartbeat: failed` no log). O template `quiver-tap-analyst-heartbeat` guarda 30 dias, sem réplica.

A regra `quiver-tap-analyst-heartbeat-missing-prd` (a cada 5 min, nenhum batimento em 15 min) vai pelo poller do VPS ao Telegram **uma vez por queda**, com mensagem de recuperação quando o batimento volta. Com o watch no VPS, o aviso significa contêiner parado, travado ou sem acesso ao Elastic. Configuração: `scripts/observability/setup-analyst-heartbeat.ps1 -Apply -ConfirmPrd`, depois `configure-kibana.ps1 -Target prd -ConfirmPrd` e `wire-alert-actions.ps1 -Target prd -ConfirmPrd -Apply`, e recriação do contêiner do analista.

## Contêiner no VPS (TAP-171)

- Imagem `quiver-tap-support-analyst` (`support-analyst/Dockerfile`, só o `dist`, usuário `node`), serviço em `deploy/tap-quiver/docker-compose.analyst.yml`: rede externa `elasticsearch-kibana_elastic`, `mem_limit: 256m`, `restart: unless-stopped`, volume `support_analyst_runtime` em `/app/runtime` e healthcheck que exige `watch/state.json` regravado há menos de 3 min.
- Configuração em `deploy/tap-quiver/.env.support-analyst` (600, fora do Git e preservado pelo `rsync` do deploy; modelo `.env.support-analyst.example`). Telegram é o mesmo bot/chat do poller; `SUPPORT_ANALYST_TELEGRAM_DRY_RUN=true` deixa em sombra.
- O `deploy-prd.sh` monta e recria o serviço depois da API; falha nele só gera AVISO. Para recriar à mão: `docker compose -f docker-compose.yml -f docker-compose.analyst.yml up -d support-analyst` em `/opt/quiver-tap/deploy/tap-quiver`.
- Dentro do contêiner o processo sempre tem o mesmo PID; o lock trata um arquivo com o próprio PID como sobra de reinício.
- A janela pós-boot usa o uptime do VPS (o contêiner enxerga o do host): após reboot do servidor, 10 min sem alerta enquanto o Elastic sobe.

## PC sem plantão PRD e janela pós-boot

Em 2026-11-02 o agente PRD saiu do PC: a tarefa `QuiverTap-SupportAnalyst-Watch-PRD` foi removida, o env e o estado locais foram apagados e as chaves do PC revogadas. `run-analyst.ps1 -Target prd` em `watch`/`pilot` encerra com código 0 e `install-watch-task.ps1 -Install -Target prd` recusa, para não haver dois plantões no Telegram. No PC o analista roda só contra a DEV (`-Target dev`). A tarefa DEV, quando instalada, executa `support-analyst/dist` e `run-analyst.ps1` recompila antes de cada partida quando algum `src/*.ts` está mais novo, registrando `build do analista: atual|recompilado|falhou`.

Ao subir, o processo espera o Elastic com backoff de 5, 10, 30 e 60 s e depois tenta a cada 60 s. Nesse período o estado local fica como "aguardando rede". Durante os primeiros 10 min após o boot (`SUPPORT_ANALYST_BOOT_QUIET_MINUTES`) nenhum alerta é enviado; os detectores continuam contando. Um lock com PID de processo morto é removido sozinho.

## Avisos de caixa `[CAIXA]` (TAP-174)

A cada ciclo, depois das leituras do Elastic, o watch procura em `logs-audit*.otel-prd*` as ações `transacao.cash_register_opened`, `transacao.cash_register_closed` e `transacao.cash_register_administrative_closed` (só `event.outcome: success`, sem `test.synthetic`) e manda um aviso por evento:

```
[CAIXA] 🟢 Caixa aberto
Empresa: <nome da empresa>
Unidade: <ponto de venda>
Por: <nome de quem abriu>
Quando: 01/11/2026, 18:02 (Brasília)
```

- Só o caixa da operação: o caixa de evento (modelo antigo) não gera aviso, por decisão do Filipe em 2026-11-01.
- O backend grava `empresaNome`, `pontoVendaNome` e `abertoEm`/`fechadoEm` no `metadata` desses eventos (`backend/src/lib/operacao/caixa-audit.ts`). O exportador OTLP guarda o `metadata` como texto JSON e o analista lê os dois formatos. Em evento antigo, sem esses campos, a empresa sai pelo slug e o horário pelo `@timestamp`.
- Cada evento sai uma vez: o estado do watch guarda a marca d'água (`cash.since`) e os `event.id` já avisados. A leitura recua 10 min para cobrir o atraso de ingestão; depois de muito tempo parado, só o último dia é avisado; na primeira execução só a marca é gravada (nenhum histórico).
- Os avisos não respeitam a janela pós-boot (são eventos de negócio, não alertas de saúde). Falha de leitura só adia para o próximo ciclo.
- Cota própria, separada dos alertas: `SUPPORT_ANALYST_CASH_MAX_PER_HOUR` (padrão 60), com estado e outbox em `<RUNTIME_DIR>/cash/notifications`. `SUPPORT_ANALYST_CASH_NOTICES=false` desliga.

## Telegram sem dados pessoais

A única exceção é o aviso `[CAIXA]`, que leva o nome de quem abriu ou fechou o caixa, por decisão explícita do Filipe (TAP-174). Ele lê só ação, empresa, ponto de venda, nome do operador e horário; e-mail, IP e valores nunca são lidos.

As mensagens `[ANALISTA]` levam só contagens, rotas-modelo (ids viram `:id`, sem query) e correlationIds. Nome, e-mail, IP, cidade e termo de busca nunca entram: o contexto passa por allow-list (`toSafeErrorContext`) e todo texto passa por `scrubPersonalData`. Testes unitários em `support-analyst/test/notify.test.ts` cobrem isso. Para investigar uma pessoa em PRD, rode `scripts/support-analyst/jornada-prd.ps1` no PC (mesmos argumentos de `npm run journey`). Ele executa a jornada dentro do contêiner do VPS por SSH (`docker exec`), com a chave de leitura do contêiner; nenhuma chave PRD fica no PC. A saída aparece no terminal, o contêiner guarda o arquivo em `/app/runtime/journeys` (`SUPPORT_ANALYST_JOURNEY_DIR`, volume `support_analyst_runtime`) e o PC guarda uma cópia em `deploy/runtime/support-analyst/journeys`, os dois com retenção de 30 dias. `--resumo` não tem LLM no VPS e devolve só a linha do tempo.
