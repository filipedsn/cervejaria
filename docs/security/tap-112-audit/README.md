# TAP-112: auditoria de dependências do backend

Data da coleta: 2026-10-19 (America/Sao_Paulo)

## Baseline reproduzido

- Repositório/produção: `e37682231355b592c40d74f6f8ead0a992a92dfc`; `/api/health` respondeu `releaseSha=e3768223`.
- O SHA-256 de `deploy/prod-artifacts/backend/package-lock.json` é `6B1BC47689165E65404CE4CAC75EBB8FC36F5140A3E4549F8C43699E7B8A6B46`, igual ao lockfile `backend/package-lock.json` do commit publicado.
- `deploy/logs/deploy-20261019-134733.log` registra a instalação do runtime do backend, 365 pacotes adicionados/366 auditados e `26 vulnerabilities (9 moderate, 15 high, 2 critical)`. `scripts/prod/publish-artifacts.ps1` confirma `npm ci --omit=dev` no diretório isolado do artefato.
- O log histórico não registra as versões exatas de Node/npm. A reprodução atual usou Node `v24.18.0`, npm `11.16.0`, data `2026-10-19`, o lockfile acima e uma cópia temporária com `prisma/schema.prisma`. Nenhum `npm ci` ou instalação foi executado no `backend/node_modules` usado pelos processos de produção.
- Comandos no diretório temporário do backend, usando `backend/package.json` e `backend/package-lock.json` do artefato:

  ```powershell
  npm ci --omit=dev
  npm audit --json
  npm audit --omit=dev --json
  ```

- Os dois JSONs de baseline reportaram `9 moderate, 15 high, 2 critical` (26 entradas de pacote do npm). Eles contêm 67 GHSA distintos; esse total não equivale a CVEs distintos, pois um pacote pode agregar vários advisories e alguns GHSAs não têm CVE.
- O inventário instalado com `npm ci --omit=dev` incluiu também `prisma@6.19.3` e `@prisma/config@6.19.3` pelo relacionamento de peer de `@prisma/client`. Portanto, a presença deles não foi inferida só do campo `devDependencies`.
- O resumo original veio do runtime de produção. Não foi possível recuperar o JSON emitido naquela instalação histórica; os JSONs anexos reproduzem o resultado a partir do mesmo lockfile publicado e do feed atual.

Os relatórios completos, incluindo ranges afetados, severidades, títulos e referências retornados pelo registry no momento da coleta, estão em [before-full.json](./before-full.json) e [before-omit-dev.json](./before-omit-dev.json).

A matriz por advisory GHSA, com versões/ranges, nós no lock e resolução após a correção, está em [advisory-matrix.md](./advisory-matrix.md).

## Matriz por pacote encontrado no baseline

Todos os 26 nós abaixo apareceram na árvore instalada com `npm ci --omit=dev`. A coluna “Advisories” aponta para os IDs completos e ranges nos JSONs anexos. Os mesmos advisories podem ser agregados em mais de um nó transitivo; não some linhas como se fossem CVEs independentes.

