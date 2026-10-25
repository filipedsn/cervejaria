---
name: quiver-tap-environments
description: Explica a segregação entre DEV local e produção no VPS do Quiver Tap.
---

# Quiver Tap — ambientes DEV e PRD

## Resumo

- **DEV:** PC Windows do Filipe; API Node local, Vite e serviços de desenvolvimento locais.
- **PRD:** VPS Hostinger; aplicação e Postgres em Docker. O endereço público aponta para essa produção.
- São máquinas e serviços distintos. Nunca direcione DEV para banco, Elasticsearch, URL de aplicação ou credenciais do VPS.

## Mapa atual

| Recurso | DEV (local) | PRD |
|---|---|---|
| Aplicação | Node nativo no PC | Docker no VPS |
| API | `http://localhost:3002` | serviço no host do VPS |
| Frontend | `http://localhost:5202` | `https://tap.quivercloud.com.br` |
| Postgres | Docker local, `:5432` e/ou `:5434` conforme compose; nunca VPS | Docker no VPS |
| Elasticsearch/Kibana | Cluster Docker local | Cluster separado no VPS, operações privadas |
| Publicação | Não publica clientes | VPS via SSH/Tailscale hoje; autorização explícita |

A API DEV ainda roda em Node nativo; **não** documente como containerizada. Equalizar a API DEV em Docker permanece pendente.

## Comandos DEV

```powershell
npm run dev:start
npm run dev:status
npm run dev:stop
```

Valide no frontend `http://localhost:5202` e na API `http://localhost:3002`. O DEV oficial deste ciclo é local; `tapdev.quivercloud.com.br` e tunnel Cloudflare para DEV são legados/removidos, não um caminho vigente.

## Regras de produção

- A produção pública é independente do PC e não depende do PC ligado.
- Não reative o tunnel do Tap no PC nem exponha portas administrativas.
- Mudança pública só no VPS, após PR mergeada com o check remoto `build-and-unit` verde e autorização explícita.
- `deploy.cmd` e `scripts/prod/deploy.ps1` são legados Windows; não publicam o site público.

Para detalhes de operação, use [CONTRIBUTING.md](../../../CONTRIBUTING.md) e linke o [handoff interno](../../../docs/handoff-vps-hostinger-arquiteto.md), sem copiar dados de acesso ou paths de credenciais.
