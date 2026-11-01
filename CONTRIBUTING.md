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

1. Validar no DEV local (`http://localhost:5202` / API `http://localhost:3002`) quando a mudança tiver efeito visível. `tapdev.quivercloud.com.br` e o tunnel de DEV não são caminhos vigentes.
2. Esperar o check remoto **build-and-unit** verde no PR (branch protection). Rodar `npm run ci` local continua recomendado (suite Windows + atestado legado).
3. Merge por **Squash and merge**. Exceção: quando o PR apenas leva `main` a um commit que já está em produção, o merge é fast-forward para preservar o SHA publicado.
4. Com autorização explícita para **produção pública** (`tap.quivercloud.com.br`): o merge na `main` dispara a esteira **Deploy PRD (VPS)**, que espera aprovação humana no environment `production` (painel Ops ou GitHub; handoff §7.1). Deploy manual por SSH via Tailscale só como contingência. O `deploy.cmd` / `scripts/prod/deploy.ps1` no PC são **legado** e **não** publicam o site público.

## Publicar no DEV

O DEV roda da pasta canônica do projeto (TAP-136), sem elevação. A versão é trocada pelo painel Ops ("Testar o PR", "Igualar ao site", "Trazer a versão oficial") ou direto pelos scripts, que param o DEV, trocam o código, aplicam migrations no banco DEV e religam:

```powershell
.\scripts\dev\sync-dev-main.ps1                                   # versão oficial (origin/main)
.\scripts\dev\switch-dev-code.ps1 -Sha <sha> -Kind pr -Pr <número> # head de um PR com build-and-unit verde
```

Rode em PowerShell **sem** elevação: processos do DEV elevados ficam invisíveis para o supervisor e para o `stop-dev.ps1` de um usuário comum.

Modo alternativo (pacote compilado em `deploy/dev-artifacts`): `prepare-dev-release.ps1 -ExpectedReleaseSha <sha>` e `swap-dev-release.ps1 -FromSha <ativo> -ToSha <sha>`. O swap só funciona quando já existe um pacote compilado ativo; no modo pasta canônica ele recusa com mensagem explícita. Nunca toca na porta `:3001` nem em `deploy/prod-artifacts`.

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

Rode `npm run ci` em `main` limpa imediatamente antes do deploy legado (ou no mesmo SHA após o pull). O painel Ops (`npm run ops:open`, `:3099`) não usa o `deploy.ps1`: ele mergeia PRs com `build-and-unit` verde e aprova ou dispara a esteira Deploy PRD (VPS), sempre com confirmação humana.

`.\deploy.cmd -DryRun` e `-PreflightOnly` mostram o resultado do gate sem alterar nada.

Emergência autorizada: `.\deploy.cmd -Confirmed -BypassReleaseGate "motivo"`. O motivo aparece no preflight e no log do deploy (`deploy/logs/deploy-*.log`). O commit publicado precisa chegar a `main` por PR logo em seguida.

## GitHub Actions e branch protection (vigente)

O repositório é **público**. Em `main`: PR obrigatório + status check `build-and-unit` + branch atualizada; force push desligado. Detalhes operacionais do VPS/CD: `docs/handoff-vps-hostinger-arquiteto.md`.

O publisher de **produção pública** é o **VPS** (Docker), não mais o `deploy.cmd` do PC. O gate do `deploy.ps1` (atestado local) permanece para o fluxo Windows **legado** e para quem ainda o usa em cenários não públicos.
