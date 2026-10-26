# SUPER PROMPT OBRIGATÓRIO — Arquitetura Quiver Tap (PRD no VPS)

> **Leitura obrigatória no início de TODO chat Codex/agente neste repositório.**  
> Apontado por `AGENTS.md` e `.cursor/rules/codex-super-prompt-vps.mdc`.  
> Complementa (não substitui) `docs/handoff-vps-hostinger-arquiteto.md` e `CONTRIBUTING.md`.  
> Se este arquivo divergir do handoff na `main`, prevalece o **handoff** + `origin/main`.

Você é o Codex (ou agente equivalente). Seja literário: siga ao pé da letra. Não invente infraestrutura. Não “melhore” produção sem autorização. Não faça deploy sem autorização explícita. Não peça confirmação sobre decisões já fechadas na seção 2 — execute.

---

## 0. Antes de qualquer edição (toda missão)

1. Repo: `filipedsn/cervejaria`.
2. Parta de main limpa quando for trabalho novo:

```powershell
git fetch origin main
git switch -c <prefixo>/descricao-curta origin/main
```

3. Working tree sujo / outra feature: NÃO misture. Prefira worktree isolado.
4. Leia nesta ordem (fonte da verdade). Se a cópia local divergir do GitHub, prevalece `origin/main`:

   1. **Este arquivo** (`docs/codex-super-prompt-arquitetura-vps.md`)  
   2. `docs/handoff-vps-hostinger-arquiteto.md` — checklist canônico no topo, §0, §0.1, §7.1, §11.0  
   3. `CONTRIBUTING.md`  
   4. `AGENTS.md`

5. Handoff = documento **interno**. Em resumos para humanos, NÃO reproduza IPs Tailscale, paths de `.env`, rclone.conf, inventário de chaves. No repo, linke o handoff em vez de copiar segredos.

---

## 1. Realidade vigente (decore; não contradiga)

### 1.1 Dois mundos físicos — NUNCA misturar

| | **DEV** | **PRD** |
|---|---|---|
| Máquina | PC Windows do Filipe | VPS Hostinger (KVM) |
| App Quiver Tap | Node **nativo** hoje | Docker `cervejaria-api` |
| Postgres | Docker no PC (`docker-compose.yml`) | Docker no VPS |
| Elasticsearch + Kibana | **Cluster Docker no PC** | **Outro cluster** no VPS |
| URL que cliente usa | Nenhuma (só local) | `https://tap.quivercloud.com.br` |
| Como chega o HTTPS | — | Cloudflare **proxy** → nginx VPS `:443` → app `127.0.0.1:3001` |
| SSH admin | — | **Só Tailscale**; porta 22 **fechada** na internet |

Regras absolutas:
- App DEV **não** aponta Postgres/Elastic/APP_URL do VPS.
- App PRD **não** depende do PC ligado.
- Índices/streams `*.otel-dev` ≠ `*.otel-prd`. Clusters diferentes.
- PC desligado **não** derruba produção (já provado).

### 1.2 O que JÁ está feito (NÃO trate como pendência)

- Cutover do Tap para o VPS + Cloudflare Full Strict  
- Tunnel Cloudflare do hostname `tap` removido do path de produção  
- Watchdog/tarefas de prod no PC (AtLogon/AtStartup) desativados/removidos para o Tap público  
- SSH só Tailscale  
- Repo **público** + GitHub Actions job **`build-and-unit`** + branch protection em `main`  
- Backup Postgres no VPS: dumps locais (cron 01:00 BRT, 30) **E** cópia off-site OneDrive via rclone (`OFFSITE_ENABLED=1`, comprovado)  
- Segregação Dev/PRD documentada no handoff  

### 1.3 O que AINDA é pendência real (só execute se a missão pedir explicitamente)

Conforme handoff §11.0:
1. Restore drill do Postgres  
2. Ativar a esteira de deploy PRD (policy `tag:ci` + OAuth Tailscale) — §7.1 (esteira já implementada, TAP-126)  
3. `releaseSha` no container + rollback imagem n-1  
4. Smoke automático no promote  
5. OTEL → ES PRD (opcional)  
6. Equalizar API DEV em Docker  

**NÃO é pendência:** “configurar backup OneDrive do banco”. Já está feito.

### 1.4 CI — modelo híbrido (não são rivais)

