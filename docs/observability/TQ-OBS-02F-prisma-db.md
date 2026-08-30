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

Os testes cobrem sucesso rápido sem evento, lentidão, Prisma `P2002`, deadlock/lock
timeout/timeout por códigos explícitos, falha técnica e funcional de transação,
contexto HTTP, sanitização e telemetria fail-open. Execute:

```
npm.cmd run test:unit --prefix backend
npm.cmd run build --prefix backend
npx prisma validate
```