| Pacote e versão afetada | Cadeia / uso e condição relevante | Decisão e correção |
|---|---|---|
| `@elastic/opentelemetry-node@1.16.0` (direto) | Iniciado pela API com `--import @elastic/opentelemetry-node`; agrega instrumentações de banco afetadas por `GHSA-qqmp-wf37-98f9`. Os nós específicos estão abaixo. | **Corrigir:** atualizar o pai para `1.17.0`, menor release que traz as instrumentações corrigidas e exporters OTel `0.221`; alinhados os quatro pacotes OTel usados diretamente pelo código. |
| `@fastify/busboy@3.2.0` (transitivo) | `@fastify/multipart@10.0.0` → Busboy. Parser é usado nos endpoints multipart de administração/uploads; boundary excessivo, header com nome de protótipo e CRLF em nome/filename são entradas de rede. `GHSA-xjh9-v7x6-24jw`, `GHSA-x8mw-p69m-v3mx`, `GHSA-gxm5-99cw-xjw9`. | **Corrigir:** primeiro atualizar o pai para `@fastify/multipart@10.1.4`; como o range do pai ainda admitia Busboy vulnerável, atualizar o nó do lock para `3.2.3`. |
| `@fastify/jwt@9.1.0` (direto) | Plugin de autenticação da API; cadeia `@fastify/jwt` → `fast-jwt@5.0.6`. Os advisories incluem falhas de verificação JWT; aplicabilidade varia com chave, algoritmo, cache e claims usados. O código usa segredo da aplicação, sem `cacheKeyBuilder` customizado. IDs subjacentes: `GHSA-hm7r-c7qw-ghp6`, `GHSA-mvf2-f6gm-w987`, `GHSA-rp9m-7r4c-75qg`, `GHSA-cjw9-ghj4-fwxf`, `GHSA-3j8v-cgw4-2g6q`, `GHSA-gmvf-9v4p-v8jc`, `GHSA-x937-hj6v-793p`, `GHSA-8wpc-h4q6-8fxv`, `GHSA-687g-22h4-j4w4`, `GHSA-5hjw-83fp-phq9`. | **Corrigir:** `@fastify/jwt@10.2.5` é necessário para receber `fast-jwt@6.3.4+`; o lock resolve `6.3.5`. É major e foi validado pelo typecheck, build e testes locais. |
| `@fastify/static@8.3.0` (direto) | Ativo em `/uploads/` e no frontend estático. Os advisories cobrem traversal e bypass de guardas via caminhos codificados/não canônicos: `GHSA-pr96-94w5-mx2h`, `GHSA-x428-ghpx-8j92`, `GHSA-8pvw-jcv7-9cmj`, `GHSA-83w8-p2f5-377r`. | **Corrigir:** não havia release corrigida no major 8; `10.1.6` inclui os patches. A documentação oficial de compatibilidade mantém a linha `>=8.x` em Fastify 5. A API `setHeaders` agora recebe `FastifyReply`; ajustado de `setHeader` para `header` e validado no typecheck/build. |
| `@grpc/grpc-js@1.14.4` (transitivo) | Exporters gRPC carregados pelo pacote OTel; a exploração exige uso do servidor/auth context afetado ou caminho que revele mensagens de handler. `GHSA-m9gg-hp2v-232j`, `GHSA-f596-whhp-79r4`. | **Corrigir:** `1.14.6` pelo pai OpenTelemetry atualizado. |
| `@opentelemetry/instrumentation-cassandra-driver@0.65.0` (transitivo) | `@elastic/opentelemetry-node`; atributo `db.user` em spans quando instrumentação Cassandra é usada. | **Corrigir:** `0.66.0` via Elastic `1.17.0`; `GHSA-qqmp-wf37-98f9`. |
| `@opentelemetry/instrumentation-knex@0.64.0` (transitivo) | Mesmo caminho; exposição de `db.user` em spans de Knex instrumentado. | **Corrigir:** `0.65.0` via Elastic `1.17.0`; mesmo GHSA. |
| `@opentelemetry/instrumentation-mongoose@0.66.0` (transitivo) | Mesmo caminho; exposição de `db.user` em spans Mongoose instrumentados. | **Corrigir:** `0.67.0` via Elastic `1.17.0`; mesmo GHSA. |
| `@opentelemetry/instrumentation-mysql@0.66.0` (transitivo) | Mesmo caminho; exposição de `db.user` em spans MySQL instrumentados. | **Corrigir:** `0.67.0` via Elastic `1.17.0`; mesmo GHSA. |
| `@opentelemetry/instrumentation-mysql2@0.66.0` (transitivo) | Mesmo caminho; exposição de `db.user` em spans mysql2 instrumentados. | **Corrigir:** `0.67.0` via Elastic `1.17.0`; mesmo GHSA. |
| `@opentelemetry/instrumentation-oracledb@0.45.0` (transitivo) | Mesmo caminho; exposição de `db.user` em spans Oracle instrumentados. | **Corrigir:** `0.46.0` via Elastic `1.17.0`; mesmo GHSA. |
| `@opentelemetry/instrumentation-pg@0.72.0` (transitivo) | Mesmo caminho; instrumentação PostgreSQL está presente e a API conecta ao PostgreSQL. | **Corrigir:** `0.73.0` via Elastic `1.17.0`; mesmo GHSA. |
| `@opentelemetry/instrumentation-tedious@0.39.0` (transitivo) | Mesmo caminho; exposição de `db.user` em spans Tedious instrumentados. | **Corrigir:** `0.40.0` via Elastic `1.17.0`; mesmo GHSA. |
| `@prisma/config@6.19.3` (transitivo) | `@prisma/client@6.19.3` peer → `prisma@6.19.3` → config; CLI presente no artefato runtime e executado em generate/migrate, não no handler HTTP. O merge vulnerable é o `c12` loader de config JS/TS. | **Corrigido:** override estreito `deepmerge-ts@8.0.2`; `npm ci`, Prisma commands, CI e migrations descartáveis passaram. |
| `brace-expansion@5.0.7` e `2.1.2` (transitivos) | Instâncias por `@fastify/static`/`glob` e cadeia `@elastic` → `rimraf`/`glob`; DoS por expansão/recurso em padrões. `GHSA-mh99-v99m-4gvg`, `GHSA-rgw5-rvv9-x895`, `GHSA-q2hr-2g5m-vwhr`, `GHSA-qhr7-859c-m2p7`, `GHSA-6j4f-fj2g-mc7p`. Padrões vêm da configuração de diretórios do servidor, não de rota HTTP. | **Corrigir:** `5.0.12` e `2.1.7` no lock, dentro das faixas aceitas pelos pais. |
| `deepmerge-ts@7.1.5` (transitivo) | `@prisma/config@6.19.3`; `GHSA-ggr8-5vv4-36mx` / CVE-2026-40345, afetado `<8.0.0`. Stack exhaustion requer dois grafos JS cíclicos no mesmo caminho. Config atual é JSON sem ciclos; `prisma.config.ts` ausente. | **Corrigido:** o lockfile fixa a resolução a `8.0.2` via override scoped; os três nós agregados desapareceram dos audits. |
| `engine.io@6.6.9` (transitivo) | `socket.io@4.8.3`; protocolo Engine.IO exposto pela instância Socket.IO e DoS por revisão de protocolo divergente. `GHSA-2gc4-cqfq-p2gv`. | **Corrigir:** `6.6.11` no lock via atualização do nó compatível. |
| `fast-jwt@5.0.6` (transitivo) | `@fastify/jwt@9.1.0`; verificação JWT em requests e sockets. Os dez IDs estão junto ao pai acima; incluem algorithm confusion, aceitação de segredo vazio em resolver, cache/claim validation e condições dependentes de configuração. | **Corrigir:** `6.3.5` via `@fastify/jwt@10.2.5`. |
| `fast-uri@3.1.3` (transitivo) | `fastify` → `@fastify/ajv-compiler`/`fast-json-stringify`; parser usado no roteamento/validação de URLs. `GHSA-v2hh-gcrm-f6hx`, `GHSA-7p8r-x3mc-p8w7`, `GHSA-5jgf-p345-68v8`, `GHSA-f65p-4m7j-42xc`, `GHSA-fph4-wmhf-6fwf`, `GHSA-jqff-g426-hqxp`, `GHSA-qw65-cvwx-89v3`, `GHSA-hrr3-gc8f-f4qj`. | **Corrigir:** `3.1.8` no lock após atualizar Fastify e o nó transitivo. |
| `fastify@5.9.0` (direto) | Framework e parser de todas as rotas/API. Inclui bypasses de autenticação/validação e headers; condições de rede estão detalhadas nos advisories. `GHSA-w2qp-rph6-63g4`, `GHSA-3m5p-2c4r-xxw2`, `GHSA-4mh8-r7rc-xpvc`, `GHSA-667r-xxjv-c9mm`, `GHSA-p68q-wchp-6fh7`, `GHSA-hwr6-493r-vm6h`, `GHSA-9q9j-q6p8-xq58`. | **Corrigir:** `5.12.7` no major Fastify 5; atualizar também `find-my-way` transitivo. |
| `find-my-way@9.6.0` (transitivo) | `fastify`; roteamento recebe URLs externas. Advisory `GHSA-c96f-x56v-gq3h` reporta DoS HTTP/2; o servidor Quiver usa o listener HTTP/1 padrão, reduzindo essa condição específica. | **Corrigir:** `9.10.0` no lock, permitido pelo range do Fastify atualizado. |
| `nodemailer@6.10.1` (direto) | API envia e-mail por SMTP. Advisories cobrem parser de endereços, resolução de URL/arquivo, cabeçalhos e comandos SMTP; vários exigem opções avançadas/entrada controlável. IDs: `GHSA-mm7p-fcc7-pg87`, `GHSA-c7w3-x93f-qmm8`, `GHSA-vvjj-xcjg-gr5g`, `GHSA-268h-hp4c-crq3`, `GHSA-wqvq-jvpq-h66f`, `GHSA-rcmh-qjqh-p98v`, `GHSA-p6gq-j5cr-w38f`, `GHSA-8m3c-c648-2xjj`, `GHSA-wmmp-3585-3rmp`, `GHSA-2x7j-588g-ccc2`, `GHSA-cc9r-2j5m-2m83`, `GHSA-6vj9-mwq6-2f5v`, `GHSA-8vvx-rff5-p5rq`, `GHSA-v53p-9fqp-m79j`, `GHSA-r7g4-qg5f-qqm2`. | **Corrigir:** `10.1.7` (Node requerido `>=20`, compatível com Node 24) e `@types/nodemailer@8.0.2`. Atualizei o tipo `Transporter`; validação TypeScript passou. |
| `prisma@6.19.3` (dev declarado; incluído via peer no runtime) | CLI usado em generate/validate/migrate, cadeia `@prisma/client` → `prisma` → `@prisma/config` → `deepmerge-ts`. CLI/config não é handler HTTP. | **Mitigado/corrigido no nó vulnerável:** Prisma 6.19.3 preservado; o config usa `deepmerge-ts@8.0.2` corrigido e foi validado. |
| `sharp@0.35.3` (direto) | Importado em processamento de logo/fundo e conversão de imagem; imagens de usuário passam por decodificação nativa. `GHSA-rgj7-g3m4-5g8c`, `GHSA-wq5f-xc86-pv6w`. | **Corrigir:** patch `0.35.5`, a última versão corrigida compatível observada no feed. |
| `socket.io-parser@4.2.6` (transitivo) | Via `socket.io@4.8.3` e cliente de teste; parser de mensagens/attachments recebido pelo Socket.IO. `GHSA-2m8v-j782-fhvr` descreve exaustão de memória por attachments. | **Corrigir:** `socket.io` e `socket.io-client@4.8.4`; lock `socket.io-parser@4.2.7`. |
| `undici@6.27.0` (transitivo) | `@elastic/opamp-client-node`; rede de gerenciamento/telemetria, não handler de request da API. Os seis IDs e condições de retry, headers/cookies e WebSocket estão em `before-full.json`. | **Corrigir:** `6.29.1` dentro do range aceito pelo cliente OpAMP. |

