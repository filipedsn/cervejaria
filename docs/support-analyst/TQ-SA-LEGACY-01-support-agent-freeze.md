# TQ-SA-LEGACY-01 — Freeze e plano de aposentadoria do Support Agent legado

Data: 2026-08-31

Escopo: auditoria, governança e plano de transição. Nenhum código funcional, credencial, processo, Elasticsearch, banco, aplicação, Ops Panel, Alert Poller, CI ou ambiente PROD foi alterado ou consultado.

## 1. Resumo executivo

O `support-agent/` é um mecanismo legado de triagem orientado a abrir Issues e, quando explicitamente liberado, executar correção automática. Ele não é uma base segura para o novo `support-analyst/`: combina leitura de Elasticsearch com basic auth de fallback, escrita em alertas, GitHub, subprocessos, worktree, Git, Cursor CLI e PR.

Decisão: **SUPPORT AGENT = FROZEN / LEGACY IN TRANSITION**. Não adicionar features, Ollama/Gemma, novas automações ou expansão do fixer. Futuras mudanças só podem ser correções críticas, de segurança ou estritamente necessárias para manter uma função ainda usada durante a transição.

O Support Analyst será um processo local separado, shadow e não-remediador. Não importará módulos do Agent; quando um conceito for útil, será reimplementado ou extraído em ticket posterior como função pura testada.

## 2. Estado atual observado

Consulta local de status em 2026-08-31:

| Item | Estado | Evidência |
|---|---|---|
| Processo | **Parado** | `npm run agent:status`; PID file existe, mas não aponta para processo vivo. |
| `SUPPORT_AGENT_SHADOW` | `false` | `support-agent/.env` efetivo. |
| `SUPPORT_AGENT_DRY_RUN` | `false` | `support-agent/.env` efetivo. |
| `SUPPORT_AGENT_FIXER_ENABLED` | `false` | `support-agent/.env` efetivo. |
| Kill switch | Inativo | `deploy/runtime/support-agent-fixer.disabled` ausente. |
| GitHub CLI | Autenticado localmente | `gh auth status` retornou sucesso; nenhum comando mutador foi chamado. |
| Cursor credential | Não configurada nos arquivos locais auditados | `CURSOR_API_KEY` não apareceu na listagem de nomes de variáveis. |
| Elastic Agent key própria | Não configurada nos arquivos locais auditados | `SUPPORT_AGENT_ES_API_KEY` e `ELASTIC_API_KEY_SUPPORT_AGENT` não apareceram na listagem. |
| Auth Elastic efetiva se iniciado pelos scripts atuais | Basic auth compartilhada | `config.ts` carrega `ELASTIC_USER`/`ELASTIC_PASSWORD` de `deploy/observability/.env.observability` como fallback. |

Assim, o processo não está atuando neste momento, mas sua configuração atual **não é shadow estrito**: se iniciado sem mudar as flags, pode criar labels/Issues/comentários no GitHub e marcar alertas no Elasticsearch. O fixer automático continua desabilitado pela configuração; o código para habilitá-lo permanece presente.

## 3. Decisão de freeze

1. O Support Agent não recebe novas capacidades.
2. Não adicionar Ollama, Gemma, RAG, correlação nova, fontes novas, Telegram, GitHub adicional ou automação de remediação ao Agent.
3. Não usar `support-agent/` como package, processo ou dependência do Analyst.
4. Preservar o código e os controles enquanto ainda houver dependência operacional/documental durante a transição.
5. Toda exceção ao freeze exige justificar a função transitória afetada, o risco e a data de remoção esperada.

## 4. Arquitetura atual e fronteiras futuras

```text
Kibana rules -> quiver-tap-alert-events -> Alert Poller -> e-mail / Telegram
                                      \-> Support Agent legado -> GitHub Issue
                                                                    \-> fixer opcional
                                                                         -> Cursor/worktree/Git/PR

Observability -> Support Analyst separado -> incidente -> dossiê local -> humano
                                                         \-> adapters futuros com gate
                                                              -> GitHub / Telegram
                                                              -> Remediation Executor separado
```

