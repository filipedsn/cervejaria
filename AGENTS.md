# Agent Governance

## Delivery flow

[CONTRIBUTING.md](CONTRIBUTING.md) is the mandatory delivery flow for every tool (Cursor, VS Code, terminal): production is the source of truth, `main` matches production, work starts from `main` in its own branch, `npm run ci` before the PR, merge only with CI green, and production deploy only with explicit user authorization. The deploy preflight blocks anything that is not a clean `origin/main` commit with a green `CI` run.

## Plane MCP workflow

Plane is the source of truth for work state. GitHub is the source of truth for code, commits, and CI.

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