## Atualizações e impacto

- Atualizados os pais diretos afetados: `@elastic/opentelemetry-node 1.16.0→1.17.0`, `@fastify/jwt 9.1.0→10.2.5`, `@fastify/multipart 10.0.0→10.1.4`, `@fastify/static 8.3.0→10.1.6`, `fastify 5.9.0→5.12.7`, `nodemailer 6.10.1→10.1.7`, `sharp 0.35.3→0.35.5`, `socket.io` e `socket.io-client 4.8.3→4.8.4`.
- O plugin JWT, o plugin static e Nodemailer precisaram de major: as versões antigas não tinham releases corrigidas para os advisories atuais. Node 24 satisfaz a versão mínima do Nodemailer 10; o código SMTP segue na API `createTransport`/`sendMail`. O CI confirmou a tipagem, compilação e testes.
- Alinhados os quatro imports OTel usados pelo código (`api-logs`, `exporter-logs-otlp-http`, `resources`, `sdk-logs`) às versões `0.221.0`/`2.10.0` trazidas pelo pai corrigido. Atualizar só a dependência Elastic tinha deixado cópias paralelas antigas e vulneráveis.
- Depois de atualizar os pais, os ranges de Busboy, Engine.IO, fast-uri, find-my-way, socket.io-parser e undici ainda permitiam os nós vulneráveis antigos. Atualizei apenas esses nós no lockfile, sem override.
- Alterações de compatibilidade de código: callback `setHeaders` do `@fastify/static` 10 recebe `FastifyReply`, então usa `reply.header`; o novo `@types/nodemailer` exporta `Transporter` como tipo nomeado.
- Não usei `npm audit fix --force`. Não alterei os lockfiles root/frontend/ops-panel/support-analyst. `backend/node_modules` local permaneceu intacto.

