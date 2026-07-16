# Quiver Tap Ops Panel

Painel local de CI/CD e operacoes. Roda **separado** da aplicacao prod (`:3001`).

## URL

http://127.0.0.1:3099 (somente localhost)

## Setup

```powershell
copy ops-panel\.env.example ops-panel\.env
# Edite OPS_PANEL_TOKEN com um valor aleatorio
npm run ops:start
npm run ops:open
```

Cole o mesmo token no campo do painel (salvo na sessao do navegador).

## Opcional: status CI no GitHub

Defina `GITHUB_TOKEN` em `ops-panel/.env` (PAT com leitura do repo).

## Desenvolvimento

```powershell
cd ops-panel
npm run dev
```