O Alert Poller não importa nem chama o Support Agent. Sua aposentadoria futura não deve afetar regras, notificações, índice de alertas ou observabilidade; o risco está em preservar a configuração e os consumidores do Alert Poller enquanto se remove a integração visual/operacional do Agent.

## 5. Inventário completo

Foram auditados 45 artefatos/componentes lógicos: 30 módulos em `support-agent/src/` (incluindo cinco testes), três scripts de ciclo de vida, dois manifests de scripts npm, o job `support-agent-test` de CI, dois módulos/rotas do Ops Panel, os três módulos do Alert Poller e quatro documentos/artefatos de observabilidade associados.

| Área | Arquivos/componentes | Papel atual |
|---|---|---|
| Entrada e configuração | `index.ts`, `config.ts`, `types.ts` | Loop, flags, credenciais e tipos do legado. |
| Coleta e evidência | `watcher.ts`, `es.ts`, `enrich.ts`, `probe.ts`, `probe-fields.ts`, `preview.ts` | Poll de alertas, busca/escrita ES, parsing e diagnóstico. |
| Triagem e estado | `triage.ts`, `state.ts`, `logger.ts`, `metrics.ts` | Classificação código/infra, fingerprint, JSON local, logs e OTLP. |
| GitHub | `github.ts`, `report.ts`, `review.ts` | Labels, Issues, comentários, PRs e relatórios. |
| Remediação | `fixer.ts`, `fixer-cli.ts`, `policy.ts`, `worktree.ts`, `worktree-check.ts`, `shell.ts`, `circuit-breaker.ts`, `killswitch.ts`, `killswitch-cli.ts` | Cursor, subprocessos, worktree, teste, commit, push, PR e gates. |
| Testes | `*.test.ts` de triage, policy, circuit breaker, fixer e kill switch | Cobertura unitária do comportamento legado. |
| Ciclo de vida | `scripts/support-agent/{start,status,stop}.ps1`, scripts `agent:*` | Iniciar, parar, status e comandos manuais. |
| Integrações | Ops Panel, Alert Poller backend, CI, dashboard OTLP, README/docs | Controle local, alertas/notificações, validação e documentação. |

## 6. Matriz de side effects

Legenda: `R` lê; `W` escreve localmente; `ES-W` escreve Elasticsearch; `S` executa processo; `G` Git/commit/push; `GH` GitHub; `N` notificação; `Rem` remediação.

