# Certificação pós-remodelamento — observabilidade

Escopo DEV, sem mudança em PROD. A arquitetura conserva três fluxos lógicos:

- `logs-audit*.otel-{dev|prd}`: ações de usuário, autorização e auditoria de negócio;
- `logs-technical*.otel-{dev|prd}`: logs técnicos, falhas 5xx e sinais Prisma;
- traces OTel: execução backend correlacionada por `trace_id`/`span_id`.

O frontend cria um `X-Correlation-Id` por chamada via `api.ts`. O Fastify o valida,
devolve e o propaga aos eventos de auditoria e logs técnicos. Eventos explícitos de
UI usam somente `data-audit`; page views, submits semânticos e resultados HTTP são
centralizados no tracker. O tracker não lê texto arbitrário do DOM, conteúdo digitado
ou credenciais. Auditoria registra `actor.id` e `actor.role`, nunca nome ou e-mail.

## Consulta operacional (ES|QL)

Troque os filtros conforme a investigação. A consulta retorna quando, empresa, ator,
ação, tela/rota, resultado e os identificadores de correlação sem exigir o índice
interno por tenant.

```esql
FROM logs-audit*.otel-dev*, logs-technical*.otel-dev*
| WHERE attributes.cervejaria.id == "<tenant-id>"
  AND attributes.actor.id == "<user-id>"
| KEEP @timestamp, attributes.event.action, attributes.event.outcome,
       attributes.cervejaria.id, attributes.actor.id, attributes.actor.role,
       attributes.ui.page, attributes.http.route,
       attributes.http.response.status_code, attributes.correlationId,
       trace_id, span_id, message
| SORT @timestamp DESC
```

Para reconstruir uma ação específica, localize o `attributes.correlationId`, filtre
ambos os streams por esse valor e, quando houver, continue pelo `trace_id`. Erros de
autorização usam `event.outcome=failure` e possuem a mesma cadeia de contexto.

## Validação mínima DEV

1. Login, abrir caixa, criar/vender/pagar e fechar registram eventos audit e HTTP.
2. Uma ação administrativa negada registra `failure` com ator, tenant, rota e
   correlação, sem PII ou segredos.
3. Nenhum evento do tracker contém password, token, cookie, Authorization, e-mail,
   endereço, telefone ou texto digitado.
