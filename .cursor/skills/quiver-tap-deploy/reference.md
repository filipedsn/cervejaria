# Quiver Tap — referência de ambientes e publicação

## Ambientes vigentes

| Recurso | DEV (PC local) | PRD (VPS) |
|---|---|---|
| Aplicação | API Node nativa | Docker |
| Frontend | Vite em `:5202` | Build servido pela aplicação |
| API | `:3002` | `:3001` no host do VPS |
| Postgres | Docker local, `:5432` e/ou `:5434` conforme o compose | Docker no VPS |
| Elasticsearch | Cluster Docker local | Cluster separado no VPS |
| Acesso | `http://localhost:5202` | `https://tap.quivercloud.com.br` |

DEV nunca usa Postgres, Elasticsearch, `APP_URL` ou credenciais do VPS. Os clusters de Elasticsearch são físicos e distintos. Não publique detalhes de acesso administrativo; consulte o [handoff interno](../../../docs/handoff-vps-hostinger-arquiteto.md) quando necessário.

## Comandos locais de DEV

```powershell
npm run dev:start
npm run dev:status
npm run dev:stop
```

## Fluxo de entrega

1. Criar branch a partir da `origin/main` atualizada.
2. Abrir PR contra `main`; merge exige o check remoto `build-and-unit` verde.
3. `npm run ci` local é complementar e mantém a cobertura Windows/atestado legado.
4. Produção pública é publicada no VPS via SSH/Tailscale, hoje manualmente, sempre com autorização explícita. Consulte [§7.1 do handoff](../../../docs/handoff-vps-hostinger-arquiteto.md).

## Caminho Windows legado

`deploy.cmd`, `scripts/prod/deploy.ps1`, watchdog e auxiliares Cloudflared permanecem apenas para compatibilidade/histórico. Eles **não** publicam `tap.quivercloud.com.br`. Não use o fluxo Windows como deploy da produção pública.