| Componente | R | W | ES-W | S | G | GH | N | Rem | Risco | Destino |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| `index.ts` | ES/config | estado/log | sim | indireto | indireto | sim | não | gate | Alto | RETIRE |
| `config.ts` | arquivos/env | não | não | não | não | não | não | não | Alto: basic auth fallback | BLOCK_FROM_ANALYST |
| `watcher.ts` | ES | não | não | não | não | não | não | não | Médio | REIMPLEMENT |
| `es.ts` | ES/health | não | sim | HTTP | não | não | não | não | Alto | BLOCK_FROM_ANALYST |
| `enrich.ts` | ES/logs | não | não | HTTP | não | não | não | não | Médio: query ampla/stack | REIMPLEMENT |
| `triage.ts` | evidência | não | não | não | não | não | não | não | Médio: semântica de bug | REIMPLEMENT |
| `state.ts` / `logger.ts` | arquivos | sim | não | não | não | não | não | não | Baixo | REIMPLEMENT |
| `metrics.ts` | config | buffer/HTTP | não | HTTP | não | não | não | não | Médio: recursão/destino PRD | REIMPLEMENT |
| `github.ts` | GitHub | não | não | `gh` | não | sim | não | não | Alto | KEEP_TEMPORARILY |
| `preview.ts` / `probe*.ts` | ES | console | não | HTTP | não | não | não | não | Médio: expõe documentos | KEEP_TEMPORARILY |
| `report.ts` / `review.ts` | GitHub/estado | relatórios/estado | não | `gh` | não | sim | não | não | Médio | KEEP_TEMPORARILY |
| `fixer.ts` / CLI | Issue/worktree | estado/log | não | Cursor/npm | sim | sim | não | sim | Crítico | BLOCK_FROM_ANALYST |
| `policy.ts` | paths | não | não | não | não | não | não | gate | Alto: política de remediação | BLOCK_FROM_ANALYST |
| `worktree.ts` | Git/files | cria/remove | não | git/npm/npx | sim | não | não | sim | Crítico | BLOCK_FROM_ANALYST |
| `shell.ts` | processo | não | não | sim | potencial | potencial | não | potencial | Crítico | BLOCK_FROM_ANALYST |
| circuit breaker / kill switch | arquivo/estado | sim | não | não | não | não | não | gate | Alto: só para fixer | BLOCK_FROM_ANALYST |
| Scripts `start/status/stop` | env/PID | PID/log | não | inicia/para | não | não | não | não | Médio | KEEP_TEMPORARILY |
| Ops Panel Support Agent | env/PID/ES/GH | env/kill switch | não | inicia/para | não | indireto | não | controla gate | Alto | KEEP_TEMPORARILY |
| Alert Poller backend | ES/config | estado | sim | HTTP | não | não | e-mail/Telegram | não | Alto, mas independente | KEEP_TEMPORARILY |
| CI + dashboard legado | código/metrics | artefatos CI | não | CI | não | não | não | não | Baixo | KEEP_TEMPORARILY |

Nenhum componente do Support Agent toca banco ou aplicação diretamente. O fixer pode modificar código apenas no worktree, mas essa capacidade já basta para excluí-lo integralmente do Analyst.

## 7. Shadow versus dry-run

| `shadow` | `dryRun` | fixer/kill switch | Comportamento efetivo |
|---:|---:|---|---|
| `true` | `false` | qualquer | Lê ES, cria labels/Issues/comentários quando aplicável, faz `markTriaged`; **não** chama fixer. |
| `false` | `true` | qualquer | Lê ES e atualiza estado/log local; não chama GitHub nem `markTriaged`, não chega ao fixer. |
| `false` | `false` | fixer desligado ou kill switch ativo | Lê ES, cria/atualiza GitHub e marca alerta no ES; fixer não roda. |
| `false` | `false` | fixer ligado e kill switch inativo | Fluxo anterior mais Cursor, worktree, testes, commit, push e PR. |

`SUPPORT_AGENT_SHADOW=true` bloqueia somente `maybeFix` via `fixerGate`. Não bloqueia GitHub nem `markTriaged`. `SUPPORT_AGENT_DRY_RUN=true` é o controle que suprime essas escritas externas, mas ainda permite estado, logs e métricas locais. Portanto, nenhum desses modos satisfaz por si só o shadow estrito requerido pelo Analyst.

## 8. Credenciais

Somente nomes/escopos foram inventariados; valores não foram lidos nem exibidos.

| Credencial/configuração | Uso legado | Estado/localidade | Plano futuro |
|---|---|---|---|
| `SUPPORT_AGENT_ES_API_KEY` / `ELASTIC_API_KEY_SUPPORT_AGENT` | Leitura ampla e marcação de alertas | Ausente dos arquivos locais auditados | Revogar se existir após retirar Agent. |
| `ELASTIC_USER` / `ELASTIC_PASSWORD` | Fallback basic auth do Agent | Presentes no env observability compartilhado | Remover a dependência do Agent; não reutilizar. |
| `SUPPORT_AGENT_GITHUB_TOKEN` ou login `gh` | Labels, Issue, comentário, PR | `gh` local autenticado; token dedicado não configurado nos arquivos | Revogar token dedicado, se criado; separar futuro adapter. |
| `CURSOR_API_KEY` / `SUPPORT_AGENT_CURSOR_BIN` | Fixer headless | Key não configurada nos arquivos; binário configurável | Revogar key de serviço quando Remediation Executor não for aprovado. |
| `SUPPORT_AGENT_OTLP_ENDPOINT` | Métricas do Agent | Configurado localmente | Retirar dashboard/métricas após decisão LEGACY-02. |
| E-mail/Telegram | Não pertencem ao Agent | Pertencem ao Alert Poller/backend | Preservar; não revogar por aposentadoria do Agent. |

