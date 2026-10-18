# Fluxo de entrega do Quiver Tap

Este é o único fluxo válido para levar código até produção, qualquer que seja a ferramenta: Cursor, VS Code ou terminal. Regras de agentes (`AGENTS.md`, `.cursor/`) apontam para este arquivo e não o substituem.

## Princípios

1. **Produção é a verdade.** `main` no GitHub é sempre igual ao commit publicado em produção ou um passo à frente dele, nunca uma linha paralela.
2. **Só código commitado vira pacote.** DEV e produção são construídos a partir de um commit, nunca de cópias soltas ou da pasta de trabalho suja.
3. **Todo trabalho nasce de `main`** numa branch própria e volta por Pull Request.
4. **Deploy em produção exige autorização explícita** de quem responde pelo produto, além de passar pelo gate automático descrito abaixo.

## Passo a passo

```powershell
git switch main
git pull --ff-only origin main
git switch -c fix/descricao-curta      # feat/, fix/ ou chore/

# ... alteracoes ...

npm run ci                             # mesmos gates do GitHub Actions
git add <arquivos>
git commit -m "fix(area): descricao"
git push -u origin fix/descricao-curta
gh pr create --base main               # ou pela interface do GitHub
```

1. Validar no DEV (`:3002` / `:5202` / `tapdev.quivercloud.com.br`) quando a mudança tiver efeito visível.
2. Aguardar o CI do PR ficar verde em todos os jobs: `frontend`, `backend-validate`, `backend-test`, `backend-build`, `ops-panel-test`, `support-analyst-test`, `realtime-security-qa`.
3. Merge por **Squash and merge**. Exceção: quando o PR apenas leva `main` a um commit que já está em produção, o merge é fast-forward para preservar o SHA publicado.
4. Com autorização explícita para produção, no PC de produção:

```powershell
git switch main
git pull --ff-only origin main
.\deploy.cmd -Confirmed
```

## Convenção de branches

| Prefixo | Uso |
|---------|-----|
| `feat/` | Funcionalidade nova |
| `fix/` | Correção de bug |
| `chore/` | CI, scripts, documentação, organização |

Branches de backup (`backup/*`) e tags `archive/*` guardam trabalho que não está em produção. Não são base para trabalho novo.

## CI local

`npm run ci` executa, na ordem do GitHub Actions, build do frontend, `prisma generate` e `prisma validate`, testes unitários e checagem de tipos do backend, testes do ops-panel e do support-analyst e, no Windows, os testes do gate de release. Para na primeira falha e imprime um resumo. `realtime-security-qa` roda só no GitHub, porque precisa de Postgres e API isolados.

Neste PC o alert poller de produção executa `backend/dist` com `backend/node_modules` da pasta principal. Por isso o CI local checa os tipos do backend com `tsc --noEmit` em vez de gravar `backend/dist`. Se o motor do Prisma estiver travado por esse processo, o `prisma generate` só é aceito quando o client já gerado corresponde ao schema atual.

## Gate automático do deploy

`scripts/prod/deploy.ps1` recusa publicar, ainda no preflight e antes de backup, migration ou UAC, quando:

- há arquivo rastreado alterado sem commit;
- há arquivo sem commit em `frontend/src`, `frontend/public`, `backend/src` ou `backend/prisma` (o build os empacotaria);
- `HEAD` difere de `origin/main` depois de `git fetch`;
- o workflow `CI` não tem execução concluída com sucesso para esse SHA.

`.\deploy.cmd -DryRun` e `-PreflightOnly` mostram o resultado do gate sem alterar nada.

Emergência autorizada: `.\deploy.cmd -Confirmed -BypassReleaseGate "motivo"`. O motivo aparece no preflight e no log do deploy (`deploy/logs/deploy-*.log`). O commit publicado precisa chegar a `main` por PR logo em seguida.

## Limitação conhecida do GitHub

O repositório é privado no plano gratuito, sem branch protection nem rulesets (a API responde 403). O botão de merge não exige CI verde. Por isso o bloqueio obrigatório está no deploy: código fora de `main` ou sem CI verde não chega a produção. Quando o plano permitir, ativar em `main`: Pull Request obrigatório, os sete jobs acima como status checks obrigatórios e bloqueio de force push.
