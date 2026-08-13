# Quiver Tap — Deploy reference

> **Aviso:** Scripts de deploy completos (`prod:deploy`, ops-panel, CI GitHub) estão na branch `feat/ops-panel-ci`; pendente merge.

## Dev vs prod

| | Desenvolvimento | Producao |
|---|-----------------|----------|
| API | `:3002` | `:3001` |
| Frontend | Vite `:5202` | Build estatico via API `:3001` |
| Banco | `cervejaria_dev` (:5434) | `cervejaria` (:5432) |
| Container PG | `cervejaria-db-dev` | `cervejaria-db` |
| Usuario PG | `cervejaria_dev` | `cervejaria_prod` |
| Uploads | `backend/uploads-dev` | `backend/uploads-prod` |
| Env | `backend/.env.development` | `backend/.env.production` |
| URL publica | — | https://tap.quivercloud.com.br |

## Dev commands

```powershell
npm run dev:start    # sobe dev em background
npm run dev:status   # status
npm run dev:stop     # para dev
npm run restart-dev  # dev em primeiro plano (logs no terminal)
```

## Prod deploy flow

```powershell
npm run prod:deploy              # pede DEPLOY no terminal
npm run prod:deploy -- -Confirmed   # apos OK no chat (agente)
```

Steps executed by `scripts/prod/deploy.ps1`:

1. Validate `DATABASE_URL` (prod guardrails)
2. Backup → `deploy/backups/backup-prod-*.sql`
3. `build:deploy` (frontend) + `build` (backend)
4. `db:migrate:prod`
5. `restart-api.ps1` (API only, tunnel stays up)
6. Smoke test + `prod:status`

## Cloudflare Tunnel

Ingress must point to **`http://localhost:3001`** (API serves static frontend).

## Rollback

**API / code — fastest path (seconds):**

`publish-artifacts.ps1` moves the live release to `deploy/prod-artifacts.previous` before
publishing, so the last release is always on disk:

```powershell
npm run prod:rollback -- -Confirmed     # add -DryRun to inspect first
```

It swaps the directories back, restarts the API and runs the smoke test. It is a
production command — needs explicit user authorization like any deploy. Also available as
a button in the release console (`:3099`).

**It does not revert the database.** An applied migration stays applied; if the deploy you
are undoing ran a destructive migration, restore the dump from `deploy/backups` too.

**API / code — when there is no rollback point:**

1. Revert git changes or checkout previous commit
2. Rebuild + `npm run prod:deploy -- -Confirmed`

**Database:**

1. Find backup: `deploy/backups/backup-prod-*.sql`
2. Restore via Docker/psql (careful — destructive)

**Env misconfiguration:**

1. Fix `backend/.env.production`
2. `npm run prod:restart`

## Build notes

- Frontend prod build: `npm run build:deploy --prefix frontend` (Vite only)
- Full `npm run build --prefix frontend` may fail on `tsc -b`; deploy uses `build:deploy`
- Backend `tsc` must pass for deploy; fix TypeScript errors before releasing API changes