## Resultado final do Prisma

### Achado e caminho de execução

- O advisory é `GHSA-ggr8-5vv4-36mx` / `CVE-2026-40345`, high (CVSS 8.2). `deepmerge-ts` em todas as versões `<8.0.0` está afetado; `8.0.0+` está corrigido. A vulnerabilidade é recursão sem detecção de ciclos: a exploração exige que os dois objetos mesclados tenham referências próprias pelo mesmo caminho de propriedade, causando `RangeError`/exaustão de stack.
- As três entradas do audit anterior eram nós/caminhos agregados do mesmo advisory: `@prisma/config@6.19.3`, `deepmerge-ts@7.1.5` e `prisma@6.19.3`. Cadeia runtime confirmada com `npm ls --omit=dev --all`: `@prisma/client@6.19.3` (peer) → `prisma@6.19.3` → `@prisma/config@6.19.3` → `deepmerge-ts@7.1.5`. O CLI e config estão presentes no artefato `npm ci --omit=dev`, embora Prisma seja devDependency no manifest, e scripts de release usam `prisma generate`/`prisma migrate deploy`.
- `@prisma/config/dist/index.js` importa `deepmerge` no carregamento da configuração CLI e passa a função a `c12` como `merger`. O call site só mescla config JS/TS carregado pelo CLI; não é usado por handlers HTTP nem pelo Prisma Client de consultas. O repositório não contém `prisma.config.ts/js`; usa somente `backend/package.json#prisma.seed` (JSON acíclico) e flags `--schema` nos comandos de release. JSON não representa objetos cíclicos. Para fornecer o grafo necessário seria preciso executar código de configuração local controlado pelo próprio repositório; upstream observa que quem consegue criar tal `prisma.config.ts` já tem execução de código no host.
- Portanto, a instância estava fisicamente instalada e carregada pela cadeia CLI/build, mas o caminho vulnerável exigia configuração JS local que não existe e não era alcançável por payload HTTP. Ainda assim, corrigi a dependência em vez de depender apenas dessa condição de exposição.

