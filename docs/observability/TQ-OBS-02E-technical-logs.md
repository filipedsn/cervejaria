# TQ-OBS-02E — Logs técnicos Pino até Elasticsearch

Data: 2026-08-29. Escopo: DEV/local e arquivos versionados. PROD não foi consultada, alterada ou reiniciada.

## Resultado e pipeline

Antes desta alteração a configuração de DEV e PROD já habilitava o envio Pino (`ELASTIC_OTEL_NODE_ENABLE_LOG_SENDING=true`, `OTEL_LOGS_EXPORTER=otlp`) e o collector tinha um pipeline OTLP de logs. A evidência local mostra documentos em `logs-generic.otel-dev*` e `logs-generic.otel-prd*`. Portanto, os logs técnicos Pino chegavam de forma **PARCIAL**: havia entrega genérica, sem uma rota técnica explícita e verificável por aplicação.

O fluxo agora é:

`Fastify/Pino (stdout + instrumentação EDOT) → OTLP HTTP :4318 → edot-collector → Elasticsearch (mapping otel)`.

O logger Pino declara `data_stream.dataset=technical` em cada log técnico; os eventos audit já sobrescrevem esse campo com `audit-*`. Assim o exporter dinâmico usa o atributo do próprio LogRecord, sem mutar o recurso compartilhado de uma requisição. O destino técnico é `logs-technical.otel-dev*` ou `logs-technical.otel-prd*`; audit permanece em `logs-audit*.otel-{dev|prd}`. Traces e business events continuam seus pipelines existentes, e não são logs técnicos.

## Contrato dos logs

- `info`: operação técnica relevante; `warn`: condição recuperável; `error`: falha que afetou uma operação/request; `fatal`: processo incapaz de continuar.
- Exceções sem status conhecido geram exatamente um `error` estruturado 500 com `requestId`, `correlationId`, `method`, `route`, `statusCode`, `durationMs` e `err` (nome, mensagem e stack serializados pelo Pino).
- Erros 4xx esperados retornam o contrato HTTP normal e não passam pelo log técnico 500; os eventos semânticos de auth e o audit HTTP continuam aplicáveis.
- O contexto por request inclui, quando disponível, serviço, ambiente, usuário, papel e cervejaria. A versão/release permanece no atributo de recurso OTel já configurado (`service.version`); nenhum SHA foi inventado.
- O logger redige recursivamente authorization, cookie, JWT/token, senha, secret, API key e connection string. Corpo de request não é logado pelo logger técnico por padrão.

## Volume e fail-safe

O novo dataset recebe os logs que o Pino já emitia; não adiciona log por query, loop ou segundo evento de stack. Em produção, `LOG_LEVEL=info`, portanto `debug` fica fora. A retenção é 30 dias via a mesma política de logs e `npm run obs:budget` agora mostra o volume técnico isoladamente.

O stdout continua sendo a destination primária do Pino. O envio EDOT/OTLP é assíncrono; indisponibilidade de collector/Elasticsearch não participa do caminho de resposta Fastify, não cria retry bloqueante e não derruba a API.

## Como detectar falhas do pipeline

1. Collector: `docker compose -f docker-compose.observability.yml ps` e `docker logs quiver-edot-collector`.
2. Endpoint OTLP/Elastic/Kibana: `npm run obs:kibana`.
3. Ingestão e crescimento por índice: `npm run obs:budget`, observando `logs-technical.otel-{dev|prd}*`.
4. Em Discover, filtre `correlationId`, `requestId`, `route` ou `err.message` no data view `logs-*.otel-{dev|prd}`; o mesmo `correlationId` permite cruzar o log técnico com `logs-audit*.otel-{dev|prd}`.

Sem alertas novos: estes procedimentos apenas tornam a falha detectável.

## Validação DEV persistente — TQ-OBS-02E1

Em 2026-08-30, a API DEV normal na porta 3002 recebeu um 500 controlado com correlation ID `0c6bd9b8-9a50-4768-95ea-629b5912cb1c`. O Elasticsearch retornou um único evento técnico `error` em `logs-technical.otel-dev*`, com request ID, método `GET`, rota, status 500, duração, serviço, ambiente, mensagem e stack da exceção. O mesmo request também gerou o log padrão de conclusão HTTP em nível `info`; ele não é uma cópia equivalente do erro técnico. O documento não continha Authorization, cookie, JWT, senha, token, connection string nem body de request.

A validação revelou e corrigiu uma falha do primeiro roteamento: promover o dataset do LogRecord para o recurso compartilhado fazia o erro seguir para o índice audit quando o evento audit da mesma request era emitido depois. A atribuição do dataset no próprio logger elimina essa contaminação.
