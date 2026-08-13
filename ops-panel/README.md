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

## Agente de suporte autonomo

Secao **Agente de suporte autonomo** no painel:

- **KPI geral** (0–100): processo, Elasticsearch, frescor do ultimo poll, dry-run, kill switch, GitHub
- **Toggles** com descricao para cada parametro:
  - Monitoramento continuo (liga/desliga o processo)
  - Modo sombra, dry-run, fixer, kill switch, metricas OTLP
- Alterar parametro grava `support-agent/.env` e reinicia o agente se ele estiver rodando

API: `GET /api/support-agent`, `PATCH /api/support-agent` (JSON com `monitoring`, `shadow`, `dryRun`, `fixerEnabled`, `killSwitch`, `otlpMetrics`).
Acoes destrutivas ainda pedem confirmacao digitada (`DEPLOY`, `ROLLBACK`, `SYNC-DEV`).
Uma pagina em outra origem nao consegue disparar essas acoes (checagem de Origin).

`OPS_PANEL_TOKEN` so e necessario se o painel for acessado de fora do localhost.

## GITHUB_TOKEN (necessario para liberar deploy)

Defina `GITHUB_TOKEN` em `ops-panel/.env` (PAT com leitura do repo). Sem ele o painel
mostra o status do CI como indisponivel e **o gate de release recusa o deploy**: nao ha
como provar que os testes passaram, e "nao sei" nao vira "pode ir".

## Console de release

O repositorio esta no plano Free do GitHub, que nao tem branch protection. A regra "so
vai para producao o que esta em `origin/main` com CI verde" e aplicada aqui, no caminho
do botao de deploy.

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
| `working-tree-suja` | ha arquivo nao commitado, e o `deploy.ps1` compila a working tree |
| `ci-nao-verificavel` | sem `GITHUB_TOKEN` ou com erro na API do GitHub |
| `check-ausente` / `check-rodando` / `check-falhou` | um check obrigatorio nao passou |
| `migrations-sem-confirmacao` | ha migration nova e falta o aceite explicito na tela |
| `git-indisponivel` | nao da para ler o repositorio (unico impedimento sem override) |

Checks obrigatorios padrao: `frontend`, `backend-validate`, `backend-test`,
`support-agent-test`, `ops-panel-test`. Ajuste com `OPS_PANEL_REQUIRED_CHECKS`
(lista separada por virgula). `backend-build` fica fora porque tem `continue-on-error`
no workflow enquanto os erros de `tsc` pre-existentes nao forem zerados.

O override existe para hotfix, exige motivo, e o motivo vai para `deploy/logs/ops-panel.log`
junto com todos os impedimentos ignorados.

A regra do gate e uma funcao pura testada em `src/release.test.mjs`:

```powershell
npm run ops:test
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
