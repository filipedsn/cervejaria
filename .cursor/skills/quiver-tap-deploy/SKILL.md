---
name: quiver-tap-deploy
description: Orienta deploy e publicação do Quiver Tap. Use para produção, CI/CD, tap.quivercloud.com.br ou prod:deploy.
---

# Quiver Tap — Deploy de produção

## Arquitetura vigente

- **PRD público:** VPS Hostinger, aplicação em Docker atrás do proxy Cloudflare e nginx.
- **DEV:** PC Windows, API Node local em `:3002`, Vite em `:5202`, Postgres e Elasticsearch locais.
- **Publicação de PRD:** esteira "Deploy PRD (VPS)" (`.github/workflows/deploy-vps.yml`): push na `main` roda CI + build e para no environment `production` até o humano aprovar; o deploy no VPS faz backup, sync, build, smoke e rollback automático. Enquanto a ativação Tailscale da esteira estiver pendente, o deploy é manual via SSH/Tailscale. Detalhes em [§7.1 do handoff](../../../docs/handoff-vps-hostinger-arquiteto.md).
- **`deploy.cmd` e `scripts/prod/deploy.ps1`:** fluxo Windows legado. Não publica mais `tap.quivercloud.com.br`; mantenha os arquivos, mas não os use como publisher da produção pública.

Leia [CONTRIBUTING.md](../../../CONTRIBUTING.md) e o checklist canônico do [handoff interno](../../../docs/handoff-vps-hostinger-arquiteto.md) antes de qualquer publicação. Não copie para PRs ou resumos os detalhes restritos do handoff; apenas linke o documento.

## Regras obrigatórias

1. Nunca faça deploy de produção sem autorização humana explícita para aquela publicação.
2. Merge em `main` exige PR e check remoto **`build-and-unit` verde**. `npm run ci` local é complementar.
3. Não reabra portas públicas nem recrie tunnel do Tap no PC.
4. Nunca misture DEV e PRD: app, Postgres, Elasticsearch e credenciais de cada ambiente ficam no respectivo host.
5. Não crie nem altere secrets, ACLs, chaves SSH ou configuração de infraestrutura sem solicitação explícita.
6. Não use os scripts Windows legados para publicar o site público.

## Antes do deploy de PRD

- Confirme que o PR foi mergeado em `main` e que o check `build-and-unit` passou.
- Confirme autorização explícita para a publicação no VPS.
- Siga o runbook vigente em [§7.1 do handoff](../../../docs/handoff-vps-hostinger-arquiteto.md). O deploy automático futuro continua condicionado aos secrets e ao acesso privado descritos lá.
- Não execute comandos de deploy contra o VPS durante uma tarefa somente documental.

## Desenvolvimento

Validar mudanças visuais no DEV local: frontend `http://localhost:5202`, API `http://localhost:3002`. Para iniciar e verificar, consulte [quiver-tap-environments](../quiver-tap-environments/SKILL.md). `tapdev.quivercloud.com.br` e o tunnel Cloudflare para DEV não são caminhos oficiais vigentes.

## Ferramentas Windows legadas

Os comandos de `prod:deploy`, `deploy.cmd`, rollback, watchdog e tunnel no PC permanecem no repositório por compatibilidade e histórico. Eles não são o caminho de publicação do Tap público. Não os remova nem os apresente como fluxo vigente.