### Correção aplicada e escolha de versão

- Adicionado override restrito a `@prisma/config → deepmerge-ts@8.0.2`; demais dependências e Prisma Client/CLI permanecem em Prisma `6.19.3`. O lockfile resolve a versão corrigida no mesmo nó.
- Prisma ORM `7.10.1` também atualiza `deepmerge-ts`, mas a migração Prisma 7 exige atualizar conjuntamente `prisma` e `@prisma/client` e adaptar ESM, `prisma.config.ts`, geração/import do client, adapter PostgreSQL e configuração de pool/SSL. Para este advisory, o override estreito reduz a superfície de mudança e foi validado concretamente: `npm ci`, Prisma generate/validate e deploy das 102 migrations no banco descartável passaram. Prisma 7 não foi descartado apenas por ser major; a alternativa foi avaliada e não é necessária para corrigir este nó.
- A mudança de major de `deepmerge-ts` foi revisada no único call site de Prisma: este projeto não fornece mapas nem tipos da API de `deepmerge-ts`; config do CLI é JSON ou código local confiável. `npm ci`, geração/validação Prisma, CI e QA de release validaram a compatibilidade. Override não é supressão: a instalação passa a conter a versão corrigida `8.0.2`.

### Audit final

Depois do override, `npm audit --json` e `npm audit --omit=dev --json` reportaram ambos `0 info, 0 low, 0 moderate, 0 high, 0 critical, 0 total`. O mesmo resultado foi confirmado depois de uma instalação limpa `npm ci --omit=dev` em diretório isolado contendo o schema. O `npm ls --omit=dev` dessa instalação confirma que o Prisma CLI continua presente por peer e que usa `deepmerge-ts@8.0.2`.