O Analyst usa somente `SUPPORT_ANALYST_ES_API_KEY` e `SUPPORT_ANALYST_ES_URL`; não aceita nenhuma das credenciais acima como fallback.

## 9. Componentes reutilizáveis

Não há **REUSE DIRECTLY** de módulo do Agent. Funções puras podem servir como referência, mas primeiro devem ser reimplementadas contra `NormalizedEvent` e fixtures sanitizados. Os testes de rota/fingerprint/policy podem inspirar casos de teste; não autorizam importação de módulos de produção.

## 10. Componentes que devem ser reimplementados

| Conceito legado | Decisão | Motivo |
|---|---|---|
| Parser OTLP defensivo e timestamp | REIMPLEMENT | Contrato atual não extrai correlation/request/release/DB/realtime. |
| Normalização de rota e fingerprint | REIMPLEMENT | Semântica atual é “bug de código”, não incidente operacional. |
| Poll limitado/cursor/dedup JSON | REIMPLEMENT | Estado carrega Issues/PRs e não é o modelo de incidente. |
| Markdown e links Kibana | REIMPLEMENT | Dossiê atual inclui stack/log livre e corpo de Issue. |
| Métricas/buffer local | REIMPLEMENT | Destino do Analyst deve evitar recursão. |
| `types.ts` | REIMPLEMENT | Substituir por `NormalizedEvent` e entidades de incidente/dossiê. |
| Testes de funções puras | REUSE como referência | Casos de rota/fingerprint/policy informam fixtures; não importar produção. |

## 11. Componentes proibidos no Analyst

`github.ts`, `fixer.ts`, `fixer-cli.ts`, `worktree.ts`, `shell.ts`, `policy.ts`, `killswitch.ts`, `killswitch-cli.ts`, `circuit-breaker.ts`, `markTriaged`, `esReachable` com `/_cluster/health`, `config.ts` e qualquer credential fallback/basic auth são **BLOCK_FROM_ANALYST**.

Também são proibidos imports de scripts de ciclo de vida, Ops Panel mutador, Cursor CLI, Git, `gh`, arquivos runtime do Agent, dashboards/métricas do Agent e toda integração de e-mail/Telegram.

## 12. Alert Poller

O Alert Poller (`backend/src/lib/kibana-alert-poller.ts`, worker e state próprio) é independente do Support Agent: possui cursor próprio, pode marcar `processed` best-effort e entrega e-mail/Telegram conforme suas configurações. O Agent usa marcador separado `supportAgentTriaged`; não há importação ou chamada entre os dois.

Na transição, manter Alert Poller e suas regras/notificações como operação existente. O Analyst apenas lê fontes autorizadas e nunca disputa o flag `processed`, o cursor ou os canais de notificação.

## 13. Ops Panel

O Ops Panel possui dependência funcional de transição: mostra saúde/PID/log, lê e grava `support-agent/.env`, inicia/para o processo e controla shadow, dry-run, fixer, kill switch e métricas OTLP por `/api/support-agent`. Essa integração é **KEEP_TEMPORARILY**; o Agent não depende do Ops Panel para executar.

No MVP do Analyst não haverá controle por painel. Depois do piloto, substituir apenas por status read-only do Analyst se a necessidade for comprovada; então retirar controles mutadores e cartões do Agent.

