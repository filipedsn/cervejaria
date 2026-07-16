---
name: quiver-tap-git-workflow
description: Guides Quiver Tap Git flow on GitHub (feature branches, pull requests, merge to main, CI checks). Use when the user asks about branches, PR, merge, main, github, git flow, or publishing code before deploy.
---

# Quiver Tap — Git workflow (GitHub)

> **Aviso:** Scripts de deploy completos (`prod:deploy`, ops-panel, CI GitHub) estão na branch `feat/ops-panel-ci`; pendente merge.

## Regras

1. **`main`** = codigo pronto para producao. Evite push direto; use branch + PR.
2. **Deploy** so apos merge em `main` + `git pull` no PC (skill `quiver-tap-deploy`).
3. Nunca commitar `.env.production`, `.env.development`, senhas ou `deploy/production.settings.psd1`.

## Fluxo padrao

```text
main (atualizada)
  → feat/nome ou fix/nome
  → dev local (:5202)
  → commit + push
  → Pull Request → main
  → CI verde
  → Squash and merge
  → git pull main no PC
  → npm.cmd run prod:deploy
```

## Comandos (agente)

```powershell
git checkout main
git pull origin main
git checkout -b feat/descricao-curta
# ... alteracoes ...
git add .
git commit -m "feat: descricao"
git push -u origin feat/descricao-curta
```

Depois: abrir PR no GitHub (`feat/...` → `main`) ou usar `gh pr create`.

Antes de sugerir merge:

- Verificar CI no PR (jobs `frontend` e `backend-validate` devem passar)
- `backend-build` pode falhar por erros `tsc` pre-existentes — nao bloqueia merge, mas avisar

Apos merge confirmado pelo usuario:

```powershell
git checkout main
git pull origin main
```

Entao seguir skill `quiver-tap-deploy` para `prod:deploy`.

## Convencao de branches

| Prefixo | Uso |
|---------|-----|
| `feat/` | Funcionalidade nova |
| `fix/` | Correcao de bug |
| `chore/` | CI, scripts, docs, refactors |

## CI local (mesmo que GitHub)

```powershell
npm run ci:frontend
npm run ci:backend
```

## Referencia

- Painel visual local: http://127.0.0.1:3099 ([ops-panel/README.md](../../ops-panel/README.md))
- [deploy/README.md](../../deploy/README.md) — fluxo Git + deploy
- [quiver-tap-deploy](../quiver-tap-deploy/SKILL.md) — deploy apos merge