- JSON completo: [after-prisma-fix-full.json](./after-prisma-fix-full.json)
- Audit omit-dev no install completo: [after-prisma-fix-omit-dev.json](./after-prisma-fix-omit-dev.json)
- Audit após instalação limpa omit-dev: [after-prisma-fix-omit-dev-install.json](./after-prisma-fix-omit-dev-install.json)
- Lockfile final SHA-256: `E0ABF7FDF95ED10733819F20C041302D0B1771E14446C5172B47EC3B5083B6E4`.
- Os relatórios [after-full.json](./after-full.json) e [after-omit-dev.json](./after-omit-dev.json) preservam a etapa intermediária (3 entradas do advisory antes do override); não representam o resultado final.

## ADM-X03: comparação e correção do teste

O teste foi executado com o mesmo runner, seed sintético, browser Chromium e projeto Playwright `mobile` (Pixel 7), primeiro no baseline `e37682231355b592c40d74f6f8ead0a992a92dfc` após `npm ci` original, depois no candidato `5aa2d5d99e4e030ad96e3fde86c23c0cc9d1a3bd` com dependências atualizadas. Ambos falharam na mesma asserção. `AdminLayout.tsx` não mudou entre os commits: no mobile, a sidebar desktop usa `hidden md:flex` e os links funcionais estão na navegação inferior `md:hidden`. O seletor `getByText('Empresas').first()` escolhia o link desktop oculto por estar primeiro no DOM. É defeito preexistente do roteiro, não regressão do produto nem dependência.

O roteiro agora busca o link visível dentro da última região `navigation`, que é a navegação inferior real no mobile, e conserva o teste de texto corrompido. O cenário corrigido passou em desktop, mobile/Pixel 7, tablet e TV (4/4), com banco e seed descartáveis.

## Skips encontrados na suíte de release

Os 11 skips observados são os mesmos no snapshot-base e no candidato; os testes/Playwright config correspondentes não foram alterados pela atualização de dependências:

- 3 repetições de `CMD-S21` fora de desktop são skips intencionais: o teste de propagação entre sessões executa uma vez em desktop; a execução desktop passou.
- 4 repetições de `POR-X02` são `test.fixme` por uma lacuna real: cliente marcado inativo é reativado pelo fluxo público de autoatendimento. É relevante para autorização/controle de conta, mas independente da cadeia de dependências deste WI e não foi aceito como risco.
- 4 repetições de `PWA-S05` são `test.fixme`: o aviso de nova versão do service worker ainda não existe; sem impacto de segurança identificado e fora dos caminhos alterados.

**Suggested Plane Item (não criado):**

