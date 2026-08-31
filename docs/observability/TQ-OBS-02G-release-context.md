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
