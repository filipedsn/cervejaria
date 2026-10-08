# Matriz de certificacao - categorias canonicas do PDV

Revisao de aplicacao certificada: `9e86dc9daf6162fa8d5f92b10dd7911457157d13` (tree `b0dbb0042246472a7eb7b87ee7d20b297e4164a6`). O resultado PASS abaixo se aplica somente a esse snapshot imutavel e aos fixtures descartaveis indicados.

| Camada | Gate | Resultado | Cobertura |
|---|---|---|---|
| Build | Backend e frontend no snapshot exato | PASS | `npm run build` em ambos; avisos de tamanho de bundle/import do frontend, sem erro |
| UI simulada | Chromium, APIs explicitamente simuladas | PASS (2/2) | Criar categoria, editar flag e selecionar categoria no produto |
| Schema legado/API | Schema e client sem tabela/coluna de categoria | PASS | Consulta, cadastro e edicao de produto; client sem categoria escalar/modelo e selecao escalar default verificados |
| SQL limitado | Transformacao/proveniencia/rollback | PASS | Categoria manual equivalente reaproveitada; vinculo anterior preservado; criacao/vinculos registrados; replay e retomada atomica; edicoes posteriores e vinculo tardio bloqueiam rollback; colisao e FK de tenant |
| API/PostgreSQL | Aplicacao real, migration chain e Fastify.inject autenticado | PASS | 99 migrations em PostgreSQL descartavel; dono, funcionario com `catalog.manage`, sem permissao, tenant cruzado, categoria livre, colisao, flag `false` explicita, criacao/edicao/troca/edicao parcial |
| Produto, menu e venda | API/PostgreSQL | PASS | Chope renomeado preserva tipo/formato e precos por volume; menu mantem volumes; opcionais; venda por volume com Tap e montagem de sessao |
| Ranking legado | API/PostgreSQL | PASS | Ranking legado de Chope igual antes/depois da renomeacao/edicao; sem agregador novo |
| Invariantes de edicao | API/PostgreSQL | PASS | Edicao apenas da categoria nao altera pagamento da venda QA, caixa, cozinha, saldos/movimentos de estoque, menu ou opcionais |
| Permissoes e regressao | API/PostgreSQL | PASS | Gate individual; financeiro (90 migrations), comercio (96 migrations) e contratos transacionais |
| Representativo | Aplicacao em evidencia representativa | NOT_RUN | Nenhuma foto representativa foi fornecida |

## Tentativas bloqueadas anteriores

Essas execucoes nao contam como aprovacao. A revisao `9e86dc9` foi repetida integralmente depois das correcoes.

| Snapshot | Causa reproduzida | Correcao |
|---|---|---|
| `521b3ff` | Banco da API QA fora do nome exigido pelo validador isolado | Runner usa `cervejaria_qa_pdv_unico` e faixa local validada |
| `696f0ea` | `omit.categoriaPdvId` continha `undefined` com a flag ligada | Prisma inclui a chave somente com valor booleano |
| `19eedd7` | Fixture usou resposta Fastify em vez do ID parseado da categoria | ID da resposta parseada reaproveitado em todas as assercoes |
| `3586567` | Venda por volume nao tinha Tap/montagem da sessao | Fixture cria Tap QA e monta na sessao aberta |
| `b33a5a0`, `8118ff0`, `9883d6f` | Assercao de pagamento assumiu tenant direto/inexistente em Comanda e filtro relacional incorreto | Invariante filtrada pela `comandaId` da venda QA |

Evidencias bloqueadas detalhadas estao preservadas em `pdv-gamified-categories-qa-evidence-blocked-*.json`.

## Artefatos e limites

- Evidencia final: [`pdv-gamified-categories-qa-evidence-v28.json`](pdv-gamified-categories-qa-evidence-v28.json).
- Manifesto de candidatos das categorias: `pdv-gamified-categories-qa-manifest-v27.json` (digest `9b1cffa4bd8038484afcf11f4652302a6916fff0f1d9b7ee3b7c61cab2087c2e`).
- Manifesto integrado gerado do commit exato `9e86dc9`: [`pdv-unico-integrated-qa-manifest-9e86dc9.json`](pdv-unico-integrated-qa-manifest-9e86dc9.json), 101 candidatos, digest `c6608671630a9926b2f236456dc7a05c52b8ce1a43af8bc3763638eda70bb1eb`.
- QA ocorreu somente em PostgreSQL descartavel com storage tmpfs; PROD e DEV compartilhado nao foram acessados. O fingerprint local permaneceu identico e 9 itens nao rastreados foram preservados.
- Representativo nao executado; sem backfill real, cutover, deploy, pontos, ranking novo, recalculo ou reclassificacao de consumo historico.
- Permanecem pendentes: metrica de pontuacao, momento de entrada do consumo no ranking e participacao de consumos anteriores.
