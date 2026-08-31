# TQ-OBS-02F — observabilidade Prisma/DB

## Resultado

O cliente Prisma único (`backend/src/lib/prisma.ts`) agora possui uma extensão de
observabilidade de baixo volume. Ela mede cada operação apenas em memória e emite
log técnico Pino/OTel somente para operação lenta ou falha. O mesmo cliente envolve
`$transaction`, emitindo um sinal adicional apenas quando o rollback decorre de um
erro técnico de banco. Não houve alteração de schema, migration, regra de negócio,
deploy ou PROD.

## Taxonomia

| Evento | Quando | Nível |
| --- | --- | --- |
| `db.operation.slow` | operação Prisma acima do threshold | warn |
| `db.operation.failed` | falha Prisma/DB que não é de conexão | warn para constraint/timeout/lock; error para deadlock/desconhecido |
| `db.connection.failed` | inicialização, conexão perdida/indisponível ou código de conexão conhecido | error |
| `db.transaction.failed` | `$transaction` abortada por erro técnico de DB | mesma severidade da categoria |

As categorias são `CONNECTION`, `TIMEOUT`, `DEADLOCK`, `LOCK_TIMEOUT`,
`CONSTRAINT`, `NOT_FOUND`, `TRANSACTION` e `UNKNOWN`.

A classificação usa somente evidência explícita: classes/códigos documentados do
Prisma e códigos PostgreSQL `40P01` (deadlock), `55P03` (lock timeout), `57014`
(timeout) e classes de conexão `08*`. `P2034` é `TRANSACTION`, pois ele também pode
significar write conflict e não permite afirmar deadlock. Texto de erro não é usado
para inferir categoria.

## Dados e privacidade

Todo evento inclui, quando o código executa no contexto HTTP existente, `requestId`,
`correlationId`, `cervejariaId`, `userId`, `role`, serviço e ambiente via mixin do
logger. O evento DB acrescenta somente `model`, `operation`, `durationMs`, categoria
e `prismaCode` quando for um código Prisma seguro.

Não são emitidos SQL, argumentos/bindings, filtros, valores de payload, connection
string, token, cookie, senha, CPF, telefone ou email. A mensagem registrada é fixa
(`Database operation failed (<CATEGORIA>)`) e o `err` é recriado a partir dela, para
que nem a mensagem nem a stack do driver possam vazar SQL ou parâmetros.

O anterior `prisma-audit` (que podia resumir argumentos) não está mais conectado ao
cliente ativo. Operações normais rápidas não geram evento técnico adicional.

## Threshold, volume e custo

`DB_SLOW_OPERATION_MS` configura o threshold em DEV e PROD. O padrão conservador é
`500` ms; valores inválidos, menores que 1 ms ou maiores que uma hora retornam ao
padrão. Cada consulta faz duas leituras de relógio e comparações locais; logging é
síncrono para o Pino local e protegido por `try/catch`, sem `await` externo. O custo
normal é constante e nenhum documento é criado para sucesso rápido. Assim, o volume
esperado é uma linha por operação lenta/falha e, em falha técnica transacional, uma
linha de operação mais uma de transação com informação distinta.

Pool metrics não são expostas pela arquitetura Prisma atual. `P2024` sinaliza timeout
ao obter conexão do pool, mas não há polling/exporter novo nem métrica de ocupação.
Advisory locks existentes (caixa, comanda, estoque e concorrência) continuam sem log
de sucesso; seus erros passam pela operação `executeRaw` e são classificados somente
quando o driver expõe código explícito.

## Consulta no Elastic

Os sinais chegam pelo pipeline técnico existente em `logs-technical.otel-dev*` (ou
`logs-technical.otel-prd*`). Em Discover, consulte por exemplo:

```
correlationId: "<uuid>" and event: "db.operation.failed"
correlationId: "<uuid>" and category: "LOCK_TIMEOUT"
requestId: "<fastify-request-id>"
```

A ingestão DEV não foi disparada neste ticket: provocar timeout/lock no banco DEV
real não era necessário para validar o código e poderia degradá-lo. Os testes unitários
cobrem o contrato de evento; a confirmação operacional posterior deve usar uma falha
controlada, curta e um `correlationId` próprio, sem tocar em PROD.

## Validação

### Tentativa controlada de ingestão DEV (TQ-OBS-02F1)

Foi adicionado `npm run obs:validate-prisma-ingestion`, executado pelo carregador
`run-with-env.mjs development`. Ele primeiro reserva e libera a porta loopback
`127.0.0.1:65432` para comprovar que está sem listener; em seguida, somente no
processo efêmero, aponta Prisma para essa porta e executa `$queryRaw`. A API DEV e
sua `DATABASE_URL` não são alteradas.

Em 2026-08-30, a execução com correlation ID
`c4e2b2af-6763-4fa9-9d60-2e98f20c447c` produziu um
`PrismaClientInitializationError` real, classificado e escrito pelo Pino como
`db.connection.failed` / `CONNECTION`, com serviço DEV e correlação. A busca por
`attributes.correlationId` no data stream `logs-technical.otel-dev*` retornou zero
documentos, inclusive após flush e janela de 10 segundos. Portanto esta tentativa
**não comprova ingestão Elasticsearch**; não se deve afirmar o contrário.

O collector estava acessível e a segregação DEV/PRD permaneceu verde. O próximo passo
é diagnosticar por que logs Pino de processos efêmeros não chegam ao receiver OTLP ou
ao exporter, usando ambiente descartável ou endpoint DEV temporário — sem usar o banco
DEV compartilhado. A consulta Elastic para logs Pino deve usar
`attributes.correlationId`, pois os campos Pino são atributos OTLP.

### Diagnóstico de lifecycle (TQ-OBS-02F2)

O launcher padrão `--import @elastic/opentelemetry-node` inicia o SDK, mas não
expõe seu lifecycle ao script. Em processo efêmero, a API pública de logs observada
era um `ProxyLoggerProvider`, sem `forceFlush` ou `shutdown`; portanto não havia uma
forma confiável de drenar o `BatchLogRecordProcessor`. O validador agora usa
`bootstrap-prisma-observability-validation.mjs`: ele reutiliza o hook e
`startNodeSDK` do pacote Elastic, aguarda o hook e executa `telemetry.shutdown()`
explicitamente ao final, sem sleep arbitrário.

Com `OTEL_LOG_LEVEL=DEBUG` somente no processo de diagnóstico, foi comprovado que o
provider real é `LoggerProvider`, que o Pino criou o LogRecord
`db.connection.failed` com dataset `technical`, e que o OTLP exporter enviou o lote
para `127.0.0.1:4318`, recebendo resposta HTTP 200 do receiver do collector. A busca
por uma nova correlação no Elasticsearch continuou sem documentos. Assim, a perda
remanescente está após o receiver, no pipeline/exporter do collector para Elasticsearch;
não houve mudança no collector sem um erro específico de indexação que a justifique.

Os testes cobrem sucesso rápido sem evento, lentidão, Prisma `P2002`, deadlock/lock
timeout/timeout por códigos explícitos, falha técnica e funcional de transação,
contexto HTTP, sanitização e telemetria fail-open. Execute:

```
npm.cmd run test:unit --prefix backend
npm.cmd run build --prefix backend
npx prisma validate
```
