# TAP-82 — cancelamento de item entregue

Data de validação: 2026-10-19. Branch de trabalho: `fix/tap82-attendant-delivered-cancel`.

## Relato original P7 e limites da reprodução

O arquivo `../Brigde/docs/thiago-pedidos-scrum-master.md`, seção P7, relata em 08/10: “Lançou o suco errado, depois não conseguiu excluir pois falava que já tinha sido entregue.” Um relato relacionado diz que um cliente não recebeu um churrasquinho marcado como entregue e precisava removê-lo da conta. O áudio pede que somente Thiago, Cate e Daniel possam cancelar esses casos; os critérios originais sugerem proprietário/gerente autorizado, atendente comum bloqueado e motivo opcional.

O relato não identifica o login/perfil usado por Thiago, a comanda, se estava aberta/paga/fechada, a quantidade, o aparelho, o tratamento de estoque ou o estado de configuração das permissões. “Já tinha sido entregue” descreve o estado observado do item/pedido, não comprova o estado da comanda. Portanto, o cenário real do cliente não pôde ser reproduzido literalmente. A suíte abaixo usa um tenant, usuário, produto “Suco errado QA”, estoque e comanda sintéticos no PDV canônico; ela valida o contrato atual do TAP-82, sem afirmar que reproduz a conta/configuração de Thiago.

## Diagnóstico da divergência RBAC-X02

No commit-base `c8e636abd0ca367355e49b30ba8c1bcf4039ed53`, `usuarioPode()` consultava a permissão especial persistida, mas tinha um retorno explícito `false` para `command.item.cancel.delivered` em qualquer funcionário que não fosse `DONO`. O serviço exigia as duas permissões, e a interface também as consultava; por isso a autorização persistida não chegava ao serviço para um atendente. O fixture RBAC-X02 tinha o par de permissões no estado positivo, então a negativa esperada do teste descrevia o defeito da implementação, não uma falha de configuração da fixture. O estado inicial sem a permissão especial continua sendo testado separadamente como 403.

Classificação do caso original: defeito de código reproduzido com usuário sintético e permissões explícitas. A configuração da conta real de Thiago permanece desconhecida. A regra de negócio da ticket atual é a autorização conjunta no PDV canônico; não se restringe ao dono. O texto do relato não permite concluir que houve dificuldade de uso além do bloqueio observado.

Uma segunda falha foi reproduzida no frontend: depois do cancelamento total, uma comanda cujos itens ficaram todos cancelados desaparecia da tela, escondendo o histórico. A correção conserva essa comanda na lista quando há auditoria de cancelamento entregue.

## Matriz dos critérios

| Critério | Situação | Evidência sintética |
|---|---|---|
| Sem permissão especial: ação oculta e API 403 | Implementado e comprovado | CMD-S16 em navegador real; RBAC-X02 por API autenticada |
| Ambas as permissões: cancelamento parcial e total na interface mobile/tablet | Implementado e comprovado | CMD-S16 em viewports mobile e tablet |
| Concessão/revogação atualiza duas sessões sem login novo; chamadas após revogação recusadas | Implementado e comprovado | RBAC-X02: duas sessões autenticadas, `/auth/me` antes/depois e 403 nas duas após revogar |
| Troca de usuário/tenant não mantém acesso ou dados | Implementado e comprovado | CMD-X16 API cross-tenant 404; CMD-X20 troca de conta no mesmo navegador e conteúdo anterior ausente |
| Motivo, valores, quantidade, estoque, autoria e auditoria; repetição/concorrência sem duplicidade | Implementado e comprovado | CMD-S16 consulta linhas de auditoria e autoria; CMD-S04 reversão `ERRO_LANCAMENTO`; CMD-X17 quantidade obsoleta sem efeitos; CMD-X19 retry idempotente; CMD-X14 concorrência |
| Cozinha permanece ENTREGUE e histórico segue visível | Implementado e comprovado | CMD-S16 após cancelamento total; CMD-S11 após atualização e reconexão |
| Comanda paga/fechada e outro tenant/PDV são recusados sem efeitos | Implementado e comprovado | CMD-X09/X16 negam pagamento/fechamento e tenant estrangeiro; CMD-X18 nega quando há um segundo PDV e retorna `CANONICAL_PDV_AMBIGUOUS` sem mutação |
| Reconexão e atualização entre aparelhos não deixam informação antiga | Implementado e comprovado no browser automatizado | CMD-S11: atualização ao vivo no aparelho online e recarga do aparelho que ficou offline durante o cancelamento |

