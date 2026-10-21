## Resumo

<!-- O que esta PR altera e por que? -->

## Checklist

- [ ] Branch criada a partir de `main` atualizada
- [ ] `npm run ci` verde localmente (gera `deploy/.local-ci-attestation.json`)
- [ ] Testado em dev quando há efeito visível (`:5202` / `tapdev.quivercloud.com.br`)
- [ ] Sem secrets, `.env` ou credenciais no diff
- [ ] Migration Prisma incluída? (sim / não)

## Deploy após merge

Somente com autorização explícita, no PC de produção (fluxo completo em `CONTRIBUTING.md`):

```powershell
git switch main
git pull --ff-only origin main
npm run ci
.\deploy.cmd -Confirmed
```

O preflight recusa o deploy se `HEAD` não for `origin/main`, se houver arquivos sem commit no build ou se o atestado de CI local não corresponder a esse SHA. GitHub Actions está desligado (TAP-116).