- **Título:** `[SEGURANÇA] Impedir cliente desativado de reabrir pedido pelo autoatendimento`
- **Problema/evidência:** `e2e/release/por/por.spec.ts` documenta o gap; `backend/src/routes/public.ts` chama `registerOrUpdateCliente` na criação de comanda pública e `backend/src/lib/cliente-resolver.ts` grava `ativo: true` no `update`.
- **Impacto:** uma conta de cliente desativada pode voltar a abrir comanda pelo portal público, contornando a ação administrativa de bloqueio.
- **Prioridade sugerida:** high. Abrir um WI separado exige autorização humana; não alterei esse fluxo nesta entrega.

## Validação desta revisão

- Instalação limpa completa do backend na worktree isolada, Node `v24.18.0` / npm `11.16.0`: `npm ci` concluído; zero vulnerabilidades.
- Instalação limpa do artefato de runtime isolado: `npm ci --omit=dev`, 367 pacotes adicionados; generate Prisma passou e `npm audit --omit=dev` reportou zero vulnerabilidades.
- `npm run ci`: passou na worktree isolada; frontend build, Prisma generate/validate, backend 256/258 (2 skips), typecheck, ops-panel 45/45, support-analyst 82/82, dossier replay e gate Windows.
- QA de release após correção do seletor: ADM-X03 passou em 4/4 projetos. O restante da suíte extensa anteriormente teve 304 pass, 11 skips e essa falha de seletor; não foi repetido todo o E2E por ser independente da correção Prisma. Migrações e seed sintético também passaram com override no QA descartável.
- PR de follow-up [#77](https://github.com/filipedsn/cervejaria/pull/77): push concluído e squash merge com os 7/7 checks verdes. Commit do branch `a8c5219a7f2fa713e3a1892e6d20e6a077663b5f`; SHA da integração de código e release no DEV `8fc47c93fe2e5e7b2d2b3af620f9226bd50f9706`. O PR docs-only #78 não alterou o runtime.
- Publicado no DEV pelo fluxo oficial em `2026-10-20` no mesmo SHA. `diagnose-dev-runtime.ps1`: API `:3002` reporta esse SHA, readiness `ready`, DB ok, identidade e hash do artefato válidos; frontend `:5202` identidade válida e HTTP 200; candidato passou no validador oficial com 0 erros. Listener PROD `:3001` permaneceu no PID `10012`; nenhum deploy PROD foi feito.
- `PROD_DEPLOY_REQUIRED=YES`: TAP-112 permanece **In Progress** até decisão/autorização explícita para publicação em produção.
- `backend/node_modules` usado pela produção não foi tocado; instalações ocorreram em diretórios isolados. Nenhum deploy em produção foi feito.
## Fontes oficiais

- [GitHub Advisory Database: DeepmergeTS GHSA-ggr8-5vv4-36mx / CVE-2026-40345](https://github.com/advisories/GHSA-ggr8-5vv4-36mx)
- [Prisma upstream issue: deepmerge-ts advisory and scoped override discussion](https://github.com/prisma/orm/issues/30052)
- [Prisma ORM 7.10.1 release notes: dependency security advisories](https://github.com/prisma/orm/releases/tag/7.10.1)
- [GitHub Advisory: fast-jwt cache confusion GHSA-rp9m-7r4c-75qg](https://github.com/advisories/GHSA-rp9m-7r4c-75qg)
- [Fastify JWT README: compatibilidade com Fastify 5](https://github.com/fastify/fastify-jwt)
- [GitHub Advisory: @fastify/static path/guard bypass GHSA-423g-23ch-w7c6](https://github.com/fastify/fastify-static/security/advisories/GHSA-423g-23ch-w7c6)
- [Fastify Static README: tabela de compatibilidade](https://github.com/fastify/fastify-static)
- [Fastify security advisories](https://github.com/fastify/fastify/security/advisories)
- [Fastify Multipart releases e dependência Busboy](https://github.com/fastify/fastify-multipart/releases)
- [Nodemailer security advisories](https://github.com/nodemailer/nodemailer/security/advisories)
- [Documentação oficial Prisma ORM 7 upgrade](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7)
