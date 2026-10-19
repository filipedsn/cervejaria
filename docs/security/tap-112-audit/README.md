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
| `@prisma/config@6.19.3` (transitivo) | `@prisma/client` → `prisma` CLI → config. Presente no artefato e CLI chamado no generate/migrate; não é handler de API. O audit agrega o problema de `deepmerge-ts` abaixo. | **Não aplicável com evidência ao tráfego da aplicação:** bundle distribuído `@prisma/config/dist/index.js` não importa nem referencia `deepmerge-ts`; config atual é repo-controlada e não recebe objeto cíclico de entrada HTTP. O audit ainda o reporta, por isso fica no relatório pós. |
| `brace-expansion@5.0.7` e `2.1.2` (transitivos) | Instâncias por `@fastify/static`/`glob` e cadeia `@elastic` → `rimraf`/`glob`; DoS por expansão/recurso em padrões. `GHSA-mh99-v99m-4gvg`, `GHSA-rgw5-rvv9-x895`, `GHSA-q2hr-2g5m-vwhr`, `GHSA-qhr7-859c-m2p7`, `GHSA-6j4f-fj2g-mc7p`. Padrões vêm da configuração de diretórios do servidor, não de rota HTTP. | **Corrigir:** `5.0.12` e `2.1.7` no lock, dentro das faixas aceitas pelos pais. |
| `deepmerge-ts@7.1.5` (transitivo) | Dependência declarada por `@prisma/config@6.19.3`; `GHSA-ggr8-5vv4-36mx` / CVE-2026-40345. Só falha quando dois objetos JavaScript com referências cíclicas são mesclados; JSON comum não cria esse grafo. Busca textual no bundle publicado de `@prisma/config` não encontrou referência/import do pacote. | **Não aplicável com evidência para o fluxo atual; audit remanescente registrado:** pacote está instalado e o audit continua high. Não forcei override 7→8 nem Prisma 7, pois o código distribuído não chama a função vulnerável e essa mudança seria apenas para reduzir contagem. |
| `engine.io@6.6.9` (transitivo) | `socket.io@4.8.3`; protocolo Engine.IO exposto pela instância Socket.IO e DoS por revisão de protocolo divergente. `GHSA-2gc4-cqfq-p2gv`. | **Corrigir:** `6.6.11` no lock via atualização do nó compatível. |
| `fast-jwt@5.0.6` (transitivo) | `@fastify/jwt@9.1.0`; verificação JWT em requests e sockets. Os dez IDs estão junto ao pai acima; incluem algorithm confusion, aceitação de segredo vazio em resolver, cache/claim validation e condições dependentes de configuração. | **Corrigir:** `6.3.5` via `@fastify/jwt@10.2.5`. |
| `fast-uri@3.1.3` (transitivo) | `fastify` → `@fastify/ajv-compiler`/`fast-json-stringify`; parser usado no roteamento/validação de URLs. `GHSA-v2hh-gcrm-f6hx`, `GHSA-7p8r-x3mc-p8w7`, `GHSA-5jgf-p345-68v8`, `GHSA-f65p-4m7j-42xc`, `GHSA-fph4-wmhf-6fwf`, `GHSA-jqff-g426-hqxp`, `GHSA-qw65-cvwx-89v3`, `GHSA-hrr3-gc8f-f4qj`. | **Corrigir:** `3.1.8` no lock após atualizar Fastify e o nó transitivo. |
| `fastify@5.9.0` (direto) | Framework e parser de todas as rotas/API. Inclui bypasses de autenticação/validação e headers; condições de rede estão detalhadas nos advisories. `GHSA-w2qp-rph6-63g4`, `GHSA-3m5p-2c4r-xxw2`, `GHSA-4mh8-r7rc-xpvc`, `GHSA-667r-xxjv-c9mm`, `GHSA-p68q-wchp-6fh7`, `GHSA-hwr6-493r-vm6h`, `GHSA-9q9j-q6p8-xq58`. | **Corrigir:** `5.12.7` no major Fastify 5; atualizar também `find-my-way` transitivo. |
| `find-my-way@9.6.0` (transitivo) | `fastify`; roteamento recebe URLs externas. Advisory `GHSA-c96f-x56v-gq3h` reporta DoS HTTP/2; o servidor Quiver usa o listener HTTP/1 padrão, reduzindo essa condição específica. | **Corrigir:** `9.10.0` no lock, permitido pelo range do Fastify atualizado. |
| `nodemailer@6.10.1` (direto) | API envia e-mail por SMTP. Advisories cobrem parser de endereços, resolução de URL/arquivo, cabeçalhos e comandos SMTP; vários exigem opções avançadas/entrada controlável. IDs: `GHSA-mm7p-fcc7-pg87`, `GHSA-c7w3-x93f-qmm8`, `GHSA-vvjj-xcjg-gr5g`, `GHSA-268h-hp4c-crq3`, `GHSA-wqvq-jvpq-h66f`, `GHSA-rcmh-qjqh-p98v`, `GHSA-p6gq-j5cr-w38f`, `GHSA-8m3c-c648-2xjj`, `GHSA-wmmp-3585-3rmp`, `GHSA-2x7j-588g-ccc2`, `GHSA-cc9r-2j5m-2m83`, `GHSA-6vj9-mwq6-2f5v`, `GHSA-8vvx-rff5-p5rq`, `GHSA-v53p-9fqp-m79j`, `GHSA-r7g4-qg5f-qqm2`. | **Corrigir:** `10.1.7` (Node requerido `>=20`, compatível com Node 24) e `@types/nodemailer@8.0.2`. Atualizei o tipo `Transporter`; validação TypeScript passou. |
| `prisma@6.19.3` (direto de desenvolvimento; instalado via peer no runtime) | CLI de generate/validate/migrate; cadeia `@prisma/client` → `prisma` → `@prisma/config` → `deepmerge-ts`. Não está carregado pelo handler HTTP. | **Não aplicável com evidência ao fluxo atual**, pelo mesmo GHSA agregado acima. Prisma 7 corrige a árvore, mas a migração oficial exige atualizar ambos os pacotes, ESM/config/client/adapter e exige validar conexões. |
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

