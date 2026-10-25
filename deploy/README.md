# Quiver Tap — deploy e segregação DEV/PRD

## Fonte da verdade

A arquitetura e o estado operacional canônicos estão no [handoff interno](../docs/handoff-vps-hostinger-arquiteto.md). Este README resume o fluxo sem replicar dados de acesso, IPs privados, paths de env ou inventários de chaves.

- **PRD pública:** VPS Hostinger; aplicação e Postgres em Docker; Cloudflare proxy → nginx → aplicação.
- **DEV oficial:** PC Windows; aplicação Node local, frontend Vite e serviços de desenvolvimento locais.
- PRD não depende do PC ligado. Não conecte serviços de DEV a banco, Elasticsearch, URL ou credenciais de PRD.

## Ambientes

| | DEV (PC local) | PRD pública (VPS) |
|---|---|---|
| Aplicação | API Node nativa | Docker |
| API | `:3002` | `:3001` no host do VPS |
| Frontend | Vite `:5202` | Build servido pela aplicação |
| Postgres | Docker local, `:5432` e/ou `:5434` conforme compose | Docker no VPS |
| Elasticsearch/Kibana | Cluster Docker local | Cluster separado no VPS |
| URL de uso | `http://localhost:5202` | `https://tap.quivercloud.com.br` |

A API DEV ainda não está em Docker. Não descreva essa equalização como concluída. `tapdev.quivercloud.com.br` e o tunnel Cloudflare para DEV não são caminhos vigentes.

## Fluxo Git e checks

1. Atualize `origin/main` e crie uma branch própria.
2. Faça mudanças e valide no DEV local quando houver efeito visível.
3. Abra PR contra `main`.
4. O GitHub Actions `build-and-unit` é obrigatório para merge, conforme branch protection.
5. `npm run ci` local é complementar: cobre verificações adicionais de Windows e grava um atestado usado pelo tooling Windows legado.
6. Faça squash and merge após o check remoto verde.

O fluxo completo está em [CONTRIBUTING.md](../CONTRIBUTING.md).

## Publicação em produção pública

O publisher vigente é o **VPS**. Hoje a publicação é manual via SSH/Tailscale; o runbook do workflow de CD futuro está no handoff §7.1. Exija autorização humana explícita para cada deploy. Não altere secrets, ACLs, chaves ou infraestrutura como parte de uma publicação documental.

`deploy.cmd`, `scripts/prod/deploy.ps1`, o watchdog Windows e os auxiliares Cloudflared foram mantidos por compatibilidade/histórico. São **legados** e não publicam `tap.quivercloud.com.br`. Não reative o tunnel do Tap no PC, não exponha portas administrativas e não use comandos Windows de produção para publicar o site público.

## Publicação do pacote de DEV

O DEV oficial usa um pacote local em `deploy/dev-artifacts`; editar arquivos não atualiza a tela. Quando uma publicação de DEV for necessária, use o processo e os scripts documentados em [CONTRIBUTING.md](../CONTRIBUTING.md), com origem em commit enviado ao GitHub. O frontend/API de DEV usam localhost nas portas `:5202` e `:3002`.

## Artefatos Windows legados

O tooling de release local separa os artefatos de build em `frontend/dist`, `backend/dist` e os artefatos históricos de publicação Windows. O atestado `deploy/.local-ci-attestation.json` continua necessário para esse caminho legado; ele não substitui o check remoto obrigatório para merge.

## Observabilidade

DEV e PRD usam clusters Elasticsearch separados. Configurações e ferramentas de observabilidade local não devem apontar para PRD. Consulte o handoff interno para os limites operacionais.