Mobile/tablet são viewports em Playwright, não aparelhos físicos. O aceite operacional visual no DEV oficial ainda é gate da entrega.

## Alterações limitadas ao defeito reproduzido

- `backend/src/lib/operacao/permissoes.ts`: remover o bloqueio canônico que limitava a permissão especial ao proprietário; manter a decisão por permissão persistida. A verificação conjunta continua no serviço.
- `frontend/src/lib/operacao.ts`: manter a comanda visível se todos os itens foram cancelados, quando existir histórico de cancelamento de item entregue.
- `e2e/release/rbac/rbac.spec.ts` e `e2e/release/cmd/cmd.spec.ts`: converter a divergência RBAC-X02 em cenário de concessão/revogação real; incluir a reprodução sintética P7 e as lacunas de interface, reconexão, tenant/PDV, quantidade e idempotência.

Não foram adicionadas regras para CAIXA/EVENTO nem estorno de venda fechada.

## Validações

Executar no ambiente QA descartável local (PostgreSQL 17 em tmpfs, API, frontend e autenticação reais):

```powershell
node --import ./scripts/node24-tsx-host.mjs --import ./backend/node_modules/tsx/dist/loader.mjs backend/scripts/run-e2e-release-disposable-qa.mjs e2e/release/rbac/rbac.spec.ts e2e/release/cmd/cmd.spec.ts --grep "RBAC-X02|CMD-S04|CMD-S11|CMD-S16|CMD-X09|CMD-X10|CMD-X14|CMD-X16|CMD-X17|CMD-X18|CMD-X19|CMD-X20"
```

No estado atual da árvore, os cenários focados passaram no conjunto: 21 execuções de teste, somando quatro viewports para CMD-S11, CMD-S16 e CMD-X20. Uma agregação inicial expôs um filtro inválido no novo assert de auditoria; o filtro foi corrigido e CMD-S16, CMD-X14 e CMD-X17 passaram em nova execução (desktop, mobile e tablet). O container PostgreSQL foi removido após cada execução. Os relatórios E2E do runner ficam em `artifacts/release-e2e/<SHA-base>/evidence/`; o diretório é indexado ao HEAD-base usado pelo harness, então não representa sozinho um recibo imutável do commit final.

`npm.cmd run ci` passou fora do sandbox: frontend, validação Prisma (fallback de client já gerado para o schema atual, pois o DLL estava bloqueado por outro processo), 256 testes backend aprovados e 2 skipped, typecheck/build backend, 45 testes ops-panel, 82 testes support-analyst, dossier replay, build support-analyst e 12 testes do release gate. O `realtime-security-qa` também passou no GitHub Actions.

O commit `ea469f8567c21d2fdf42013b9ce55603bac861f2` foi enviado a `origin/fix/tap82-attendant-delivered-cancel` e abriu o PR [#73](https://github.com/filipedsn/cervejaria/pull/73), pronto para revisão. Os sete checks do PR passaram: `frontend`, `backend-validate`, `backend-test`, `backend-build`, `ops-panel-test`, `support-analyst-test` e `realtime-security-qa`.

O DEV oficial está em `ea469f8567c21d2fdf42013b9ce55603bac861f2`; API health e ready passaram, frontend retornou HTTP 200 e o manifesto confirma o mesmo SHA. O runner foi iniciado a partir do artefato anterior `c8e636ab`; a troca reportou o mesmo PID do listener de produção antes/depois. Nenhuma conta ou comanda real foi alterada no DEV.

## Estado de entrega

- TAP-82 permanece **In Progress** até os gates de CI, DEV e PR/merge do projeto.
- `PROD_DEPLOY_REQUIRED: YES` após a correção; nenhum deploy em produção foi autorizado ou executado.
- O relato original não permite confirmar qual permissão faltava na conta real do cliente.
