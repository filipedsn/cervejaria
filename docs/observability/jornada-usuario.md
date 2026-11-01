# Jornada do usuário — quem, o quê, onde (TAP-160)

Registro da jornada de funcionários e clientes no Tap: telas visitadas, ações, buscas, erros de interface, desempenho percebido (web vitals) e local aproximado, para suporte e segurança.

## Decisão do Filipe (2026-11-01)

- Guardar o **IP completo** e a localização aproximada derivada dele (cidade, estado, país).
- Guardar **nome e e-mail do funcionário** junto do id e dos papéis.
- O agente de suporte lê todos esses campos.
- Retenção da auditoria em PRD: **180 dias** (Marco Civil da Internet, art. 15: guarda de registros de acesso a aplicações por 6 meses).
- **Nunca** capturar senha, cartão, token nem qualquer valor digitado, exceto o termo de campos de busca marcados.

## O que é coletado

Todo evento de auditoria (`event.category: audit`) vai para o data stream `logs-audit.otel-<env>` com os campos como chaves pontuadas dentro de `attributes`:

| Grupo | Campos |
| --- | --- |
| Quem | `user.id`, `user.name`, `user.email`, `user.roles`, `actor.type`, `session.id` (nos traces: `enduser.id`, `enduser.role`) |
| O quê | `event.action` (`ui.page_view`, `ui.click`, `ui.submit`, `ui.search`, `ui.web_vital`, `ui.error`, `http.request.completed`, ações de negócio), `event.description`, `ui.label`, `ui.element`, `ui.search.term` |
| Onde (tela) | `ui.route` (template, ids viram `:id`), `ui.page`, `ui.viewport` (`LxA`), `http.route` |
| Desempenho | `ui.vital.name` (LCP, CLS, INP, TTFB, FCP), `ui.vital.value` (double; CLS sem unidade, demais em ms), `ui.vital.rating` |
| Erros | `error.message`, `error.type`, `error.stack_trace` |
| Rede e dispositivo | `client.address`, `client.ip_source` (`cloudflare`, `nginx`, `socket`), `user_agent.original` |
| Enriquecido no ES | `client.geo.city_name`, `client.geo.region_name`, `client.geo.country_iso_code`, `client.geo.country_name`, `client.geo.location` (geo_point), `user_agent.name`, `user_agent.version`, `user_agent.os.name`, `user_agent.device.name`, `enrich.error` |

### IP confiável

`backend/src/lib/client-network.ts` só confia em cabeçalhos quando o par TCP é loopback (nginx local). Em PRD a cadeia é Cloudflare → nginx (`X-Real-IP`) → API: `cf-connecting-ip` e `cf-ipcountry` só valem quando `X-Real-IP` está nas faixas da Cloudflare (padrão embutido, sobrescrevível por `TAP_CLOUDFLARE_IP_RANGES`). Cabeçalhos vindos de outro par são ignorados. No DEV o IP é loopback e não gera localização.

### Frontend

`frontend/src/lib/audit-tracker.ts` e `audit-journey.ts`:

- cliques em botões, links e controles com o nome acessível (aria-label, title, texto visível, label ou placeholder; nunca o valor digitado); `data-audit-ignore` exclui um elemento;
- mudança de `<select>` registra o nome do campo e a opção escolhida;
- buscas: só campos com `data-audit-search`, `type="search"` ou placeholder de busca, nunca senha/cartão; debounce de 800 ms ou Enter;
- `page_view` com viewport e tempo desde a tela anterior;
- web vitals via `PerformanceObserver`, enviados ao ocultar/fechar a página (`sendBeacon`);
- erros de React (`AuditErrorBoundary`) e erros globais com mensagem, tipo e stack;
- `session.id` por aba (`sessionStorage`), renovado após login.

Campos de busca marcados com `data-audit-search`: busca de comandas (Comandas e Operação), seleção de cliente na operação, contas pendentes, unir cliente, clientes, estoque da operação e QR do portal no PDV.

### Sanitização no servidor

`backend/src/routes/audit.ts` valida tamanhos, remove caracteres de controle e troca por `[REDACTED]` sequências longas de dígitos (13 a 19, como cartão ou telefone) e tokens de 32+ caracteres com letras e dígitos, em rótulos, termos de busca, mensagens e stacks.

## Onde ver

Kibana (DEV `http://localhost:5601`; PRD pela Tailscale):

- Dashboard **Jornada do usuário — quem, o quê, onde** (`quiver-tap-jornada-<env>`): usuários ativos, eventos por tela, top ações, erros por tela, mapa por local, eventos por cidade, web vitals p75 por tela e a busca por usuário.
- Buscas salvas: **Jornada por usuário** (filtrar por `attributes.user.name` ou `attributes.session.id`), **Erros de interface**, **Buscas**.
- Data view `quiver-tap-audit-<env>` (`logs-audit*.otel-<env>`); convive com o data view anterior `quiver-audit-<env>`.
- Regra `quiver-tap-ui-error-surge-<env>`: mais de 5 `ui.error` na mesma tela em 10 minutos. Criada sem ações; conectores são configurados à parte.

## Como aplicar

```powershell
# Pipeline de enriquecimento e mapping (geo_point e double)
node scripts/observability/audit-enrich-pipeline.mjs --target dev --simulate
node scripts/observability/audit-enrich-pipeline.mjs --target dev --apply
# Templates com index.final_pipeline + rollover
node scripts/observability/apply-retention.mjs --target dev --apply --rollover
# Saved objects e regra
node scripts/observability/jornada-kibana.mjs --env dev --write
powershell -File scripts/observability/configure-jornada.ps1 -Target dev
```

Em PRD os mesmos passos exigem `--confirm-prd` / `-ConfirmPrd` e autorização explícita. Os artefatos PRD (`kibana-jornada-dashboard-prd.ndjson`, `kibana-alert-ui-error-surge-prd.json`) são gerados pelo `jornada-kibana.mjs --env prd --write` no momento da aplicação.

O pipeline `quiver-tap-audit-enrich` roda como `index.final_pipeline` de `quiver-tap-logs-dev`, `quiver-tap-logs-prd` e `quiver-tap-audit-prd`. Falhas de enriquecimento nunca descartam o documento: ficam em `attributes.enrich.error`. As bases GeoIP do ES são baixadas automaticamente depois que existe um pipeline com `geoip`.

## Retenção

- `logs-audit.otel-prd`: 180 dias (template `quiver-tap-audit-prd`).
- DEV: 7 dias, como os demais logs DEV (`quiver-tap-logs-dev`).

## Pendências

- Não existe página de política de privacidade ou termos no frontend. Quando existir, incluir: coleta de IP, localização aproximada, dispositivo e interações para suporte e segurança, guardados por 6 meses (Marco Civil, art. 15).
