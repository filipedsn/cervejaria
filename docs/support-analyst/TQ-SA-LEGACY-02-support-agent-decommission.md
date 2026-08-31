# TQ-SA-LEGACY-02 — Decommission do Support Agent legado

Data: 2026-08-31

## 1. Resumo

O Support Agent legado foi removido do repositório e do runtime local. O Support Analyst continua não implementado nesta tarefa; seus scripts de onboarding independentes foram preservados.

## 2. Motivo da aposentadoria antecipada

TQ-SA-LEGACY-01 confirmou que não havia uso operacional do Agent, não existe reuso direto para o Analyst e o legado concentrava escrita Elasticsearch, fallback basic auth, GitHub, shell, Cursor, worktree, Git, commit, push, PR, fixer e remediação. A decisão arquitetural aprovada permitiu o decommission antes de TQ-SA-03, sem aguardar TQ-SA-09.

## 3. Evidência de não utilização

No pré-check, `main` estava ativa e a árvore limpa. `npm run agent:status` informou processo parado; o PID não apontava para processo vivo e a busca por command line de `support-agent` não encontrou processo. Não foram encontradas referências de watchdog ou serviço dependente. O Alert Poller é independente e usa cursor/estado/marcador `processed` próprios.

## 4. Componentes removidos

- diretório `support-agent/`, incluindo fonte, testes, README, manifests, fixer, GitHub, worktree, shell, policy, circuit breaker, kill switch, watcher, estado, métricas e parser;
- `scripts/support-agent/{start,status,stop}.ps1` e todos os scripts npm `agent:*`;
- assets exclusivos de métricas/dashboard do Agent em `deploy/observability/`;
- geração/renovação da key `quiver-support-agent` e a variável `ELASTIC_API_KEY_SUPPORT_AGENT` no script de criação de keys;
- import do dashboard exclusivo no script de configuração Kibana.

## 5. Referências removidas

| Referência | Arquivo anterior | Ação | Justificativa |
|---|---|---|---|
| Package/runtime | `support-agent/`, `scripts/support-agent/`, `package.json` | Removida | Nenhum uso operacional e nenhum reuso direto. |
| CI | `.github/workflows/ci.yml` | Job `support-agent-test` removido | Package não existe mais; checks ativos permanecem. |
| Release gate | `ops-panel/src/release.mjs` e teste | Check legado removido | Gate mantém frontend, backend e Ops Panel. |
| Ops Panel | módulo, teste, rota e UI do Agent | Removidos | Controles eram exclusivos do Agent. |
| Observabilidade | dashboard/smoke/query e import | Removidos do repositório | Não apagar métricas/dados históricos no Elasticsearch. |
| Credencial legado | `create-elastic-api-keys.ps1` | Removida | Evita criar ou regravar key exclusiva aposentada. |

## 6. Alert Poller preservado

`backend/src/lib/kibana-alert-poller.ts`, `alert-poller-state.ts` e `alert-poller-worker.ts` foram preservados sem mudança. O Poller mantém seu `processed` best-effort, cursor local e canais e-mail/Telegram. Não existe importação ou chamada ao Support Agent.

## 7. Ops Panel

Foram removidos somente a seção visual, card de overview, service tile, polling, rota `/api/support-agent`, edição de `support-agent/.env`, start/stop, shadow, dry-run, fixer, kill switch e métricas exclusivas. Release, ambientes, observabilidade, backup, logs e controles não relacionados permanecem.

Também foi removida a marcação de commits/PRs `fix/auto-*` como originados pelo Agent; o histórico de release continua exibindo a origem do PR, sem semântica operacional legada.

## 8. CI

O job `support-agent-test` foi removido. Os jobs `frontend`, `backend-validate`, `backend-test`, `ops-panel-test` e demais checks ativos permanecem; o release gate não exige mais um check inexistente.

## 9. Config/env

Não restou variável `SUPPORT_AGENT_*` funcional. `ELASTIC_USER`, `ELASTIC_PASSWORD`, `ELASTICSEARCH_URL`, keys do collector/Alert Poller e `SUPPORT_ANALYST_*` foram preservados. O script de observabilidade agora descarta uma linha legada `ELASTIC_API_KEY_SUPPORT_AGENT` caso ela exista ao regenerar keys.

## 10. Runtime

Foram removidos os artefatos exclusivos `support-agent.pid`, `support-agent-state.json` e os logs `support-agent*.log`. O diretório legado continha somente `.env` ignorado e `node_modules` após a remoção dos rastreados; ambos foram removidos. Não foi tocado nenhum arquivo `deploy/runtime/support-analyst*`.

O log compartilhado `deploy/logs/ops-panel.log` foi preservado: contém histórico de release junto a entradas antigas do Agent e não é um artefato exclusivo que possa ser removido com segurança.

## 11. Credenciais

A consulta local e read-only a `/_security/api_key?name=quiver-support-agent` retornou zero keys. Logo, não havia credencial exclusiva a revogar. Login pessoal `gh`, basic auth compartilhado, key do collector, key do Alert Poller e key do Analyst não foram alterados nem revogados.

## 12. Elasticsearch

Nenhum documento, índice, regra, data stream, dashboard armazenado ou dado Elasticsearch foi deletado ou alterado. Em especial, `quiver-tap-alert-events`, `quiver-tap-alert-events-dev`, logs, metrics e o marcador histórico `supportAgentTriaged` foram preservados em dados já existentes.

## 13. Documentação

TQ-SA-01 e TQ-SA-LEGACY-01 receberam apenas nota de status de decomissionamento; o roadmap marca TQ-SA-LEGACY-02 como concluído antes de TQ-SA-03. Esta página é o registro operacional do decommission.

## 14. Validações

- pré-check de branch, árvore, processo e referências concluído;
- testes/build/typecheck aplicáveis executados após as remoções;
- Alert Poller validado por inspeção de imports/configuração e testes backend relevantes, sem disparar e-mail ou Telegram;
- varredura final classificou referências restantes como documentação histórica/decommission ou conceitos futuros claramente marcados;
- `git diff --check` e varredura de segredo executados antes do commit.

## 15. Rollback

O commit imediatamente anterior ao decommission é `65cfcc6`. Caso seja necessária reversão aprovada, usar conceitualmente `git revert <decommission-commit>` e então repetir as validações. Não foi criado archive/cópia manual: o histórico Git é o rollback.

## 16. Estado final

Não existe package, processo, script npm, job CI, controle Ops Panel, rota, key gerada, dashboard versionado ou artefato runtime do Support Agent. Alert Poller e suas notificações permanecem independentes. O Support Analyst ainda não foi criado.

## 17. Próximo passo

`TQ-SA-03` pode iniciar como tarefa independente para criar o package/processo isolado, sem importar runtime ou credenciais do Agent legado.
