---
name: quiver-tap-deploy
description: Orchestrates Quiver Tap production deploy on Windows (backup, build, migrate, restart API :3001). Use when the user asks to deploy, publish, release to production, CI/CD, prod:deploy, or tap.quivercloud.com.br.
---

# Quiver Tap — Deploy de producao

Deploy orquestrado para o Quiver Tap (PWA Fastify + React, Windows local).

## Quando usar

Use when the user asks to deploy, publish, release, or push changes to production, CI/CD, `tap.quivercloud.com.br`, or `prod:deploy`.

## Regras absolutas

1. **Never deploy without explicit user confirmation in chat** (e.g. "sim, pode fazer deploy").
2. **Never pass `-Confirmed` to the deploy script** until the user has confirmed in this conversation.
3. **Never edit `backend/.env.production`** or run `db:migrate:prod` without confirmation.
4. Prefer **`npm run prod:deploy`** over manual step-by-step commands.
5. **Code must be merged in `main` and pulled locally** before deploy (`git checkout main` → `git pull origin main`). If user is on a feature branch, remind them to merge via PR first (skill `quiver-tap-git-workflow`).

## Pre-deploy checklist (agent)

Before running deploy, present a short summary:

1. **Git**: on `main`? Up to date with `origin/main`? Recent merge completed?
2. **Changes**: `git status` and brief `git diff --stat` (what will go to prod).
3. **Scope**: frontend only, backend only, or both? Any Prisma schema/migration changes?
4. **Dev tested?** If unclear, suggest `npm run dev:status` and testing at http://localhost:5202.
5. **Environment reminder**: dev = `:5202` / `:3002` / `cervejaria_dev`; prod = `:3001` / `cervejaria`.

Ask the user to confirm explicitly. Wait for yes.

## Deploy command

After confirmation, run from project root:

```powershell
.\deploy.cmd -Confirmed
```

`deploy.cmd` e a entrada preferida: roda via `cmd`, entao nao depende da execution policy do
PowerShell (que costuma bloquear `npm.ps1`). O equivalente por npm continua valendo:
`npm run prod:deploy -- -Confirmed`.

Optional flags (add after `-Confirmed`):

| Flag | Use when |
|------|----------|
| `-FrontendOnly` | Only UI/static assets changed |
| `-BackendOnly` | Only API changed |
| `-SkipMigrate` | No Prisma migration in this release |
| `-SkipBackup` | Emergency re-deploy (discourage unless user insists) |
| `-DryRun` | Show plan + preflight only, no changes |
| `-PreflightOnly` | Only the readiness checks (`npm run prod:preflight`) |

Examples:

```powershell
.\deploy.cmd -Confirmed -FrontendOnly
.\deploy.cmd -Confirmed -BackendOnly -SkipMigrate
.\deploy.cmd -DryRun
```

If the user runs deploy themselves in terminal (without agent), they omit `-Confirmed` and type `DEPLOY` when prompted.

## Como o deploy se protege

O deploy nao precisa mais de um PowerShell aberto como Administrador:

1. **Preflight** roda antes de qualquer acao destrutiva (~7s, nao altera nada): npm, container
   `cervejaria-db`, espaco em disco e — o mais importante — se ha permissao para encerrar a API
   e o alert poller. Se algo bloqueia, aborta ali, com producao intacta.
2. **Auto-elevacao**: o watchdog sobe a API elevada (tarefas agendadas com `RunLevel=Highest`) e
   um shell comum nao consegue encerrar processo elevado. Quando o preflight detecta isso, o
   script se relanca elevado — **o usuario ve um prompt de UAC e precisa aceitar**. A saida do
   processo elevado e espelhada em tempo real no terminal original e salva em
   `deploy/logs/deploy-<timestamp>.log`.
3. **Pausa do watchdog** via `deploy/runtime/deploy.pause`: `ensure-running.ps1` ignora seus
   ciclos durante o deploy, entao o watchdog nao sobe a API no meio da publicacao. A pausa e
   descartada se o processo que a criou morrer, para o watchdog voltar a recuperar producao.
4. **Watchdog reativado no final**, mesmo se o deploy falhar — assim uma falha volta a servir a
   release anterior em vez de deixar producao sem supervisao.

Se o usuario recusar o UAC, o deploy nao executa nada e retorna erro.

## Post-deploy

1. Read script output for smoke test (`/api/ready`, `/`).
2. On failure: check `deploy/logs/api-error.log` and run `npm run prod:status`.
3. Report success with URLs:
   - Local: http://127.0.0.1:3001
   - Public: https://tap.quivercloud.com.br

## Other prod commands

| Command | Purpose |
|---------|---------|
| `npm run prod:status` | Health check |
| `npm run prod:preflight` | Verificacoes de prontidao, sem alterar nada |
| `npm run ops:open` | Release console / painel ops local (:3099) |
| `npm run prod:rollback -- -Confirmed` | Back to previous release (code only, not DB) |
| `npm run prod:restart` | Restart API only (no build) |
| `npm run prod:backup` | Manual backup |
| `npm run prod:ensure` | Watchdog — keeps services up, does **not** apply new code |

## Rollback

`npm run prod:rollback -- -Confirmed` restores `deploy/prod-artifacts.previous` in seconds.
Code only — the database is never reverted. Details in [reference.md](reference.md).

## Additional resources

- Git workflow: [quiver-tap-git-workflow](../quiver-tap-git-workflow/SKILL.md)
- Full environment table and rollback: [reference.md](reference.md)
- Project deploy docs: [deploy/README.md](../../deploy/README.md)
