---
name: quiver-tap-git-workflow
description: Guides Quiver Tap Git flow on GitHub (feature branches, pull requests, merge to main, CI checks). Use when the user asks about branches, PR, merge, main, github, git flow, or publishing code before deploy.
---

# Quiver Tap — Git workflow (GitHub)

A regra é [CONTRIBUTING.md](../../../CONTRIBUTING.md). Leia e siga esse arquivo; esta skill não define regra própria, para Cursor e VS Code seguirem o mesmo fluxo.

Resumo operacional para agentes:

- Trabalho novo nasce de `main` atualizada, em `feat/`, `fix/` ou `chore/`.
- Antes do PR: `npm run ci`.
- Merge só com os sete jobs do CI verdes (`frontend`, `backend-validate`, `backend-test`, `backend-build`, `ops-panel-test`, `support-analyst-test`, `realtime-security-qa`).
- Nunca construir pacote DEV ou PROD a partir de cópia solta ou pasta suja.
- Deploy em produção: só com autorização explícita do usuário, seguindo [quiver-tap-deploy](../quiver-tap-deploy/SKILL.md). O preflight bloqueia `HEAD` diferente de `origin/main` e CI não verde.
- Nunca commitar `.env.production`, `.env.development`, senhas ou `deploy/production.settings.psd1`.
