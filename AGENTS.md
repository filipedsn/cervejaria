# Agent Governance

## OBRIGATÓRIO — primeiro passo de TODO chat (Codex / Cursor / qualquer agente)

1. **Ler por completo** [`docs/codex-super-prompt-arquitetura-vps.md`](docs/codex-super-prompt-arquitetura-vps.md) antes de editar código, abrir PR, falar de deploy, CI, DEV/PRD, Elastic, tunnel ou VPS.  
2. Em seguida ler o checklist canônico em [`docs/handoff-vps-hostinger-arquiteto.md`](docs/handoff-vps-hostinger-arquiteto.md) (topo + §0 / §0.1 quando o assunto for infra).  
3. Só depois aplicar [`CONTRIBUTING.md`](CONTRIBUTING.md) e o restante deste arquivo.

Se houver conflito entre docs antigos (skills, README, TAP-116) e o super prompt / handoff na `main`, **prevalecem o super prompt e o handoff**.

Resumo operacional que nenhum agente pode “esquecer”:
- **PRD** = só VPS (`https://tap.quivercloud.com.br`); **DEV** = só PC (localhost).  
- Elastic DEV ≠ Elastic PRD (clusters físicos diferentes).  
- CI: Actions `build-and-unit` **obriga** merge; `npm run ci` é complementar.  
- `deploy.cmd` no PC = **legado**; não publica o Tap público.  
- Off-site backup Postgres (OneDrive) **já feito**; falta restore drill.  
- Se `gh` der 403: push da branch + link compare; não loop de auth; produção intocada.

## Delivery flow

[CONTRIBUTING.md](CONTRIBUTING.md) is the mandatory delivery flow for every tool (Cursor, VS Code, terminal), **subject to the super prompt and handoff above**.

Current rules (supersede TAP-116 “Actions off”):
- Work starts from `main` on its own branch and returns via Pull Request.
- Merge to `main` requires GitHub Actions check **`build-and-unit`** (branch protection). Local `npm run ci` remains complementary (attestation for legacy Windows tooling).
- Public production publish is the **VPS** (Docker), not `.\deploy.cmd` on the PC. Legacy Windows deploy still uses attestation preflight when that path is used.
- Production deploy (VPS or legacy) only with **explicit** user authorization.

## Plane MCP workflow

Plane is the source of truth for work state. GitHub is the source of truth for code and commits. GitHub Actions `build-and-unit` gates merge to `main`; local `npm run ci` (attestation file) remains for the complementary / legacy Windows release gate.

Use the Plane MCP with least privilege. The authorized capabilities are limited to `workspace`, `project`, `workitem`, `workitem_comment`, `state`, and `label`; do not expand tools without an explicit need.

Before changing a Plane work item, read the explicitly indicated ticket and record its identifier, title, status, priority, and labels. An agent may read that ticket, move it to **In Progress** when real work begins, add evidence comments, and move it to **Done** only after every acceptance gate passes.

An agent must not automatically alter another ticket, reprioritize the backlog, change a roadmap, delete a ticket, create additional tickets, modify cycles or modules, or reassign work items.

When a technical ticket uncovers another problem, do not create an item automatically. Report a **Suggested Plane Item** with a suggested title, problem, impact, evidence, and suggested priority. Human authorization is required to create it.

If a real blocker is found, leave the ticket **In Progress** and add one evidence-based comment with the blocker, evidence, impact, and next step. Do not mark it Done.

Move an item to **Done** only when all mandatory acceptance gates pass. The final Plane evidence comment must include, when applicable: root cause/objective, solution, tests, commit SHA, push status, `PROD_DEPLOY_REQUIRED`, and pending work. Avoid trivial progress comments.

Plane records actionable incidents and work. Elastic/Ops Panel records events and alerts. Do not automatically turn transient alerts into backlog. A relevant incident may become a work item only with real impact, recurrence, manual intervention, relevant risk, or a need for a permanent correction; automatic incident creation is not authorized.

Never hardcode, version, print, or include `PLANE_API_KEY` in a prompt. The credential must remain outside the repository.

## Functional Value Gate

A technical item does not gain priority merely by existing. It must reduce real risk, improve operations, or enable product value. Avoid engineering in anticipation.

## Infrastructure Scaling Principle

Infrastructure scales when the financial and operational risk of remaining simple exceeds the cost of evolving it. TAP Quiver is at an early commercial stage, so simple infrastructure is a deliberate economic decision. Do not introduce HA, Kubernetes, microservices, managed databases, or permanent staging without evidence of need.

Post-cutover baseline (see handoff): public Tap runs on a single Hostinger VPS behind Cloudflare; admin via Tailscale; Dev and PRD are physically segregated including Elasticsearch clusters. Do not reintroduce PC-as-production or Cloudflare Tunnel for `tap` without an explicit new decision.
