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

npm run ci                             # complementar (atestado local); merge exige Actions
git add <arquivos>
git commit -m "fix(area): descricao"
git push -u origin fix/descricao-curta
gh pr create --base main               # ou pela interface do GitHub
```

1. Validar no DEV (`:3002` / `:5202` / `tapdev.quivercloud.com.br`) quando a mudança tiver efeito visível.
2. Esperar o check remoto **build-and-unit** verde no PR (branch protection). Rodar `npm run ci` local continua recomendado (suite Windows + atestado legado).
3. Merge por **Squash and merge**. Exceção: quando o PR apenas leva `main` a um commit que já está em produção, o merge é fast-forward para preservar o SHA publicado.
4. Com autorização explícita para **produção pública** (`tap.quivercloud.com.br`): publicar no **VPS** (Docker). Ver `docs/handoff-vps-hostinger-arquiteto.md` §7.1. O `.\deploy.cmd -Confirmed` no PC é **legado** e **não** é mais o publisher do site público.

## Publicar no DEV

O DEV oficial roda um pacote compilado em `deploy/dev-artifacts`, montado a partir de um commit já enviado ao GitHub (branch do PR ou `main`). Editar arquivos não muda a tela. Em PowerShell elevado (os processos do DEV rodam elevados):

```powershell
$sha = git rev-parse HEAD
$ativo = (Invoke-RestMethod http://127.0.0.1:3002/api/health).releaseSha
.\scripts\dev\prepare-dev-release.ps1 -ExpectedReleaseSha $sha
.\scripts\dev\swap-dev-release.ps1 -FromSha $ativo -ToSha $sha
```

`swap-dev-release.ps1` para o DEV, publica o pacote, sobe a API e o frontend e confere `/api/health` e `/api/ready`. Se falhar, volta sozinho para a versão anterior. Nunca toca na porta `:3001` nem em `deploy/prod-artifacts`.

## Convenção de branches

| Prefixo | Uso |
|---------|-----|
| `feat/` | Funcionalidade nova |
| `fix/` | Correção de bug |
| `chore/` | CI, scripts, documentação, organização |

Branches de backup (`backup/*`) e tags `archive/*` guardam trabalho que não está em produção. Não são base para trabalho novo.

## CI local

Há **dois** gates: (1) **GitHub Actions** job `build-and-unit` — obrigatório para merge em `main` (repo público + branch protection; supersede TAP-116 “Actions desligado”); (2) **`npm run ci` local** — complementar, grava atestado para o deploy Windows legado e exercita Pester/ops-panel no PC. Executa build do frontend, `prisma generate` e `prisma validate`, testes unitários e checagem de tipos do backend, testes do ops-panel e do support-analyst e, no Windows, os testes do gate de release. Para na primeira falha e imprime um resumo. Em sucesso grava `deploy/.local-ci-attestation.json` (gitignore) com o SHA de `HEAD`.

Neste PC o alert poller de produção executa `backend/dist` com `backend/node_modules` da pasta principal. Por isso o CI local checa os tipos do backend com `tsc --noEmit` em vez de gravar `backend/dist`. Se o motor do Prisma estiver travado por esse processo, o `prisma generate` só é aceito quando o client já gerado corresponde ao schema atual.

## Gate automático do deploy

`scripts/prod/deploy.ps1` recusa publicar, ainda no preflight e antes de backup, migration ou UAC, quando:

- há arquivo rastreado alterado sem commit;
- há arquivo sem commit em `frontend/src`, `frontend/public`, `backend/src` ou `backend/prisma` (o build os empacotaria);
- `HEAD` difere de `origin/main` depois de `git fetch`;
- não há atestado de CI local (`deploy/.local-ci-attestation.json`) com `ok: true` para esse SHA.

O Ops Panel usa a mesma regra. Rode `npm run ci` em `main` limpa imediatamente antes do deploy (ou no mesmo SHA após o pull).

`.\deploy.cmd -DryRun` e `-PreflightOnly` mostram o resultado do gate sem alterar nada.

Emergência autorizada: `.\deploy.cmd -Confirmed -BypassReleaseGate "motivo"`. O motivo aparece no preflight e no log do deploy (`deploy/logs/deploy-*.log`). O commit publicado precisa chegar a `main` por PR logo em seguida.

## Limitação conhecida do GitHub

## GitHub Actions e branch protection (vigente)

O repositório é **público**. Em `main`: PR obrigatório + status check `build-and-unit` + branch atualizada; force push desligado. Detalhes operacionais do VPS/CD: `docs/handoff-vps-hostinger-arquiteto.md`.

O publisher de **produção pública** é o **VPS** (Docker), não mais o `deploy.cmd` do PC. O gate do `deploy.ps1` (atestado local) permanece para o fluxo Windows **legado** e para quem ainda o usa em cenários não públicos.