## 14. GitHub

O GitHub legado busca Issues por fingerprint, garante labels, cria Issue/comentário e cria PR via `gh`. Markdown/links são referência, não contrato reutilizável. A arquitetura futura é:

```text
Support Analyst -> dossiê local -> gate humano explícito -> GitHub Adapter futuro
```

Nunca `LLM -> GitHub` diretamente. O Adapter não é implementado no MVP.

## 15. Remediação/fixer

Fixer, policy, worktree, shell, Cursor, validação, commit, push, PR, circuit breaker e kill switch ficam bloqueados do Analyst. Caso a remediação volte a ser considerada, ela deve nascer como **Remediation Executor** separado, com identidade/permissões próprias, aprovação humana, policy, auditoria e gates explícitos.

## 16. Dependências externas

O legado depende de Elasticsearch/Kibana, GitHub CLI, Git, Node/npm/npx, Cursor CLI, collector OTLP e arquivos locais de runtime. O Alert Poller também depende de Elasticsearch e dos canais e-mail/Telegram, mas não depende do Agent. O Analyst não herda nenhuma dessas dependências exceto Elasticsearch read-only autorizado, armazenamento local e, em ticket futuro, Ollama loopback opcional.

## 17. Plano de transição

1. Aplicar o freeze e não acoplar TQ-SA-03 ao Agent.
2. Implementar/reproduzir funções puras do Analyst somente com fixtures DEV sanitizadas.
3. Completar TQ-SA-04 a TQ-SA-08 sem canais externos ou remediação.
4. Executar TQ-SA-09 em shadow com dossiê local e avaliação humana.
5. Inventariar o uso real de Issue/fixer/Ops Panel/credenciais no período do piloto.
6. Abrir TQ-SA-LEGACY-02 após o piloto para decidir `RETIRE NOW`, `RETIRE PARTIAL` ou `KEEP TEMPORARILY`.
7. Somente após decisão aprovada, desabilitar/remover artefatos em mudanças reversíveis, com rollback documentado.

## 18. Critérios objetivos de aposentadoria

Não aposentar o Agent até que todos sejam verdadeiros:

- TQ-SA-03 a TQ-SA-08 produzam replay reproduzível, sem Agent;
- TQ-SA-09 conclua piloto shadow com feedback humano e baseline de qualidade;
- Alert Poller, regras, e-mail/Telegram e seu estado estejam comprovadamente independentes;
- não exista função operacional usada de GitHub/fixer sem substituto ou decisão explícita de não substituí-la;
- Ops Panel não precise mais iniciar/parar/controlar o Agent, ou a funcionalidade tenha sido retirada com aprovação;
- credenciais do Agent tenham owner, inventário, plano de revogação e janela de rollback;
- dashboard/métricas/CI/documentação legados tenham plano de remoção;
- a decisão LEGACY-02, teste de rollback e responsável humano estejam registrados.

## 19. TQ-SA-LEGACY-02 — Retirement Decision

Executar somente após `TQ-SA-09 — Shadow Pilot`. Entradas obrigatórias: resultados do piloto, feedback, uso real de GitHub/fixer/Ops Panel, inventário de credenciais, independência do Alert Poller e plano de rollback. Saída: exatamente uma decisão `RETIRE NOW`, `RETIRE PARTIAL` ou `KEEP TEMPORARILY`; este ticket não toma essa decisão.

## 20. Riscos

Principais riscos: reativação acidental com `dryRun=false`; fallback basic auth compartilhado; confundir shadow legado com segurança sem escrita; remover UI/scripts antes de confirmar se alguém usa GitHub/fixer; e confundir o Alert Poller independente com o Agent.

## 21. O que não remover ainda

Não remover ainda: `support-agent/`, scripts `agent:*`, job CI, integração Ops Panel, dashboard/métricas, arquivos runtime/estado, Alert Poller, regras/connector de alerta, credenciais ou documentação. Nenhum deles é removido ou desligado neste ticket.

