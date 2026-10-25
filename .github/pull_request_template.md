## Resumo

<!-- O que esta PR altera e por que? -->

## Checklist

- [ ] Branch criada a partir de `main` atualizada
- [ ] `npm run ci` verde localmente (gera `deploy/.local-ci-attestation.json`)
- [ ] Testado no DEV local quando há efeito visível (`http://localhost:5202` / API `http://localhost:3002`)
- [ ] Sem secrets, `.env` ou credenciais no diff
- [ ] Migration Prisma incluída? (sim / não)

## Deploy após merge

Somente com autorização explícita, publicar no VPS (Docker), hoje manualmente via SSH por Tailscale. O runbook está em [`docs/handoff-vps-hostinger-arquiteto.md`](../docs/handoff-vps-hostinger-arquiteto.md) §7.1. O `deploy.cmd` e `scripts/prod/deploy.ps1` são ferramentas Windows **legadas** e não publicam `tap.quivercloud.com.br`.

O merge em `main` exige o check remoto `build-and-unit` verde. `npm run ci` local é complementar e mantém o atestado usado pelo fluxo Windows legado.
