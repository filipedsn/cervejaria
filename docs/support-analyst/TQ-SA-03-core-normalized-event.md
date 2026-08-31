# TQ-SA-03 — Core isolado e `NormalizedEvent`

Data: 2026-08-31
Status: concluído localmente; sem acesso a Elasticsearch ou PROD.

## Implementação

O novo processo está em `support-analyst/`. É um package Node 20 independente, sem imports de backend, Alert Poller, Ops Panel ou do Support Agent legado. Ele usa somente TypeScript, `tsx` para executar testes TypeScript e os módulos nativos do Node.

O entrypoint é fail-closed: sem argumento apenas informa que Sources Elasticsearch ainda não existem e encerra. Os únicos modos são `--help`, `--validate-config` e `--normalize-fixture <arquivo>`. Não há polling, rede, escrita local operacional, Elastic client, LLM, correlação, agrupamento, incidente ou remediação.

## Configuração

As únicas variáveis reconhecidas são `SUPPORT_ANALYST_ENV`, `SUPPORT_ANALYST_ES_URL`, `SUPPORT_ANALYST_ES_API_KEY` e `SUPPORT_ANALYST_RUNTIME_DIR`, além do gate futuro `SUPPORT_ANALYST_ALLOW_PRD=true`.

- `SUPPORT_ANALYST_ENV` aceita somente `dev` ou `prd`.
- URL, se configurada, deve ser HTTP(S) e não pode conter usuário/senha.
- A validação estrutural offline não exige API key.
- Um runtime Elasticsearch futuro exigirá URL e API key exclusivas.
- PRD continuará bloqueado até o gate explícito.
- Qualquer variável `SUPPORT_AGENT_*` é rejeitada; `ELASTIC_USER`, `ELASTIC_PASSWORD`, credenciais do Collector e do Alert Poller não são lidas nem usadas como fallback.

Mensagens de erro nunca interpolam API keys ou a URL com credenciais.

## Contrato `NormalizedEvent` V1

Campos obrigatórios: `schemaVersion: 1`, `eventId`, `timestamp`, `source` e `rawRef.index`/`rawRef.id`. A falha de referência, documento, timestamp ausente ou timestamp inválido retorna `NormalizationResult` explícito, sem substituir a data por relógio atual.

Campos opcionais representam dataset, ambiente, serviço, release, IDs de correlação/request/trace/span, tenant, ator técnico, ação/outcome, HTTP, DB, realtime e alerta. Foi adicionado `reasonCode?` de nível superior porque o mapping comprovado de auditoria é `attributes.metadata.reasonCode`; associá-lo a `realtime` teria semântica incorreta. Não há campo livre de payload nem stack em V1.

`eventId` é `sa1:` seguido de SHA-256 de `rawRef.index + NUL + rawRef.id`. Assim é estável para replay, não contém PII e não depende de rede ou aleatoriedade. Timestamps aceitos são os formatos parseáveis do campo `@timestamp`/`timestamp` e saem como ISO-8601 UTC.

## Mapping suportado

Audit e technical usam os campos comprovados em TQ-SA-02: correlation/request/release/service/environment, trace/span, `attributes.event.action`/outcome no audit, HTTP em `attributes.http.*`, tenant novo com fallback legado, e `attributes.event`, `category` e `durationMs` no technical. Serviço também pode vir de `resource.attributes.service.name`.

Para DB, `db.*` ativa somente quando `attributes.event` começa com `db.`. Categorias conhecidas são preservadas; `UNKNOWN` só é usado nesse caso comprovadamente DB com categoria não mapeável.

A fixture realtime é explicitamente `synthetic / producer-contract`; ela testa o formato `attributes.realtime.action` e `attributes.metadata.reasonCode`, mas **não comprova mapping operacional Elasticsearch realtime**.

## Privacidade

Os normalizadores usam allowlist: copiam somente caminhos declarados e ignoram todo o resto antes de formar o evento. Não carregam Authorization, Cookie, JWT/token, API key, password, connection string, SQL/bindings, request/response body, payload bruto, e-mail, telefone, nome, dados financeiros ou stack.

`alert.reason` é a única mensagem livre permitida nesta etapa. Ela passa por sanitizer puro, que redige Bearer/JWT/API key/password/cookie/connection string evidentes, e é limitada a 1.000 caracteres. `body.text` não é carregado por padrão. `error.message` permanece fora do mapping até haver contrato técnico comprovado.

## Fixtures e testes

Todas as fixtures são sintéticas e ficam em `support-analyst/test/fixtures/`: alert telemetry gap, audit HTTP success, audit auth failure, technical HTTP 500, DB failure, realtime producer-contract e privacy attack. Os testes cobrem normalização, fallback de tenant, IDs de correlação e trace, HTTP, reason code, DB, timestamps, determinismo, imutabilidade e falhas explícitas.

Há um teste de fronteira recursivo que verifica a ausência de chaves proibidas, além de verificar que valores PII/secretos da fixture não são serializados.

## Comandos e CI

No repositório raiz: `npm run analyst:typecheck`, `npm run analyst:test`, `npm run analyst:build` e `npm run analyst:validate`. O job bloqueante `support-analyst-test` instala dependências do package e executa typecheck, testes e build em Node 20 sem secrets ou rede Elasticsearch.

## Limitações e próximo passo

TQ-SA-03 termina no `NormalizedEvent`: não lê Elasticsearch, não implementa Sources, correlação, incidentes, dossiês, Ollama nem integrações externas. TQ-SA-04 deverá introduzir Sources read-only com filtros de origem e consultas limitadas, após revisão humana desta entrega.