## 22. Classificação final

| Componente | Propósito atual | Side effects | Em uso/necessário hoje | Analyst precisa? | Decisão | Ação futura |
|---|---|---|---|---|---|---|
| Orquestrador `index.ts` | Triagem + saída externa | ES/GitHub/estado | Parado; fluxo legado | Não | RETIRE | Remover após LEGACY-02. |
| Config/ES | Credenciais e busca/marcação | basic auth, `/_cluster/health`, update | Configurado para fallback compartilhado | Não | BLOCK_FROM_ANALYST | Não importar; Analyst usa key exclusiva. |
| Watcher | Poll limitado de alertas | leitura ES | Referência | Sim, como conceito | REIMPLEMENT | Source read-only DEV. |
| Enrich/parser | Evidência por janela | leitura ES/texto livre | Referência | Sim, com contrato novo | REIMPLEMENT | Normalizer R-02. |
| Triage/fingerprint | Decide bug de código | nenhum direto | Referência | Sim, com semântica distinta | REIMPLEMENT | Incidente/classe/severidade. |
| State/logger | Cursor/dedup/log local | arquivo | Possível transição | Sim | REIMPLEMENT | Store Analyst isolado. |
| Dossiê/links | Corpo Markdown para Issue | texto livre | Legado | Sim, com privacy guard | REIMPLEMENT | Dossiê local Facts/Evidence/Hypotheses. |
| Metrics | OTLP do Agent | HTTP OTLP | Dashboard legado | Sim, destino separado | REIMPLEMENT | Métricas Analyst sem recursão. |
| GitHub | Issue/PR/commentário | `gh`, escrita externa | Pode ser usado pelo legado | Não no MVP | KEEP_TEMPORARILY | Futuro adapter gated ou retire. |
| Preview/probe/report/review | Diagnóstico legado | ES/GitHub/arquivos | Manual | Não | KEEP_TEMPORARILY | Preservar até decisão. |
| Fixer/Cursor | Correção automática | shell, arquivos, testes | Desabilitado | Não | BLOCK_FROM_ANALYST | Só Remediation Executor futuro. |
| Policy/worktree/shell | Guardrails e Git | subprocessos/Git | Só fixer | Não | BLOCK_FROM_ANALYST | Não carregar. |
| Circuit breaker/kill switch | Gate do fixer | estado/arquivo | Kill switch inativo | Não | BLOCK_FROM_ANALYST | Substituir apenas se houver Executor. |
| Scripts de ciclo de vida | Operar Agent | processos/PID | Disponíveis | Não | KEEP_TEMPORARILY | Retirar junto do processo. |
| Ops Panel Agent | Status e controles mutadores | env/PID/kill switch | Integração ativa | Não no MVP | KEEP_TEMPORARILY | Status Analyst read-only futuro. |
| CI Agent | Teste legado | CI | Ativo no workflow | Não | KEEP_TEMPORARILY | Retirar após remoção de código. |
| Alert Poller | Alertas/notificações | ES write/e-mail/Telegram | Independente | Não | KEEP_TEMPORARILY | Preservar fora da aposentadoria. |

Contagem da classificação final: **REUSE 0; REIMPLEMENT 6; KEEP_TEMPORARILY 6; RETIRE 1; BLOCK_FROM_ANALYST 4**. “REUSE” direto é zero por decisão de fronteira; referências de testes e conceitos não contam como importação.

## 23. Validação desta tarefa

- somente documentação foi alterada;
- status local do Agent e autenticação local do `gh` foram consultados sem escrita;
- nenhuma operação Elasticsearch, GitHub, Cursor, Git, banco, aplicação, deploy ou PROD foi executada;
- antes do commit: validar Markdown por inspeção, `git diff --check` e ausência de segredo no diff.
