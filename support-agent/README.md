# Agente de suporte autônomo

Observa o Elasticsearch, transforma erro de produção em Issue enriquecida no GitHub,
corrige o código via Cursor CLI headless em worktree isolado e abre PR para revisão
humana. O deploy em produção continua sendo liberado por você no ops-panel `:3099`.

```
Kibana rules → quiver-tap-alert-events → watcher → enrich → triage
                                                              ↓
                              infra/SLO → Telegram e e-mail (fluxo atual)
                              código    → Issue com dossiê
                                            ↓
                                     fixer (worktree isolado)
                                            ↓
                              verificação: test:unit + ci:validate + teste novo
                                            ↓
                                     PR fix/auto-N → você revisa
                                            ↓
                                  ops-panel :3099 libera o deploy
```

## Estado atual: modo sombra

O agente nasce em **modo sombra**: abre Issues e nunca corrige código. Isso é
deliberado. A qualidade da correção automática é limitada pela qualidade do dossiê,
e o dossiê só pode ser avaliado com dados reais de produção.

Rode em sombra por 1 a 2 semanas, leia as Issues, e só então decida.

## Comandos

Todos disponíveis a partir da raiz do repositório:

| Comando | O que faz |
|---|---|
| `npm run agent:probe` | Verifica conexão com o Elasticsearch e mostra a estrutura dos documentos |
| `npm run agent:preview` | Mostra o dossiê que seria publicado, sem tocar no GitHub |
| `npm run agent:triage` | Roda um ciclo de triagem e sai |
| `npm run agent:start` | Sobe o agente em background |
| `npm run agent:status` | Processo, modo de operação e resumo do estado |
| `npm run agent:stop` | Para o agente |
| `npm run agent:report` | Relatório de eficácia (avaliação do modo sombra) |
| `npm run agent:review` | Revisão semanal: desfecho dos PRs automáticos e lacunas a preencher |
| `npm run agent:fixer:off -- "motivo"` | Kill switch: para a correção sem parar a triagem |
| `npm run agent:fixer:on` | Religa a correção |
| `npm run agent:fixer:status` | Mostra por que o fixer está ligado ou desligado |
| `npm run agent:test` | Testes unitários do agente |

Dentro de `support-agent/` há ainda `npm run worktree:check` (valida o isolamento) e
`npm run probe:fields` (investiga o mapping do Elasticsearch quando algum campo do
enriquecimento parece vazio).

## Configuração

Copie `.env.example` para `.env`. As credenciais do Elasticsearch são lidas também de
`deploy/observability/.env.observability`, então normalmente basta deixar as linhas de
ES comentadas.

O agente precisa da própria API key do Elasticsearch — **a do alert-poller não serve**,
porque ela só lê `quiver-tap-alert-events` e o enriquecimento depende de ler `logs-*`:

```powershell
npm run obs:create-api-keys
```

Sem essa chave o agente cai em basic auth com o usuário `elastic`, o que funciona
localmente mas dá mais privilégio do que ele precisa.

## Avaliando o modo sombra

Depois de uma ou duas semanas:

```powershell
npm run agent:report
```

A métrica que decide é a proporção de Issues com **dossiê acionável**. Uma Issue é
acionável quando tem falha de servidor correlacionada e ao menos um ponto de partida
no código (stack trace ou rota HTTP).

- **Abaixo de 50%** — não ligue a correção automática. O gargalo é o enriquecimento,
  e nenhum modelo compensa dossiê ruim. Ver "Lacunas conhecidas" abaixo.
- **Acima de 50%** — o dossiê sustenta uma tentativa. Ligue a Fase 3 com
  `SUPPORT_AGENT_SHADOW=false` e `SUPPORT_AGENT_FIXER_ENABLED=true`.

## Lacunas conhecidas na telemetria

Levantadas ao validar o agente contra os dados reais de produção:

1. **Não há stack trace nos logs.** Nenhum documento em `logs-audit*.otel-prd` traz
   `attributes.metadata.stack`. Sem stack, o ponto de partida é só a rota HTTP, e o
   fingerprint agrupa de forma mais grosseira. Corrigir isso na instrumentação da
   aplicação é o maior ganho disponível para a qualidade do dossiê.
2. **Toda a telemetria de produção é `severity_text: info`.** Não existe log de nível
   `error` em produção — falhas são identificadas por `event.outcome: failure` e por
   `http.response.status_code`. O agente já trata os três sinais, mas um nível `error`
   real tornaria a detecção mais direta.
3. **Não existe `logs-generic.otel-prd`.** Em produção só há os data streams de
   auditoria. Logs de aplicação fora do fluxo de audit não chegam ao Elasticsearch.

## Por que 4xx não é bug

Um 401 em `/api/auth/me` é o comportamento correto de um endpoint que verifica sessão,
e a auditoria o registra como `event.outcome: failure`. Tratar isso como bug faria o
agente abrir Issue para o funcionamento normal do login.

O agente separa os dois conceitos: `isFailure` reflete o que a aplicação declarou, e
`isServerFailure` (5xx, `error`/`fatal`, ou `outcome: failure` sem status 4xx) é o que
define rotas suspeitas e elegibilidade para correção. Erros 4xx entram no dossiê apenas
como contexto.

## Segurança

Três camadas, e nenhuma delas depende de o modelo se comportar bem:

1. **Hook `beforeShellExecution`** — `.cursor/hooks/block-prod-without-approval.mjs`
   escala `ask` para `deny` quando `QUIVER_AGENT_HEADLESS=1`. Em headless não há humano
   para responder ao "ask", e `agent --force` permite tudo que não seja explicitamente
   negado. O hook também bloqueia push em `main`, escrita em `.env`, migrations e
   alteração dos próprios guardrails.
