---
name: quiver-tap-git-workflow
description: Orienta branches, PRs, merge em main e os checks do Quiver Tap.
---

# Quiver Tap — fluxo GitHub

A regra completa está em [CONTRIBUTING.md](../../../CONTRIBUTING.md). Esta skill resume o fluxo para que Cursor, Codex e VS Code usem a mesma regra.

- Trabalho novo nasce de `origin/main` atualizada em branch própria (`feat/`, `fix/`, `chore/` ou `docs/`).
- Abrir PR contra `main`.
- O check remoto **GitHub Actions `build-and-unit` é obrigatório para merge** (branch protection).
- `npm run ci` local é complementar: exercita verificações Windows e gera atestado para tooling de release Windows legado.
- Nunca construir pacote DEV ou PRD a partir de cópia solta ou pasta de trabalho suja.
- PRD pública está no VPS; publicar só após merge e autorização humana explícita, seguindo [a skill de deploy](../quiver-tap-deploy/SKILL.md) e o [handoff interno](../../../docs/handoff-vps-hostinger-arquiteto.md).
- `deploy.cmd` não publica mais o site público. Não descreva Actions como desligado por causa do TAP-116 histórico.
- Nunca commitar `.env`, senhas, chaves, tokens ou `deploy/production.settings.psd1`.