| Gate | Papel |
|---|---|
| GitHub Actions `build-and-unit` | **Obrigatório** para merge em `main` (branch protection). Supersede TAP-116 “Actions desligado”. |
| `npm run ci` local | **Complementar** (suite Windows, Pester, atestado legado). Recomendado; **não** substitui o Actions. |

Textos que digam “GitHub Actions está desligado” ou “TAP-116 = decisão vigente de desligar Actions” estão **errados** e devem ser corrigidos quando a missão for de docs/alinhamento.

### 1.5 Deploy de produção pública

- Path oficial: **VPS Docker** (hoje manual via SSH Tailscale; CD futuro no handoff §7.1).  
- `.\deploy.cmd` / `scripts/prod/deploy.ps1` = **LEGADO Windows**. Não publica mais `tap.quivercloud.com.br`. Manter no repo; relabelar; não apagar sem missão explícita.

---

## 2. Decisões fechadas — NÃO PERGUNTE, EXECUTE ASSIM

1. **DEV oficial neste ciclo** = localhost: API `:3002`, Vite `:5202`. **Não** recriar `tapdev.quivercloud.com.br` nem tunnel para DEV. Onde docs citarem `tapdev`/tunnel de DEV como path vigente, reescreva para localhost **ou** marque **legado/removido** (em missões de alinhamento de docs).
2. **Scripts Windows de prod** = manter arquivos; documentação marca LEGADO. Não delete “para limpar” sem pedido explícito.
3. **Postgres no PC**: `cervejaria-db` (`:5432`) e/ou `cervejaria-db-dev` (`:5434`). Sempre **local Docker**; jamais VPS. Não mude scripts só para “escolher uma porta” — alinhe o texto ao que o script já faz.
4. **Git / PR — autenticação (já falhou na prática):**  
   - Mínimo: **commits + `git push -u origin HEAD`**.  
   - Tente `gh auth status` e `gh pr create`.  
   - Se **403**, not logged in, token inválido, ou browser não controlável: **PARE**. Não loop de `gh auth login`, não automação de browser.  
   - Relatório obrigatório nesse caso:

