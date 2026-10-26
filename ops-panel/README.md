# Quiver Tap Ops

Painel local, numa tela só, para saber em que pé está a entrega e agir sem abrir GitHub, terminal ou VPS.
Roda no PC em `http://127.0.0.1:3099` e só atende o navegador desta máquina.

```powershell
npm run ops:open      # sobe o painel se estiver parado e abre o navegador
npm run ops:status    # rodando, parado, painel antigo na porta ou porta ocupada
npm run ops:stop
npm run ops:restart
```

Requisitos: Node, `git` e o `gh` logado (`gh auth status`) com acesso ao repositório.

## O que a tela mostra

1. **Veredito**: uma frase com o estado mais grave e, ao lado, a próxima ação recomendada.
2. **Trilho da entrega**: Local, Pull request, main (CI + build), Aprovação, Produção. A estação acesa é onde a entrega está.
3. **Quatro cartões**:
   - **Git**: branch, à frente/atrás da main, PRs abertos com o CI de cada um.
   - **DEV**: API `:3002`, web `:5202`, containers do Postgres e Elasticsearch, versão em execução.
   - **Esteira**: últimos runs do Deploy PRD (VPS) e o deploy que aguarda aprovação.
   - **Produção**: health e versão públicos; com o relatório do VPS, também container, banco, disco, último backup e histórico de deploy.
4. **Ações feitas pelo painel**: registro em `deploy/logs/ops-panel.log` (JSONL).

O estado vem de `src/state.mjs`, uma função pura testada em `src/state.test.mjs` (`npm run ops:test`).

## Ações

Lista fechada em `src/actions.mjs`; o servidor revalida os parâmetros e executa uma ação por vez.

| Ação | Confirmação | O que roda |
|---|---|---|
| Ligar / Desligar / Reiniciar DEV | desligar e reiniciar pedem confirmação | `scripts/dev/supervisor.ps1`, `scripts/dev/stop-dev.ps1` |
| Mergear PR | modal com commits e migrations | `gh pr merge --squash`, só com `build-and-unit` verde, mergeável e fora de rascunho |
| Aprovar / Rejeitar deploy | modal com o que muda em produção | `pending_deployments` do run que aguarda o environment `production` |
| Publicar / rollback | escolhe um commit da main e vê o que entra ou sai | `gh workflow run deploy-vps.yml` (com `sha` quando não é o HEAD); o run para aguardando aprovação |

O painel não faz deploy sozinho: todo caminho até produção passa pela esteira e por uma aprovação humana.
Migration destrutiva continua bloqueada pela esteira (`allow_destructive` só pelo GitHub).

## Segurança

- Escuta só em `127.0.0.1`; recusa Host e Origin que não sejam desta porta.
- POST exige o header `x-ops-panel: 1`, que uma página de outra origem não consegue enviar sem preflight CORS.
- Usa as credenciais do `gh` já logado no PC; o painel não guarda token.

## Relatório do VPS (opcional)

Sem configuração, o cartão Produção usa só `https://tap.quivercloud.com.br/api/health` e `/api/ready`.
Para ver container, banco, disco, backup e histórico de deploy:

1. No VPS (com autorização), instale `deploy/tap-quiver/ops-report.sh` em `/usr/local/sbin/quiver-tap-ops-report`
   e cadastre uma chave exclusiva do painel em `authorized_keys` com
   `restrict,command="/usr/local/sbin/quiver-tap-ops-report"`. A chave não abre shell e o script não altera nada.
2. No PC, crie um host no `~/.ssh/config` que use essa chave pela Tailscale e informe o nome em
   `OPS_VPS_SSH_HOST` no `ops-panel/.env`.

## Configuração

`ops-panel/.env` (copiado de `.env.example` no primeiro `ops:start`):

| Variável | Padrão | Uso |
|---|---|---|
| `OPS_PANEL_PORT` | `3099` | porta do painel; não há fallback para outra porta |
| `GITHUB_REPO` | `filipedsn/cervejaria` | repositório consultado pelo `gh` |
| `OPS_VPS_SSH_HOST` | vazio | host SSH da chave só leitura; vazio = só dados públicos |
| `OPS_PANEL_AUDIT_LOG` | `deploy/logs/ops-panel.log` | registro das ações |

## Desenvolvimento

```powershell
cd ops-panel
npm run dev                                      # node --watch
npm run test:unit
$env:OPS_PANEL_PORT='3096'; node src/server.mjs  # segunda instância sem tocar na 3099
```
