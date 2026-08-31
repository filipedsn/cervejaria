# TQ-OBS-02G - contexto de release

## Contrato

Os registros relevantes do backend usam os campos planos `releaseSha`, `service` e
`environment`. `releaseSha` e um SHA Git curto ou completo em minusculas (7 a 40
hexadecimais); `unknown` e o fallback seguro em producao. Em desenvolvimento, o
fallback explicito e `dev`, sem consulta ao repositorio.

## Fonte de verdade e deploy

Para uma release publicada, a fonte de verdade e `deploy/prod-artifacts/manifest.json`:
o campo `gitSha` identifica o artefato que esta no ar. O deploy resolve esse SHA uma
vez, antes do build, injeta-o como `RELEASE_SHA` no backend e `VITE_RELEASE_SHA` no
frontend, e passa exatamente o mesmo valor para o manifest e para o release ledger.
O bootstrap da API le somente o manifest e exporta `RELEASE_SHA` ao novo processo.
Assim, a API nao executa Git, le arquivos ou consulta servicos externos por request.

Se o manifest estiver ausente, corrompido ou contiver um valor invalido, a API inicia
normalmente com `releaseSha=unknown`. O valor nao e inventado. O deploy e rollback
continuam usando o manifest e ledger ja existentes; este ticket nao os executa nem
altera PROD.

## Backend, audit, Prisma e realtime

`backend/src/lib/release-context.ts` cria um contexto estatico no inicio do processo.
O mixin central do Pino anexa-o a todo LogRecord tecnico, inclusive eventos de Prisma
e Socket.IO. O contexto HTTP tambem adiciona os atributos a spans OTel ativos.
`buildAuditPayload` adiciona os tres campos ao pipeline central de audit, portanto
eventos HTTP, de negocio e da extensao Prisma herdam o release sem alterar cada
produtor. Os eventos `realtime.session.*` e `realtime.room.*` usam o mesmo logger.

Os valores sao somente SHA, nome de servico e ambiente; nenhum secret, token, path ou
saida de comando e registrado por esta mudanca.

## Frontend

Vite recebe `VITE_RELEASE_SHA` no build. O browser nao executa Git: o valor estatico
normalizado e enviado como `metadata.frontendReleaseSha` pelos eventos de audit da UI.
O campo canonicamente usado para a release do processo que emitiu o registro continua
`releaseSha` (o backend o define no recebimento do evento).

## Consulta Elastic em DEV

Depois de iniciar somente o ambiente DEV, gere uma requisicao e um erro controlado
pelos mecanismos de QA existentes. Em Discover, use o data view
`logs-*.otel-dev` e uma consulta como:

```text
releaseSha : * and service : "quiver-tap-api" and correlationId : "<uuid>"
```

Para cruzar o audit com o log tecnico, mantenha o mesmo `correlationId` e pesquise nos
datasets `logs-technical.otel-dev*` e `logs-audit*.otel-dev`. A ingestao depende de
Elastic/collector locais estarem ativos; nao foi feita chamada a PROD por este ticket.

## Validacao DEV persistente - TQ-OBS-02G1

Em 2026-08-31, a API DEV persistente em `:3002` (codigo do commit `994a78e`) foi
consultada com o correlation ID `e88eaefd-882c-4914-96d8-8bb262261e9e`. O registro
tecnico de conclusao da requisicao foi encontrado em
`logs-technical.otel-dev*`, com `attributes.releaseSha=dev`,
`attributes.service=quiver-tap-api-dev`, `attributes.environment=development`,
`attributes.requestId=req-1m` e o mesmo
`attributes.correlationId`.

A consulta correta e por campos OTLP, nao por campos na raiz:

```json
{
  "query": {
    "term": {
      "attributes.correlationId.keyword": "e88eaefd-882c-4914-96d8-8bb262261e9e"
    }
  }
}
```

O mapping DEV confirma `attributes.correlationId.keyword`,
`attributes.releaseSha.keyword`, `attributes.service.keyword`,
`attributes.environment.keyword` e `attributes.requestId.keyword`. O documento tem
`severity_text=info` e `body.text=request completed`; o logger padrao de conclusao
do Fastify nao inclui `route` nem `statusCode` nesse LogRecord. O endpoint historico
`/api/__obs/controlled-500` nao esta presente no codigo atual; a chamada segura a ele
retornou 404 e gerou o audit local com route, status 404, requestId, correlationId e
os tres campos de release.

Esse audit local confirmou a propagacao central, e os testes unitarios cobrem o
payload de audit. A pesquisa do novo audit em `logs-audit*.otel-dev*` nao retornou
documento durante esta validacao; isso nao invalida a prova do pipeline tecnico, mas
permanece uma verificacao operacional de ingestao de audit separada. Nenhuma mudanca
foi feita no collector, Elastic, banco ou PROD.

O frontend recebe `VITE_RELEASE_SHA` como metadado estatico do build; o valor e
normalizado no browser e nao envolve Git, path, comando, token ou secret.
