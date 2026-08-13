# Roteiro de validação — observabilidade Quiver Tap

## Pré-requisitos

```powershell
npm run obs:up
npm run obs:index-defaults
npm run obs:ilm
npm run obs:configure
npm run obs:connectors   # após preencher deploy/observability/.env.connectors
```

## Orçamento (antes/depois de mudanças)

```powershell
npm run obs:budget
```

Verifique que `metrics-generic.otel-dev` não cresce desproporcionalmente vs `otel-prd`.

## Segregação DEV/PRD

```powershell
npm run obs:verify
```

Gere tráfego em dev (`npm run qa:test` ou uso manual em `:5202`) e confirme:

| Sinal | Índice DEV | Índice PRD |
|-------|------------|------------|
| Métricas | `metrics-generic.otel-dev*` | `metrics-generic.otel-prd*` |
| Audit | `logs-audit_*.otel-dev` | `logs-audit_*.otel-prd` |
| Traces | `traces-*.otel-dev` | `traces-*.otel-prd` |
| Infra | — | `metrics-infra.otel-infra*` |

## UI / cliques

1. Abra uma comanda no quiosque e clique em **Confirmar pagamento**.
2. No Kibana Discover (Audit PRD ou DEV), filtre `attributes.event.action: ui.click`.
3. Confirme label semântico `quiosque-confirmar-pagamento` quando `data-audit` presente; fallback genérico para outros botões.

## Transações de negócio (quiosque)

Após abrir caixa, fechar comanda ou movimentar estoque:

- Discover Audit → `attributes.event.action: transacao.quiosque_*`

## Healthchecks

Após ~2 min com collector reiniciado:

- Discover → data view **Metrics Infra** → métricas `httpcheck.*`
- Alertas `quiver-tap-api-ready-down-prd` e `quiver-tap-telemetry-gap-prd` devem avaliar sem erro em Stack Management → Rules.

## Relatório 4xx

```powershell
npm run obs:report-4xx
```
