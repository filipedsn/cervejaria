# Outside-in monitoring — Quiver Tap

Kibana Synthetics exige `locations` Elastic Cloud ou **private location** — em stack local Basic, use **httpcheck do collector** + **UptimeRobot** (abaixo).

## Camadas

| Camada | O quê valida | Onde |
|--------|----------------|------|
| **Collector httpcheck** | DNS + Cloudflare + tunnel + origin | `deploy/observability/otel-collector-config.yml` |
| **Kibana Uptime** | Mesmas URLs públicas | `kibana-uptime-monitor-*.json` |
| **UptimeRobot** (externo) | Geo externo, independente do host | Este documento |

## UptimeRobot (recomendado)

Conta gratuita: [https://uptimerobot.com](https://uptimerobot.com)

### Monitores a criar

| Nome | URL | Intervalo | Alerta |
|------|-----|-----------|--------|
| Quiver Tap PRD ready | `https://tap.quivercloud.com.br/api/ready` | 5 min | E-mail UptimeRobot |
| Quiver Tap DEV ready | `https://tapdev.quivercloud.com.br/api/ready` | 5 min | E-mail UptimeRobot |
| Quiver Tap PRD UI | `https://tap.quivercloud.com.br/` | 5 min | E-mail UptimeRobot |

Configuração sugerida:

- **Monitor type:** HTTP(s)
- **Keyword:** opcional — corpo contém `"status":"ok"` ou status HTTP 200
- **Alert contacts:** equipe de operações

### Webhook opcional (unificar alertas)

Se quiser que falhas do UptimeRobot apareçam no mesmo índice `quiver-tap-alert-events`:

1. Crie um monitor com **Alert Contacts → Webhook**
2. URL: endpoint interno que grava no ES (requer proxy seguro) **ou** use apenas o e-mail do UptimeRobot
3. Licença Kibana Basic não expõe webhook nativo nas regras — o fluxo principal continua sendo connector `.index` + alert poller worker

## Cloudflare Health Checks (alternativa)

Se o tunnel estiver no Cloudflare Zero Trust:

1. Dashboard Cloudflare → **Traffic** → **Health Checks**
2. Target: `https://tap.quivercloud.com.br/api/ready`
3. Notificações via e-mail ou PagerDuty

Vantagem: integrado ao tunnel. Desvantagem: não cobre falhas de DNS fora da Cloudflare.

## O que outside-in **não** substitui

- **Postgres:** tcpcheck no collector (`host.docker.internal:5432` / `:5434`)
- **Alertas de negócio / SLO:** métricas `quiver.*` e audit no Elasticsearch
- **Processo cloudflared:** watchdog local em `scripts/prod/ensure-running.ps1`

## Referências no repositório

- SLI/SLO: `deploy/observability/sli-slo.yml`
- Alertas públicos: `kibana-alert-public-ready-down-*.json`
- Relatório SLO: `npm run obs:report-slo`
- Worker de alertas (independente da API): `npm run alert-poller:start`
