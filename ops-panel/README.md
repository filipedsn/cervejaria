# Quiver Tap Ops Panel

Painel local de CI/CD e operacoes. Roda **separado** da aplicacao prod (`:3001`).

## URL

http://127.0.0.1:3099 (somente localhost)

## Setup

```powershell
copy ops-panel\.env.example ops-panel\.env
npm run ops:start
npm run ops:open
```

## URL e confiabilidade

**Porta fixa:** `3099` (configuravel em `ops-panel/.env` como `OPS_PANEL_PORT`).  
**Nao existe fallback automatico para outra porta** — se algo antigo estiver preso na 3099, o start falha com instrucoes claras em vez de subir em silencio em outro lugar.

### Comandos (use estes, nao adivinhe a URL)

| Comando | O que faz |
|---|---|
| `npm run ops:status` | **Fonte da verdade** — URL, PID, rodando/parado/legado |
| `npm run ops:start` | Sobe na porta configurada |
| `npm run ops:stop` | Para o painel |
| `npm run ops:restart` | Para e sobe de novo |
| `npm run ops:open` | Abre no navegador **somente** se a versao atual estiver no ar |

O servidor grava `deploy/runtime/ops-panel.meta.json` com porta, PID e horario de inicio.  
A propria UI mostra `Online · PID …` no topo quando voce esta na instancia certa.

Se `ops:status` mostrar **LEGADO**, encerre o PID indicado (PowerShell como Administrador) e rode `ops:start` de novo.

Abra sempre a URL que `ops:status` imprimir — hoje e `http://127.0.0.1:3099`.

## Segurança de ações

Acoes destrutivas ainda pedem confirmacao digitada (`DEPLOY`, `ROLLBACK`, `SYNC-DEV`).
Uma pagina em outra origem nao consegue disparar essas acoes (checagem de Origin).

`OPS_PANEL_TOKEN` so e necessario se o painel for acessado de fora do localhost.

## Qualidade do deploy (CI local)

O gate de release exige `deploy/.local-ci-attestation.json` gerado por `npm run ci` para
o SHA de `HEAD`. `GITHUB_TOKEN` continua opcional: so enriquece metadados de PR no painel
(O check remoto build-and-unit é obrigatório para merge em main; o atestado local é complementar para tooling legado.)

## Console de release

O repositório é público e main exige PR e check remoto build-and-unit verde. Este console e scripts/prod/release-gate.ps1 pertencem ao fluxo Windows legado: o atestado npm run ci protege esse caminho, mas não substitui o check remoto nem publica o site público no VPS.

`GET /api/release` mostra:

- o commit publicado (`gitSha` de `deploy/prod-artifacts/manifest.json`) e a data;
- o commit local (`HEAD`), a branch e se ha arquivo nao commitado;
- os commits pendentes entre o publicado e o `HEAD`, com o PR de origem e marca de
  `agente` quando vieram de uma branch `fix/auto-N`;
- os checks obrigatorios do CI para o `HEAD`;
- as migrations que entram no deploy;
- a release anterior disponivel para rollback.

O deploy e **recusado** (HTTP 409) quando:

| Impedimento | Motivo |
|---|---|
| `head-fora-do-main` | o commit local nao esta em `origin/main` — falta merge do PR |
| `working-tree-suja` | ha arquivo nao commitado (o painel lista os caminhos) |
| `ci-local-ausente` | sem `deploy/.local-ci-attestation.json` — rode `npm run ci` |
| `ci-local-desatualizado` / `ci-local-falhou` | atestado de outro SHA ou sem sucesso |
| `migrations-sem-confirmacao` | ha migration nova e falta o aceite explicito na tela |
| `git-indisponivel` | nao da para ler o repositorio (unico impedimento sem override) |

A prova de qualidade e o atestado gerado por `npm run ci` para o SHA de `HEAD`.

O override existe para hotfix, exige motivo, e o motivo vai para `deploy/logs/ops-panel.log`
junto com todos os impedimentos ignorados.

A regra do gate e uma funcao pura testada em `src/release.test.mjs`:

```powershell
npm run ops:test
```

### Roteiro no painel

O console de release mostra um **roteiro numerado** (passos 1–4):

1. **Verificar release** no painel — sincroniza `main` com `origin/main` automaticamente (checkout + pull) quando a working tree esta limpa
2. Working tree — lista arquivos sujos e o que fazer
3. CI / gate — atestado de `npm run ci`
4. Campo **DEPLOY** — habilita o botao **Liberar deploy** (sem `prompt()` do navegador)

Apos o deploy, o **Passo 5 (smoke)** roda sozinho: `/api/ready`, frontend, manifest e amostra de logo.

No terminal, antes de abrir o painel:

```powershell
npm run prod:ready
```

## Rollback

`scripts/prod/rollback.ps1` devolve os artefatos da release anterior, preservada em
`deploy/prod-artifacts.previous` a cada `prod:deploy`. O `node_modules` vai junto, entao
voltar nao exige `npm ci` — leva segundos.

O rollback e reversivel: a release que sai do ar toma o lugar da anterior, entao rodar
duas vezes devolve o estado inicial.

**O banco nao volta.** Migration aplicada continua aplicada; para isso, restaure o dump
de `deploy/backups`.

## Desenvolvimento

```powershell
cd ops-panel
npm run dev
```

Para testar numa porta alternativa sem interferir na instancia real:

```powershell
$env:OPS_PANEL_PORT='3096'; node src/server.mjs
```

O painel nao sobrescreve `deploy/runtime/ops-panel.pid` quando o pid registrado
pertence a outro processo vivo.
