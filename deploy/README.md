# Quiver Tap â€” Deploy e segregacao Dev/Prod

## Ambientes

| | Desenvolvimento | Producao |
|---|-----------------|----------|
| API | `:3002` | `:3001` |
| Frontend | Vite `:5202` | Build estatico via API `:3001` |
| Banco | `cervejaria_dev` (:5434) | `cervejaria` (:5432) |
| Usuario PG | `cervejaria_dev` | `cervejaria_prod` |
| Uploads | `backend/uploads-dev` | `backend/uploads-prod` (fora de `prod-artifacts`; ver `Set-ProdUploadsEnv`) |
| Env | `backend/.env.development` | `backend/.env.production` |
| Build UI (local/CI) | `frontend/dist` | â€” |
| Build UI (publicado) | â€” | `deploy/prod-artifacts/frontend` |
| Build API (local/CI) | `backend/dist` | â€” |
| Build API (publicado) | â€” | `deploy/prod-artifacts/backend/dist` |
| URL local | http://localhost:5202 | https://tap.quivercloud.com.br |
| URL internet (dev) | https://tapdev.quivercloud.com.br | â€” |

### Dev pela internet

O ambiente de desenvolvimento também pode ser acessado em **https://tapdev.quivercloud.com.br** (Cloudflare Tunnel → Vite `:5202`).

**Importante:** o serviço Windows `Cloudflared` neste PC roda com `tunnel run --token` (config **remota** no painel Zero Trust). O arquivo `%USERPROFILE%\.cloudflared\config.yml` **nao** e aplicado automaticamente pelo servico — ingress novo exige cadastro no painel (ou migrar o conector para config local).

1. **Painel Cloudflare** → Zero Trust → Networks → Connectors → Tunnels → **quiver** → Configure → **Public Hostname** → Add:
   - Hostname: `tapdev.quivercloud.com.br`
   - Service: `http://localhost:5202`
2. **DNS** (se ainda nao existir): `cloudflared tunnel route dns quiver tapdev.quivercloud.com.br`
3. **SSL:** `tapdev.quivercloud.com.br` e coberto pelo certificado `*.quivercloud.com.br`.
4. Em `backend/.env.development`:
   ```env
   CORS_ORIGIN="http://localhost:5202,https://tapdev.quivercloud.com.br"
   APP_URL="https://tapdev.quivercloud.com.br"
   ```
5. Reinicie o dev: `npm run dev:stop` → `npm run dev:start`.

O Vite faz proxy de `/api`, `/uploads` e WebSocket para a API dev (`:3002`). **Nao** aponte o tunel dev para `:3001` (prod).

**Sintomas se faltar ingress remoto:** DNS resolve, HTTP 502, HTTPS falha handshake.

### Isolamento de artefatos

- `npm run ci:frontend` / `vite build` escrevem em **`frontend/dist`** â€” nao alteram prod.
- Somente **`npm run prod:deploy`** publica em **`deploy/prod-artifacts/`** (manifest em `manifest.json`).
- Um candidate retido fica em `deploy/release-candidates/<SHA-completo>/`, fora do artifact ativo e da `.staging` transitória. Seu `candidate-manifest.json` tem hashes SHA-256 de todos os arquivos publicados; ele não é publicado automaticamente.
- A API prod usa `FRONTEND_DIST` apontando para `prod-artifacts/frontend`.
- O entry da API e `prod-artifacts/backend/dist/index.js`; `node_modules` e um junction para `backend/node_modules` (resolucao ESM do Node).
- Verificar alinhamento: `npm run prod:verify`.

## Politica no mesmo PC

- **Producao** e supervisionada pelo daemon oculto + tarefas `QuiverTap-AtLogon` / `QuiverTap-AtStartup`. Neste Windows o PostgreSQL depende do Docker Desktop/WSL: boot sem login nao garante banco disponivel. Ao fazer login, o launcher abre Docker Desktop se necessario; o supervisor aguarda o container PROD healthy e recupera a API automaticamente.
- O supervisor inicia somente `cervejaria-db` ja existente, sem recriar volumes, executar migrations ou iniciar DEV. O servico Windows `Cloudflared` e o unico dono do tunel quando instalado; configuracao local nao e usada como fallback. Estado Running indica processo ativo, nao comprova conectividade externa.
- A tarefa de boot executa o daemon diretamente, sem limite de duracao, com reinicio em falha. Um lock entre sessoes impede supervisores duplicados. Auxiliares nao condicionam a recuperacao do banco/API/tunel.
- **Desenvolvimento** via supervisor do Cursor/VS Code ou `npm run dev:start`.
- Evite rodar dev e prod sob carga pesada ao mesmo tempo (RAM).

