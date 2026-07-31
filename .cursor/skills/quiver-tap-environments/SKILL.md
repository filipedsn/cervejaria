---
name: quiver-tap-environments
description: Explains Quiver Tap dev vs prod segregation (ports, databases, env files, uploads). Use when the user asks about dev, prod, ambiente, segregacao, localhost, portas 5202, 3002, 3001, or whether changes affect production.
---

# Quiver Tap — Ambientes dev e prod

> **Aviso:** Scripts de deploy completos (`prod:deploy`, ops-panel, CI GitHub) estão na branch `feat/ops-panel-ci`; pendente merge.

## Resposta rapida

**Codigo e banco de dev nao alteram prod diretamente**, mas builds locais em `frontend/dist` **tambem nao publicam prod** desde o isolamento de artefatos. Producao so muda com **`npm run prod:deploy`** (publica em `deploy/prod-artifacts/`).

## Tabela de segregacao

| | Desenvolvimento | Producao |
|---|-----------------|----------|
| API | `:3002` | `:3001` |
| Frontend | Vite `:5202` | Build estatico via API `:3001` |
| Banco | `cervejaria_dev` | `cervejaria` |
| Usuario PG | `cervejaria_dev` | `cervejaria_prod` |
| Uploads | `backend/uploads-dev` | `backend/uploads-prod` |
| Env | `backend/.env.development` | `backend/.env.production` |
| Build UI | `frontend/dist` (CI/dev) | `deploy/prod-artifacts/frontend` |
| Build API | `backend/dist` (CI/dev) | `deploy/prod-artifacts/backend/dist` |
| URL | http://localhost:5202 | https://tap.quivercloud.com.br |

## Comandos do dia a dia

**Desenvolvimento:**

```powershell
npm run dev:start      # sobe API :3002 + Vite :5202
npm run dev:status     # verifica se dev esta no ar
npm run dev:stop       # para apenas dev
npm run restart-dev    # dev com logs no terminal
```

**Producao (consulta / deploy):**

```powershell
npm run prod:status    # health check
npm run prod:verify    # manifest vs bundle servido
npm run prod:deploy    # publicar alteracoes (com confirmacao)
npm run prod:restart   # reinicia so a API (nao rebuild)
```

## Guardrails

- Scripts de prod validam `DATABASE_URL` — nao conectam em `cervejaria_dev` por engano.
- Scripts de dev usam `.env.development` e banco `cervejaria_dev`.
- `prod:ensure` (watchdog) mantem prod no ar; **nao aplica codigo novo**.
- Cloudflare aponta para `localhost:3001` (nao para Vite dev).

## Fluxo recomendado

1. Codar e testar em http://localhost:5202
2. Quando estiver pronto, pedir deploy: "deploy em prod" ou `npm run prod:deploy`
3. Para detalhes do deploy, use a skill `quiver-tap-deploy`

## Mesmo PC

Dev e prod podem rodar juntos (portas e bancos diferentes). Evite carga pesada nos dois simultaneamente por RAM.

## Referencia completa

Ver [deploy/README.md](../../deploy/README.md) e [.cursor/skills/quiver-tap-deploy/reference.md](../quiver-tap-deploy/reference.md).
