## Resumo

<!-- O que esta PR altera? -->

## Checklist

- [ ] Testado em dev (`npm run dev:start` → http://localhost:5202)
- [ ] Sem secrets, `.env` ou credenciais no diff
- [ ] Migration Prisma incluida? (sim / nao)
- [ ] CI verde no GitHub antes do merge

## Deploy apos merge

No PC de producao:

```powershell
git checkout main
git pull origin main
npm.cmd run prod:deploy
```
