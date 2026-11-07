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
| Cenário funcional (TAP-179) | `metadata.context` (onde estava: comanda, mesa, cliente, totais) e `metadata.intent` (o que queria: `summary`, itens, pagamentos); ver seção abaixo |
| Erros semânticos (TAP-177) | `metadata.handled`, `metadata.kind` (`network`\|`api_client`\|`api_server`\|`validation`\|`ui_bug`\|`unknown`), `metadata.feature`, `metadata.operation`, `metadata.scenario`, `metadata.httpStatus`, `metadata.apiCode`, `metadata.entityType`/`entityId`; correlacionar com `correlationId` / `interactionId` |
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
- erros de React (`AuditErrorBoundary`) e erros globais com mensagem, tipo e stack (`handled=false`);
- erros tratados exibidos ao usuário via `reportUserFacingError` / React Query `MutationCache` (e queries com `meta.reportError` ou falha de rede/5xx), com `handled=true` e campos semânticos;
- `session.id` por aba (`sessionStorage`), renovado após login.

#### Padrão semântico de `ui.error` (TAP-177)

Todo erro que o usuário vê deve chegar ao Kibana como `event.action=ui.error` com:

| Campo | Uso |
| --- | --- |
| `metadata.handled` | `true` se tratado na UI; `false` para crash/boundary/unhandled |
| `metadata.kind` | classifica a falha (rede, API, validação, bug de UI…) |
| `metadata.feature` / `metadata.operation` | chaves estáveis da tela/ação (`comanda.detail`, `comanda.close`) |
| `metadata.scenario` | código curto filtrável (`network_unreachable`, `validation_…`) |
| `metadata.httpStatus` / `metadata.apiCode` | quando veio de `ApiError` |
| `correlationId` | liga ao `http.request.completed` da mesma tentativa |

No Discover (data view `quiver-tap-audit-<env>`), filtre por exemplo:

```text
attributes.event.action : "ui.error" and attributes.metadata.feature : "comanda.detail"
attributes.event.action : "ui.error" and attributes.metadata.scenario : "network_unreachable"
```

Alertas Telegram (`quiver-tap-ui-error-*`) **não** disparam para `handled=true` + `kind` de negócio esperado (`validation` / `api_client`); só para `handled=false`, legado sem flag, ou `kind` in `network|api_server|ui_bug`.

#### Cenário funcional completo (TAP-179)

Regra: todo log do frontend precisa responder, sem perguntar ao usuário, **onde ele estava** e **o que ele queria fazer**. Para isso todo evento (clique, busca, page view, `http.request.completed`, `ui.submit`, `ui.error`) carrega dois blocos:

| Campo | Conteúdo | Origem |
| --- | --- | --- |
| `metadata.context` | onde estava: `tela`, `resumo` ("Comanda #42 · Mesa 3 · cliente Ana"), `comandaId`, `comandaNumero`, `comandaIdentificador`, `comandaStatus`, `subtotal`, `total`, `valorEmAberto`, `itensQtd`, `clienteNome`, `eventoNome`… | a tela declara com `useAuditContext(...)`; para comanda use `comandaAuditContext(comanda)` |
| `metadata.intent` | o que queria: `summary` em português ("Incluir 2x Chopp Pilsen 300ml; 1x Batata frita (+ Cheddar)") e os detalhes (`itens[]` com produto/quantidade/volume/preço, `pagamentos[]`, `desconto`, `deixarPendente`, quantidade anterior/nova…) | a mutação declara `meta: auditMutationMeta({ feature, operation, intent: (variáveis) => ... })` |

Com isso:

- ao começar uma mutação o `MutationCache` guarda um retrato do contexto; em caso de sucesso grava `ui.submit` com `metadata.actionOutcome=success`, `durationMs` e a mensagem `Concluiu "<summary>" em <tela> [<resumo>]`; em caso de falha o `ui.error` sai com a mesma intenção (`Erro na interface em <tela> ao tentar "<summary>": <mensagem> [<resumo>]`);
- sem `entityType/entityId` explícitos, o evento herda a comanda do contexto (`entity.type=comanda`), então qualquer clique é filtrável por comanda;
- o alerta do Telegram/e-mail monta o **Cenário** com comanda e intenção e abre o **Detalhamento** com `Onde`, `Queria`, `Mensagem exibida`, campos do contexto, itens, `Correlation ID`/`Request ID`/`Sessao`; o stack vai por último, para que o corte de 4000 caracteres do Telegram só atinja o stack.

Proibido no contexto/intenção (o servidor descarta a chave): textos digitados livremente (observação, motivo), telefone, e-mail, endereço, documento, senha, token, dados de cartão. Observação só como `temObservacao: true/false`. Valores aceitos: texto (até 200 caracteres, com a mesma redação de cartão/token), número e booleano; listas apenas de objetos planos (até 30 itens × 15 campos).

Telas cobertas: detalhe da comanda na Operação (`/operacao/comandas/:id`: incluir itens, remover, alterar quantidade, fechar conta, encerrar, abrir nova, atender balcão, cliente avisado, dispensar pedido de conta) e detalhe da comanda legado (`/comandas/:id`). Nova tela ou ação: declarar `useAuditContext` e `auditMutationMeta` — mutação sem `operation` continua gerando `ui.error`, mas sem `ui.submit` de sucesso nem intenção.

O OTel grava `attributes.metadata` como **um único JSON `keyword` (`ignore_above: 1024`)**, então chaves internas não eram pesquisáveis. O emissor agora também grava como atributos próprios: `metadata.handled`, `kind`, `feature`, `operation`, `scenario`, `httpStatus`, `apiCode`, `actionOutcome`, `durationMs`, `tipo`, `comandaId`, `comandaNumero`, `eventoId`, `clienteId`, `produtoId`, e os valores simples de `metadata.context.*` e `metadata.intent.*` (listas como `itens` ficam só no JSON). Isso também faz os filtros `metadata.handled`/`metadata.kind` das regras `quiver-tap-ui-error-*` funcionarem a partir deste release (antes todo `ui.error` passava pelo ramo "sem `handled`").

```text
attributes.metadata.context.comandaNumero : 42
attributes.event.action : "ui.submit" and attributes.metadata.operation : "comanda.itens.incluir"
```

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