2. **`.cursor/cli.json`** — `permissions.deny` para comandos `prod:*`, `taskkill`,
   escrita em `deploy/prod-artifacts/**`, `**/.env*` e `.cursor/hooks/**`. `deny` tem
   precedência sobre `allow` e é respeitado pelo `--force`.
3. **Policy de caminhos** — `src/policy.ts` define allowlist e denylist. O fixer
   inspeciona o diff do worktree antes de commitar e aborta se qualquer arquivo violar
   a policy, mesmo que as camadas anteriores tenham deixado passar.

O agente nunca roda no repositório de trabalho. Cada Issue ganha um `git worktree` em
`C:\quiver-agent-work\issue-N` criado a partir de `origin/main`, e `createWorktree`
recusa qualquer caminho dentro do repositório principal.

## Circuit breakers

O Cursor CLI não tem `--max-turns`, então os limites vivem no orquestrador:

- 2 tentativas por fingerprint
- 3 PRs automáticos por dia
- 6 execuções do CLI por dia, ou menos se `MAX_COST_USD_PER_DAY / EST_COST_USD_PER_RUN`
  der um número menor — vale a restrição mais apertada, e `agent:report` mostra qual
- timeout de 20 minutos por execução
- label `nao-corrigir` numa Issue impede o fixer de tentar

**O `stream-json` do Cursor CLI não reporta custo**, só `duration_ms`. Não há evento
`usage` para ler, então não existe como abortar uma execução no meio por preço. O
controle de gasto é indireto: limitar execuções limita o gasto. O teto absoluto precisa
ser um spend limit na conta do Cursor ou na service account key.

## Kill switch

Dois mecanismos, para dois momentos diferentes:

| Mecanismo | Efeito | Quando usar |
|---|---|---|
| `SUPPORT_AGENT_FIXER_ENABLED=false` | decide como o agente sobe | configuração padrão |
| `npm run agent:fixer:off -- "motivo"` | desliga o fixer de um agente **já rodando** | emergência |

O arquivo `deploy/runtime/support-agent-fixer.disabled` é consultado a cada ciclo e antes
de cada correção — inclusive no meio de uma fila de Issues. A triagem nunca para: alertas
continuam virando Issue, só a correção automática é suspensa. `npm run agent:status`
mostra o estado e o motivo registrado.

## Métricas e dashboard

O agente exporta contadores via OTLP/HTTP JSON direto para o collector (`:4318`), sem
carregar o SDK do OpenTelemetry — são poucos contadores num processo simples. Configure
`SUPPORT_AGENT_OTLP_ENDPOINT` (ou `OTEL_EXPORTER_OTLP_ENDPOINT`); sem isso a exportação
é no-op e o agente segue funcionando.

As métricas caem em `metrics-generic.otel-prd*` como `metrics.support_agent.*`. O
dashboard **Quiver Tap Agente de Suporte** é importado por `npm run obs:configure` a
partir de `deploy/observability/quiver-tap-dashboard-agente.ndjson` e tem quatro painéis:

- **Funil de triagem** — alertas vistos, Issues abertas, quanto foi infra, quanto ficou
  sem evidência. Se "sem evidência" domina, o problema é o enriquecimento.
- **Correção automática** — tentativas, PRs abertos, aprovados e rejeitados. Se
  rejeitados dominam, o agente está gerando ruído em vez de ajudar.
- **Barreiras acionadas** — verificação reprovada, policy de caminhos, circuit breaker,
  fixer desligado. Estas são as travas que impediram um PR ruim de existir.
- **Consumo e reincidência** — execuções do CLI (o proxy de custo) e alertas
  reincidentes.

Aprovados e rejeitados só aparecem depois de `npm run agent:review`, que é quem lê o
desfecho no GitHub. Cada PR é contabilizado uma única vez (`reviewedPrs` no estado).

O namespace é enviado explicitamente como `prd`. O `transform/namespace` do collector só
preenche o campo quando ele vem vazio e espera `production`, não `prd` — sem o atributo
explícito as métricas do agente cairiam em `metrics-generic.otel-dev` e o dashboard
ficaria vazio. Para conferir o caminho ponta a ponta sem rodar o agente, poste
`deploy/observability/otlp-support-agent-smoke.json` em `:4318/v1/metrics` (troque o
`"0"` do `timeUnixNano` pelo epoch atual em nanossegundos) e consulte com
`deploy/observability/es-query-agente-metrics.json`.

## Revisão semanal

```powershell
npm run agent:review        # últimos 7 dias
npm run agent:review -- 14  # últimos 14 dias
```

Gera `deploy/reports/support-agent/revisao-<data>.md` com os números da semana e, para
cada PR rejeitado, os comentários da revisão e um campo **Lacuna identificada** em
branco. Preencha em uma linha e escolha onde corrigir:

- `.cursor/skills/quiver-tap-bugfix/SKILL.md` — o agente não sabia a regra
- `support-agent/src/enrich.ts` — o dossiê não tinha a informação
- nenhum dos dois — problema de arquitetura, não delegável

Esses relatórios são versionados de propósito: é o registro de por que o agente errou, e
é o que faz a skill melhorar ao longo do tempo. Rejeição sem diagnóstico anotado não
ensina nada, e a correção seguinte repete o erro.

## O que o agente não faz

Ele corrige sintomas bem descritos. Problemas de arquitetura, de concorrência e
decisões de produto continuam sendo seus. Quando não identifica a causa raiz, ele
declara "NAO CONSEGUI DIAGNOSTICAR", comenta o diagnóstico na Issue e não abre PR —
um PR errado custa mais caro para o revisor do que nenhum PR.
