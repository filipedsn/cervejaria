---
name: quiver-tap-scrum-master
description: Scrum Master do Tap Quiver — vincula todo trabalho a um work item do Plane (projeto TAP), mantém o WI atualizado do início ao Done e mantém o Git sincronizado (branch, commit, push, PR). Use no início e no fim de qualquer tarefa, quando o usuário citar um ticket TAP-N, pedir status do backlog, sprint, prioridades, ou perguntar o que está em andamento.
---

# Quiver Tap — Scrum Master

Todo trabalho tem dono no Plane e rastro no Git. Esta skill define o ciclo que o agente
segue em toda tarefa. As regras de governança vêm do [AGENTS.md](../../../AGENTS.md) e
valem acima desta skill.

## Contexto fixo

| | |
|---|---|
| Plane | `http://localhost:8090`, workspace `quiver`, MCP `plane` |
| Projeto | **Tap Quiver** — `TAP`, id `36c2326b-07fc-44e6-9f16-4176c7f5fae0` |
| Fora de escopo | Projeto `QCAP` (Quiver Capacity) — não ler nem alterar |
| Ferramentas autorizadas | `workspace`, `project`, `workitem`, `workitem_comment`, `state`, `label` |

Estados do TAP (confirme com `state list` se algo parecer diferente):

| Estado | Grupo | id |
|---|---|---|
| Backlog | backlog | `78f65696-dd51-48f5-a806-4ee5044bd532` |
| Todo | unstarted | `a01a5610-d47c-4af0-83a3-ec4bbca4a6df` |
| Ready | unstarted | `827c58c2-ad7b-4a07-bd14-c6494ba66a8c` |
| In Progress | started | `5380522e-62ed-4820-89ad-225bc2177f77` |
| Done | completed | `509d4294-77b5-45dd-9af8-704e7cde1e0e` |
| Cancelled | cancelled | `aa2f31f9-057e-4718-bd46-5d202473c0dd` |

Labels: `Bug`, `Feature`, `Tech Debt`, `Security`, `DevSecOps`, `Observability`,
`Architecture`, `Performance`, `UX`, `Product`, `Quality`, `Ops`, `Support Analyst`,
`Platform`, `Product Decision`, `Blocked`. Use `label list` para obter os ids.

Limitações do Plane self-hosted:

- `workitem count` responde 404. Para contar, use `workitem list` com
  `fields=sequence_id,name,priority,state` e `expand=state`, e agregue localmente.
- `workitem search` busca pelo título; use palavras curtas e tente sinônimos.
- `workitem retrieve_by_identifier` aceita `TAP-93` e é o jeito mais rápido de ler um ticket.

## Ciclo de toda tarefa

### 1. Localizar o work item antes de trabalhar

1. Se o usuário citou `TAP-N`, leia com `retrieve_by_identifier` (`expand=state,labels`).
2. Se não citou, rode `workitem search` com duas ou três palavras-chave do assunto e
   compare também com os itens abertos (In Progress, Ready, Todo, Backlog) via `list`.
3. Se houver mais de um candidato plausível, pergunte ao usuário qual usar.
4. Registre na conversa: identificador, título, estado, prioridade e labels.

Item em `Done` ou `Cancelled` que parece cobrir o assunto não é reaberto
automaticamente: informe o usuário e pergunte se o trabalho é continuação dele.

### 2. Sem work item: sugerir, não criar

O agente não cria tickets por conta própria. Apresente um **Suggested Plane Item** e peça
autorização:

```text
Suggested Plane Item
Título: [PREFIXO] descrição curta no imperativo
Problema: o que está errado ou faltando
Impacto: quem é afetado e quanto
Evidência: arquivo, log, print, reprodução
Prioridade sugerida: urgent | high | medium | low
Labels sugeridas: ...
```

Com autorização explícita, crie no projeto TAP, estado `Backlog` (ou `In Progress` se o
trabalho começa agora), com as labels combinadas. Antes de sugerir, aplique o
Functional Value Gate: o item precisa reduzir risco real, melhorar a operação ou
habilitar valor de produto.

### 3. Início do trabalho

- Mova para **In Progress** quando o trabalho real começar (não ao apenas ler o ticket).
- Não mexa em responsável, ciclo, módulo, prioridade ou em outros tickets.

### 4. Git sincronizado

Fluxo obrigatório da skill [quiver-tap-git-workflow](../quiver-tap-git-workflow/SKILL.md):

- Branch a partir de `origin/main`: `feat/tap-<n>-slug`, `fix/tap-<n>-slug` ou
  `chore/tap-<n>-slug`.
- Se a pasta de trabalho tiver mudanças de outra frente, não misture: use
  `git worktree add ..\cervejaria-tap-<n> -b <branch> origin/main`.
- Commits em Conventional Commits, com o ticket no rodapé:

  ```text
  fix(caixa): manter turno aberto após a virada do dia

  Refs: TAP-93
  ```

- `git push` a cada unidade coerente de trabalho, não só no fim.
- PR para `main` com `TAP-N` no título ou na descrição; merge só com `npm run ci` local verde.
- Nunca push direto em `main`. Deploy em produção só com autorização explícita
  (regra `quiver-tap-deploy`).
- Toda alteração de código também é publicada no DEV oficial (regra
  `quiver-tap-dev-refresh`).

### 5. Durante o trabalho

Comente no WI apenas em marcos: decisão relevante, mudança de escopo, bloqueio, PR
aberto. Sem comentários triviais de progresso.

**Bloqueio real:** mantenha em In Progress e registre um único comentário com bloqueio,
evidência, impacto e próximo passo. Nunca mova para Done.

**Problema novo descoberto:** não crie item; reporte um Suggested Plane Item ao usuário.

### 6. Encerramento

Mova para **Done** somente quando todos os gates passarem (testes, CI verde, merge,
DEV publicado quando houver código). O comentário final usa este modelo (HTML):

```html
<p><strong>Objetivo / causa raiz:</strong> ...</p>
<p><strong>Solução:</strong> ...</p>
<p><strong>Testes:</strong> comandos executados e resultado</p>
<p><strong>Commit:</strong> <code>abc1234</code> — <strong>Push:</strong> ok — <strong>PR:</strong> #NN</p>
<p><strong>DEV releaseSha:</strong> <code>...</code></p>
<p><strong>PROD_DEPLOY_REQUIRED:</strong> sim | não</p>
<p><strong>Pendências:</strong> ...</p>
```

Se faltar algum gate, o item fica em In Progress e a pendência vai no comentário.

## Status do backlog (cerimônias leves)

Quando o usuário pedir status, daily ou planejamento:

1. `workitem list` do TAP com `per_page=100`, `fields=sequence_id,name,priority,state`,
   `expand=state`.
2. Resuma por estado e destaque: itens In Progress (WIP alto é sinal de alerta),
   prioridade `high`/`urgent` ainda em Backlog e itens `Blocked`.
3. Sugestões de prioridade são só sugestões: o agente não reprioriza o backlog nem
   altera roadmap, ciclos ou módulos.

## Proibido

- Alterar ticket que não foi indicado pelo usuário ou vinculado à tarefa atual.
- Criar, excluir ou reatribuir tickets sem autorização.
- Mover para Done sem todos os gates.
- Expor, versionar ou citar `PLANE_API_KEY`.
- Transformar alerta transitório de observabilidade em ticket automaticamente.