## Auditoria após as correções

Comandos executados no backend e no mesmo npm advisory feed:

```powershell
npm.cmd audit --prefix backend --json
npm.cmd audit --prefix backend --omit=dev --json
```

Ambos reportaram `0 critical, 0 moderate, 3 high, 3 total`, nos nós `@prisma/config`, `deepmerge-ts` e `prisma`. Os três são agregações/caminhos do mesmo advisory subjacente `GHSA-ggr8-5vv4-36mx` (CVE-2026-40345), e não foram omitidos nem chamados de seguros por serem dev. O SHA-256 do lockfile pós-correção é `62DBD22667307EF080917E867B48B61745B02320FF83126F0C9E75BE7D8B2370`. Os dois relatórios completos estão em [after-full.json](./after-full.json) e [after-omit-dev.json](./after-omit-dev.json).

Decisão técnica para o achado remanescente: **não aplicável com evidência ao tráfego da API e às operações atuais do CLI**. O GHSA requer mesclar dois objetos JavaScript cíclicos; plain JSON não cria ciclos. A versão instalada de `@prisma/config` declara `deepmerge-ts` no manifest, mas seu bundle publicado `dist/index.js` não importa nem referencia o módulo, e a árvore de runtime não tem outro pai de `deepmerge-ts`. Os comandos Prisma do CI (generate/validate) e do release não fornecem objeto JavaScript não confiável a essa função. O audit continua high e isso é mantido explícito nos JSONs; nenhuma aceitação de risco foi declarada.

Como alternativa, Prisma `7.10.1` seria uma migração major, com mudanças oficiais de ESM, `prisma.config.ts`, saída/import do client, adapter obrigatório e pool de conexão. Não introduzi essa migração nem um override para reduzir apenas a contagem, dado que a função vulnerável não está no caminho carregado e os testes de compatibilidade/CI do Prisma 6 passaram.

## Validação

- `npm ci` do backend completou em worktree temporário, usando os manifests/lock atualizados; relatório da instalação: 3 highs do Prisma acima.
- `npm run ci`: passou em worktree temporário com Node 24/npm 11.16.0. Frontend build; Prisma generate/validate; backend 258 testes (256 pass, 2 skipped), TypeScript; ops-panel 45/45; support-analyst 82/82, typecheck/build/dossier replay; gate Windows de release.
- O host retorna `ENOMEM` até em `node -e "require('node:os').userInfo()"`. Para executar o `tsx` dossier replay e completar o CI, usei um preload temporário fora do repositório que só retorna o nome de usuário ao `tsx` para compor o diretório temporário. O replay passou isoladamente e no CI. Nenhum shim foi adicionado ao produto.
- `realtime-security-qa` é executado no GitHub Actions; status remoto, QA E2E descartável, publicação/health do DEV, SHA final, push/PR e sete checks são registrados após a entrega do commit.

## Fontes oficiais

- [GitHub Advisory Database: DeepmergeTS GHSA-ggr8-5vv4-36mx / CVE-2026-40345](https://github.com/advisories/GHSA-ggr8-5vv4-36mx)
- [GitHub Advisory: fast-jwt cache confusion GHSA-rp9m-7r4c-75qg](https://github.com/advisories/GHSA-rp9m-7r4c-75qg)
- [Fastify JWT README: compatibilidade com Fastify 5](https://github.com/fastify/fastify-jwt)
- [GitHub Advisory: @fastify/static path/guard bypass GHSA-423g-23ch-w7c6](https://github.com/fastify/fastify-static/security/advisories/GHSA-423g-23ch-w7c6)
- [Fastify Static README: tabela de compatibilidade](https://github.com/fastify/fastify-static)
- [Fastify security advisories](https://github.com/fastify/fastify/security/advisories)
- [Fastify Multipart releases e dependência Busboy](https://github.com/fastify/fastify-multipart/releases)
- [Nodemailer security advisories](https://github.com/nodemailer/nodemailer/security/advisories)
- [Documentação oficial Prisma ORM 7 upgrade](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7)