### Tela piscando?

**Causa comum:** supervisor dev reiniciando Vite a cada 30s (frontend `:5202` instavel).

```powershell
npm run dev:stop
```

Se nao estiver codando, mantenha dev parado. Para corrigir autostart prod:

```powershell
npm.cmd run prod:fix-flickering
```

(Use `npm.cmd`, nao `npm`, se o PowerShell bloquear scripts.)

Isso remove a tarefa antiga `QuiverTap-Watchdog` e usa um unico processo oculto para monitorar prod.

## Deploy de producao (caminho principal)

O fluxo obrigatorio (branch, PR, `npm run ci` local, merge em `main`) esta em [CONTRIBUTING.md](../CONTRIBUTING.md).

```powershell
git switch main
git pull --ff-only origin main
npm run prod:deploy
```

O script pede confirmacao digitando `DEPLOY`, depois executa:

0. Preflight com gate de origem: arquivos rastreados limpos, nada solto em `frontend/src`, `frontend/public`, `backend/src` e `backend/prisma`, `HEAD` igual a `origin/main` e atestado de `npm run ci` (`deploy/.local-ci-attestation.json`) para esse SHA. Se falhar, nada e alterado.
1. Backup do banco `cervejaria`
2. Build frontend em staging (`build:prod`) e backend (`backend/dist`)
3. Parada da API e do Alert Poller, depois de staging valido
4. Migrations e backfill em producao (`db:migrate:prod`)
5. Publicacao atomica em `deploy/prod-artifacts/` + `manifest.json`
6. Restart da API (`:3001`) â€” tunnel Cloudflare permanece ativo
7. Smoke test (`/api/ready`, `/`) + `prod:status`

A API e os processos consumidores do banco sao interrompidos antes de migrations de
producao para impedir que a versao anterior execute sobre um schema em transicao. Se
uma migration, backfill, swap, start ou smoke falhar depois desse ponto, o watchdog fica
pausado ate intervencao operacional validar banco e artefatos; nao ha rollback automatico
de banco nem reinicio automatico da release anterior.

O deploy nao faz pre-analise propria para distinguir migration pendente de no-op. Assim,
quando `-SkipMigrate` nao for usado, aplica a mesma janela controlada antes de chamar o
Prisma; isso evita criar um parser ou uma segunda regra de migrations.

### Flags uteis

```powershell
npm run prod:deploy -- -DryRun              # so mostra o plano
npm run prod:deploy -- -Confirmed           # pula prompt (apos OK no chat com agente)
npm run prod:deploy -- -FrontendOnly        # so UI
npm run prod:deploy -- -BackendOnly         # so API
npm run prod:deploy -- -SkipMigrate         # sem migration Prisma
npm run prod:deploy -- -SkipBackup          # emergencia (evitar)
npm run prod:deploy -- -Confirmed -BypassReleaseGate "motivo"  # emergencia autorizada, fora do gate
```

### Outros comandos prod

| Comando | Uso |
|---------|-----|
| `npm run prod:status` | Health check |
| `npm run prod:verify` | Manifest vs bundle servido |
| `npm run prod:restart` | Reinicia API sem rebuild |
| `npm run prod:backup` | Backup manual |
| `npm run prod:ensure` | Watchdog â€” nao aplica codigo novo |

## Checklist manual (avancado)

Se precisar rodar passos isolados (nao recomendado â€” use `prod:deploy`):

1. `npm run prod:backup`
2. `npm run prod:deploy -- -Confirmed` (publica artefatos + restart)

Builds locais (`ci:frontend`, `npm run build`) **nao** publicam prod.

### Candidate retido para release

O candidate é preparado de uma worktree explícita, limpa e certificada. O SHA completo, a worktree de origem e o destino são obrigatórios; o comando falha se o HEAD, Node 20, arquivos tracked ou hashes não conferirem. Use o Node 20 provisionado:

```powershell
npm run release:candidate:prepare -- -SourceWorktree C:\caminho\runtime -ExpectedReleaseSha <sha-completo> -CandidateRoot C:\caminho\deploy\release-candidates
npm run release:candidate:verify -- -CandidatePath C:\caminho\deploy\release-candidates\<sha-completo> -ExpectedReleaseSha <sha-completo>
```