```text
Os ajustes foram commitados e enviados para a branch [<nome>](https://github.com/filipedsn/cervejaria/tree/<nome>).
O npm run ci [passou|falhou|não rodou] no commit <sha>.

Não consegui concluir a criação da PR: <erro exato>.
A branch está pronta; abra a PR contra main:
https://github.com/filipedsn/cervejaria/compare/main...<nome>?expand=1

Produção não foi alterada.
```

   - Exemplo real: `fix/cozinha-tablet-ocupacao` ficou assim; outro ambiente abriu a PR [#121](https://github.com/filipedsn/cervejaria/pull/121).  
   - **Não** afirme que a PR existe se só a branch foi enviada.
5. **Merge:** squash-merge só se **você** criou a PR, `build-and-unit` verde, e (docs-only **ou** OK humano explícito para runtime). Se a PR ficou para outro agente: **não mergeie**.
6. **`docs/observability/**`**: não reescrever TAP-96 em massa. Só corrija frases vigentes que mandem PC/tunnel como prod do Tap ou “Actions desligado” como regra atual.
7. **Plane:** WI só com autorização / indicação; não criar épico sozinho; não bloquear missão no Plane.
8. **Secrets Tailscale / aprovar deploy PRD / restore drill / Docker API DEV / OTEL PRD**: só se a missão do usuário pedir. Senão, anote em próximos passos.
9. Dúvida clone vs GitHub → **`origin/main` + handoff + este arquivo**.
10. Não reabrir 22 / 3001 / 5432 / 9200 / 5601 na internet.  
11. Não commitar `.env`, chaves, senhas, tokens, `rclone.conf`.  
12. Não comandos destrutivos no VPS sem autorização explícita.  
13. Idioma: mantenha o do arquivo; não traduza o repo inteiro.  
14. **Produção não muda** sem autorização explícita do humano.

---

## 3. Missão padrão de alinhamento de docs (quando o usuário pedir adequar o projeto / “super prompt de arquitetura”)

### Objetivo
Atualizar docs/skills/rules/templates para a arquitetura da §1.

### Escopo
`AGENTS.md`, `README.md`, `CONTRIBUTING.md`, `deploy/README.md`, `.github/pull_request_template.md`, `.cursor/skills/**`, `.cursor/rules/**`, e outros docs de processo que ainda ensinem prod-no-PC.

### Fora de escopo (nessa missão)
Runtime da API, Dockerfile de prod, secrets Actions, SSH no VPS para “ajustar prod”. Se `gh` quebrado → só push + link compare.

### Busca obrigatória

```text
GitHub Actions está desligado
TAP-116
Cloudflare Tunnel
cloudflared
tapdev.quivercloud.com.br
PC de produção
deploy.cmd -Confirmed
fonte de verdade
sem branch protection
QuiverTap-AtLogon
QuiverTap-AtStartup
watchdog
tunnel run
```

Arquivos já flagrados (alinhar todos em missão de docs):

1. `AGENTS.md`  
2. `README.md`  
3. `deploy/README.md`  
4. `.github/pull_request_template.md`  
5. `.cursor/skills/quiver-tap-deploy/SKILL.md`  
6. `.cursor/skills/quiver-tap-deploy/reference.md`  
7. `.cursor/skills/quiver-tap-environments/SKILL.md`  
8. `.cursor/skills/quiver-tap-git-workflow/SKILL.md`  
9. `.cursor/rules/quiver-tap-deploy.mdc`  
10. `.cursor/rules/quiver-tap-dev-refresh.mdc`  
11. Qualquer outro hit vigente da busca  

Padrão de reescrita: PRD=VPS+Cloudflare+Docker; deploy oficial≠`deploy.cmd`; CI Actions obrigatório + `npm run ci` complementar; DEV=localhost; tunnel/watchdog=legado; link handoff; sem duplicar secrets.

### História única (teste mental)
Qualquer agente lendo `AGENTS.md` + `CONTRIBUTING.md` + skill de deploy conclui: PRD=VPS; DEV=PC; merge exige `build-and-unit`; publish ≠ deploy.cmd; off-site backup feito; falta restore; Elastic DEV≠PRD; detalhes→handoff.

---

## 4. Processo Git / push / PR

### 4.1 Commits e push

```powershell
git add <arquivos>
git commit -m "docs: align agent guides to VPS production architecture"
git push -u origin HEAD
```

### 4.2 PR (tente; não morra)

```powershell
gh auth status
gh pr create --base main --head <branch> --title "..." --body-file pr-body.md
```

Se falhar → §2.4 (compare URL). Produção intocada.

### 4.3 Merge
Docs-only + PR sua + CI verde → squash ok. Senão → regras §2.5.

---

## 5. Definition of Done (missão de alinhamento de docs)

- [ ] Partiu de `origin/main`  
- [ ] Leu este arquivo + handoff (checklist, §0.1, §7.1, §11.0)  
- [ ] Busca obsoleta limpa ou só sob Legado/histórico  
- [ ] Lista da §3 tratada  
- [ ] Branch pushed  
- [ ] PR criada **ou** compare URL com modelo §2.4  
- [ ] Produção não alterada  
- [ ] Relatório final  

### Relatório final

```text
## Feito
- Branch: <nome> @ <sha>
- PR: <url>  OU  Compare: https://github.com/filipedsn/cervejaria/compare/main...<branch>?expand=1
- Motivo se sem PR: <403 / gh auth / browser>
- Arquivos tocados: <lista>
- npm run ci: <pass/fail/skip + sha>
- Produção alterada?: NÃO

## História única (5 linhas)
- ...

## Próximos passos (handoff §11.0)
- restore drill / CD Tailscale / releaseSha / OTEL PRD / API DEV Docker

## O que NÃO fiz
- ...
```

---

## 6. Proibições (missão falha se violar)

- Deploy VPS (aprovar o environment `production` ou SSH manual) sem autorização  
- Secrets no GitHub sem pedido  
- Reabrir firewall / recriar tunnel do `tap`  
- Cruzar Elastic/DB DEV↔PRD  
- Apagar scripts legados “para limpar”  
- Reescrever TAP-96 inteiro  
- Commitar credenciais  
- Tratar off-site OneDrive Postgres como pendência de config  
- Inventar que API DEV já é Docker  
- Loop de login `gh` / browser  
- Mentir que a PR existe  
- Alterar produção sem OK explícito  

---

## 7. Prompt mental (uma linha)

> PRD só VPS; DEV só PC; Actions obriga merge; deploy.cmd é legado; tapdev/tunnel não são prod; off-site backup já existe; leio este arquivo + handoff; push sempre; se gh der 403 entrego compare e paro; produção intocada sem autorização.
