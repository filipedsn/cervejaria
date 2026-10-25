# Outside-in monitoring — Quiver Tap

Este documento descreve os checks externos vigentes sem duplicar o inventário do [handoff interno](../../docs/handoff-vps-hostinger-arquiteto.md).

## Ambientes

- **PRD pública:** atende clientes no VPS e pode ser monitorada externamente.
- **DEV:** somente local no PC (http://localhost:5202, API http://localhost:3002). Não há endpoint DEV público oficial nem tunnel vigente; serviços externos não conseguem monitorar localhost.
- Qualquer monitor, alerta ou URL de DEV que ainda cite tapdev.quivercloud.com.br é **legado** e não representa a disponibilidade atual do DEV.

## UptimeRobot — PRD

Os checks externos abaixo cobrem apenas a produção pública:

| Nome | URL | Intervalo | Alerta |
|---|---|---|---|
| Quiver Tap PRD ready | https://tap.quivercloud.com.br/api/ready | 5 min | E-mail UptimeRobot |
| Quiver Tap PRD UI | https://tap.quivercloud.com.br/ | 5 min | E-mail UptimeRobot |

Configuração sugerida:

- **Monitor type:** HTTP(s)
- **Keyword:** opcional — corpo contém status ok ou status HTTP 200
- **Alert contacts:** equipe de operações

Não crie monitor público para DEV. Para validar DEV, use o browser local e a API em localhost.

## Webhook opcional

Falhas de monitoramento externo podem ser encaminhadas ao fluxo de alertas conforme a configuração vigente de observabilidade. Nunca coloque tokens, segredos ou credenciais neste documento; detalhes operacionais restritos ficam no handoff e nos arquivos locais de configuração.