O publish futuro deve chamar `Publish-ReleaseCandidateArtifacts` com o candidate e SHA explícitos. Ele revalida o manifest antes de copiar para a `.staging` transitória, faz o swap atômico existente e só então escreve o `manifest.json` **ativo**. O candidate nunca é reconstruído, alterado ou confundido com o manifest ativo.

## Rollback

- API nao sobe: reverter codigo/env e `npm run prod:deploy` ou `npm run prod:restart`
- Banco: restaurar `deploy/backups/backup-prod-*.sql` via `psql`

## Postgres — dois containers

| | Producao | Desenvolvimento |
|---|----------|-----------------|
| Container | `cervejaria-db` | `cervejaria-db-dev` |
| Porta | `5432` | `5434` |
| Volume | `postgres_data` | `postgres_dev_data` |

Comandos:

```powershell
npm run db:up          # sobe prod + dev
npm run db:up:prod     # sobe so prod
npm run db:up:dev      # sobe so dev
npm run db:down        # para so dev (prod intocavel)
npm run db:down:all    # para tudo (emergencia)
npm run db:cleanup-dev-from-prod  # remove vestigios de dev do container prod
```

Variaveis externas exigidas para criar ou recriar os containers:

- `POSTGRES_PROD_PASSWORD` para `postgres` (producao);
- `POSTGRES_DEV_PASSWORD` para `postgres-dev` (desenvolvimento);
- `npm run db:up` exige ambas.

## Setup inicial (usuarios Postgres segregados)

```powershell
npm run db:create-env-users
```

Cria `cervejaria_prod` e `cervejaria_dev` com acesso apenas ao seu banco.

## Cloudflare Tunnel

Producao serve frontend + API em **`:3001`**. Ingress deve apontar para:

```yaml
service: http://localhost:3001
```

## Skills Cursor (agente)

- Git + PR: `.cursor/skills/quiver-tap-git-workflow/SKILL.md`
- Deploy: `.cursor/skills/quiver-tap-deploy/SKILL.md`
- Dev vs prod: `.cursor/skills/quiver-tap-environments/SKILL.md`

PeÃ§a no chat: **"deploy em prod"** â€” o agente guia com confirmacao antes de executar.

## Painel Ops (local, separado da app)

Servico **independente** em **http://127.0.0.1:3099** â€” continua no ar mesmo se a app prod (`:3001`) cair.

| Comando | Uso |
|---------|-----|
| `npm run ops:start` | Sobe o painel |
| `npm run ops:open` | Abre no navegador |

**Primeira vez:** copie `ops-panel/.env.example` â†’ `ops-panel/.env` e defina `OPS_PANEL_TOKEN`.

O painel mostra status prod/dev, links GitHub, logs e botoes (dev start/stop, restart API, deploy).

- **Nao expor** via Cloudflare â€” apenas localhost
- Sobe automaticamente junto com o watchdog (`QuiverTap-AtLogon`)
- Acoes destrutivas exigem token + confirmacao `DEPLOY`

## Fluxo Git + GitHub

Repo: `https://github.com/filipedsn/cervejaria.git` â€” branch **`main`** = linha de producao.

```mermaid
flowchart LR
  branch[feat ou fix branch] -->|push| pr[Pull Request]
  pr --> localCi[npm run ci local]
  localCi -->|verde| main[main]
  main -->|git pull + npm run ci no PC| deploy[prod:deploy]
```

### Passo a passo

| # | Acao |
|---|------|
| 1 | `git checkout main` → `git pull origin main` |
| 2 | `git checkout -b feat/nome-curto` |
| 3 | Desenvolver e testar em http://localhost:5202 |
| 4 | `npm run ci` + `git commit` + `git push -u origin feat/nome-curto` |
| 5 | Abrir PR **→ main** no GitHub |
| 6 | Confirmar CI local verde no commit a mergear (Actions desligado — TAP-116) |
| 7 | **Squash and merge** |
| 8 | No PC: `git pull origin main` → `npm run ci` → `npm.cmd run prod:deploy` |

### Branches

- `feat/` — funcionalidade
- `fix/` — correcao
- `chore/` — CI, scripts, docs

### CI

Fonte de verdade: `npm run ci` (grava `deploy/.local-ci-attestation.json`). O workflow em [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) nao dispara em push/PR.

Rodar antes do PR e imediatamente antes do deploy em `main`:

```powershell
npm run ci
```

### GitHub

Actions esta desligado no repositorio (TAP-116). No plano free privado nao ha branch protection; o gate obrigatorio e o deploy local com atestado de `npm run ci`.
