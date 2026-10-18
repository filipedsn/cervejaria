## Resumo

<!-- O que esta PR altera e por que? -->

## Checklist

- [ ] Branch criada a partir de `main` atualizada
- [ ] `npm run ci` verde localmente
- [ ] Testado em dev quando há efeito visível (`:5202` / `tapdev.quivercloud.com.br`)
- [ ] Sem secrets, `.env` ou credenciais no diff
- [ ] Migration Prisma incluída? (sim / não)
- [ ] CI verde no GitHub antes do merge

## Deploy após merge

Somente com autorização explícita, no PC de produção (fluxo completo em `CONTRIBUTING.md`):

```powershell
git switch main
git pull --ff-only origin main
.\deploy.cmd -Confirmed
```

O preflight recusa o deploy se `HEAD` não for `origin/main`, se houver arquivos sem commit no build ou se o CI desse commit não estiver verde.
