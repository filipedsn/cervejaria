# Prontidão para migração de produção — Tap Quiver

**Etapas 1–2 — fixação do candidato, validação de origem e ensaio isolado**  
**Data:** 10/10/2026 (America/Sao_Paulo)  
**Decisão nesta preparação:** candidato-fonte identificado; **NO-GO para janela de produção**. Nenhuma consulta, operação, leitura de metadados ou alteração de PRD foi feita. Nenhuma migração ou publicação foi executada. `PROD_DEPLOY_REQUIRED=NO`.

## 1. Candidato e estado do repositório

| Referência | SHA / tree | Evidência e uso |
|---|---|---|
| Candidato-fonte fixado | `956f3a64e67fc3016a177426364f625c2682212d` / `ec7b1c159f3f1184142c142e5f4f7db53455c0fd` | `origin/main` após `git fetch origin main`; commit publicado no remoto. Usar este SHA literal nos próximos artefatos e ensaios. |
| Release DEV informada | `4555adf8bcf36a6b0055c67bf1cb97b951a52bb9` | Manifesto local e consulta somente leitura atual confirmam: `/api/health` HTTP 200 com esse `releaseSha`, `/api/ready` HTTP 200 e frontend local HTTP 200. Um recibo antigo registrou `327f546` antes da ativação posterior; é evidência histórica, não estado atual. |
| HEAD local | `c86ad3fe59d178520a08b81ffff316231a36f807` | Não é candidato: diverge de `origin/main` em 20 commits à frente e 61 atrás, e inclui trabalho local/paralelo. |
| Ensaio integral anterior | `780772179d39173660c378a867898438f0aec765` / `e5ffe0dd400a9441907cd61cb5cb8d113d47bc9f` | Evidência de ensaio Git-snapshot em banco descartável; anterior ao candidato fixado. |

O pacote compilado e imutável de `956f3a64e67fc3016a177426364f625c2682212d` existe em `deploy/release-candidates/956f3a64e67fc3016a177426364f625c2682212d`; o manifesto foi verificado novamente nesta etapa e passou. Não foi reconstruído.

O workspace tem alterações locais staged e unstaged, remoção staged, arquivos e diretórios não rastreados e três stashes. Foram preservados. Nenhum conteúdo desse workspace foi incluído no candidato. O novo documento deve ser commitado isoladamente, com base em `origin/main`, sem trocar/resetar/rebasear a branch `main`.

### Diferenças relevantes

- A comparação Git entre `4555adf` e `956f3a6` não mostra diferenças em fontes funcionais, schema, migrations, transformations ou entradas funcionais de build. O bundle backend é idêntico; o bundle frontend difere além da substituição do SHA embutido. O pacote 956 foi verificado diretamente. Evidências de fluxo da revisão DEV continuam classificadas como anteriores até smoke direcionado do bundle candidato; não se presume equivalência byte a byte.
- `7807721` é o último SHA com recibo de ensaio integral da migração. Comparado a ele, o candidato contém as migrations `20261009140000_cancel_delivered_comanda_item` e `20261009180000_agenda_archive`, além do código de runtime que já aparece no pacote DEV `4555adf`. O ensaio integral de `7807721` não prova essas diferenças.
- O recibo RBAC local registra `84/84` etapas centrais e cenários transversais como PASS e referencia o SHA de release `4555adf`; entretanto, o recibo não fixa o tree de código usado em cada etapa. Usar como evidência do release referenciado, sujeita à confirmação de hash do pacote `956f3a6`, e não como uma certificação autossuficiente do candidato atual.

## 2. Inventário da migração prevista

### Migrations versionadas

O conjunto exato a avaliar é o contido no tree `ec7b1c1…`, com SQL e checksums obtidos dos blobs desse commit. A lista efetivamente pendente só pode ser calculada contra o ledger de uma cópia autorizada da origem; não há ledger atual autorizado nesta etapa.

Como referência histórica de escopo, o manifesto TAP-76 registra o schema de origem `66ec00886b65eaea8e437fae4e9a36f7be971b09`. O delta de diretórios de migration desse schema até o candidato contém:

```text
20261003180000_restrict_event_cash_history
20261003210000_additive_pdv_operational_core
20261003220000_pdv_catalog_configuration
20261004100000_pdv_session_restartable
20261004150000_pdv_finance_session_link
20261004170000_pdv_commerce_inventory_context
20261005180000_payment_historical_provenance
20261006120000_comanda_sale_session_context
20261006130000_pdv_tap_montage
20261007180000_product_independent_kitchen_order
20261007220000_individual_operational_permissions
20261007230000_individual_module_permissions
20261008090000_shift_catalog_permission
20261008120000_pdv_gamified_categories
20261009140000_cancel_delivered_comanda_item
20261009180000_agenda_archive
```

Esta lista é uma comparação de revisões versionadas, não uma afirmação de migrations pendentes hoje em qualquer banco. A evidência do SHA `7807721` não inclui as duas últimas da lista.

### Transformações, replays e ordem

O runbook [`pdv-unico-cutover-runbook.md`](../ops/pdv-unico-cutover-runbook.md) e os scripts versionados descrevem: preflight global e validação do ledger/checksums; migrations-base até `20261004150000_pdv_finance_session_link`; preparação de negócio, catálogo e contexto de cozinha; novo preflight comercial; migrations dependentes; migradores de negócio/TAP, catálogo, sessão, finanças, cozinha e comércio com replay; transformação de categorias canônicas; reconciliação integrada financeira/comercial; readiness e ativação por tenant.

O SQL de categorias `backend/prisma/transformations/pdv-gamified-categories-v1.sql` tem transformação inversa versionada em `rollback-pdv-gamified-categories-v1.sql`. Os demais migradores registram mapas, lotes, checkpoints e recibos; não há uma sequência geral de down-migrations para desfazer os dados. O rollback de dados é restore do checkpoint pré-migração validado. Backfills de `ConfiguracaoOperacional` e capacidade de caixa pertencem à bridge operacional documentada separadamente; não devem ser presumidos como parte automática deste corte.

### Ativação e tenants

- Os parâmetros atuais do executor são **DEV-only**: `--profile=dev`, confirmação do alvo `cervejaria_dev`, SHA e digest de migrations, arquivo de foto e prova de restore vinculada ao backup. O runner QA aceita um SHA explícito (`--commit`) e materializa blobs Git. Os IDs de tenant da allowlist e `PDV_CANONICAL_TENANTS` referem-se ao ensaio DEV e não são parâmetros autorizados para produção.
- A lista de tenants de produção a ativar e a lista explícita que permanecerá `LEGACY` não estão presentes em material autorizado desta etapa. Precisam de inventário e decisão operacional próprios, fora dos dados de DEV.
- O escopo SQL contém mudanças globais de schema e restrições; a ativação funcional é seletiva. A evidência QA documenta que tenants não selecionados mantêm o caminho LEGACY e não são mesclados. Isso não substitui a decisão sobre cada tenant real.
- O arquivo de fixture da foto indicado pelo runbook está presente no diretório temporário local e corresponde ao hash descrito no runbook. Ele é apenas fixture de QA; não representa dados nem autorização para copiar registros/imagens de produção. Nenhuma decisão de regularização de sessões ou pagamentos de teste DEV deve ser transportada.

### Compatibilidade

O bridge conserva campos/modelos/fallbacks legados; essa compatibilidade não autoriza assumir que a release anterior funciona após toda transformação. Migrations com FKs restritivas e alterações de permissionamento afetam schema/linhas em escopo global. Migradores de dados não têm rollback SQL universal. `scripts/prod/rollback.ps1` troca artefatos de aplicação, mas declara explicitamente que **não** reverte o banco. Compatibilidade da release anterior contra o schema migrado e recuperação do checkpoint precisam ser comprovadas no ensaio isolado do SHA fixado.

## 3. Matriz de gates

`PASS` nesta tabela só significa prova diretamente ligada ao candidato. Evidência sem tree/release idêntico está marcada como revisão anterior. Nenhum FAIL funcional foi confirmado para `956f3a6`; isso não equivale a aprovação.

| Gate | Estado | Evidência / lacuna |
|---|---|---|
| Identidade Git do candidato | **PASS** | SHA/tree fixos em `origin/main`; diferente de HEAD e da árvore de trabalho. |
| Pacote imutável e builds backend/frontend do candidato | **PASS** | Pacote 956 já materializado, hashes/builds/scan verificados e manifesto novamente validado nesta etapa; sem rebuild. |
| RBAC, isolamento de permissões e cenários transversais | **Evidência válida para revisão anterior; impacto pendente** | [`rbac-completion-receipt.json`](../../artifacts/rbac-permissions-ui-2026-10-10/results/rbac-completion-receipt.json): 84 etapas centrais PASS e transversais PASS, release indicada `4555adf`; tree por etapa não consta no recibo. Transferir após comparação dos hashes compilados e confirmação do vínculo da execução. |
| Caixa, abertura/fechamento e virada do dia | **Evidência válida para revisão anterior; impacto pendente** | Existem recibos/UI de DEV e QA. Vincular aos hashes do artefato candidato; focar regressão de caixa/virada se o build divergir. |
| Vendas, pagamentos, dívidas e estornos | **Evidência válida para revisão anterior; impacto pendente** | O ensaio integral anterior preservou invariantes de pagamentos e incluiu operação autenticada em QA; RBAC possui casos de receber/fechar/reembolsar. Não há replay integral amarrado ao candidato atual. |
| Catálogo/cardápios, cozinha, cancelamentos e estoque | **Evidência válida para revisão anterior; impacto pendente** | Manifestos e recibos de QA cobrem etapas dessas áreas; repetir apenas se hash/build mudar e no fluxo completo de corte do candidato. |
| Portal e relatórios | **Evidência válida para revisão anterior; impacto pendente** | Cobertura funcional registrada em revisões anteriores, sem recibo de release para `956f3a6`. |
| Isolamento de tenant e preservação de LEGACY | **Evidência válida para revisão anterior; impacto pendente** | QA anterior verificou preflight, isolamento, sentinel e tenant não selecionado em LEGACY. Repetir com fixtures sintéticas na execução integral do SHA fixado. |
| Migrations, transformações, replay e retomada | **FAIL no preflight; execução pendente** | O restore da cópia 10/10 revelou 27 checksums de migrations aplicadas diferentes dos SQL do candidato. Nenhuma migration foi iniciada; ledger intacto. Evidência de `7807721` permanece histórica. |
| Restore de backup | **PASS para cópias históricas** | Cópias 29/09 e 10/10 restauradas em PostgreSQL descartável; schema/ledger extraídos da própria cópia. Isso não confirma estado atual de PRD. |
| Release anterior e recuperação | **Evidência histórica PASS para 29/09; atual pendente** | Manifesto c55 encontrado e recibo de readiness/rollback para a cópia 29/09. Sem prova pós-candidato nem compatibilidade no snapshot 10/10. |
| FAIL confirmado para o candidato | **Sim — checksum de ledger** | 27 aplicações históricas divergem do pacote atual; gate de preflight bloqueia. Não editar ledger. |
| Autorização/janela PRD | **PENDENTE** | Fora do escopo da etapa e sem qualquer consulta ou operação em PRD. |

## 4. Materiais para o ensaio e lacunas

| Material | Disponível nesta etapa | Uso/limite |
|---|---|---|
| Commit candidato, migrations, scripts e manifests versionados | Sim, Git `origin/main` em `956f3a6` | Fonte imutável para build e ensaio; não usar HEAD/arquivos locais. |
| Pacote do candidato e do release DEV | Sim, para `956f3a6` e `4555adf` | Manifesto do candidato PASS. Bundle frontend não byte equivalente; manter smoke RBAC focado pendente. |
| Pacotes anteriores locais de DEV | Sim, em `deploy/release-candidates` e snapshots DEV | Não comprovam qual é o artefato anterior de produção. |
| Recibos de ensaio isolado e QA | Sim, para `888a4a8` e `7807721` | Evidência histórica útil; não está ligada ao backup/schema/ledger de uma futura cópia. |
| Fixture autorizada de foto para QA | Sim, local e identificada pelo hash do runbook | Não transportar sua decisão nem quaisquer registros de dados de teste para PRD. |
| Cópias pré-migração arquivadas | **Encontradas** | Backups de ensaio em setembro e backups diários arquivados de 04 a 10/10. Cópias 29/09 e 10/10 restauradas; hash/data/proveniência constam no adendo e recibo. São snapshots históricos, não estado atual. |
| Schema e ledger ligados à mesma cópia | **Disponíveis; checksum FAIL** | Schema e ledger sanitizado extraídos do restore 10/10. Pendências calculadas contra o pacote; 27 divergências impedem avanço seguro. |
| Arquivos persistentes | **Parciais** | Uploads/logos arquivados de 25/09, não vinculados ao snapshot 10/10. Inventário/cópia correspondente ao checkpoint escolhido ainda necessário. |
| Release anterior e prova de restore | **Encontrados com limite** | Release c55 e manifesto/hashes dos arquivos referenciados verificados. Recibo histórico vinculado ao dump 29/09; não é prova de recuperação pós-candidato ou do snapshot 10/10. |
| Dados e recibos de regularização DEV | Existem, mas **excluídos do ensaio de produção** | Sessões e pagamentos PIX de teste não são regra de migração nem autorização para saneamento/copiar dados. |

## 5. Testes mínimos antes de fechar os gates

1. Investigar em artefatos imutáveis de release/CI as versões SQL que produziram os 27 checksums já aplicados no snapshot 10/10. Não substituir nem reparar linhas do ledger. Se não houver correspondência segura, criar novo candidato com correções aditivas e revalidar apenas os gates afetados.
2. Reexecutar o preflight de checksums sobre a cópia arquivada e confirmar zero divergências antes de aplicar qualquer migration.
3. Só então executar a sequência integral do runbook em PostgreSQL descartável: migrations-base, preparação de negócio/catálogo/cozinha, migrations dependentes, transformações/replays, retry/interrupção e reconciliação por tenant/LEGACY.
4. Após a migração, executar jornadas autenticadas representativas de caixa/virada, venda/pagamento/dívida, catálogo/cardápio, cozinha/cancelamento/estorno, estoque, portal e relatórios; fazer um smoke RBAC focado na diferença do bundle, sem repetir a matriz 84/84.
5. Injetar falhas em fases confirmadas da sequência; restaurar checkpoint. Iniciar a release c55 contra a cópia compatível e conferir login sintético, leitura e integridade; medir restore DB, recuperação de aplicação e rollback de código separadamente.

## 6. Riscos concretos e decisão de próxima etapa

- Os recibos de `7807721` não exercitam todas as migrations/código atuais; presumir equivalência deixa risco em schema/ledger e no encadeamento de retomada.
- O snapshot arquivado de 10/10 e seu ledger existem, mas 27 checksums aplicados divergem do candidato; aplicar migrations sem resolver a história pode mascarar drift ou bloquear o motor no meio do corte.
- O inventário de uploads está defasado em relação à cópia SQL 10/10; não há prova de que o conjunto persistente corresponde ao snapshot escolhido.
- Os tenants DEV allowlisted não definem tenants de produção. Ativação errada pode mudar operação de tenants que deveriam continuar `LEGACY`.
- Rollback de release não desfaz migrations/dados. A recuperação segura depende de backup restaurável e prova de compatibilidade da release anterior.
- Mudanças locais paralelas tornam proibido usar `HEAD`, working tree, dados/artifacts não rastreados ou branch local como origem do candidato.

**Próxima etapa executável:** recuperar e validar os SQL históricos correspondentes aos 27 checksums, ou fixar novo SHA com migrations aditivas sem editar ledger. Em paralelo, obter inventário de uploads correspondente ao snapshot escolhido. Reexecutar preflight; somente após PASS executar ensaio integral e recovery em banco isolado. Primeiro gate operacional continua **NO-GO**.

### Separação QA/DEV e janela de produção

**Concluído agora em QA isolado:** pacote/manifesto candidato verificado, busca de arquivos históricos, validação de hashes/sidecars, restore de dois snapshots e extração schema/ledger. **Pode continuar em QA/DEV:** investigar SQL históricos, corrigir estratégia de migrations em candidato futuro e atualizar inventário de arquivos sem acessar PRD.

**Dependerá de autorização futura para janela PRD:** obter checkpoint e arquivos persistentes contemporâneos, freeze de escrita, lista aprovada de tenants a ativar/manter `LEGACY`, confirmação de janela e responsáveis, execução e publicação, smoke/monitoramento e decisão de rollback. Esta documentação não concede tal autorização.

**TAP-76:** permanece `In Progress`; prioridade `High`; labels `Quality`, `Product`. Esta etapa não satisfaz todos os gates do item e não solicita seu encerramento.

## 7. Etapa 2 — pacote fixado e ensaio bloqueado por material de origem

**Executada em:** 10/10/2026 UTC. **Candidato-fonte:** `956f3a64e67fc3016a177426364f625c2682212d`, tree `ec7b1c159f3f1184142c142e5f4f7db53455c0fd`. O `HEAD` local continuou em `c86ad3fe59d178520a08b81ffff316231a36f807`; nenhuma troca, reset, merge ou rebase foi feita. O ensaio de dados não foi iniciado porque não há uma cópia de origem autorizada, com schema e ledger vinculados, disponível nesta rodada. Não se usou DEV regularizado.

### Pacote retido

O pacote foi preparado por `scripts/dev/prepare-dev-release.ps1 -ExpectedReleaseSha 956f3a64e67fc3016a177426364f625c2682212d`, que exporta com `git archive` e constrói a partir do snapshot, sem ler o working tree como fonte. `npm ci` instalou as dependências de ambos os lockfiles; o postinstall gerou Prisma Client `6.19.3`; backend `build:deploy` e frontend `build:deploy` terminaram com sucesso em Node `v24.18.0` / npm `11.16.0`.

| Artefato | Local | Digest |
|---|---|---|
| Candidato compilado | `deploy/release-candidates/956f3a64e67fc3016a177426364f625c2682212d/` | manifest SHA-256 `3df23fdeb0e0b9a722e94f3d2e25e9e39c5563b326686ce04822a25a2e405365` |
| Dependências isoladas | `deploy/dev-runtime-dependencies/956f3a64e67fc3016a177426364f625c2682212d/` | manifest SHA-256 `4c8eb09651253f25f2354be437cf531721cede9e5c6cc2e9b435b20345122c1d` |
| Prisma Client gerado | `deploy/dev-runtime-dependencies/956f3a64e67fc3016a177426364f625c2682212d/prisma-client-manifest.json` | SHA-256 `1064ea7ab8e49d60e67d345a44cf4e5743dbc4bcd521ed46178052e0cfebaa59` |
| Bundle backend | `backend/dist/index.js` dentro do candidato | `15462de941d798c3215f81fae2354f6145c1bf5c2b19da8796149011ece6f4e6` |
| `package-lock.json` backend | mesmo pacote | `6b1bc47689165e65404ce4cac75ebb8fc36f5140a3e4549f8c43699e7b8a6b46` |
| Schema Prisma | mesmo pacote | `c63b918e56577dec92c843247eb43e39770bc2e645470f3f6a097dcaedf7d0d9` |

O manifesto lista 352 arquivos. `scripts/prod/verify-release-candidate.ps1`, com o caminho absoluto do candidato, retornou `CANDIDATE_CHECKSUM_RESULT=PASS`, `CANDIDATE_SECRET_SCAN=PASS` e `CANDIDATE_ARTIFACT_READY=YES`. O manifesto Prisma separado identifica os hashes do client gerado e engine, Prisma CLI/client `6.19.3`, lock e schema usados. Uma varredura estática dos artefatos compilados não encontrou caminho da árvore mutável (`C:\Users\Papai\Documents\Desenvolvimento\Cervejaria`). O build foi materializado do SHA e a pasta retida contém somente frontend compilado, `backend/dist`, `backend/prisma` e manifests/package lock. O audit dinâmico de imports durante o replay de QA continuará obrigatório no ensaio integral.

### Comparação DEV, RBAC e revisões certificadas

Comparando `4555adf8bcf36a6b0055c67bf1cb97b951a52bb9` com o candidato, Git não relata diferenças em `backend/src`, `frontend/src`, manifests/locks de dependências, configuração Vite, schema, migrations ou transformations. Os hashes do backend compilado, backend lock e schema também são iguais. A saída JavaScript do frontend não é byte-idêntica: o chunk mudou de nome `index-aM8pwxCG.js` para `index-CfmZH99r.js`; o diff de arquivos é composto pelos dois nomes de chunk, `index.html` e `sw.js`. O bundle candidato inclui o SHA esperado uma vez; substituir apenas o SHA não tornou os bundles iguais (os primeiros bytes também divergem). Logo, compilação e igualdade de fontes/entradas não demonstram por si só equivalência de saída.

O recibo RBAC `artifacts/rbac-permissions-ui-2026-10-10/results/rbac-completion-receipt.json` comprova `84/84` stages e transversais na revisão DEV `4555adf`, mas não identifica o tree por cenário. É evidência utilizável para a revisão anterior; o impacto do bundle frontend divergente permanece pendente. Não se repetiu a matriz completa. No ensaio candidato, executar somente um smoke de autorização por API e UI para permissões de pagamento/dívida/estorno, contemplando concedida, negada/revogada e invariância do estado, além de troca de tenant. Se os resultados e a origem do bundle explicarem a divergência como saída de build sem diferença funcional, transferir o recibo completo RBAC sem nova execução integral.

A evidência integral de `780772179d39173660c378a867898438f0aec765` / tree `e5ffe0dd400a9441907cd61cb5cb8d113d47bc9f` permanece histórica: não exercita `20261009140000_cancel_delivered_comanda_item` nem `20261009180000_agenda_archive`. O pacote atual não prova migrations, replay, API autenticada pós-migration nem recuperação.

### Matriz de gates na revisão fixada

| Gate | Estado | Prova / próxima verificação |
|---|---|---|
| SHA/tree e pacote imutável, checksums, secret scan | **PASS** | Manifesto retido e verificador oficial passaram; SHA/tree fixos acima. |
| Builds frontend/backend e Prisma Client | **PASS** | Builds do snapshot e geração do cliente 6.19.3 passaram. |
| Imports do workspace mutável | **PASS estático** | Nenhum caminho absoluto da árvore mutável nos artefatos; audit de imports em runtime continua PENDENTE até QA integral. |
| RBAC 84/84 | **Evidência válida para revisão anterior; impacto pendente** | Fontes e entradas funcionais iguais; bundle frontend difere além do SHA. Fazer apenas o smoke direcionado acima. |
| Caixa/virada; vendas/pagamentos/dívidas; catálogo/cardápios; cozinha/cancelamentos; estoque; portal/relatórios; isolamento/LEGACY | **Evidência válida para revisão anterior; impacto pendente** | Testes e recibos existentes não pertencem ao tree do candidato. Revalidar jornadas representativas no banco isolado após migração, sem matriz integral duplicada. |
| Migrations, transforms, backfills e replay | **PENDENTE** | Falta origem autorizada com schema e ledger; não há cálculo de pendência nem reconciliação por tenant. Nenhum FAIL atual confirmado. |
| Restore do banco/checkpoint e retomada após interrupção | **PENDENTE** | Falta cópia autorizada e prova vinculada. Não foi restaurado banco. |
| Compatibilidade da release anterior sobre banco restaurado | **PENDENTE** | Falta artifact/manifesto da release anterior de PRD; nenhum teste nem tempo medido. |
| Rollback completo da aplicação | **PENDENTE** | Além do pacote antigo, faltam arquivos persistentes/prova de restore da origem. Rollback de código não substitui restore do banco. |
| FAIL confirmado | **Nenhum confirmado** | Bloqueio por ausência de evidência/material não é classificado como falha funcional. |
| Janela/autorização de produção | **PENDENTE — NO-GO** | Sem pedido, acesso ou alteração a PRD. |

### Migração, dados e materiais

> **Atualização:** as ausências abaixo foram registradas antes de seguir as referências históricas. O inventário e o estado corrigido estão no adendo final; para status atual da preparação, prevalecem o adendo e o recibo vinculado.

Inventário de origem disponível em Git: migrations SQL/checksums do SHA, migrations `cancel_delivered_comanda_item` e `agenda_archive`, transformations versionadas, migradores/replays e executor com ordem documentada no [`pdv-unico-cutover-runbook.md`](../ops/pdv-unico-cutover-runbook.md). O caminho documentado valida o ledger antes de aplicar; executa o lote base até `20261004150000_pdv_finance_session_link`, prepara dados de negócio/catálogo/contexto de cozinha, aplica migrations dependentes, executa transformações e replays de negócio/TAP, catálogo, sessão, finanças, cozinha e comércio, aplica categorias canônicas, reconcilia invariantes e só então avalia readiness/ativação seletiva. Rollback de categorias possui SQL inverso; transformações/replays restantes não têm down universal, e dependem do checkpoint pré-migration. Backfills de `ConfiguracaoOperacional`/capacidade de caixa são da bridge operacional e não são presumidos neste corte.

| Material | Situação da Etapa 2 |
|---|---|
| Candidato, manifests, SQL e scripts rastreados | Disponíveis; pacote imutável retido conforme acima. |
| Backup/cópia pré-migração arquivada | **Encontrada** | Backups arquivados em setembro e diários 04–10/10; restores 29/09 e 10/10 PASS. Hashes/tempos no adendo/recibo. Snapshot histórico, não estado atual. |
| Schema e ledger da mesma origem | **Extraídos; gate FAIL** | Schema/ledger extraídos do restore 10/10. 27 checksums aplicados divergem do pacote 956; não editar ledger. |
| Arquivos persistentes | **Parciais** | Há logos arquivados datados de 25/09; não há inventário/cópia correspondente ao snapshot 10/10. |
| Lista de tenants canônicos e LEGACY | **Faltante para produção.** Decisão/inventário autorizado por tenant; parâmetros DEV não são transportáveis. |
| Pacote anterior de produção e evidência de restore | **Encontrados com limite** | Release c55/manifesto e recibo de readiness/rollback para o dump 29/09; não prova compatibilidade após migrations candidatas nem com snapshot 10/10. |
| Evidência de restore antiga de QA e DEV regularizado | Existe, mas não substitui a origem nem será usado como cópia produtiva. Sessões antigas e PIX de teste permanecem fora do ensaio. |

Na análise inicial, antes de localizar os arquivos, não se havia aberto cópia local. A busca e os restores posteriores estão descritos no adendo. Nenhum runtime, serviço ou metadado ativo de produção foi consultado.

### Próximo ensaio mínimo executável após reconciliar o ledger

1. Recuperar os SQL imutáveis que correspondam aos 27 checksums aplicados ou fixar novo candidato aditivo; não modificar ledger.
2. Repetir preflight contra a cópia arquivada e exigir zero divergências antes de qualquer migration.
3. Aplicar sequência do runbook no banco descartável; testar transforms/replays, retry/interrupção, reconciliação financeira/comercial, vínculos, órfãos e isolamento por tenant/LEGACY.
4. Executar jornadas autenticadas representativas e smoke RBAC focado no bundle 956; não repetir 84/84 sem mudança funcional que o justifique.
5. Injetar falhas em fases confirmadas, restaurar checkpoint e iniciar release anterior sobre banco restaurado; medir restore DB, recuperação da aplicação e rollback de código separadamente.

**Decisão da Etapa 2:** **NO-GO** para solicitar janela PRD. As cópias arquivadas foram localizadas e restauradas; o gate de checksum é FAIL. Pode-se continuar em QA com SQL históricos e inventário persistente. Um checkpoint fresco e contemporâneo, tenants/LEGACY aprovados e janela dependerão de autorização futura.

**Versionamento desta entrega:** os documentos e recibo desta etapa estão completos no workspace. O commit/push isolado não foi feito: a política local rejeitou a operação com índice Git alternativo já tentada na etapa anterior; nenhum desvio dessa proteção foi usado. `commit SHA: none`; `push: bloqueado pela política local`. O estado `HEAD`, o índice e os demais arquivos/stashes foram preservados. `PROD_DEPLOY_REQUIRED=NO`.

## Adendo de validação de origem — 10/10/2026

Este adendo substitui as afirmações anteriores de que não havia cópia autorizada, schema/ledger, uploads ou release anterior arquivada. A busca percorreu `deploy/backups-production`, os recibos em `deploy/restore-drills`, a documentação TAP-33 de backup/restore e `previous-prod-artifacts`. Não abriu `private-config`, `deploy/prod-artifacts`, configuração ativa, runtime, serviço ou metadados de PRD; não gerou cópia nova.

### Materiais históricos localizados

Todos os itens abaixo são snapshots arquivados; datas, tamanhos e quantidades descrevem somente cada arquivo histórico, nunca o estado atual de PRD. Os sete backups diários têm sidecar `.sha256` e todos os sidecars conferem com os bytes do respectivo SQL. Foram restaurados em PostgreSQL descartável os snapshots de 29/09 e 10/10.

| Cópia arquivada | Tamanho | SHA-256 | Última gravação UTC | Proveniência/uso |
|---|---:|---|---|---|
| `deploy/backups-production/cutover-rehearsal-20260928/backup-prod-2026-09-28-232439.sql` | 5.912.708 B | `d8fb667fbe0483dac998e0ea0ca765c60f9c7a8424ee0d523a8bf70521fe833f` | 2026-09-29 02:24:39Z | Cópia listada no inventário de ensaio de cutover de 28/09. |
| `deploy/backups-production/cutover-predeploy-20260929/backup-prod-2026-09-29-014736.sql` | 5.912.708 B | `24b53c1fed6b7adbf46ae6e0f56b1ff308600cbb8e55fe5d71ad2d7a93f3ee1b` | 2026-09-29 04:47:36Z | Cópia pré-deploy arquivada. |
| `deploy/backups-production/cutover-predeploy-20260929/backup-prod-2026-09-29-015527.sql` | 5.912.708 B | `9d95afb84656cd081547fd44515fe0ad22cd3c636e8dea84cdb1262cbe97e24c` | 2026-09-29 04:55:28Z | Mesma cópia/hash citada no recibo histórico de restore e rollback. |
| `deploy/backups-production/cutover-warm-20260929/backup-prod-2026-09-29-070257.sql` | 5.912.708 B | `4ec09aa94075030d1f84c125c2ca606288e8b2d4067df6a8fa21fa17c5fda33d` | 2026-09-29 10:02:58Z | Cópia arquivada do ensaio warm. |
| `deploy/backups-production/cutover-T0-20260929/backup-prod-2026-09-29-071930.sql` | 5.912.708 B | `5471b918ad816dbaa464f79a9ce8595537efddfe86faa1efc1b9d6d37b816fb2` | 2026-09-29 10:19:31Z | Cópia arquivada do ensaio T0. |
| `deploy/backups-production/backup-prod-2026-10-04-031502.sql` | 13.524.354 B | `c464b66c49403eb726ad98d1e2b760567f32dfb951c365b0529e6c71b97cb71a` | 2026-10-04 06:15:03Z | Backup diário arquivado; sidecar validado. |
| `deploy/backups-production/backup-prod-2026-10-05-031502.sql` | 13.524.355 B | `38c37883932e1759db919aa22f8b97812aaade9437efd1dafec759c0c5c99b41` | 2026-10-05 06:15:03Z | Backup diário arquivado; sidecar validado. |
| `deploy/backups-production/backup-prod-2026-10-06-031502.sql` | 13.524.355 B | `af79aa7b7fda9ca4c0f8f7402ec776718c91f47738fefdf4e79bcc5d3339b76d` | 2026-10-06 06:15:03Z | Backup diário arquivado; sidecar validado. |
| `deploy/backups-production/backup-prod-2026-10-07-031502.sql` | 13.525.069 B | `b7ff13841607b5a6859bc3dc187cb0586ecec0dfb3e65cb922ab3417ea927c6b` | 2026-10-07 06:15:02Z | Backup diário arquivado; sidecar validado. |
| `deploy/backups-production/backup-prod-2026-10-08-031502.sql` | 16.554.342 B | `f314068ec1531ea666b38e1a78aef4a4a2b7b5da2ebe19bdb1f32c721000d168` | 2026-10-08 06:15:03Z | Backup diário arquivado; sidecar validado. |
| `deploy/backups-production/backup-prod-2026-10-09-031502.sql` | 16.562.973 B | `fec53188f843fe107c9b17e391b5d3757d2d9377aa4f4a2273129c42eb89af26` | 2026-10-09 06:15:03Z | Backup diário arquivado; sidecar validado. |
| `deploy/backups-production/backup-prod-2026-10-10-031502.sql` | 18.419.622 B | `60c570f4798b935e874a0bd41bb0b1ee33555f571a87f8168f125eaa3f7ab8a1` | 2026-10-10 06:15:02Z | Cópia diária mais recente encontrada; `.sha256` confere. Não prova o estado atual da produção. |

Os backups diários de 04 a 10/10 têm sidecars de 101 bytes, cada um conferido com o hash do SQL. O SHA-256 do sidecar de 10/10 é `f418dc6132d5681cf3b4a5205c681ceb2f09642db7822a2d9ad66004d9717f2d`; o de 04/10 é `0e29fb58c9a751a54b0343ac1a56e769385e01a52381777e0b1905f5e10d3cec`. O nome/caminho e o sidecar são evidência local de proveniência, não assinatura independente do produtor.

### Restore e gate de histórico de migrations

O snapshot de 10/10 foi restaurado em banco descartável no PostgreSQL da imagem fixada `postgres@sha256:e013e867e712fec275706a6c51c966f0bb0c93cfa8f51000f85a15f9865a28cb`, rede Docker `Internal=true`, disco temporário em `tmpfs`; restore PASS em 4.105 ms. O snapshot de 29/09 também restaurou, PASS em 3.689 ms. Os containers e a rede próprios do ensaio foram removidos depois das consultas. Nenhuma migration foi aplicada e nenhum ledger foi alterado.

O schema foi extraído da restauração de 10/10, não exigido como arquivo separado: [`source-schema-20261010.sql`](../../deploy/restore-drills/source-schema-20261010.sql), 83.541 B, SHA-256 `89753de4a2555936e15a31cbbaedf4614d44e89965ba902b4245b0ce7f6865dc`; schemas `public` e `quiosque`. O ledger foi exportado como metadados apenas (nome, checksum e estado/timestamp), sem logs ou linhas de negócio: [`source-ledger-20261010.sanitized.txt`](../../deploy/restore-drills/source-ledger-20261010.sanitized.txt), 12.154 B, SHA-256 `fbf876f4583053e8ffd986ed652b360aa6057982ffa8b4916e48c9c0f991a290`. Ele contém tentativas e reexecuções; a comparação considera apenas aplicações concluídas e não revertidas. No retrato 10/10, o ledger tem aplicações históricas e migrations pendentes; esses totais pertencem apenas a esse snapshot, não são contagem atual de PRD. Esse snapshot é anterior à transformação/corte pretendido.

**FAIL confirmado — checksum do ledger.** Comparando os checksums aplicados do snapshot de 10/10 com os arquivos `migration.sql` do pacote imutável 956f3a6, 27 migrations já concluídas divergem. O snapshot arquivado de 29/09 também diverge em seis migrations já concluídas. A sequência atual valida nome e checksum antes de aplicar; portanto o gate bloqueia antes da primeira migration. Essa é divergência entre histórico de origem e SQL do candidato, não prova de corrupção de linhas; não se executou `migrate deploy`, transformação ou replay e o ledger permaneceu intacto. Os nomes exatos das 27 divergências estão no recibo JSON.

| Gate de origem/ensaio | Estado | Evidência |
|---|---|---|
| Integridade do backup 10/10 e sidecar | **PASS** | SHA local confere; restauração `ON_ERROR_STOP=1` concluída em PostgreSQL descartável. |
| Schema/ledger extraídos da própria cópia | **PASS** | Hashes acima; schema e ledger pertencem ao mesmo banco restaurado. |
| Ledger compatível com SQL do candidato | **FAIL** | 27 checksums divergentes no snapshot 10/10; seis no snapshot 29/09. Não contornar nem editar ledger. |
| Migrations, transforms, replays, retry/retomada | **PENDENTE** | Bloqueados pelo gate de checksum; sequência não iniciada. |
| Reconciliação por tenant e jornadas pós-migração | **PENDENTE** | Dependem de aplicar a sequência segura primeiro. Saneamentos de DEV e autorizações financeiras de DEV não foram lidos nem aplicados. |
| Smoke RBAC focado no bundle do candidato | **PENDENTE** | A evidência 84/84 pertence à revisão DEV 4555; fontes funcionais não diferem, mas o bundle candidato difere além da substituição do SHA. Não repetir a matriz integral; fazer apenas o smoke direcionado após ambiente candidato migrado. |

### Matriz consolidada dos gates

| Gate | Classificação | Base e próximo passo mínimo |
|---|---|---|
| Identidade SHA/tree, pacote imutável, dependências fixadas, Prisma Client e busca de secrets | **PASS para o candidato** | Manifesto 956f3a6 validado novamente; não houve rebuild. |
| Build frontend/backend e auditoria estática de imports mutáveis | **PASS para o candidato** | Recibo e manifesto da preparação anterior; execução desta etapa usou pacote imutável. |
| RBAC 84/84 e cenários transversais | **Evidência válida para revisão anterior; impacto pendente** | Revisão DEV 4555. Código-fonte funcional é igual, bundle não é byte equivalente; repetir somente smoke de permissão/rota afetada no bundle candidato. |
| Caixa, virada do dia, vendas, pagamentos, dívidas, catálogo/cardápios, cozinha/cancelamentos, estoque, portal, relatórios e tenant isolation | **Evidência válida para revisão anterior; impacto pendente** | Não repetir a matriz completa; executar jornadas representativas autenticadas por tenant/contrato e LEGACY após migrations e replay aprovados. |
| Restore PostgreSQL de cópia histórica | **PASS** | Restore integral sem erro para as cópias arquivadas 29/09 e 10/10, em banco descartável privado; schema/ledger extraídos da cópia. |
| Checksum das migrations aplicadas contra o candidato | **FAIL confirmado** | Divergem 27 migrations já aplicadas na cópia 10/10. O preflight documentado deve bloquear. |
| Aplicação das migrations, transformações, replays, retry, idempotência e retomada | **PENDENTE bloqueado pelo FAIL** | Não iniciado; não editar ledger. Primeiro reconciliar as versões SQL que produziram os checksums ou fixar candidato aditivo revisado. |
| Reconciliação financeira/comercial e integridade por tenant | **PENDENTE** | Não houve transformação. Executar sobre a mesma cópia após preflight aprovado, sem inferência temporal nem aprovações de DEV. |
| Jornadas autenticadas pós-migração e smoke RBAC focado | **PENDENTE** | Dependem de migração candidata íntegra e identidade sintética autorizada no QA. |
| Recuperação de código anterior em snapshot de 29/09 | **Evidência histórica PASS** | Recibo vinculado ao mesmo SHA de backup, release c55, readiness PASS e duração total registrada. |
| Release anterior/readiness/login sobre snapshot de 10/10 e banco pós-candidato | **PENDENTE** | `/api/health` local passou; rede interna impediu leitura DB do processo host. Sem login e sem prova pós-migração. |
| Uploads/arquivos persistentes do snapshot 10/10 e rollback completo | **PENDENTE** | Só existe inventário datado de 25/09; obter cópia/inventário correspondente ao checkpoint escolhido. |
| Injeção de falhas e restore de checkpoint pós-transformação | **PENDENTE** | Ainda não houve mutação de ensaio; executar quando a sequência íntegra puder avançar. |
| Janela de produção | **PENDENTE — NO-GO** | Depende de resolver checksum, concluir ensaio integral, checkpoint final e autorização futura. Nenhuma ação de PRD foi feita. |

### Release anterior e arquivos persistentes

O pacote anterior preservado está em `deploy/backups-production/cutover-predeploy-20260929/previous-prod-artifacts`, manifesto SHA-256 `b1de20b7722020f9c5e507ead2bea03fe3d55008392b4169fe1678c4cea6d654`, release `c55abc0a6d96fb2659d4ee32c214a21d3c56bf1a`, implantada em 25/09/2026 02:09:36Z. O arquivo arquivado contém 18.293 arquivos e 449.010.904 B (medidas do pacote histórico). Os quatro arquivos cobertos pelo manifesto (HTML, JS, CSS e entry backend) conferem; `backend/package-lock.json` SHA `acb93de95a9a0de767b5596e35baed43e92ed7f75c29ddd66e107730b85ed456`; schema SHA `4eb6a16766cf5721425f7b6a1d7ff87c6cd8d677cfc851be20d4e79927ecd3c1`; Prisma Client instalado `6.19.3`. A cópia foi preservada e não alterada. O manifesto valida os assets referenciados, não fornece digest agregado de cada arquivo de dependência.

O recibo histórico `rollback-drill-20260929-050929.json` usa exatamente o dump de 29/09 com SHA acima e release c55: readiness PASS, banco temporário removido, `productionDatabaseTouched=false`, duração total 27.038 s; o recibo de restore vinculado mediu 1.478 s. Isso comprova aquele ensaio histórico, não compatibilidade depois das migrations candidatas nem recuperação atual completa. Nesta rodada a API arquivada respondeu `/api/health` 200 em loopback; o teste local de `/api/ready` não foi conclusivo porque a rede isolada não publica a porta do PostgreSQL ao host. Nenhum login foi tentado sem credencial de teste autorizada.

Existe um inventário/cópia de uploads em `deploy/backups-production/cutover-predeploy-20260929/uploads-prod/logos`, mas datado de 25/09: `cmr9yis3c0000hvu00q9fe7y1.webp` (47.354 B, SHA-256 `507967e2561d270bab4c5b9101d12dfab4117e31e479fc6218b9f206b644e50c`, 2026-09-25 02:18:27Z) e `cmsry9xrn0000hvlgopjxy0oo.webp` (29.882 B, SHA-256 `b87bbc98b4cae92d37ba15cc532451c2cfae9facd7c5e24d3174aa37307a9f6c`, 2026-09-25 18:48:03Z). Não há inventário/cópia de uploads correspondente ao snapshot de 10/10. Também há `deploy/backups-production/cutover-predeploy-20260929/runtime-state/alert-poller-state.json` (214 B, UTC 2026-09-29 05:04:04Z, SHA-256 `1f796e4f7c9e3ab8ca57449e1ee038104d35b68d661ed34ae2ae7f44018a79c4`); não foi aberto. `private-config` permaneceu intocado. Portanto não se declara rollback completo da aplicação para o snapshot mais recente.

### Ação executável e decisão

1. Obter de artefatos de release/CI preservados o SQL imutável que corresponda aos 27 checksums já gravados na cópia 10/10; compará-lo com a história Git e explicar cada divergência. Alternativamente, corrigir a história de migrations com estratégia aditiva em novo SHA candidato. Não editar ledger nem renomear migration para fazê-lo passar.
2. Fornecer inventário/cópia de arquivos persistentes correspondente ao snapshot escolhido e identidades sintéticas/credenciais de ensaio. Manter o backup 10/10 apenas como snapshot histórico, não como checkpoint final.
3. Depois de um preflight sem divergências, executar em banco privado descartável a ordem do runbook: migrations-base, preparação de negócio/catálogo/cozinha, migrations dependentes, transformações/replays, reconciliação, retry/interrupção e jornadas autenticadas; usar somente os tenants/LEGACY formalmente previstos, sem fixtures financeiras de DEV.
4. Restaurar checkpoint e testar release anterior, login sintético, leitura e integridade no mesmo ambiente isolado; medir restore DB, recuperação da aplicação e rollback de código separadamente. Repetir só os gates afetados pela nova revisão/bundle.

**Decisão permanece NO-GO.** Em QA/DEV pode-se agora investigar os 27 SQL históricos, obter release artifacts e corrigir/validar o preflight em snapshot descartável. Nenhuma autorização futura de janela elimina a necessidade de um checkpoint novo, inventário de persistência correspondente e autorização explícita para coletá-los/usar a cópia na janela. PRD não foi consultado nem alterado.

**Versão/Plane:** o manifesto do pacote candidato foi verificado novamente, PASS; nenhum rebuild ocorreu. `HEAD`, índice, stashes e trabalho paralelo foram preservados. O commit/push segue bloqueado pela rejeição anterior da política; não houve nova tentativa de versionamento. TAP-76 permanece In Progress, sem mudança de título, prioridade, labels ou estado.






## 7. Investigação e ensaio dos checksums — atualização de 10/10/2026

Esta seção substitui os status anteriores de preflight e ensaio. O pacote imutável original 956f3a64e67fc3016a177426364f625c2682212d não foi alterado. Nenhuma ação tocou PRD.

### Causa comprovada e recuperação dos SQLs

Foram lidas as 85 entradas aplicadas do ledger sanitizado extraído do backup backup-prod-2026-10-10-031502.sql (SHA-256 60c570f4798b935e874a0bd41bb0b1ee33555f571a87f8168f125eaa3f7ab8a1). Em cada uma das 27 divergências, o hash dos bytes do blob Git do candidato é exatamente o hash do ledger. Blobs e pacote são UTF-8 válido, sem BOM. Os bytes do pacote candidato têm CRLF, enquanto os blobs e o ledger têm LF; a comparação adicional, feita somente depois de guardar os hashes originais, confirma que a única diferença entre esses bytes é a inserção de CR antes de LF. Portanto, não há alteração funcional de SQL nesses 27 casos.

O Git local está configurado com core.autocrlf=true e não há atributos text/eol/filter definidos para esses SQLs. O preparador versionado em scripts/prod/release-candidate.ps1 copia backend/prisma da árvore de trabalho para o pacote. Essa cópia converte os 27 arquivos LF em CRLF. Os 58 demais SQLs aplicados já conferem exatamente com o pacote original e foram mantidos como estavam; normalizar todos os 101 arquivos recriaria divergências, portanto não é a correção.

Todos os 27 SQLs exatos foram recuperados dos blobs históricos do candidato. A tabela registra hashes, tamanhos, proveniência Git e EOL. SHA é calculado nos bytes originais, sem normalização. A busca examinou 1849 arquivos migration.sql arquivados sob deploy; nenhum deles continha esses 27 hashes, então a fonte comprovada é o histórico Git. Recibo completo em deploy/restore-drills/sql-checksum-audit-20261010.json (SHA-256 b4a8ee178033a601598af29139f7e468fcbbe0121b40d4ee47e68b7bbd8dfc75).

| Migration | SHA-256 ledger | SHA-256 blob Git | SHA-256 pacote 956 | Commit histórico | Bytes e EOL (blob → pacote) | Classificação |
|---|---|---|---|---|---|---|
| 20260731162046_modulo_quiosque_fundacao | 543431c37fee4847faff6f4f516ce32cbd04d0ceadc19834e339f6f6333bcb61 | 543431c37fee4847faff6f4f516ce32cbd04d0ceadc19834e339f6f6333bcb61 | be300e58f4f89b8b6878c4e98baaf9f1c7779879131b5697ca4733c989955560 | b9c89d76b08f543a1c2a126727eb98de502edf66 | 2260 → 2318; LF=58; CRLF=0; BOM=false; LF=0; CRLF=58; BOM=false | SQL exato no blob Git; pacote alterado só por CRLF |
| 20260731162815_quiosque_modo_exclusivo | f26cf40f30f748eaba1ba24818c7d748304fdb0373e2b33e81ff132c215e586b | f26cf40f30f748eaba1ba24818c7d748304fdb0373e2b33e81ff132c215e586b | f71a7daa555f3a28fc42221c61d8f626b353103b06b8649b75f24f02906684f1 | 3894599c59592eafbf6db44b355ed38381b4e58c | 119 → 121; LF=2; CRLF=0; BOM=false; LF=0; CRLF=2; BOM=false | SQL exato no blob Git; pacote alterado só por CRLF |
| 20260731180005_pdv_quiosque | 38d4df2e1fbb1d36fa8f21480f106b32b692267172bc2542ed8af40bae37c2f6 | 38d4df2e1fbb1d36fa8f21480f106b32b692267172bc2542ed8af40bae37c2f6 | e1c74dd4278c5a0c015a5390c1d19783a9bde0f415264b3c8b77889898dafcfa | 76eb5e187e4214af62b59926abeae4db72304312 | 5207 → 5328; LF=121; CRLF=0; BOM=false; LF=0; CRLF=121; BOM=false | SQL exato no blob Git; pacote alterado só por CRLF |
| 20260806225944_caixa_quiosque | c2d3e1327fe096a33ec945fc95b8465de4b8122cd3ee5bd045f52b2f9e09656f | c2d3e1327fe096a33ec945fc95b8465de4b8122cd3ee5bd045f52b2f9e09656f | 4542b783fa7c6f69c7be288163126ee2001b20415531f9fe784633598e96d8bd | c64a8c6f2605b12cba4e5045c53b66217c815ffe | 2419 → 2476; LF=57; CRLF=0; BOM=false; LF=0; CRLF=57; BOM=false | SQL exato no blob Git; pacote alterado só por CRLF |
| 20260806235600_estoque_quiosque | 3642ce0b1cb04c08f3a59e6e548817d643df88e8cd13373f326c1bde05a88ccb | 3642ce0b1cb04c08f3a59e6e548817d643df88e8cd13373f326c1bde05a88ccb | 99b55fe89d39ca02bda61d81032275bbac9e62dbd1cce3e01df5b88f10ccbd11 | e5fc6d92321f261c33d8fac0ae850a941e87664d | 3215 → 3278; LF=63; CRLF=0; BOM=false; LF=0; CRLF=63; BOM=false | SQL exato no blob Git; pacote alterado só por CRLF |
| 20260902120000_estoque_minimo_quiosque | ed3cfd6c11c804ea34e6b75fecf59195a343498e6c3b9faba4ae07b6e274f061 | ed3cfd6c11c804ea34e6b75fecf59195a343498e6c3b9faba4ae07b6e274f061 | 9f8d5098836dd5ab8cb325ad7d8e0353d5c069a06466fcc5010284343269c3aa | a0bb1da908062fd04608db5098f3567674cd0cc6 | 403 → 411; LF=8; CRLF=0; BOM=false; LF=0; CRLF=8; BOM=false | SQL exato no blob Git; pacote alterado só por CRLF |
| 20260924210000_operational_context_caixa | 0052572a068ef530b39f352b86ac6800b3b75466b1830159e66145e8413bafb9 | 0052572a068ef530b39f352b86ac6800b3b75466b1830159e66145e8413bafb9 | 2ea688fd6e992a0f19bf65fc380d0d029075ca039f811810c822e9123786cc76 | d45cf0f8a3c2657a22933d5d760f7b48b1704b2f | 248 → 252; LF=4; CRLF=0; BOM=false; LF=0; CRLF=4; BOM=false | SQL exato no blob Git; pacote alterado só por CRLF |
| 20260924211000_canonical_observability_events | 4330e24ab25d60bd2966daed416f08e614c420c6fc473e7ffc5a2f12d1ecc1ac | 4330e24ab25d60bd2966daed416f08e614c420c6fc473e7ffc5a2f12d1ecc1ac | f199b5c54a064fc8ca08d07a7dbe5b48170e7dfca18137af8154aa6d1a476fa8 | f49196067672e47f6132c4eb23a7124abb715bd2 | 1070 → 1083; LF=13; CRLF=0; BOM=false; LF=0; CRLF=13; BOM=false | SQL exato no blob Git; pacote alterado só por CRLF |
| 20260924211500_backfill_comanda_caixa | 1a54d22bf53cd8bfe160ef859ce522ad8bf96993476ac22f469fb4da305da5aa | 1a54d22bf53cd8bfe160ef859ce522ad8bf96993476ac22f469fb4da305da5aa | 375e8e510da0e7bf117333c73effd1db3fb095258efb4ccf20f4984f21efcc62 | d45cf0f8a3c2657a22933d5d760f7b48b1704b2f | 236 → 241; LF=5; CRLF=0; BOM=false; LF=0; CRLF=5; BOM=false | SQL exato no blob Git; pacote alterado só por CRLF |
| 20260924212000_rename_operational_discount_permission | a9f4b72591a92441e5e85397cab4f3ea028f486ce79c955f093bb66829d23d28 | a9f4b72591a92441e5e85397cab4f3ea028f486ce79c955f093bb66829d23d28 | e385f9b74f9c4d732b73d79d39f22affca2585404678faadbfc84ec2c1b76b66 | 40d150d14b7d3b8a3f196e7b5c5d99c164440c62 | 179 → 182; LF=3; CRLF=0; BOM=false; LF=0; CRLF=3; BOM=false | SQL exato no blob Git; pacote alterado só por CRLF |
| 20260925090000_pedido_para_viagem | 84abab206d6281bb26ca4f5c5815a4cde3ad0a60490711d9c48f7f3977be266c | 84abab206d6281bb26ca4f5c5815a4cde3ad0a60490711d9c48f7f3977be266c | 85d8c35c9b069407169a2a335702bcae502c0b25f9d3ffe8792f0b4f5c61930a | b7dcab3bc783643b4765484a348b92e8ac670f87 | 96 → 98; LF=2; CRLF=0; BOM=false; LF=0; CRLF=2; BOM=false | SQL exato no blob Git; pacote alterado só por CRLF |
| 20260925100000_item_comanda_para_viagem | d936a72b5331086de79b38d3e42d2798d110b80839fcd14b141a98052e82a85b | d936a72b5331086de79b38d3e42d2798d110b80839fcd14b141a98052e82a85b | f6d513a95d6cb51b3d82f3f3c991bc54e7351af70ff7eccd7171b1d1411ed49c | b7dcab3bc783643b4765484a348b92e8ac670f87 | 91 → 93; LF=2; CRLF=0; BOM=false; LF=0; CRLF=2; BOM=false | SQL exato no blob Git; pacote alterado só por CRLF |
| 20260925103000_event_kitchen_orders | c2cbd9acfe8abc6e62d0c0d805bc40d3abeb1cdf81d5e3bdda87a41597bd6bf3 | c2cbd9acfe8abc6e62d0c0d805bc40d3abeb1cdf81d5e3bdda87a41597bd6bf3 | 7632a00118f3dfac4164d0071bfbde4f79defe2d905ba22ddb879801c60450c8 | b7dcab3bc783643b4765484a348b92e8ac670f87 | 83 → 85; LF=2; CRLF=0; BOM=false; LF=0; CRLF=2; BOM=false | SQL exato no blob Git; pacote alterado só por CRLF |
| 20260926100000_produto_opcionais_observacao | 584fde5be0e3ab55f636699ea4c5dbf96266fa42e861702734087697d44944e3 | 584fde5be0e3ab55f636699ea4c5dbf96266fa42e861702734087697d44944e3 | d119031e10289dac426b9dfd2c8f45d82bab69ae9e143624e4d213606d50b56a | b7dcab3bc783643b4765484a348b92e8ac670f87 | 3622 → 3700; LF=78; CRLF=0; BOM=false; LF=0; CRLF=78; BOM=false | SQL exato no blob Git; pacote alterado só por CRLF |
| 20260926103000_opcionais_catalogo_global | e0014311b30a3fb4d94b1550d92eea8f553695fa330a1ab3c57712a02ccdd114 | e0014311b30a3fb4d94b1550d92eea8f553695fa330a1ab3c57712a02ccdd114 | 356b81602030aa841199c1f5d278e5e0b344be8ea575ddf1b9294b0d44b9ab89 | b7dcab3bc783643b4765484a348b92e8ac670f87 | 2439 → 2466; LF=27; CRLF=0; BOM=false; LF=0; CRLF=27; BOM=false | SQL exato no blob Git; pacote alterado só por CRLF |
| 20260926120000_contas_receber_operacao | 74022e4a49614fb63076c0836c046c52c8f29700cba7b4910958339fc7469e4d | 74022e4a49614fb63076c0836c046c52c8f29700cba7b4910958339fc7469e4d | 899093c87999f9a2a273dc81bece5033eecbb2a71473e657386e42fb29fe61e0 | b7dcab3bc783643b4765484a348b92e8ac670f87 | 1625 → 1659; LF=34; CRLF=0; BOM=false; LF=0; CRLF=34; BOM=false | SQL exato no blob Git; pacote alterado só por CRLF |
| 20260927120000_cancelamento_pendente_cozinha | 24077bf22b21faf8d7524887040771087b84c891c19724aa0f01cb8c91828e45 | 24077bf22b21faf8d7524887040771087b84c891c19724aa0f01cb8c91828e45 | 6d09f9fb5890f421f8ddcbf8633bc95a42fc756255195333ef85546a8f8209f0 | b7dcab3bc783643b4765484a348b92e8ac670f87 | 80 → 82; LF=2; CRLF=0; BOM=false; LF=0; CRLF=2; BOM=false | SQL exato no blob Git; pacote alterado só por CRLF |
| 20260927130000_cancelamento_item_comanda | 8daa5f324dc1759910e36706491b5ae96bcd651bb94ffee40addd4232fbd1f7f | 8daa5f324dc1759910e36706491b5ae96bcd651bb94ffee40addd4232fbd1f7f | 83291c7b05a4b66baa8fcad5116d5fab51359bfa72cd4ace0681a5b370abf68c | b7dcab3bc783643b4765484a348b92e8ac670f87 | 124 → 127; LF=3; CRLF=0; BOM=false; LF=0; CRLF=3; BOM=false | SQL exato no blob Git; pacote alterado só por CRLF |
| 20260927140000_portal_cliente_background | 2696d3030bde2b7946af4b9c6b76d81df3184a1e0633a3c9ab1eec9b181b0f09 | 2696d3030bde2b7946af4b9c6b76d81df3184a1e0633a3c9ab1eec9b181b0f09 | 759c0bcb644dd84c9c3cc7d4dbc6e695d36516da68d3cde9b093fae3c6fa92e6 | b7dcab3bc783643b4765484a348b92e8ac670f87 | 73 → 75; LF=2; CRLF=0; BOM=false; LF=0; CRLF=2; BOM=false | SQL exato no blob Git; pacote alterado só por CRLF |
| 20260927150000_operacao_categoria_ordem | 614737dc9ee0cf6fb7e3e463b1a4d78549a3284cb3e86a0f2bd751b687b66681 | 614737dc9ee0cf6fb7e3e463b1a4d78549a3284cb3e86a0f2bd751b687b66681 | 9e39063a9254eba85a730e204f37f77019efb15d58a998ea7beb8d05137f3389 | b7dcab3bc783643b4765484a348b92e8ac670f87 | 78 → 80; LF=2; CRLF=0; BOM=false; LF=0; CRLF=2; BOM=false | SQL exato no blob Git; pacote alterado só por CRLF |
| 20260927160000_aviso_pedido_pronto_whatsapp | a8d1cc41253a56c858fcca3a53aa76225755edbae27c4fc10724bec0dbc87b33 | a8d1cc41253a56c858fcca3a53aa76225755edbae27c4fc10724bec0dbc87b33 | fbbbf0a921b6df9be2fd64affecd1ee8851fa28e7e4e6b9d5ac6da6c8d56de26 | b7dcab3bc783643b4765484a348b92e8ac670f87 | 280 → 286; LF=6; CRLF=0; BOM=false; LF=0; CRLF=6; BOM=false | SQL exato no blob Git; pacote alterado só por CRLF |
| 20260927180000_unificar_cardapio_operacao | f7dfea537f01955b16e658d13f76547e9525c5f80d45179ad178498696e33e91 | f7dfea537f01955b16e658d13f76547e9525c5f80d45179ad178498696e33e91 | 780377c024e2a8aeb189670a79966d078de7950616e9539bb245952f40c2c562 | 9174f5cc50d808e1d90829d89259647447f1292a | 2074 → 2136; LF=62; CRLF=0; BOM=false; LF=0; CRLF=62; BOM=false | SQL exato no blob Git; pacote alterado só por CRLF |
| 20260927193000_tap_agnostico_evento_turno | d58c49eac4f95122d9cd6ad48fa94a82d8edceb31b9197c5393be20d774b0b50 | d58c49eac4f95122d9cd6ad48fa94a82d8edceb31b9197c5393be20d774b0b50 | 039fd47dfeb56363fa86813fd8782e0b4eebfbab3268fb356132325bbaca2d6d | 9174f5cc50d808e1d90829d89259647447f1292a | 1281 → 1317; LF=36; CRLF=0; BOM=false; LF=0; CRLF=36; BOM=false | SQL exato no blob Git; pacote alterado só por CRLF |
| 20260927210000_estoque_chope_litros | 51a38c2375d09b237d0269c24a0366cf52725d6ac28887479faf55e4f3436ff6 | 51a38c2375d09b237d0269c24a0366cf52725d6ac28887479faf55e4f3436ff6 | 269ca9c7ed6faa3eb774d72b7f6d1becd74e4560d8ac070b33f6aa2b8b41d2d8 | 9174f5cc50d808e1d90829d89259647447f1292a | 527 → 539; LF=12; CRLF=0; BOM=false; LF=0; CRLF=12; BOM=false | SQL exato no blob Git; pacote alterado só por CRLF |
| 20260927230000_cardapio_chope_volume_variants | 53927b83831f69175a183982737168fc489ed1f856b64318d429c3725dfff4da | 53927b83831f69175a183982737168fc489ed1f856b64318d429c3725dfff4da | 7e0d4155a07d23c7e8d635a7244cbca215eeaf43f2268c7fe6ab5085a9dfc622 | 9174f5cc50d808e1d90829d89259647447f1292a | 2556 → 2605; LF=49; CRLF=0; BOM=false; LF=0; CRLF=49; BOM=false | SQL exato no blob Git; pacote alterado só por CRLF |
| 20260928010000_cardapio_chope_volume_scope | b324257fe10dc486a158a6d499d32cc2d8a4c6938a3742a0402e1f99ac0b6723 | b324257fe10dc486a158a6d499d32cc2d8a4c6938a3742a0402e1f99ac0b6723 | 410394b7ab04e10c56a80f6bf10cc1b71b231e5f9d937e1ee2fe749cdadd901d | 9174f5cc50d808e1d90829d89259647447f1292a | 802 → 828; LF=26; CRLF=0; BOM=false; LF=0; CRLF=26; BOM=false | SQL exato no blob Git; pacote alterado só por CRLF |
| 20260928150000_first_access_operational_setup | 1a8a8e28c25ac5ffd114bf4d0ab3e1693eeab36b5caac84663f30063b0acbe43 | 1a8a8e28c25ac5ffd114bf4d0ab3e1693eeab36b5caac84663f30063b0acbe43 | f7050fc1f73eb989b40b589979c29d0212fd01e56d3a08d1cf6b159ba6124673 | 9174f5cc50d808e1d90829d89259647447f1292a | 178 → 183; LF=5; CRLF=0; BOM=false; LF=0; CRLF=5; BOM=false | SQL exato no blob Git; pacote alterado só por CRLF |

### Pacote QA e resultado de migrations

Foi criada uma cópia somente QA em deploy/restore-drills/qa-candidate-956f3a64e67fc3016a177426364f625c2682212d-snapshot-compatible. Ela deriva do pacote imutável 956, preserva os 58 SQLs que já conferem e substitui apenas os 27 SQLs pelo blob Git cujo hash já está registrado no ledger. O manifesto QA cobre 352 arquivos; todos os hashes conferem. Manifesto SHA-256: a1e4586f458f5e0681ffcbe58630f034b2d72bfbf30a62596378b78282f0a7b5. A cópia bruta “todos os blobs Git” foi deliberadamente descartada como candidato de ensaio: ela gera 58 novas divergências por ignorar a proveniência CRLF já aplicada.

O snapshot foi restaurado em PostgreSQL descartável em porta publicada somente em 127.0.0.1; o volume era tmpfs e o container foi removido ao final. O preflight comparou 85 entradas aplicadas e encontrou zero divergências. prisma migrate deploy aplicou as 16 migrations pendentes, incluindo cancel_delivered_comanda_item e agenda_archive, em 1.599 ms; migrate status confirmou schema atualizado e o ledger de ensaio tinha 101 entradas concluídas. Restore: 1.508 ms. Recibo: deploy/restore-drills/prisma-migration-drill-20261010.json.

Esse PASS prova as migrations SQL sobre uma cópia do snapshot com bytes históricos compatíveis. Não transforma o pacote imutável 956 em pacote liberável e não emite um novo SHA. O ensaio derivado não substitui um novo candidato imutável, preparado por código revisado e comprometido.

### Release anterior e recuperação

O artefato de produção arquivado c55 (SHA c55abc0a6d96fb2659d4ee32c214a21d3c56bf1a) iniciou no host ligado só à porta loopback do PostgreSQL descartável. Health e readiness responderam HTTP 200, e readiness confirmou a consulta ao banco. O login sintético falhou HTTP 500 com Prisma P2022. O código c55 espera Usuario.podeDarDescontoQuiosque; a migration 20260924212000_rename_operational_discount_permission já aplicada no ledger 10/10 renomeou a coluna para podeDarDescontoOperacao. Isso confirma que health/readiness não bastam e que rollback de código c55 sozinho não é compatível com a origem arquivada.

Medições desse ensaio: restore do banco 1.508 ms; migrations candidatas 1.479 ms; readiness da API antiga 1.088 ms; tentativa de login 20 ms; tempo total até falha de autenticação 6.542 ms. Não houve leitura autenticada nem recuperação completa. O artefato c55 não é uma release anterior compatível com o schema do snapshot; falta o pacote real da release que estava ativa imediatamente antes da nova migração ou outro caminho de rollback comprovado. A cópia de uploads do snapshot 10/10 também continua ausente.

### Gates restantes e limites do ensaio

| Gate | Estado atualizado | Evidência / próximo requisito |
|---|---|---|
| SQLs das 27 divergências | **PASS — bytes exatos recuperados** | 27/27 hashes do ledger correspondem a blobs Git históricos; pacote divergia só em EOL. |
| Preflight de checksum no pacote QA derivado | **PASS** | 85/85 entradas aplicadas; zero divergências; backup e ledger identificados acima. |
| Pacote imutável original 956 | **FAIL** | Manifesto continua íntegro, mas os 27 arquivos ainda têm CRLF incorreto. Foi preservado. |
| prisma migrate deploy | **PASS no ensaio QA** | 16 migrations aplicadas no PostgreSQL restaurado e descartável; migrate status atualizado. Nenhum ledger foi alterado manualmente. |
| UI de categorias e jornada de retry | **FAIL de QA focado** | No SHA 956, 9/10 testes passaram em duas execuções; o mesmo teste de salvar categoria expira porque o botão de submit é removido durante a atualização do modal. Falha do teste confirmada; sucesso funcional após retry não certificado. Recibos/hash registrados no JSON. |
| Transformações de dados, replay/idempotência/retomada, reconciliação por tenant e jornadas autenticadas | **PENDENTE** | O executor versionado disponível é DEV-scoped, contém os dois tenants e decisões de teste DEV, e exige configuração DEV. Não foi redirecionado ao snapshot. Falta lista aprovada de tenants a ativar/LEGACY e identidade sintética autenticada para cada contrato. |
| Recuperação da release anterior | **FAIL — c55 não autentica** | Harness corrigido em loopback. Health e readiness HTTP 200; login sintético HTTP 500/P2022. c55 espera podeDarDescontoQuiosque, renomeada na origem para podeDarDescontoOperacao. Readiness isolada não comprova recuperação. Restore DB 1.508 ms; migrations 1.479 ms; readiness antiga 1.088 ms; falha de login em 20 ms; total até falha 6.542 ms. Falta o pacote da release que estava ativa imediatamente antes da migração; não declarar rollback completo. |
| Uploads | **PENDENTE para snapshot 10/10** | Só há duas logos arquivadas datadas de 25/09; nenhuma cópia/inventário vinculado ao backup 10/10. Não abrir uploads ativos. |
| Candidato novo e autorização de produção | **NO-GO** | Corrigir o preparador, obter commit/SHA novo pelo fluxo autorizado, preparar pacote imutável e repetir gates. Versionamento segue bloqueado pela rejeição anterior; não houve nova tentativa Git de commit/push. |

O harness foi testado com DB limitado a 127.0.0.1. O container foi removido pelo próprio recibo. A verificação PowerShell do preparador alterado não foi executada: o comando focado anterior foi rejeitado pela política local; não foi repetido nem contornado. git diff --check não substitui esse teste.

**Decisão atual: NO-GO.** Próximo ensaio: corrigir o E2E de retry ou o comportamento de submit após fechar o modal; fixar novo SHA e pacote; repetir restore da cópia arquivada, validar ledger com pacote, e executar transformações somente com escopo explícito aprovado de tenant/LEGACY e identidades sintéticas. Adquirir/preservar o artefato da release imediatamente anterior que seja compatível com o schema atual ou provar que seu rollback requer restaurar outro checkpoint; manter o teste c55 como FAIL. Restaurar uploads a partir de inventário do mesmo snapshot e medir recuperação completa. Para futura janela produtiva será necessário checkpoint novo e autorização específica; o backup 10/10 é histórico, não checkpoint final.

## 8. Ensaio autorizado de origem, retomada e API — atualização de 11/10/2026

Esta seção substitui os estados pendentes de transformações, retry de categorias, identidades QA e smoke autenticado acima. O SHA candidato de origem continua `956f3a64e67fc3016a177426364f625c2682212d`, tree `ec7b1c159f3f1184142c142e5f4f7db53455c0fd`. O pacote imutável 956 original não foi sobrescrito. Nenhuma conexão, consulta, alteração, publicação ou migração em PRD ocorreu.

### Preparador e retry de categorias

O preparador `scripts/prod/release-candidate.ps1` foi ajustado localmente para preservar bytes por origem: os 58 SQLs com checksum do ledger continuam byte a byte como estavam; nos 27 casos, o preparador exige que o blob Git tenha o hash histórico aplicado antes de copiar seus bytes LF; migrations pendentes são materializadas dos blobs Git. A verificação compara hash do pacote com ledger ou blob conforme o estado da migration. Foram acrescentados casos de hash exato para LF/CRLF e BOM presente/ausente, inclusive os comportamentos diferentes dos 58 e 27 SQLs. A correção ainda não gerou SHA nem pacote imutável publicável: o teste Pester foi bloqueado pela política local de execução de scripts. Não foi usado bypass. Parse AST do PowerShell e `git diff --check` passaram; isso não substitui o Pester.

O teste de retry da UI foi corrigido no harness: o botão de salvar é removido no rerender que fecha o modal, então o seletor não pode ser reusado após o sucesso. O teste reenvia pelo campo que retém o rascunho e comprova exatamente duas tentativas, uma categoria persistida no estado de teste e nenhuma duplicação. O overlay sobre os blobs do SHA 956 passou **10/10**; o recibo `deploy/restore-drills/focused-categories-harness-20261010.json` vincula SHA/tree e hash do overlay. Essa prova é da UI/state E2E, não prova escrita por API autenticada.

### Origem, migrations e transformações

O dump autorizado de 10/10 (`backup-prod-2026-10-10-031502.sql`, SHA-256 `60c570f4798b935e874a0bd41bb0b1ee33555f571a87f8168f125eaa3f7ab8a1`) foi restaurado em PostgreSQL descartável, privado, publicado só em `127.0.0.1:55441`, com volume tmpfs e ownership labels verificados. Os 85 checksums aplicados passaram sem divergência no pacote QA snapshot-compatible, as 16 migrations pendentes foram aplicadas — incluindo `agenda_archive` e `cancel_delivered_comanda_item` — e o status Prisma ficou atualizado. O ledger não foi modificado. O recibo da migration SQL permanece `deploy/restore-drills/prisma-migration-drill-20261010.json`.

Os únicos tenants ativados foram CIA Marítima (`cmr9yis3c0000hvu00q9fe7y1`) e Churrasquinho do Thiago (`cmsry9xrn0000hvlgopjxy0oo`); os demais permanecem LEGACY. O executor interrompido no QA retomou do checkpoint persistido de 6.000/11.653 registros do scope comercial, mantendo o mesmo run ID e ledger. O driver de QA usa lote comercial 100 (limite suportado pelo migrador), com timeout aumentado para o tamanho do snapshot. Não foi inferido vínculo financeiro por horário nem transportado saneamento/PIX de DEV.

| Transformação por tenant | Resultado | Evidência |
|---|---|---|
| Tap ownership | **PASS + replay PASS** para ambos | Run TAP e recibos/mapas confirmados para tenant e PDV canônico. |
| Sessões | **PASS + retomada/replay PASS** para ambos | Checkpoints e replay concluídos no mesmo run. |
| Cozinha/revalidação | **PASS + replay PASS** para ambos | Revalidação do scope concluída. |
| Comércio (comandas/pedidos/estoque) | **PASS + retomada/replay PASS** para ambos | CIA concluiu na primeira execução; Churrasquinho concluiu após retomada; 11.653 registros no checkpoint comercial de Churrasquinho, 297 lotes confirmados. Reconciliação interna de mapas, recibos, dependências e destinos do migrador passou. |
| Financeiro e revalidação financeira | **FAIL confirmado neste snapshot** para ambos | O migrador retornou `FINANCE_PAYMENT_SESSION_MISSING`. Sem prova de sessão/pagamento correspondente, o gate bloqueia; não foi criado vínculo por tempo nem corrigido o ledger/dado de origem. |
| Categorias históricas escopadas | **PASS + replay idempotente** | `deploy/restore-drills/scoped-category-transform-d61444384f85b644.json`: predicados limitados aos dois tenants; 5 categorias criadas no primeiro replay e zero inserções/updates no segundo. O recibo declara que não houve diff independente dos tenants LEGACY. |

O ensaio de migração foi executado com todas as migrations SQL antes das transformações, e depois as transformações de preparação e os scopes retomáveis. Essa ordem não certifica o interleaving staged completo do runbook. A falha financeira impede declarar reconciliação integral de pagamentos, dívidas e totais ou prosseguir para uma aprovação GO.

### Login e leituras autenticadas

O smoke executou o backend compilado do candidato em cópia temporária, com dependências instaladas pelo lockfile fixado do candidato. A cópia recebe `node_modules` por junction para a instalação QA exata; o bundle original não foi alterado. O API foi iniciado sob a entrada permitida pelo guard QA (`NODE_ENV=test`, `PDV_ISOLATED_QA=1`, `QA_DATABASE_URL` igual a `DATABASE_URL`, tenant allowlist explícita), mantendo o guard DEV/PRD inalterado e sem variáveis `PROD_*`. Readiness confirmou conexão ao banco descartável.

Contas sintéticas foram criadas apenas no PostgreSQL descartável; credenciais não foram incluídas em recibos nem impressas. Login e `/api/auth/me` passaram para os dois tenants. Dashboard, contexto operacional, contas pendentes, opções de catálogo, cardápios e eventos responderam 200 nos dois. Para CIA Marítima, cozinha e estoque responderam 404 porque as capacidades persistidas desse tenant estão desligadas (`inventoryEnabled=false`, `kitchenEnabled=false`); o guard respeitou essas flags. Para Churrasquinho, cozinha respondeu 200 e estoque respondeu 200 quando solicitado com o `pontoVendaId` canônico. Este é um smoke de autenticação/leitura, não uma jornada de escrita de estoque.

O primeiro boot do smoke revelou dois defeitos do harness, ambos corrigidos sem relaxar o guard: ESM não resolve dependências por `NODE_PATH`, então o runtime temporário agora vincula a instalação do `npm ci`; e `NODE_ENV=production` com allowlist era corretamente rejeitado pelo guard QA, então o runner usa as três variáveis da entrada QA isolada. Uma consulta de estoque sem `pontoVendaId` e URLs sem parâmetros obrigatórios retornaram 400/404; chamadas válidas com contexto e ponto canônico passaram. Esses erros de construção da chamada não são apresentados como defeito do produto.

As jornadas autenticadas de venda, pagamento/recebimento, liquidação de dívida, abrir/movimentar/fechar caixa, meia-noite, pedido e cancelamento/estorno de cozinha, ajuste de estoque, pedido do portal público e conteúdo de relatórios ainda não foram executadas. Também não houve diff independente de todos os registros de tenants LEGACY. Permanecem **PENDENTES**.

### Recuperação, persistência e estado operacional do QA

Não foi encontrado o pacote da release imediatamente anterior que seja compatível com o schema do snapshot de 10/10. O release arquivado `c55abc0a6d96fb2659d4ee32c214a21d3c56bf1a` inicia, health/readiness 200, mas login falha em P2022. O pacote DEV 4555 também falhou no login HTTP 500 contra a origem bruta e não tem proveniência que prove ser o predecessor de produção. Nenhum deles prova autenticação, leitura ou integridade após restore do checkpoint mais recente. O único tempo disponível é do ensaio antigo que terminou na falha de login (restore DB 1.508 ms; total até falha 6.542 ms). Não se declara recuperação completa nem tempo de recuperação bem-sucedida.

Continuam ausentes os uploads ligados ao snapshot de 10/10; as duas logos disponíveis são de 25/09. Não foi consultado nenhum diretório ou runtime de produção.

Uma remoção do container QA e do scratch desta execução foi rejeitada pela política automática. A rejeição foi respeitada sem repetição nem bypass. O container próprio `tapq-source-d61444384f85b644` permanece RUNNING, com volume tmpfs, limitado a loopback, e contém somente a cópia histórica restaurada e contas sintéticas; os processos de API encerraram. O recibo `deploy/restore-drills/source-snapshot-transform-qa-20261011.json` declara esse estado. A remoção futura precisa de uma ação de limpeza aceita pelo controle de política.

### Gate consolidado e próxima ação

| Gate | Estado em 11/10 | Base |
|---|---|---|
| Bytes históricos de migrations no pacote QA | **PASS** | 85/85 sem divergência; 16 pendentes aplicadas; ledger intocado. |
| Preparador de pacote corrigido e testes LF/CRLF/BOM | **PENDENTE** | Código/testes locais alterados; Pester não executou sob a política vigente; nenhum novo SHA/pacote imutável. |
| Retry de categoria UI | **PASS** | 10/10, uma persistência, duas tentativas, sem duplicata; limite UI/state registrado. |
| Tap, sessão, cozinha e comércio | **PASS no snapshot histórico** | Migrações, retomada/replay e reconciliação interna dos scopes concluídos. |
| Financeiro, pagamentos, dívidas e totais | **FAIL confirmado** | `FINANCE_PAYMENT_SESSION_MISSING` para os dois tenants. Resolver somente com vínculo de origem comprovável; sem inferência temporal ou saneamento de DEV. |
| Login e leitura autenticada | **PASS parcial** | Login e leituras de escopo passaram; endpoints kitchen/inventory de CIA seguem intencionalmente fechados pelas capacidades. |
| Jornadas de escrita e portal/relatórios | **PENDENTE** | Ainda não executadas no runtime autenticado. |
| Release anterior compatível, restore completo e uploads 10/10 | **FAIL/PENDENTE** | Artefato de release compatível e cópia persistente correspondentes não localizados. |
| Novo SHA e candidato imutável publicável | **PENDENTE** | O pacote original 956 permanece; ajustes ainda não comprometidos e o pacote corrigido não foi construído. |
| Limpeza do recurso QA | **PENDENTE** | Remoção rejeitada; container de banco descartável permanece ativo. |
| Janela de produção | **NO-GO** | Nenhuma ação em PRD; gates financeiros, jornada, release anterior e checkpoint persistente permanecem abertos. |

**Próxima etapa executável em QA:** acertar apenas os vínculos financeiros a partir de evidência exata da origem, repetir o scope financeiro e a reconciliação; completar jornadas autenticadas de escrita e relatórios no mesmo isolamento; ensaiar falhas/restore com a release anterior compatível quando o artefato for recuperado. Antes de qualquer janela futura, obter pacote publicável com SHA novo pelo fluxo técnico permitido, pacote imutável verificado, cópia de uploads/checkpoint da janela, e repetir o ensaio contra essa identidade. O ensaio histórico de 10/10 não substitui checkpoint final.

**Versão e TAP-76:** nenhuma alteração foi committed/pushed; alterações locais, staged, stashes e HEAD divergente foram preservados. A correção do preparador, os testes, o harness e este relatório continuam no workspace para revisão/versionamento pelo fluxo permitido. TAP-76 permanece In Progress, com título, prioridade e labels preservados. `PROD_DEPLOY_REQUIRED=NO` nesta etapa.

## Atualização de ensaio financeiro e jornadas QA — 2026-10-11

Esta seção substitui, para o snapshot arquivado de 10/10 e somente para o ensaio QA, o estado financeiro FAIL registrado acima. Ela não altera o candidato fonte nem amplia o escopo autorizado. Candidato fonte: `956f3a64e67fc3016a177426364f625c2682212d`, tree `ec7b1c159f3f1184142c142e5f4f7db53455c0fd`; snapshot SQL SHA-256 `60c570f4798b935e874a0bd41bb0b1ee33555f571a87f8168f125eaa3f7ab8a1`.

### Causa e classificação dos pagamentos

Os 577 registros do arquivo imutável de autorização foram comparados individualmente com o backup, pelo Prisma Client 6.19.3 e sem normalizar os valores originais. Os 430 pagamentos C da CIA Marítima e os 147 do Churrasquinho do Thiago conferem em ID, tenant, comanda, origem, PDV/evento, valores, forma, timestamps, usuário, dívida e campos de sessão. A identidade da lista autorizada é `87e3a8f6aca3e878a027c485ca2e15a120ba9cc0edfc27337e3f39858165ef7a`; o arquivo QA tem SHA-256 `adab0178d1ef0c01c2cd091fad4762cb04c3d0b17aaa6329b80a423932431dfc` e a fotografia histórica referenciada tem SHA-256 `2071d444df091fe85438278ca1e6d2329d4e2106679b23143f0e863b8769d16b`. O escopo permanece literalmente `TAP-76 QA rehearsal only`; a autorização dos 577 não é transportável para produção.

| Tenant e pagamento | Valor/forma e vínculos existentes | Campo ausente | Prova na origem | Classe e tratamento ensaiado |
|---|---|---|---|---|
| CIA Marítima — `cmrcmcnfp000khv2w2uyceipp` | R$ 18,00, `CARTAO_DEBITO`; comanda `cmrclyoac0001hv8c2lle58mi`, evento `cmrclp7700001hvfkhomuqdmo`, sem conta a receber e sem usuário registrador | `sessaoCaixaEventoId` e `sessaoCaixaId` nulos | A auditoria `COMANDA_FECHADA` não contém referência exata ao ID do pagamento. O snapshot e a linha de autorização coincidem byte a byte nos campos financeiros e de vínculo disponíveis; digest da linha de origem `6031abf00cd2b09356521133327f47a7cad4581b49d348781680f49501254be2` | `C_ORIGIN_UNPROVEN`; a ausência histórica é permitida pela exceção explícita da classe C no escopo QA. Preservar valores e ambos os vínculos nulos, marcar `CAIXA_NAO_COMPROVADA`, excluir de totais por sessão. Não criar sessão nem associar por horário. |
| Churrasquinho do Thiago — `cmsthiwwu007ohvmo2o79k3g1` | R$ 33,00, `PIX`; comanda `cmstgyi5z003chvmo1wh7kevt`, PDV `cmsry9xry0004hvlge0wgboza`, sem conta a receber, registrador `cmsry9xrs0002hvlgkaq7g6c5` | `sessaoCaixaId` e `sessaoCaixaEventoId` nulos | `QUIOSQUE_COMANDA_FECHADA` (`cmsthiwx0007qhvmooagk389n`) e `QUIOSQUE_PAGAMENTO_REGISTRADO` (`cmsthiwxd007shvmoeujwds9k`) referem o ID, forma PIX e R$ 33,00; nenhum contém campo de sessão | `C_ORIGIN_UNPROVEN`; a auditoria prova pagamento/valor, não prova caixa. Preservar ambos os vínculos nulos, marcar `CAIXA_NAO_COMPROVADA`, sem inferência temporal ou saneamento de DEV. |

O FAIL anterior foi uma recusa do gate em aplicar a disposição histórica C já autorizada para esta fotografia, não um vínculo comprovável omitido pelo migrador. A correção ensaiada foi fornecer ao replay apenas a autorização QA exata já versionada e verificar novamente os dados. Não foi alterado `_prisma_migrations`, ledger, backup, valor, vínculo ou SQL histórico.

### Replay e reconciliação financeira

Execução com o materializado exato do SHA 956, Prisma Client compatível, banco privado identificado e somente `NODE_ENV=test`, `PDV_ISOLATED_QA=1` e URL loopback QA. A primeira tentativa confirmou uma transação por tenant e encerrou o processo após o primeiro lote: CIA cursor 25/499, lote 1, 4.938 ms; Churrasquinho cursor 25/535, lote 1, 315 ms. Um processo separado retomou os mesmos run IDs sem editar ledger/checkpoint: CIA `COMPLETE`, checkpoint 20, 499/499; Churrasquinho `COMPLETE`, checkpoint 22, 535/535. Um replay subsequente retornou `reusedCompletedRun=true` e `zeroDuplicateWrites=true` para ambos.

O recibo de baseline pré-lote [`finance-before-approval-qa-20261011.json`](../../deploy/restore-drills/finance-before-approval-qa-20261011.json) compara contagem/soma/hash de pagamentos, dívidas, movimentos de caixa operacional, saldos e sessões. Após o replay, os pagamentos mantiveram 499 e R$ 25.392,00 na CIA e 519 e R$ 39.237,00 no Churrasquinho; as dívidas mantiveram zero na CIA e 16/R$ 1.432,00 no Churrasquinho; os saldos mantiveram zero linhas na CIA e 38/3.801 unidades no Churrasquinho. Os 577 C ficaram exatos e com os dois campos de sessão nulos. O histórico de pagamentos não foi duplicado. A classe C tem proveniência explícita, não virou movimento de caixa.

### Jornadas autenticadas

O primeiro harness exigia, incorretamente para esta fotografia, um tenant LEGACY em modo EVENTO e um ponto sem caixa aberto. O backup tem apenas um PDV por tenant selecionado e três sessões históricas ainda abertas. Nenhuma sessão histórica foi fechada na cópia transformada principal. Os fixtures de ponto sintético inicialmente usados foram removidos após confirmação de zero sessão/comanda/movimento dependente. O banco principal conservou a fotografia migrada.

Para as jornadas, foi criado um clone PostgreSQL adicional, `cervejaria_qa_pdv_unico`, em container QA independente, com identidade e comentário de propriedade verificados. Somente no clone operacional, as três sessões pré-existentes foram fechadas e anotadas como precondição exclusiva do fixture; pagamentos, dívidas e estoque tiveram hashes idênticos antes/depois dessa preparação. Nenhuma regularização foi incorporada ao migrador ou à regra de produção.

No clone, a execução autenticada `qa-operation-5f1741cdbf7a3fa7` passou para os dois tenants: abertura de turno com/sem ocorrência, catálogo/preços, venda e pagamento, cancelamento sem efeito de estoque, portal, caixa/fechamento e RBAC na mesma sessão. O hash dos 1.018 IDs de pagamento da fotografia anterior às jornadas permaneceu `23c3e64b051f2cd0da29a5b68c950c9a604cf0b76a1b1ee5ebd5722b738bc2f1`. CIA tem cozinha/estoque desativados e recebeu a recusa esperada nessas capacidades; Churrasquinho passou cozinha, entrada/consumo/estorno de estoque, cancelamento e reembolso. A jornada suplementar `qa-midnight-debt-1763cf9d84c1df` passou virada local de 25 para 26/12/2026 mantendo a sessão e o dia operacional original, dívida com dois recebimentos autenticados (parcial e saldo), fechamento com diferença zero e relatório diário de recebimentos reconciliado. Para a CIA, o relatório de evento também bateu com comandas fechadas, pagamentos e dívida. Churrasquinho não tem evento arquivado aplicável; a reconciliação foi pelo resumo diário autenticado de recebimentos. A movimentação de estoque suplementar foi exatamente a saída do item sintético de dívida no clone (uma unidade no Churrasquinho, zero na CIA desabilitada), com movimento ligado ao pedido; não representa backfill.

O status LEGACY foi conferido em tenant fora do escopo: leitura autenticada e contexto LEGACY passaram, sem categoria nem configuração canônica adicionada. As configurações históricas `plannedOperationsEnabled=false` foram preservadas; não foram transformadas em EVENTO para satisfazer o harness.

### Recuperação e materiais persistentes

O HTTP 500 inicial da release 4555 foi reproduzido com stack em `tenantPdvActivation`: `Invalid PDV activation destination` por executar o login com `NODE_ENV=production` e `PDV_CANONICAL_TENANTS`, combinação vedada para ativação QA. Com a configuração LEGACY sem ativação, o artefato arquivado 4555 passou readiness, login sintético e `/api/auth/me` contra o schema bruto de 10/10. Isso prova compatibilidade técnica de leitura/login para aquele teste, mas não sua identidade como release imediatamente anterior de produção. `c55` continua incompatível: login P2022. Portanto recuperação completa segue pendente. A cópia de uploads ligada ao snapshot 10/10 também não existe; só há as duas logos de 25/09 já inventariadas acima.

### Preparador, candidato e decisão

O teste focado do preparador foi executado com `ExecutionPolicy Bypass` restrito ao processo PowerShell: **17/17 PASS**, incluindo hashes exatos de LF, CRLF e BOM. Os arquivos corretivos têm hashes registrados no recibo de acompanhamento. Contudo HEAD permanece `c86ad3fe59d178520a08b81ffff316231a36f807`, `origin/main` continua `956f3a64e67fc3016a177426364f625c2682212d` e a divergência local/staged é preservada. O pacote candidato fonte segue 956/tree `ec7b1c1`; nenhuma revisão nova foi fixada, committed/pushed ou empacotada como publicável. A cópia QA alterada não é candidato publicável.

**Decisão: NO-GO para solicitar janela de produção.** O gate financeiro e as jornadas independentes passaram no clone autorizado. Bloqueios atuais: (1) obter pelo mecanismo técnico permitido a revisão Git versionada e pacote imutável com o preparador corrigido; (2) localizar/validar o artefato exato da release predecessor compatível, autenticação/leitura após restore e tempo de recuperação bem-sucedida; (3) obter cópia de uploads contemporânea ao checkpoint. O snapshot 10/10 é histórico e não substitui checkpoint autorizado da futura janela. Nenhuma ação foi feita em PRD.

Os dois containers QA permanecem ativos em loopback (`127.0.0.1:55441` e `127.0.0.1:55442`), sem mounts; o segundo tem label `tapq-operation-journals-qa` e marker `codex-qa-owned:tapq-operation-journeys-qa-20261011:tap76-operation-rehearsal-20261011`. A remoção anterior do container original já foi rejeitada; nenhum mecanismo alternativo foi usado para contornar. Preservar os bancos até autorização técnica legítima de limpeza.

### Registro Plane e versionamento

A tentativa de registrar a evidência consolidada na TAP-76 foi rejeitada pelo Plane com HTTP 403 Forbidden. Não alterei o estado nem tentei contornar a permissão por outro mecanismo. A TAP-76 permanece In Progress; a atualização fica pendente de permissão legítima no Plane. Não criei commit ou push: a rejeição anterior de versionamento foi preservada, sem nova tentativa de contorno.

## Consolidação para novo candidato e recuperação — 2026-10-11

### Inventário fechado do que foi realmente ensaiado

| Grupo | Arquivo/identidade | Hash/estado | Uso e limite |
|---|---|---|---|
| Preparador operacional | `scripts/prod/release-candidate.ps1` | SHA-256 `582aecfd1effdcf2ec2221fbdd183f835f85fe77f6584cb267f5381155ac6044` | Leitura dos blobs Git e cópia dos bytes exatos; preserva SQL cujo ledger já confere; inventaria SHA-256 por migration e valida contra ledger/manifesto. |
| Testes do preparador | `scripts/prod/release-candidate.tests.ps1` | SHA-256 `ec4e9b1bd1fe5ac74cfe68a6b1042ae5726483f180be5d2d365e55319d9fce1f` | Reexecutados agora: 17/17 PASS. Incluem bytes e hashes de LF/CRLF e presença/ausência de BOM, checksum ausente/divergente e source SHA/árvore sujos. |
| Transformação financeira executada | snapshot 956, `backend/scripts/pdv-unico-finance-transform.ts` | blob Git `2633a971d06ea42a7c0d0aead71562fa95da905f`; SHA-256 do arquivo `bc359db60b34584d24fd8b4a77dd44ef53d55b004f90dfed2a4fa126bb5d6cb4` | A cópia arquivada da fonte é idêntica ao blob de 956. A lógica de autorização escopada já existe em 956; não houve alteração operacional financeira. |
| Reconciliação financeira | snapshot 956, `backend/scripts/pdv-unico-finance-reconcile.ts` | blob Git `410bb43dc89dc814de745517269aa2e1a380f2af`; SHA-256 `5ad50fc6116575049c17c8a4c2bce16d998cbab8dd819100ebd058e9fce0bec6` | Idêntica ao blob de 956; pagamentos sem caixa são mostrados no bucket não atribuído, não somados a uma sessão. |
| Teste isolado do migrador financeiro | snapshot 956, `backend/scripts/pdv-unico-finance-migrator.isolated.test.mjs` | blob Git `67a27a17dface81f72b8fbf1410c3c1dccd4c7a9`; SHA-256 `eedc348ea2b41573bf4d34211245f26aa1abbeb9e9c71e086202d01404a02f96` | Fonte idêntica ao blob de 956; esta etapa não repetiu jornadas ou transformação já aprovada. |
| Harness QA de jornadas | `.../snapshot-transform-d61444384f85b644/source/backend/scripts/pdv-unico-migrated-operation.qa.mjs` e `.qa.overlay.mjs` | SHA-256 `8f8df62e35c2e2b8439fdd063e2b163d5145746bd4ec23fcc7ddbd53a47f0f2f` e `85bfaa9c3db61436b6de2855d08c259fd325e444e6095629c8554abdc402ddb0` | Harness e overlay QA, fixtures isoladas; não incorporar à aplicação operacional. A autorização de pagamento também fica fora do pacote operacional. |
| Reconciliador de prova QA | `artifacts/rbac-permissions-ui-2026-10-10/finance-reconcile-qa-20261011.mjs` | SHA-256 `5b71daa63de4424f15b28db043f1acb4a0edf64a5db9440e8c6ca92e431ca199` | Só compara snapshot restaurado, autorização e linhas resultantes; QA-only. |
| Autorização imutável QA | `.../source/backend/scripts/pdv-unico-historical-no-session-approval.json` | Arquivo SHA-256 `adab0178d1ef0c01c2cd091fad4762cb04c3d0b17aaa6329b80a423932431dfc`; digest aprovado `87e3a8f6aca3e878a027c485ca2e15a120ba9cc0edfc27337e3f39858165ef7a`; foto de origem `2071d444df091fe85438278ca1e6d2329d4e2106679b23143f0e863b8769d16b` | 577 IDs limitados literalmente a `TAP-76 QA rehearsal only`; nunca copiar para autorização de produção. |
| Pacote antigo 956 | `deploy/release-candidates/956f3a64e67fc3016a177426364f625c2682212d/candidate-manifest.json` | SHA-256 `3df23fdeb0e0b9a722e94f3d2e25e9e39c5563b326686ce04822a25a2e405365` | É o pacote anterior à correção: manifesto sem inventário `migrationIntegrity` (zero registros); no preflight local contra o ledger sanitizado 10/10, 58/85 hashes conferem e 27 divergem. Não é o novo pacote imutável com integridade corrigida. |

Os recibos de ensaio são [finance-and-operations-followup-qa-20261011.json](../../deploy/restore-drills/finance-and-operations-followup-qa-20261011.json), SHA-256 `14e424037ea4c30bc6b6bc891115c20573123518517c28e09781d8e201642063`, e [source-snapshot-transform-qa-20261011.json](../../deploy/restore-drills/source-snapshot-transform-qa-20261011.json). O relatório de prontidão atual tem hash SHA-256 `7b13b8eab9f98209303282a85632024813ef9ecd108fd93739db9e3856c9c18a` antes deste adendo.

### SHA e limite de versionamento

A cópia de QA da fonte financeira e o artefato da autorização foram comparados com os blobs do SHA 956; ambos correspondem ao que foi ensaiado. O tratamento classe C em si não precisa de novo código: o que não pode ser promovido é sua autorização QA.

HEAD `c86ad3fe59d178520a08b81ffff316231a36f807` está 20 commits à frente e 61 atrás de `origin/main`/956. A árvore `HEAD` difere de 956 em 85 arquivos (525 inserções e 10.562 remoções, incluindo regressões RBAC e artefatos), e a árvore de trabalho/índice contém alterações paralelas. Um commit sobre HEAD incluiria essas revisões ancestrais no novo tree, portanto não seria um candidato equivalente ao SHA ensaiado. Não fiz checkout, reset, rebase, merge, stage adicional, commit por plumbing nem push. A correção e seus testes estão prontos nos hashes acima; o executor técnico precisa fixar apenas essa alteração sobre a base 956 sem introduzir as 20 revisões divergentes. A diferença impede declarar candidato publicável agora.

O teste de integridade foi reexecutado, mas não se atribui seu PASS ao pacote velho. Para um SHA corrigido: empacotar a partir de blobs do SHA imutável; comparar `frontend/src`, `backend/src`, schema, 85 SQLs e locks/dependências com os blobs; exigir os 85 hashes de migration no manifesto; então executar preflight do ledger 10/10 e somente smoke de login/leitura e RBAC por causa do bundle. As jornadas e a reconciliação financeira anteriores permanecem evidência para 956 apenas até essa comparação.

### Recuperação: busca arquivada e gate restante

A busca nesta rodada foi restrita a `docs/ops`, `docs/release`, `deploy/backups-production`, `deploy/restore-drills`, pacotes `deploy/release-candidates` e evidências QA arquivadas. O único pacote comprovado como predecessor arquivado é `c55abc0a6d96fb2659d4ee32c214a21d3c56bf1a`, manifesto SHA-256 `b1de20b7722020f9c5e507ead2bea03fe3d55008392b4169fe1678c4cea6d654`, ligado ao deploy/backup de 29/09. Lock SHA `acb93de95a9a0de767b5596e35baed43e92ed7f75c29ddd66e107730b85ed456`; schema incluído SHA `4eb6a16766cf5721425f7b6a1d7ff87c6cd8d677cfc851be20d4e79927ecd3c1`; Prisma Client 6.19.3. O recibo de rollback 29/09 não vale para 10/10. c55 falha login em 10/10 com P2022.

4555 (`4555adf8bcf36a6b0055c67bf1cb97b951a52bb9`) foi validada como release DEV: manifesto 352/352 e login/leitura em modo LEGACY no snapshot 10/10. Nenhum recibo associa seu SHA ao deploy de produção que originou o snapshot. Não há no conjunto arquivado manifesto, lock e pacote de aplicação cuja proveniência prove a release predecessor de 10/10. Faltam: identificador imutável do deploy efetivo naquele corte e seu pacote backend/frontend, manifesto completo, `package-lock.json`/dependências e Prisma Client associado. Sem isso não se inicia o teste final de recuperação contra o checkpoint 10/10 nem se mede seu tempo.

### Solicitação única de coleta futura de arquivos persistentes

**Solicitação pronta — não executada:** em uma coleta autorizada, para o checkpoint de banco que será escolhido para a janela futura, exportar de forma consistente a árvore persistente resolvida da release/app (`UPLOADS_DIR`, ou volume persistente que a atende), incluindo recursivamente `logos/**` e `portal-backgrounds/**`, preservando nomes/caminhos relativos. A implementação padrão resolve para `backend/uploads`; `UPLOADS_DIR` pode sobrescrever o caminho, por isso o operador deve declarar o mount/path resolvido e a identidade do artefato do qual o obteve. Finalidade: restaurar branding e fundos de portal junto ao banco correspondente. Entregar manifesto com caminho relativo, tamanho, SHA-256 e mtime UTC de cada arquivo, data/identificador do checkpoint e origem do volume. Validar todos os hashes, abrir cópia QA isolada e conferir apenas que os caminhos referenciados pelo snapshot existem; não coletar de runtime nesta etapa. As duas logos arquivadas de 25/09 não substituem esse conjunto.

### Decisão classe C preparada para aprovação de negócio

**Decisão proposta — PENDENTE, não aprovada para produção:** no snapshot de origem 10/10, a lista fechada de 577 pagamentos da autorização QA (430 CIA Marítima e 147 Churrasquinho do Thiago) tem conjunto e escopo identificados pelo arquivo SHA-256 `adab0178...` e digest do snapshot aprovado `87e3a8f6...`; linha-fonte inclui o hash `2071d444...`. Isso somente descreve aquele snapshot histórico. Para a origem real da futura janela será necessário recomputar o conjunto e o digest sobre cópia autorizada e obter nova aprovação explícita para aquela origem. Nenhuma autorização QA é reutilizada.

A decisão de negócio deve aceitar explicitamente: preservar IDs, valores, formas e vínculos de sessão nulos; marcar `CAIXA_NAO_COMPROVADA` com trilha de origem; proibir inferência por horário; excluir os valores do subtotal por sessão/caixa e apresentá-los em grupo separado, identificado como não atribuído, nos relatórios gerais de pagamentos. A aceitação precisa declarar que totais gerais por forma e de pagamentos não devem silenciosamente perder esses valores, enquanto fechamento de sessão não deve incorporá-los.

Guardas mínimas: conferir digest integral do snapshot e hash de cada linha aprovada; comparar tenant, ID, valor, forma, comanda/dívida e vínculos disponíveis antes de escrever; limitar a lista enumerada a tenants/IDs explicitamente autorizados; abortar em qualquer divergência; preservar campos originais e adicionar só proveniência/auditoria; não criar/alterar sessões, vínculos ou valores; impedir que relatório por sessão some linhas sem vínculo; emitir reconciliação separada da quantidade/valor e formas do bucket não atribuído. Gate de negócio em produção continua **PENDENTE** até assinatura aplicável à origem escolhida.

### Evidências e gates reusados

As jornadas autenticadas e a transformação financeira aprovadas não foram repetidas. Seus recibos vinculam evidência ao snapshot 10/10 e à fonte 956; a equivalência de pacote para qualquer SHA posterior permanece por provar. Nesta rodada reexecutou-se apenas `release-candidate.tests.ps1` (17/17 PASS). Não se repetiu RBAC nem se rodou outro banco/transformação.

**Gates finais abertos:** (1) commit/candidato sobre a base 956 sem árvore divergente e pacote com manifesto de todos os hashes; (2) identidade e pacote comprovados da release predecessora 10/10, restore/login/leitura e duração integral; (3) coleta autorizada de `UPLOADS_DIR` correspondente ao checkpoint futuro e validação de hashes; (4) aprovação de negócio classe C calculada e assinada para a origem exata da janela; (5) novo checkpoint e autorização de janela/operação. Nenhuma ação em PRD foi feita.

### Permissão de Plane e propriedade dos recursos QA

A nova leitura da TAP-76 foi rejeitada com HTTP 403 Forbidden. Não enviei comentário sem acesso de leitura permitido; o texto conciso pronto para publicação foi preservado no campo `tap76.preparedCommentHtml` do recibo financeiro. Não alterei ticket nem seus campos. As duas instâncias Docker foram conferidas por nome, ID, labels da execução, estado e publicação de porta; ambas continuam próprias da execução, sem bind mounts, acessíveis somente em loopback (`55441` e `55442`). Ambas guardam bancos necessários para retomada e foram preservadas; nenhuma operação de remoção foi repetida.

## Fechamento da tentativa de fixação do candidato — 2026-10-11

Os hashes dos dois arquivos autorizados foram conferidos novamente: scripts/prod/release-candidate.ps1 = 582aecfd1effdcf2ec2221fbdd183f835f85fe77f6584cb267f5381155ac6044; scripts/prod/release-candidate.tests.ps1 = ec4e9b1bd1fe5ac74cfe68a6b1042ae5726483f180be5d2d365e55319d9fce1f. O teste focado executado nesta rodada passou 17/17. git fetch origin main atualizou a referência; origin/main continua em 956f3a64e67fc3016a177426364f625c2682212d, sem commits remotos novos.

A criação autorizada via índice temporário separado, árvore iniciada em 956 e commit-tree com pai 956 foi tentada. O executor rejeitou a chamada antes do processo iniciar: Rejected("... blocked by policy"). Em respeito à rejeição, não tentei commit normal, API, outro executor ou caminho alternativo. Nenhum commit novo, referência local nova, pacote novo ou push foi criado. Assim, não há SHA/tree de candidato corrigido e o pacote anterior 956 continua sem inventário de integridade de migrations; o resultado observado para ele segue 58/85 correspondentes e 27 divergentes. A afirmação 85/85 só poderá ser feita após gerar o pacote vinculado ao commit corrigido e compará-lo ao ledger do snapshot.

### Integridade do workspace durante a tentativa

A captura imediatamente posterior à rejeição confirmou HEAD=c86ad3fe59d178520a08b81ffff316231a36f807, branch main, árvore HEAD 409ce5eff4cb4f9d3b550937c5eaf3d4c556f7e2, índice Git real SHA-256 BAD24517930A2592F6D7606EE30CB4A748A9FB36ADE290FCF026B56F451650BF e árvore staged df366be66a5fc7dec4afa7fde1b9d5306c8a5bba. Os dois itens staged continuam sendo somente trabalhos paralelos: modificação de backend/scripts/pdv-individual-permissions.isolated.test.mjs e remoção de e2e/rbac-live/remaining-permissions.spec.ts. As alterações não staged/untracked e os arquivos autorizados permanecem no checkout; não houve checkout, reset, merge, rebase ou stage. Os três stashes continuam, na mesma ordem e identidade: 86159340107fad8c7c2c91e5e2770f08b9da679c, 83319bff8a8153e7e6c3811838b9dda0e667003a, 993bed6d52744695e95c90e8e0cfe553e861e626.

A evidência de 956, inclusive transformações e jornadas previamente aprovadas, não foi atribuída a um candidato que não existe. Depois da fixação permitida, ainda serão necessários pacote por blobs Git, manifesto e secret scan, builds/dependências, ausência de import da árvore mutável, preflight de ledger 85/85 com as 16 pendentes previstas e somente os smokes direcionados a diferenças de bundle. Permanecem como gates separados: predecessor de produção de 10/10 e recuperação completa, uploads correspondentes ao checkpoint, aprovação classe C para a origem exata da janela e autorização futura da janela. Nenhuma ação em PRD foi feita.
A comparação limitada à base 956 e aos dois caminhos autorizados contém exatamente esses dois arquivos: preparador 98 inserções/6 remoções e testes 45 inserções/2 remoções; verificação de whitespace nesses caminhos sem erros. A working tree global contém trabalhos paralelos fora do escopo e não foi usada como conteúdo do commit. Os arquivos de código continuam com os mesmos hashes revisados após a tentativa.
## Publicação do candidato 3f792451 e preflight de insumos — 2026-10-12

O commit existente foi preservado, sem recriação: SHA 3f79245101f1bc4b7815ccc59a6fb5629ca74d8e, tree 6d9dfd2b2c3420c5de7e414cee8d4c723e5466d7, pai 956f3a64e67fc3016a177426364f625c2682212d. A lista do commit contém exatamente os três caminhos aprovados: scripts/prod/release-candidate.ps1, scripts/prod/release-candidate.tests.ps1 e scripts/prod/prepare-release-candidate.ps1. GitHub CLI autenticado no host github.com para filipedsn com escopo repo. origin/main foi buscado e estava no pai 956; push sem force foi confirmado como avanço rápido 956f3a6..3f79245. origin/main e ls-remote confirmam 3f79245101f1bc4b7815ccc59a6fb5629ca74d8e.

### Integridade do ledger e limite do preflight

O ledger sanitizado arquivado deploy/restore-drills/source-ledger-20261010.sanitized.txt tem SHA-256 fbf876f4583053e8ffd986ed652b360aa6057982ffa8b4916e48c9c0f991a290. O inventário de Git tree de 3f contém 101 migrations SQL: 85 aplicadas no ledger e 16 pendentes. Comparação dos SQLs do tree de Git contra as 85 linhas aplicadas, sem materialização de pacote: 27 blobs já têm o checksum do ledger; 58 não têm. A aplicação da regra testada no preparador aos insumos arquivados resulta em 58 SQLs preservados do pacote-base 956 que já conferem e 27 substituições pelos blobs de 3f que conferem: 85/85 sem faltantes ou divergências. O pacote-base usado como insumo teve 352/352 hashes de arquivos conferidos, mas não contém migrationIntegrity; não é o pacote novo nem substitui sua geração. O conjunto nominal das 16 pendentes foi inventariado no recibo release-candidate-3f792451-preflight.json. Isso comprova a compatibilidade dos insumos e da regra, não um manifesto 3f nem o preflight do pacote 3f.

### Geração do pacote bloqueada por requisito da fonte

O pacote deploy/release-candidates/3f79245101f1bc4b7815ccc59a6fb5629ca74d8e ainda não existe. O entrypoint de preparação chama Assert-CandidateSource, que exige HEAD do SourceWorktree igual ao SHA solicitado e nenhum arquivo tracked modificado; o empacotador também lê os blobs via git -C SourceWorktree. O checkout principal está em c86ad3fe59d178520a08b81ffff316231a36f807, com alterações locais. A cópia-fonte QA e pacote 956 resolvem para esse mesmo checkout sujo. O único worktree de release limpo observado está em faa2c53fa70f0b2bc8506de437bc9f0b52d78d83; não corresponde a 3f. Nenhum worktree existente corresponde a 3f. Para obedecer à preservação de checkout e à proibição de criar worktree/clone, não apontei o preparador a uma fonte incorreta nem improvisei outro pacote. Falta uma fonte imutável e limpa em 3f compatível com o contrato atual do preparador, ou uma revisão do fluxo que aceite materialização auditada de blobs sem exigir worktree. Não executei builds nem secret scan no pacote inexistente. Assim, manifesto e validação de arquivos do pacote são PENDENTES; 85/85 acima é somente preflight dos insumos.

### Preservação, Plane e status

Push e fetch alteraram referências remotas, não o checkout ou índice real. Após a operação: HEAD permaneceu c86ad3fe59d178520a08b81ffff316231a36f807; ref codex/release-migration-integrity-20261012 e origin/main estão em 3f; árvore staged df366be66a5fc7dec4afa7fde1b9d5306c8a5bba; SHA-256 do índice real BAD24517930A2592F6D7606EE30CB4A748A9FB36ADE290FCF026B56F451650BF; os três stashes seguem 86159340107fad8c7c2c91e5e2770f08b9da679c, 83319bff8a8153e7e6c3811838b9dda0e667003a e 993bed6d52744695e95c90e8e0cfe553e861e626. Nenhum dado de produção foi consultado ou alterado.

Tentei ler a TAP-76 pelo item 20cf2ca0-90e6-428f-af2b-903ce1184f7a no projeto conhecido; o Plane retornou HTTP 403. Não alterei o ticket. O comentário de evidência foi preparado no recibo financeiro. Conclusão atual: candidato versionado e publicado; pacote imutável 3f e seu manifesto não gerados; os 85/85 de pacote continuam PENDENTES até uma fonte compatível com o fluxo, embora os insumos estejam reconciliados 85/85. A autorização classe C para produção, os uploads do checkpoint e a recuperação da release predecessora continuam gates separados.
A execução efetiva do entrypoint, com ExecutionPolicy Bypass limitado ao processo e CandidateRoot previamente confirmado ausente, chegou ao guard do preparador e parou antes dos builds: source HEAD diverge do expected RELEASE_SHA (c86ad3fe59d178520a08b81ffff316231a36f807). Nenhum diretório 3f foi criado. Isso confirma a condição concreta que impede o fluxo atual; não substitui geração integrada nem preflight do pacote.

## Candidato imutável publicado e gates de recuperação — 2026-10-12

O candidato corrigido foi fixado e publicado por fast-forward: `304953bff4013e0ad54e33f6be443d5cfda1c130`, tree `c0e0c8a71672130b6f648ac311d1deb42049f71c`, com pai `207c4c6631300932bb48fdb6db663b92a85571ad`. `origin/main` foi conferido em `3f79245101f1bc4b7815ccc59a6fb5629ca74d8e` imediatamente antes do push e confirmou 304 após fetch. Nenhum force push ocorreu.

O pacote existente não foi reconstruído. A validação independente local confirmou o manifesto SHA-256 `5d07b8832a0b1421cd4d38f55ecdd5439faf5e82423b28ea3def6b15453b2aac`, hashes de 353/353 arquivos, inventário de 1.524 blobs, 85/85 SQLs aplicados iguais ao ledger, o conjunto exato das 16 pendentes e zero achados de segredo. As verificações de build registradas no recibo são frontend PASS e backend PASS conforme `tsc --noCheck`; full typecheck não executado. A TAP-76 foi atualizada pelo usuário; esta rodada não alterou o item Plane.

### Release predecessora

A busca nos manifests e artefatos arquivados encontrou um único manifesto de deploy de produção: `deploy/backups-production/cutover-predeploy-20260929/previous-prod-artifacts/manifest.json`, SHA de release `c55abc0a6d96fb2659d4ee32c214a21d3c56bf1a`, data `2026-09-25T02:09:36.7895445Z`. Ele não identifica a versão ativa no checkpoint de banco de `2026-10-10 03:15`. O ensaio documentado em `deploy/restore-drills/old-release-recovery-drill-20261010.json` iniciou c55 contra esse backup, mas login sintético falhou com HTTP 500/P2022; leitura autenticada não ocorreu, então c55 não demonstra recuperação compatível.

Há manifests locais para os candidatos `0eb7017`, `327f546`, `3704167`, `4555adf`, `4b2649e`, `956f3a6`, `adaa6ba` e `ceccaf7`; os horários de criação arquivados não os ligam ao deploy de produção no corte. O recibo de 4555 mostra login/authMe PASS em modo LEGACY, mas não prova predecessor e marca leitura autenticada/integridade após restore como NOT_PROVEN; não há tempo de recuperação completa. O artefato exato ainda necessário é o recibo imutável do deploy ativo imediatamente antes do checkpoint (SHA ou digest da imagem, horário e identidade de ambiente), junto do pacote frontend/backend correspondente, manifesto, lock/runtime dependencies e Prisma Client. O gate predecessor continua PENDENTE; não se escolheu uma versão por conseguir iniciar.

### Arquivos persistentes arquivados

Em `deploy/backups-production/cutover-predeploy-20260929/uploads-prod` encontrei apenas duas logos, ambas datadas de 25/09: `logos/cmsry9xrn0000hvlgopjxy0oo.webp`, 29.882 bytes, SHA-256 `b87bbc98b4cae92d37ba15cc532451c2cfae9facd7c5e24d3174aa37307a9f6c`, mtime UTC `2026-09-25T18:48:03.276Z`; e `logos/cmr9yis3c0000hvu00q9fe7y1.webp`, 47.354 bytes, SHA-256 `507967e2561d270bab4c5b9101d12dfab4117e31e479fc6218b9f206b644e50c`, mtime UTC `2026-09-25T02:18:27.709Z`. Os diretórios arquivados `archived-dev-login-empty-uploads` e `old-release-empty-uploads` estão vazios. O recibo do snapshot de 10/10 informa que esses arquivos não correspondem àquele banco; não encontrei árvore de `portal-backgrounds` nem inventário completo de uploads para o checkpoint.

Para recuperação completa ainda é necessária uma coleta futura autorizada e consistente da árvore `UPLOADS_DIR` resolvida para o checkpoint escolhido, incluindo `logos/**` e `portal-backgrounds/**`, com origem/mount, caminhos relativos, tamanho, SHA-256, mtime UTC e identidade do checkpoint. Essa coleta não foi executada. A aprovação produtiva de classe C permanece separada e PENDENTE. Nenhum acesso, consulta ou coleta em PRD ocorreu.

O recibo atualizado é [release-candidate-304953bf-20261012.json](../../deploy/restore-drills/release-candidate-304953bf-20261012.json), SHA-256 `2de49a8c59b966aae2db105174396d659b19036a81ff8e4a73af75337b7c63dd`. Tentei versionar apenas este relatório e o recibo num commit separado com índice alternativo iniciado em 304, mas o executor rejeitou a chamada antes do processo (`blocked by policy`). Respeitei a rejeição; não usei outro mecanismo. Os dois arquivos permanecem locais e não versionados. Os gates remanescentes para recuperação são: (1) identificar e obter o pacote da predecessora efetiva de 10/10; (2) testar restore do banco com login, leitura e integridade nessa release e medir recuperação completa; (3) obter e validar uploads do checkpoint escolhido. GO para produção continua **NO-GO**; não houve publicação em DEV ou PRD.

## Preparador por snapshot de blobs Git — 2026-10-12

Foi preparada localmente uma implementação para criar o pacote sem checkout limpo: reutiliza `backend/scripts/pdv-unico-git-snapshot.mjs`, fixa commit e tree, materializa os blobs rastreados sem `.git`, registra blob Git/SHA-256/tamanho por arquivo e valida o inventário antes de `npm ci` e dos builds. O fluxo antigo por checkout e seu `Assert-CandidateSource` foram mantidos. O pacote preserva SQLs por comparação explícita ao ledger: 58 bytes do pacote arquivado 956 quando já conferem, 27 blobs Git recuperados quando conferem; SQLs pendentes vêm dos blobs Git. O ledger exige caminho e SHA-256 explícitos. O pacote incluiria `source-snapshot-inventory.json` e `migrationIntegrity`.

Arquivos locais preparados: `scripts/prod/release-candidate.ps1`, `scripts/prod/release-candidate.tests.ps1`, `scripts/prod/prepare-release-candidate-from-git.ps1`, `scripts/prod/materialize-release-source-snapshot.mjs`, `backend/scripts/pdv-unico-git-snapshot.mjs` e `backend/scripts/pdv-unico-git-snapshot.test.mjs`. Verificações independentes: Pester 22/22 PASS; teste Node do materializador PASS; parse PowerShell PASS; `node --check` do wrapper PASS. Os testes cobrem LF/CRLF/BOM, snapshot sem `.git`, `HEAD` divergente, alteração de blob, arquivo extra, dependência local externa e hash de ledger incompatível.

A tentativa de fixar o commit filho de `3f79245101f1bc4b7815ccc59a6fb5629ca74d8e`, usando índice Git separado e somente esses seis arquivos, foi rejeitada pelo executor antes de iniciar (`blocked by policy`). Não repeti a operação por outro mecanismo. Por consequência não há novo SHA/tree, push, build integrado, pacote imutável ou preflight executado sobre um pacote final. Os 85/85 + 16 pendentes permanecem apenas a reconciliação anterior dos insumos arquivados; não são PASS do pacote novo. O bloqueio concreto está na política efetiva do executor (`approval_policy=never`), que precisa permitir a operação local `git read-tree`/`git add` com `GIT_INDEX_FILE` separado e `git commit-tree`, seguida do push fast-forward autorizado. `origin/main` permaneceu em 3f e nenhuma mudança de referência local foi criada.

O índice real preserva SHA-256 `BAD24517930A2592F6D7606EE30CB4A748A9FB36ADE290FCF026B56F451650BF`; HEAD continua `c86ad3fe59d178520a08b81ffff316231a36f807`; os três stashes continuam `86159340107fad8c7c2c91e5e2770f08b9da679c`, `83319bff8a8153e7e6c3811838b9dda0e667003a` e `993bed6d52744695e95c90e8e0cfe553e861e626`. A leitura da TAP-76 retornou HTTP 403; nenhum comentário foi enviado. O recibo `release-candidate-git-snapshot-20261012.json` registra hashes dos arquivos preparados, testes, preservação e impedimento. PRD não foi acessado.

### Pacote Git-snapshot comprovado — 12/10/2026

O candidato local 304953bff4013e0ad54e33f6be443d5cfda1c130, tree c0e0c8a71672130b6f648ac311d1deb42049f71c, foi fixado e gerado pelo entrypoint real por snapshot. A cadeia parte de 3f792451 e inclui d6bebaa (seis arquivos do fluxo), 207c4c6 (caminhos temporários curtos) e 304953b (parser de lockfile compatível com a chave raiz vazia em PowerShell 5.1). O checkout, índice real e três stashes foram preservados.

O Pester reexecutado passou 23/23 com dependências de publicação da base, incluindo regressão do lockfile real. A geração real concluiu builds de deploy frontend/backend e validação de manifesto/secret scan. O build backend configurado usa tsc --noCheck: este resultado não representa uma nova validação completa de tipos.

Pacote: deploy/release-candidates/304953bff4013e0ad54e33f6be443d5cfda1c130. Manifesto SHA-256: 5d07b8832a0b1421cd4d38f55ecdd5439faf5e82423b28ea3def6b15453b2aac. Verificação independente: 353/353 arquivos com hashes corretos; 85/85 checksums aplicados compatíveis com o ledger arquivado; 16 migrations pendentes; 58 SQLs históricos preservados do pacote arquivado; inventário de 1.524 blobs Git vinculado ao SHA/tree. A leitura independente do ledger considerou seu BOM UTF-8, sem modificar o arquivo.

Os insumos operacionais, schema, migrations e locks são idênticos a 956; a evidência anterior não foi convertida em uma nova execução de jornadas. Não houve acesso a bancos, PRD ou reinício/publicação de DEV nesta execução.

Push não confirmado: o helper GitHub via sh/MSYS falhou no executor; nenhum acesso HTTPS autenticado foi obtido. A referência local codex/source-snapshot-package-20261012 preserva o candidato. Recibo: deploy/restore-drills/release-candidate-304953bf-20261012.json.

NO-GO para produção permanece: publicar a revisão pelo acesso autenticado permitido, comprovar predecessor/recuperação completa, uploads do checkpoint, aprovação classe C aplicável à origem produtiva e autorização da janela. Este PASS resolve o gate de geração e checksums do pacote, não a liberação produtiva.

## Coleta autorizada em PRD e ensaio de recuperação — 12/10/2026

Escopo executado somente para leitura/coleta de PRD e escritas no diretório protegido de preparação/QA. Não houve migration, deploy, parada/reinício de serviço, alteração de configuração produtiva, operação bancária, impressão ou envio. Nenhum pagamento classe C foi processado ou aprovado.

### Janela e origem observada

A coleta do banco ocorreu aproximadamente entre `2026-10-13T01:54:16.539Z` e `2026-10-13T01:54:17.897Z` (22:54:16–22:54:17 America/Sao_Paulo), duração reportada de 1,358 s. Foi usado `scripts/backup/backup-db.ps1 -Environment production`, apontado para diretórios novos e exclusivos desta preparação; a retenção não removeu arquivos anteriores. O `pg_dump` online produz uma fotografia consistente do banco, mas este material é de ensaio, não checkpoint final de janela sem escritas.

Health/readiness permaneceram HTTP 200 nas verificações de início e fim; o bundle frontend público e seu hash também permaneceram iguais. A cópia de uploads não teve alterações. A comparação de tamanho do dump atual com o backup diário das 03:15Z mostra +885.785 bytes (+4,41%); é apenas uma diferença de tamanho, não uma reconciliação de linhas. Não foram coletadas métricas de escrita do banco dentro do intervalo de 1,358 s.

O bundle efetivamente servido pelo frontend público foi identificado como `assets/index-Ctt2AlhG.js`; SHA-256 `651593a1650eea37698f302b7b9b75c75652dbb83dcbd09e48e23bdcfa28f86d`, igual ao manifesto local `deploy/prod-artifacts/manifest.json`. Esse manifesto identifica `gitSha=66ec00886b65eaea8e437fae4e9a36f7be971b09`, tree `b089b592f8d8320f9af7025548fbcea2a5b0775a`, deploy `2026-10-02T01:27:16.5369130Z`. O entrypoint backend em disco também confere com o SHA declarado pelo manifesto (`15462de941d798c3215f81fae2354f6145c1bf5c2b19da8799011ece6f4e6`).

**Limite de identidade:** a API pública e a local responderam health HTTP 200 e readiness HTTP 200, mas `/api/health` não expôs `releaseSha`; a linha de comando e o caminho executável do processo que atende a porta 3001 não são legíveis nesta sessão. Portanto o manifesto e o pacote backend de `66ec008` são a melhor origem disponível e foram usados no ensaio, mas a identidade do backend efetivamente carregado não ficou comprovada independentemente. O gate de identidade do backend permanece pendente.

### Materiais protegidos e proveniência

Todos os materiais estão em `C:\Users\Papai\OneDrive\Quiver\Tap Quiver\Backup banco\PRD\recovery-prep-20261012-225416`. A ACL desta nova pasta e seus arquivos foi restringida a Filipe\Papai, SYSTEM e Administradores; o grupo do sandbox não tem leitura. A cópia protegida do `.env.production` foi comparada byte a byte com a origem. Seu conteúdo não foi exibido nem incluído em log/relatório; só o hash está no inventário protegido.

- Backup SQL plain text: `backup-prod-2026-10-12-225416.sql`, 20.967.356 bytes, SHA-256 `3ba54e26d9d5b7042e65695217eae396d1c7d291c87aed48f024d5963386cd3e`. A cópia de preparação e sua sidecar conferem com o original. `source-schema-20261012.sql` e `source-ledger-20261012.sanitized.txt` foram extraídos **desta mesma restauração**.
- Pacote de origem indicado pelo manifesto: cópia completa em `origin-runtime`, 18.089 arquivos, 528.870.020 bytes, zero divergências de hash após cópia. Manifesto SHA-256 `16f6447a5d51b8bd67c71ac85693e0b1a285c8e696bdf3adbcd81cca3c47f7b0`; inventário completo por caminho, tamanho, SHA-256 e mtime UTC: `origin-runtime-inventory.json` (SHA-256 `966006458b5408b9530795765b6f361f72b4ebf68c860b2d5e78a97b5139c3d1`). Inclui frontend, backend, package locks, dependências e Prisma Client.
- Configuração necessária: `protected-config/backend.env.production`; SHA-256 `af6843eb73ebe4d8f77825f5172c8d9e03f4dff1c775a80e46ac3d801fee3b60`. Nenhum valor secreto está neste relatório.
- Uploads: o launcher resolve `UPLOADS_DIR` para `backend/uploads-prod` a partir do `ProjectRoot`; `.env.production` não define `UPLOADS_DIR`. Foram copiados 4 arquivos, 615.620 bytes, incluindo `logos/` e `portal-backgrounds/`. `uploads-inventory.json` registra, para cada caminho relativo, origem, tamanho, SHA-256 e mtime UTC, e registra zero mudança entre início/fim da cópia (`01:59:26.148Z`–`01:59:26.352Z`). Hashes da cópia conferem 4/4; SHA-256 do inventário `8718ab3f1db9c3ddcfcaf5cbc76f2dde5da914072e6f87a587a7307cb8f919d0`.

Uploads começaram cerca de 5 min após o fim do dump. Os hashes não mudaram durante a cópia, mas banco e arquivos não formam uma captura atômica; ambos continuam materiais de ensaio.

A pasta também contém o recibo `isolated-recovery-report.json`, schemas/ledgers sanitizados, logs de inventário e os scripts locais do ensaio. Nenhum backup ou dado pessoal foi versionado.

### Comparação com a fotografia de 10/10 e ensaio isolado

O schema restaurado atual (`source-schema-20261012.sql`, SHA-256 bruto `cb41373b5204a97df0c71a36bcd0489d86e83a440db54f1e581ee2146f1f62c0`) tem SHA-256 canônico `4175a016da7306d22571bf9aaae3c0b0d5e7d0f7b375b061637ec19814b5a323`, igual ao schema de 10/10. Os hashes brutos do `pg_dump` diferem somente pelos tokens gerados `\restrict`/`\unrestrict`. O ledger (`source-ledger-20261012.sanitized.txt`, SHA-256 `9d48404035fac78a2c253c622f28b5867a571e2a440d21d96393b30869b86e7d`) contém 88 registros e 85 migrations únicas concluídas; nome, checksum e estado normalizados não mostram diferença para 10/10. Contra o pacote candidato `304953bff4013e0ad54e33f6be443d5cfda1c130`, o preflight ligado ao backup atual dá 85/85 checksums compatíveis e exatamente 16 migrations pendentes. Nenhuma delas foi aplicada.

O ensaio restaurou o backup em PostgreSQL 16 descartável, com dados em tmpfs e porta publicada apenas em loopback `127.0.0.1`; o container foi removido após o ensaio. A release preservada do manifesto foi iniciada contra essa cópia, com integrações externas desativadas. Uma identidade sintética foi criada somente no banco restaurado. O recibo sanitizado `isolated-recovery-report.json` tem SHA-256 `3812ee2bd8a0c3f82a0d8f91d114e07f0c330daf11731620daad5c59fd66eca1`.

- Restore do banco: PASS, 1.645 ms.
- Readiness com banco: PASS, HTTP 200, 1.081 ms.
- Login sintético: PASS, HTTP 200, 115 ms; leitura autenticada `/api/auth/me`: PASS.
- Logos e portal-backgrounds: 4/4 respostas e SHA-256 recuperados corretamente.
- Tempo completo, do início da recuperação até a verificação dos arquivos: **6.503 ms**.

O tempo não inclui uma parada de serviço (nenhuma ocorreu), transferência final de uploads numa janela congelada, ou cutover. O snapshot de 10/10 não tem inventário de uploads correspondente; o arquivo histórico disponível é de 25/09, então não há comparação válida dos arquivos persistentes entre 10/10 e esta coleta.

### Gates de 304953b que ainda precisam de revalidação

O novo preflight 85/85 é evidência ligada ao backup atual; ele não aplica nem aprova migrations. O candidato 304953b difere do commit de origem 66ec008 em 163 arquivos (cerca de 8.028 inserções e 1.488 remoções), incluindo schema e migrations. Portanto continuam pendentes no snapshot atual:

- sequência integral das 16 migrations, transformações e replays; preflight por tenant, isolamento, preservação de LEGACY, retomada/idempotência, reconciliação e injeção de falhas com restore do checkpoint;
- RBAC, permissões individuais e rotas transversais;
- abertura/fechamento de caixa e virada do dia;
- vendas, pagamentos, dívidas e estornos, sem operar classe C produtiva e sem transportar a autorização QA dos 577 pagamentos;
- catálogo/cardápios, cozinha, cancelamentos e estoque;
- portal e relatórios;
- compatibilidade e recuperação da release predecessora depois das transformações no snapshot atual e com os uploads deste checkpoint;
- identidade do backend atualmente carregado, que não foi exposta pela API nem pelo processo legível nesta sessão;
- inventário de uploads amarrado à fotografia 10/10, que não existe nos materiais encontrados.

### Plane, versionamento e estado local

Não foi indicado identificador de ticket Plane. Pela regra do repositório, não alterei nem comentei item não explicitamente indicado; nenhuma evidência foi enviada ao Plane.

O relatório foi atualizado somente no checkout local. Não fiz commit ou push. `main` continua com divergência remota (20 commits à frente e 65 atrás na captura inicial), trabalho staged/unstaged e 3 stashes preservados; o HEAD e o SHA-256 do índice permaneceram iguais à captura inicial (`c86ad3fe59d178520a08b81ffff316231a36f807` e `bad24517930a2592f6d7606ee30cb4a748a9fb36ade290fcf026b56f451650bf`). O log criado pelo procedimento é ignorado pelo Git. A coleta e o ensaio não dependiam de versionamento.

**Pendências exatas:** identidade live do backend; gate funcional/migração completo de 304953b em QA para este backup; uploads vinculados à fotografia 10/10; eventual checkpoint final e janela produtiva futura, que continuam sem autorização. `PROD_DEPLOY_REQUIRED=NO`.

## Certificação final do candidato 304953b sobre a nova fotografia — 13/10/2026

Este adendo substitui, para esta certificação, a exigência de uploads da fotografia de 10/10 e atualiza as pendências anteriores. A origem usada é exclusivamente `C:\Users\Papai\OneDrive\Quiver\Tap Quiver\Backup banco\PRD\recovery-prep-20261012-225416`. O backup online e os uploads foram coletados em instantes diferentes, cerca de cinco minutos entre si; não são captura atômica. São material de ensaio. O checkpoint final requer coleta própria na janela com escritas congeladas.
### Correções da coleta inicial

Este adendo corrige três pendências/status descritos acima: a identidade live do backend foi confirmada por leitura elevada; a comparação repetida de schema encontrou diferença canônica contra 10/10 (`4175a016da7306d22571bf9aaae3c0b0d5e7d0f7b375b061637ec19814b5a323` versus `41bc0d814cadd0c319a0c2db817bd3b7bf3014e603114f2aad42f0e821b7adb2`); e a ausência de uploads da fotografia 10/10 foi substituída pela nova fotografia de 12/10 nesta certificação. O resultado de recuperação de 6.503 ms é histórico; a repetição final mediu 5.764 ms. A lista classe C antiga de 577 pagamentos foi substituída pela classificação atual de 579 IDs/digest, sem transferência da autorização QA.

### Identidades comprovadas

- Pacote candidato preservado: release SHA completo `304953bff4013e0ad54e33f6be443d5cfda1c130`; manifesto SHA-256 `5d07b8832a0b1421cd4d38f55ecdd5439faf5e82423b28ea3def6b15453b2aac`. Verificação: 353/353 arquivos, 85/85 checksums de migrations aplicadas e 16 migrations previstas: `20261003180000_restrict_event_cash_history`, `20261003210000_additive_pdv_operational_core`, `20261003220000_pdv_catalog_configuration`, `20261004100000_pdv_session_restartable`, `20261004150000_pdv_finance_session_link`, `20261004170000_pdv_commerce_inventory_context`, `20261005180000_payment_historical_provenance`, `20261006120000_comanda_sale_session_context`, `20261006130000_pdv_tap_montage`, `20261007180000_product_independent_kitchen_order`, `20261007220000_individual_operational_permissions`, `20261007230000_individual_module_permissions`, `20261008090000_shift_catalog_permission`, `20261008120000_pdv_gamified_categories`, `20261009140000_cancel_delivered_comanda_item` e `20261009180000_agenda_archive`. Os 16 SQLs foram aplicados somente no PostgreSQL descartável QA em sequência intercalada com as preparações/transformações do runbook. Ledger QA resultante: 101/101 entradas.
- Frontend servido: `assets/index-Ctt2AlhG.js`, SHA-256 `651593a1650eea37698f302b7b9b75c75652dbb83dcbd09e48e23bdcfa28f86d`.
- Backend live observado por leitura: porta 3001 atendida pelo PID 2056; executável `C:\Program Files\nodejs\node.exe`, SHA-256 `9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de`; entrypoint `deploy/prod-artifacts/backend/dist/index.js`, SHA-256 `15462de941d798c3215f81fa2354f6145c1bf5c2b19da8796149011ece6f4e6`; processo pai PID 12028, PowerShell lançando `scripts/prod/watchdog-daemon.ps1`, SHA-256 `631e9e0daadf34b88a9469da505c269e45479e1aa4f252b5af6a0804ddc5c475`. O manifesto de origem vincula o pacote a `66ec00886b65eaea8e437fae4e9a36f7be971b09`, manifesto SHA-256 `16f6447a5d51b8bd67c71ac85693e0b1a285c8e696bdf3adbcd81cca3c47f7b0`. Evidência de processo `live-backend-process.protected.json`, SHA-256 `408040d4755e955b34ee1b91048396c5a1ddbc836b7be51368e7e256cc7c8c4d`. A cadeia PID/caminho/launcher/artefato coincide com o pacote preservado; não foi adicionado `releaseSha` e PRD não foi reiniciado.

### Fotografia, schema, ledger e proveniência

- Backup restaurado: 20.967.356 bytes, SHA-256 `3ba54e26d9d5b7042e65695217eae396d1c7d291c87aed48f024d5963386cd3e`.
- Schema extraído da restauração de recuperação: SHA-256 bruto `feb80f70f40de4346c69d6f49fcc904b3b274a88b33b8f4a7490a84699e28c95`; hash canônico `4175a016da7306d22571bf9aaae3c0b0d5e7d0f7b375b061637ec19814b5a323`. O hash canônico arquivado para 10/10 é `41bc0d814cadd0c319a0c2db817bd3b7bf3014e603114f2aad42f0e821b7adb2`; portanto esta origem tem diferença de schema em relação à fotografia anterior. O schema foi extraído do restore do mesmo backup usado para o ledger.
- Ledger da origem: SHA-256 `9d48404035fac78a2c253c622f28b5867a571e2a440d21d96393b30869b86e7d`, 88 linhas, 85 migrations únicas concluídas. Contra o candidato, 85/85 checksums compatíveis e 16 pendentes antes do ensaio. Contra o ledger de 10/10 não há migrations únicas adicionadas/removidas nem checksum alterado; há diferença de estado em registros históricos de `20250715180000_cliente_crm_stats` e `20260914143000_add_cash_register_capability_to_ponto_venda`.
- O runtime preservado tem manifesto SHA-256 `16f6447a5d51b8bd67c71ac85693e0b1a285c8e696bdf3adbcd81cca3c47f7b0` e inventário completo SHA-256 `966006458b5408b9530795765b6f361f72b4ebf68c860b2d5e78a97b5139c3d1`; dependências, locks e Prisma Client estão incluídos. `.env.production` permaneceu na pasta protegida, SHA-256 `af6843eb73ebe4d8f77825f5172c8d9e03f4dff1c775a80e46ac3d801ee3b60`, sem valores secretos em logs ou relatório.
- Inventário persistente de uploads SHA-256 `8718ab3f1db9c3ddcfcaf5cbc76f2dde5da914072e6f87a587a7307cb8f919d0`: 4 arquivos, 615.620 bytes, cobrindo logos e portal-backgrounds. Caminhos relativos, origem, tamanhos, hashes SHA-256 e mtimes UTC estão em `uploads-inventory.json`. A nova fotografia substitui a lacuna de uploads de 10/10 para esta certificação; não elimina a necessidade do checkpoint final sincronizado.

### Resultado da sequência integral e reconciliação

O PostgreSQL QA era descartável, privado e publicado somente em loopback. Backup, cliente Prisma, migrations e transformações permaneceram fora do runtime publicado. Integrações externas ficaram desativadas. O pacote 304953b não foi modificado; a alteração de harness ficou na cópia protegida de ensaio.

A execução inicial do comércio do tenant 3 expirou com `P2028` no timeout padrão de 30 s, cursor 9.900/13.797. Interrompi apenas o runner QA em checkpoint confirmado e corrigi o custo do harness: ele repetia a fotografia ampla e a validação do ledger a cada lote de 25. A retomada no mesmo run ID usou lotes de 250 e timeout de diagnóstico 600 s. O comércio do tenant 3 terminou em 611.290 ms de retomada, mais 67.629 ms do primeiro lote e 43.931 ms de replay; replay, financeiro pós-comércio e cozinha foram concluídos. Esse override é só da medição QA e não remove o timeout de 30 s do pacote.

O status global do recibo permanece **BLOCKED**. Na repetição de idempotência, tenants 1 e 2 pararam em `FINANCE_HISTORICAL_COMMERCE_PROOF_DIVERGED` (`COMANDA`, zero lotes financeiros comprometidos; run concluído anterior invalidado). Uma tentativa intermediária também parou o replay comercial do tenant 2 com `SOURCE_PAYLOAD_CHANGED`. Tenant 3 completou as nove fases — business, catálogo, TAPs, sessões, financeiro, preparação de cozinha, comércio, revalidação financeira e revalidação de cozinha — incluindo retomada após interrupção e replay do mesmo run. O resultado está em `representative-sequence-batch250.protected.log`, SHA-256 `ffe85777d162599d2e97eecba378c8ec309a5e3eea85c1740d34ef2b7f0a9491`.

Reconciliação agregada: 33 tabelas / 28.361 linhas observadas e zero arestas entre tenants; prontidão de ativação de produtos PASS nos três tenants (3, 11 e 42 produtos; zero categorias sem vínculo); comparação imutável PASS de 8.929 `TransacaoLog` e 486 `ClienteEstatisticas`. O recibo é bloqueado para os tenants 1 e 2, portanto isso não certifica órfãos nem vínculos de todas as fases pendentes nesses tenants.

### Pagamentos classe C — somente QA

A classe foi recalculada para a origem atual: 579 IDs, digest UTC `6d649ade7c8471adba44b381bd113d0fe2c8c04191287b1f8504e84ad9e908a9`; digest da lista ordenada de IDs `9ac3dac5ad2311bcf49817dd062771c5f7cf51b017da96c121b703441a8cf128`; fotografia de origem SHA-256 `5e9bef24a42574ea85d203e4fe593317a89c86c165f3c242f5680786d896e3eb`. A autorização de QA aplicada é específica a esses dados da cópia: 579/579 com proveniência `CAIXA_NAO_COMPROVADA`; 579/579 preservam nulos os vínculos de sessão operacional, sessão de evento e conta a receber, sem inferir sessão por horário. A comparação origem→QA não encontrou divergência em IDs, valores ou campos de pagamento; o único campo divergente foi `pointId` do contexto da comanda em 432 casos, correspondente à transformação do PDV canônico. Recibos sanitizados: `class-c-source-vs-target-diagnostic.protected.json` SHA-256 `3ac395e9deac228fc3f13cf5ad6ba4247b72e0a73a3446440ee7871e63b29efc` e `class-c-qa-status.protected.log` SHA-256 `ac83393ee79d16482301d9b6872fde9f0b1fd7e6f7f86a9d2370ec77b6a03471`.

**Decisão produtiva que requer aprovação humana:** aprovar ou rejeitar, para exatamente os 579 IDs do digest acima, a disposição conservadora de manter IDs e valores, manter nulos os três vínculos, registrar `CAIXA_NAO_COMPROVADA` e não inferir sessão por horário. A evidência e autorização QA não aprovam essa mudança em produção. Sem aprovação explícita, classe C produtiva fica intocada e a janela permanece bloqueada.

### Recuperação, jornadas e condições da janela

O restore-drill repetido restaurou o backup em PostgreSQL privado e descartável, iniciou o runtime preservado com integrações desativadas, comprovou readiness HTTP 200, login sintético HTTP 200, leitura autenticada e 4/4 uploads com hashes coincidentes. Tempo total, do início do restore até a verificação dos arquivos: **5.764 ms**. Recibo `isolated-recovery-after-sequence.protected.json`, SHA-256 `72fbbdbb7c2bfa28c6519ae0f8d8340fdc054f76579f48b93d27d5a4551fdb12`. Não houve parada de PRD. As jornadas de venda, pagamento, dívida, caixa, meia-noite, cozinha, cancelamento/estorno, estoque, portal e relatórios não foram iniciadas porque a sequência não convergiu nos três tenants.

Condições mínimas para considerar uma futura janela: corrigir e repetir em restore novo os gates de prova/idempotência financeira e `SOURCE_PAYLOAD_CHANGED`; resolver a execução comercial acima do timeout padrão com duração compatível com a janela; completar reconciliação sem órfãos/vínculos cruzados e todas as jornadas autenticadas; obter aprovação produtiva específica dos 579 pagamentos classe C; gerar checkpoint de banco e uploads pelo procedimento congelado da janela; confirmar runtime predecessor/restauração e receber autorização explícita da janela. Até lá, **NO-GO** e `PROD_DEPLOY_REQUIRED=NO`.

### Plane e versionamento

TAP-76 foi lido antes desta atualização e permanece In Progress, prioridade high, labels Product e Quality; nenhum campo do ticket foi alterado. O workspace, staged files e os três stashes existentes foram preservados. Não houve commit nem push. Bloqueio de versionamento registrado separadamente: worktree já estava sujo no início; no fechamento havia 2 entradas staged, 43 modificadas unstaged e 6.188 não rastreadas. HEAD permaneceu `c86ad3fe59d178520a08b81ffff316231a36f807`; SHA-256 do índice permaneceu `bad24517930a2592f6d7606ee30cb4a748a9fb36ade290fcf026b56f451650bf`; stashes preservados: `86159340107fad8c7c2c91e5e2770f08b9da679c`, `83319bff8a8153e7e6c3811838b9dda0e667003a`, `993bed6d52744695e95c90e8e0cfe553e861e626`. Por isso não criei commit nem push. Isso não impediu a coleta nem o ensaio. Comentário interno de evidência foi adicionado ao TAP-76; o ticket não foi fechado.
### Retomada da certificação — restore novo em 13/10/2026

Foi criada uma restauração QA nova diretamente do dump protegido, sem usar o alvo transformado anterior. O SHA-256 integral conferido é `3ba54e26d9d5b7042e65695217eae396d1c7d291c87aed48f024d5963386cd3e` (20.967.356 bytes). PostgreSQL descartável, somente em `127.0.0.1:55447`; restore de 43 tabelas e ledger da origem com 85 migrations concluídas. O recibo protegido `fresh-restore-receipt.protected.json` vincula o container, tempo de restauração, backup e classificação QA dos 579 pagamentos sem expor IDs ou credenciais. Nenhuma migration foi aplicada nesta restauração até este ponto.

O manifesto/script de ativação preservado admite somente CIA Marítima (`cmr9yis3c0000hvu00q9fe7y1`) e Churrasquinho do Thiago (`cmsry9xrn0000hvlgopjxy0oo`) sob CANONICAL_PDV. Demo Chopp Móvel (`cmr9yfsdd0001hvtku98n4cjd`) consta no conjunto de alvos do ensaio anterior, mas fica LEGACY pela ausência no allowlist; não deve ser transformado. Lanchonete (`cmu78vehi009hhv80bfwo5d6v`) também permanece fora do escopo e LEGACY. Isso alinha o contrato de ativação ao manifesto e não amplia o escopo.

O harness de sequência preservado ainda contém asserções para a foto de 10/10 e para 577 pagamentos; esse binário de ensaio não pode validar a origem nova como está. A autorização Classe C protegida para esta fotografia tem 579 registros e está vinculada ao SHA do backup e aos digests de payload/IDs no recibo acima. Nenhuma lista antiga foi reaplicada. O restore novo confirmou bytes e estrutura básica, mas a sequência de migrations, reprodução dos bloqueios e jornadas ainda não foi executada nesta cópia.

A comparação por objetos do schema com 10/10 continua sem base reproduzível local: foi localizado no relatório apenas o hash canônico antigo, sem o SQL/schema nem a restauração 10/10 no armazenamento protegido disponível. Hashes distintos não identificam objetos alterados; nenhum diagnóstico estrutural é afirmado neste adendo.

Estado desta retomada: ensaio integral **PENDENTE**, não certificado; sem alterações em PRD. A nova origem substitui a fotografia antiga nesta certificação. O caráter não atômico do backup online e dos uploads permanece; o checkpoint final requer coleta própria na janela. Condições para seguir: adaptar o harness ao backup e à autorização de 579 da origem, reproduzir os dois bloqueios com checkpoints, corrigir somente causas comprovadas, e executar sequência/replay/recuperação/jornadas sobre novo restore descartável. `PROD_DEPLOY_REQUIRED=NO`.

## Fechamento da certificação com restore novo — 13/10/2026 (corrige os adendos anteriores)

**Estado:** sequência de migração e recuperação PASS em QA; jornadas autenticadas parciais por conflito que veio no backup. Não é GO produtivo. Esta seção substitui as declarações pendentes/diagnósticos incorretos dos adendos anteriores. A única origem foi `C:\Users\Papai\OneDrive\Quiver\Tap Quiver\Backup banco\PRD\recovery-prep-20261012-225416`; o backup protegido tem SHA-256 completo `3ba54e26d9d5b7042e65695217eae396d1c7d291c87aed48f024d5963386cd3e`. A tentativa final restaurou esse mesmo arquivo no banco QA descartável em `2026-10-13T18:01:15.791Z`–`18:01:17.239Z`; nenhum backup novo foi obtido.

### Escopo, origem e schema

| Tenant | ID | Contrato autorizado | Resultado no ensaio |
|---|---|---|---|
| Chopp Móvel | `cmr9yfsdd0001hvtku98n4cjd` | LEGACY, fora do allowlist CANONICAL | preservado sem transformação CANONICAL |
| CIA Marítima | `cmr9yis3c0000hvu00q9fe7y1` | CANONICAL_PDV | transformado |
| Churrasquinho do Thiago | `cmsry9xrn0000hvlgopjxy0oo` | CANONICAL_PDV | transformado |

O manifesto de ativação inclui somente CIA Marítima e Churrasquinho do Thiago. Lanchonete (`cmu78vehi009hhv80bfwo5d6v`) está fora do escopo e LEGACY. A sequência usou a lista explícita de alvos; não ampliou o escopo.

A comparação estrutural reproduzível de schema agora está feita: 134 objetos em 10/10 e 134 em 12/10; zero diferenças de objetos. SHA-256 do dump bruto 10/10 `89753de4a2555936e15a31cbbaedf4614d44e89965ba902b4245b0ce7f6865dc`; 12/10 `ab539454da6baf080df6f7e9b498f6490d0130c6873504990f3dd9a387b7f0fc`. Após remover BOM UTF-8 e nonce de `\\restrict/\\unrestrict`, ambos produzem `ae04caa9a9daed2853426c7803dd17ac6b11a19bc882e75fdd884b61beed23e`. A diferença observada nos bytes do dump é metadado de geração, não mudança estrutural. O adendo anterior que declarou hashes canônicos diferentes usou normalização incorreta e fica revogado.

O backup online e os uploads são fotografias não atômicas. O inventário protegido tem 4 arquivos (logos e portal-backgrounds), 615.620 bytes, SHA-256 `8718ab3f1db9c3ddcfcaf5cbc76f2dde5da914072e6f87a587a7307cb8f919d0`; esse conjunto substitui uploads de 10/10 nesta certificação. A coleta final de janela ainda precisa sincronizar banco e arquivos com procedimento próprio.

### Código, pacote e causas corrigidas

HEAD/código ensaiado: `d398d67ed9d128bbb9528d983911fe41eeb7dc0b`; tree `8de147f75949d0f3644e0ba00fba40ab5c7075dc`; candidato por snapshot em `qa304953-final/generated-release-candidates/d398d67ed9d128bbb9528d983911fe41eeb7dc0b/`; `candidate-manifest.json` SHA-256 completo `9dcce061e3fa7d8a530f4cb8c6841a87dfd506ad90eb5628910edf0cfc3ee513`, 353 arquivos, 101 entradas de integridade de migration. A sequência comparou 85 migrations aplicadas sem divergência e aplicou as 16 previstas. A aprovação e lista classe C foram fixtures protegidas de QA, fora da lista de arquivos do manifesto; não são conteúdo publicável do pacote.

Causas comprovadas e correções: (1) `SOURCE_PAYLOAD_CHANGED` foi produzido pelo teste/harness que atualizava `Comanda` via Prisma e alterava `updatedAt`; a prova agora troca somente os vínculos de contexto via SQL e preserva o timestamp original. (2) `FINANCE_HISTORICAL_COMMERCE_PROOF_DIVERGED` era consequência desse payload alterado; a prova/replay reconhece apenas os campos de contexto previstos quando mapa, run, checkpoint, lote, recibo e tenant confirmam a mesma transformação. `_count` é projeção derivada, não exclusão geral de campos. (3) primeira execução vazia comparava `undefined` com `null`; a validação de checkpoint agora normaliza o cursor ausente. (4) a fixture QA ainda exigia digest antigo de 577; a autorização atual de 579 agora exige simultaneamente o backup exato e o digest atual, e o runner passa a identidade do backup ao validador. (5) a medição de timeout revelou fotografia ampla e invariantes repetidas por lote; o caminho de lote evita esse trabalho repetido, mantendo guards de segurança vivos nos limites de fase, atomicidade/checkpoint e retomada.

Os 432 casos não são causa presumida: o diff de origem/alvo confirma 432 `pointId` nulos → PDV canônico e 432 `occurrenceId` nulos → ocorrência confirmada. São as transformações de contexto autorizadas, rastreadas por 578 recibos de 578 comandas; zero casos sem prova. O replay permaneceu bloqueando diferenças de valor financeiro, identidade, vínculo, origem ou tenant. O ensaio final limpo não teve divergência em `updatedAt` de comandos.

### Sequência integral, replay e duração

A sequência intercalada exata passou no restore novo: cinco migrations, preparação de negócio/catálogo, preparação de cozinha, onze migrations restantes, TAPs/sessões/financeiro/comércio, transformação de categorias e replays/reconciliação. Ledger final: 101 entradas. Os três alvos do runbook terminaram COMPLETED, sem fases ausentes; activation readiness PASS; comparações imutáveis PASS para 8.931 `TransacaoLog` e 486 `ClienteEstatisticas`. Os guards negativos de prova de comércio bloquearam mapa/recibo ausente ou divergente. O executor interrompeu e retomou fases no mesmo run ID, incluindo comércio; replay integral do mesmo run passou.

Usou os padrões do pacote: lote 250, timeout transacional 30.000 ms. O runner da sequência durou 18m13s pela diferença entre timestamps de início e fim; 1m47s foram preparação/migrations iniciais/finais fora da prova representativa. A fase representativa e replay durou 985.358 ms (16m25s). As durações cumulativas medidas dentro das 801 transações de lote confirmadas somam 643.315 ms (10m43s); os 342.043 ms restantes dessa fase são snapshots, validações invariantes, checkpoints, orquestração e replay fora das transações de lote, não tempo atribuído a um timeout do harness. A retomada medida somou 712.249 ms e replay 137.116 ms, somados sobre chamadas instrumentadas. No comércio do Thiago: 13.797/13.797 registros, 552 lotes, média 960 ms, P95 2.042 ms, máximo 2.184 ms; com limite de 30 s. A primeira falha histórica com lote 25/timeout 30 s era custo repetido do harness, não prova de que dez minutos isoladamente seja falha. Para uma futura janela, reservar ao menos 20 minutos para sequência representativa dessa fotografia, além de restore, verificações, contingência e corte; a duração final depende do checkpoint/janela.

Recibo protegido: `final-qa-304953b-20261013/authoritative-final-commit-d398d67-final-sequence.protected.json`, SHA-256 `b4451f40b168715611caaf7e3de940044910c791d8a9980be891b2106f5da1eb`.

### Classe C — somente QA

Recálculo ligado ao backup acima: 579 pagamentos; digest de payload `6d649ade7c8471adba44b381bd113d0fe2c8c04191287b1f8504e84ad9e908a9`; digest SHA-256 da lista ordenada de IDs `9ac3dac5ad2311bcf49817dd062771c5f7cf51b017da96c121b703441a8cf128`. IDs permanecem no arquivo protegido `final-qa-304953b-20261013/class-c-current-origin.ids.txt`; os recibos não expõem PII. Origem/alvo: 579/579; diferenças em campos de pagamento: zero. IDs, valores, timestamps, origem e vínculos nulos foram preservados. 432 mudanças de point/ocorrência estão vinculadas a mapa e recibo confirmado, sem inferência de sessão por horário. Disposição QA: manter proveniência `CAIXA_NAO_COMPROVADA`, preservar nulos. Decisão produtiva concreta pendente de aprovação humana: aceitar ou rejeitar essa disposição conservadora para exatamente os 579 IDs desse digest. Nenhuma autorização produtiva foi inferida.

Reconciliação protegida: `class-c-final-reconciliation.protected.json`, SHA-256 `95acb1c67f2c897878744ef4a02de26a635c66b0ea83b0dc13896c645957d516`.

### Jornadas e recuperação

Na CIA Marítima, a jornada QA autenticada concluiu venda/comanda, pagamento, abertura/fechamento de caixa, cardápio/preço, cancelamento/estoque, cozinha/estorno, portal e concessão/revogação de permissão na mesma sessão. Pagamentos originais permaneceram iguais antes/depois; integrações externas estavam desativadas. Na conta do Thiago, login e leitura autenticada passaram; a primeira criação de comanda retornou HTTP 409 corretamente porque o único ponto ativo contém três sessões de caixa abertas oriundas da fotografia (dias operacionais 17/08/2026, 07/10/2026 e 12/10/2026). Nenhuma sessão foi alterada ou escolhida. A jornada do Thiago não foi forçada por saneamento QA. Dívida, virada da meia-noite e relatórios autenticados continuam sem evidência pós-sequência nesta certificação.

A repetição de recuperação usou runtime preservado `66ec00886b65eaea8e437fae4e9a36f7be971b09` (manifesto SHA-256 `16f6447a5d51b8bd67c71ac85693e0b1a285c8e696bdf3adbcd81cca3c47f7b0`). O backend live foi comprovado por processo/PID/caminho/launcher na coleta anterior: PID 2056, entrypoint `deploy/prod-artifacts/backend/dist/index.js` SHA-256 `15462de941d798c3215f81fae2354f6145c1bf5c2b19da8799011ece6f4e6`; processo pai 12028/launcher `scripts/prod/watchdog-daemon.ps1` SHA-256 `631e9e0daadf34b88a9469da505c269e45479e1aa4f252b5af6a0804ddc5c475`; frontend efetivamente servido `assets/index-Ctt2AlhG.js` SHA-256 `651593a1650eea37698f302b7b9b75c75652dbb83dcbd09e48e23bdcfa28f86d`. O material preservado, frontend servido e processo backend live ficam distinguidos; não foi adicionado `releaseSha` nem reiniciado PRD.

Restore de recuperação: 1.945 ms; readiness de API: 12.902 ms; login sintético: 116 ms; leitura autenticada PASS; quatro uploads retornaram bytes e hashes esperados. Tempo completo até validar arquivos: **17.493 ms**. PostgreSQL foi privado, temporário, em tmpfs/loopback e removido; nenhuma integração externa foi habilitada. Recibo `isolated-recovery-after-sequence.protected.json`, SHA-256 `df842bec6b11920407bc7005c42b37094f76c686d37f187abb7815f421bc59e7`.

### Pendências mínimas antes de qualquer janela

1. Decisão humana sobre a disposição produtiva de classe C vinculada ao digest de 579 IDs acima.
2. Procedimento de negócio autorizado para as três sessões abertas do ponto do Thiago; preservar a decisão/auditoria e revalidar as jornadas afetadas. Não saneadas nesta tarefa.
3. Evidência autenticada pós-sequência para Thiago, dívida, meia-noite e relatórios; não alegar cobertura que não foi executada.
4. Integração dos commits D398 ao ramo remoto: `main` está 25 commits à frente e 65 atrás; não houve push. Não fiz atualização que descartasse ou reordenasse o histórico local. Workspace, staged e stashes foram preservados.
5. Aprovação da janela e coleta/checkpoint final sincronizado de banco + uploads, com freeze de escritas conforme procedimento da janela. Este ensaio online não é o checkpoint final.

TAP-76 permanece **In Progress**, prioridade high, labels Product/Quality. `PROD_DEPLOY_REQUIRED=YES` para publicar o pacote corrigido depois da integração técnica; `PROD_GO=NO` até aprovações de classe C, jornadas pendentes e janela. Nenhuma migration, escrita, deploy ou reinício ocorreu em PRD.

## Certificação funcional pós-migração e integração delimitada — 13/10/2026

Trabalho técnico executado apenas na cópia QA isolada (`cervejaria_qa_pdv_unico`, PostgreSQL local em `127.0.0.1:55447`) restaurada do backup autorizado. Nenhuma conexão, consulta ou escrita em PRD ocorreu nesta etapa.

### Origem, escopo e sessões do Thiago

Origem: backup SHA-256 completo `3ba54e26d9d5b7042e65695217eae396d1c7d291c87aed48f024d5963386cd3e`. O conjunto classe C de QA permanece vinculado ao payload digest `6d649ade7c8471adba44b381bd113d0fe2c8c04191287b1f8504e84ad9e908a9` (579 IDs); não é autorização produtiva nem evidência para um checkpoint posterior.

| Tenant | ID | Contrato | Tratamento certificado |
|---|---|---|---|
| Chopp Móvel | `cmr9yfsdd0001hvtku98n4cjd` | LEGACY | preservado, sem transformação CANONICAL |
| CIA Marítima | `cmr9yis3c0000hvu00q9fe7y1` | CANONICAL_PDV | alvo explícito transformado |
| Churrasquinho do Thiago | `cmsry9xrn0000hvlgopjxy0oo` | CANONICAL_PDV | alvo explícito transformado |
| Lanchonete | `cmu78vehi009hhv80bfwo5d6v` | LEGACY, fora dos três alvos | preservada fora do allowlist |

O manifesto de ativação aponta somente CIA Marítima e Churrasquinho do Thiago. O sentinel sintético LEGACY ficou fora da transformação e manteve seu contrato EVENTO; a evidência compara empresa, configuração operacional, produtos, PDVs, trailers e usuário.

O retrato protegido foi gravado antes da fixture QA em `final-qa-304953b-20261013/thiago-open-sessions-before-qa-fixture.protected.json`; os vínculos financeiros completos estão em `thiago-session-payment-links.protected.json`. As três sessões abertas são do PDV `cmsry9xry0004hvlge0wgboza` (“Principal”):

- `cmsxnry380001hvq4mr19uwnr`, 17/08/2026, troco inicial R$ 0,00: zero movimentos, zero comandas via relação da sessão e zero pagamentos diretamente ligados;
- `cmuyhu2nm00akhvekroi8onoz`, 07/10/2026, troco inicial R$ 100,00: zero movimentos, 99 pagamentos ligados por `Pagamento.sessaoCaixaId`, 99 comandas distintas via `Pagamento.comandaId`, total R$ 6.318,00 (22 PIX, 53 crédito, 14 débito, 10 dinheiro);
- `cmv575i7c07bmhv74pf6gvbz6`, 12/10/2026, troco inicial R$ 100,00: zero movimentos, 48 pagamentos ligados por `Pagamento.sessaoCaixaId`, 48 comandas distintas via `Pagamento.comandaId`, total R$ 4.617,00 (19 PIX, 20 crédito, 6 débito, 3 dinheiro); oito dos pagamentos têm vínculo `contaReceberId`.

Em todos os 147 pagamentos acima, o vínculo próprio `Comanda.sessaoCaixaRealizacaoId` está nulo. Portanto o recibo distingue os vínculos FK existentes no pagamento do vínculo de contexto ausente na comanda; não associa registros por horário. Impacto contabilizado na cópia: R$ 10.935,00 em pagamentos relacionados e R$ 200,00 de troco inicial somado, sem movimentos manuais. O material não comprova contagens físicas de fechamento.

A evidência do bloqueio original foi separada e preservada: login sintético e tentativa real de abertura na API D398 retornaram HTTP 409 com as três sessões simultaneamente abertas. Em seguida, exclusivamente na cópia descartável QA, a fixture encerrou tecnicamente essas três sessões para abrir novos turnos. Alterações diretas registradas: `status ABERTO→FECHADO`, `fechadoEm null→timestamp UTC`, e `observacaoFechamento null→nota explícita “fixture QA; não representa fechamento financeiro”`. `fechadoPorId` e todas as contagens permaneceram nulos; não foram criados movimentos nem pagamentos. Os 147 pagamentos, IDs, valores, vínculos de sessão/comanda/contas e seu digest permaneceram iguais. A fixture não é regra de migração e não autoriza mudanças em produção. Recibo `thiago-original-409-and-qa-fixture.protected.json`.

**Proposta concreta para produção — sem execução:** manter os IDs, valores e relações atuais e não preencher `Comanda.sessaoCaixaRealizacaoId` por proximidade de horário. Solicitar ao responsável do Thiago decisão documentada para cada sessão: (1) a sessão de 17/08 não tem pagamento, comanda vinculada por contexto nem movimento no restore; o fechamento só pode ser autorizado como regularização técnica após confirmação do responsável; (2) para 07/10 e 12/10, reconciliar os 147 pagamentos de IDs já ligados a cada sessão, o troco inicial e os oito recebíveis com comprovantes/contagem de caixa, e aprovar valores de fechamento por meio antes de qualquer escrita. Se a documentação não resolver divergências, preservar o estado e manter o tenant fora da ativação operacional até decisão. Nenhum pagamento ou comanda deve ser realocado; alterações em produção exigem aprovação da decisão escolhida e da janela separadamente.

### Jornadas pós-sequência

As jornadas principais foram executadas de novo contra os módulos compilados `backend/dist/app.js` e `backend/dist/lib/prisma.js` do pacote D398, com o Prisma Client gerado do schema do próprio pacote, API Fastify autenticada e PostgreSQL QA real. Harness QA usou identidade sintética. Nenhum pagamento bancário, envio, impressão ou integração externa foi executado. Recibo/log protegido: `functional-journeys-exact-d398-package.protected.log`; execução `qa-operation-4957adeffbb96994`, cerca de 8,7 s total (CIA 3,0 s; Thiago 3,3 s).

- CIA Marítima: abertura de comanda com/sem ocorrência, venda, pagamento, cardápio/preço persistidos, cancelamento sem delta indevido de estoque, portal, permissões na mesma sessão, torneiras/volume e fechamento de caixa PASS. Cozinha, venda independente preparada e estorno retornaram a recusa esperada porque cozinha está desligada. TAP permaneceu habilitado.
- Churrasquinho do Thiago: comanda, venda/pagamento, cozinha com preparação independente, cancelamento, estoque, portal, permissões, venda direta, cancelamento/estorno e fechamento PASS. Recusa de TAP PASS porque a capacidade está desligada.
- Cancelamento de comanda vazia usou API autenticada, gerou auditoria, preservou total zero e não alterou pagamento, estoque ou caixa.
- Hash dos 1.151 pagamentos da fotografia antes/depois das jornadas permaneceu `d72458eb61b9fbd3b44c41b3918607932dd2a7d72141d77f0d90a470e16fd224`.

Dívida, caixa e meia-noite passaram para ambos os tenants, usando a cópia D398 do harness financeiro e seus dados/identidades sintéticas. Caixa aberto em 27/12/2026 continuou associado ao dia operacional 27/12 após 00:05 local de 28/12. CIA: dívida de R$ 12,99, recebimentos parciais R$ 6,49 e R$ 6,50; duas linhas de pagamento ligadas ao turno, dívida encerrada, caixa fechado e resumo diário/evento conferido contra pagamentos, comandas e saldo persistidos (R$ 12,99). Thiago: dívida R$ 8,00, parcelas R$ 4,00 + R$ 4,00, duas linhas ligadas ao turno, saldo zero, caixa fechado; resumo diário de recebimentos confere com R$ 8,00. Estoque da CIA estava desabilitado e não mudou; estoque do Thiago teve somente a saída unitária prevista para o produto controlado, um movimento ligado ao pedido. Digest dos pagamentos/dívidas históricos da execução: 1.175 pagamentos `0d4a6caf76b8b5e55d69b2edfce6a381a2b2b2c9f29dea41b5a2d25753d38d86`; 40 dívidas `aebf6ee21b5e616a2214274b70a679297b92a0002d5f779349e149cc079704e5`. Execução `qa-midnight-debt-d659d09bda99eb`, 3,8 s. Logs protegidos: `functional-finance-midnight-reports-d398d67.protected.log`.

**Defeito de harness corrigido:** o cenário de cancelamento da comanda vazia tentava criar a comanda antes de abrir o caixa; a API corretamente respondia 400 “Abra o caixa antes de registrar vendas”. Movi o cenário para depois da abertura autenticada do turno, sem reduzir nenhuma asserção. A falha e correção foram reproduzidas em cópia do script do commit D398; a suíte funcional, apontando diretamente ao `dist` imutável D398, passou integralmente. O executável atual do backend não apresentou defeito nessas jornadas.

A interface visual no navegador não pôde ser iniciada: a ferramenta de execução rejeitou pela política automática o comando para iniciar o serviço local QA, antes de abrir qualquer porta. Não houve tentativa por mecanismo alternativo. Login autenticado e rotas foram validados diretamente pela API do artefato D398; a etapa visual permanece pendente de autorização técnica no executor.

### Pacote, Git e pendências de integração

O pacote testado continua exatamente `d398d67ed9d128bbb9528d983911fe41eeb7dc0b`; `candidate-manifest.json` SHA-256 completo `9dcce061e3fa7d8a530f4cb8c6841a87dfd506ad90eb5628910edf0cfc3ee513`; 353 arquivos; 101 arquivos de migration no manifesto. Esses artefatos não foram alterados. O pacote do runtime exclui harness/fixtures QA, credenciais e dados; a cópia de runtime utilizada para gerar dependências/Prisma Client e executar as jornadas ficou na pasta protegida QA. Testes anteriores de build, integridade das 85 migrations presentes e aplicação das 16 restantes, transformação intercalada, replay, retomada, reconciliação e recuperação permanecem aplicáveis: os arquivos empacotados não mudaram. A recuperação medida permanece 17.493 ms; a sequência representativa permanece 18m13s, e sua reserva mínima na janela segue 20 minutos, além de checkpoint, verificações e contingência.

A referência remota foi lida diretamente: `origin/main=304953bff4013e0ad54e33f6be443d5cfda1c130`. O candidato D398 tem 25 commits locais e 65 remotos divergentes; a árvore difere em 94 caminhos. Para revisão foi preparado, fora do checkout, patch delimitado de cinco caminhos relevantes (`pdv-unico-catalog-migrator.ts`, `pdv-unico-commerce-transform.ts`, `pdv-unico-finance-transform.ts`, `pdv-unico-migrated-operation.qa.mjs`, `pdv-unico-representative-qa.isolated.test.mjs`), SHA-256 `5332c9777fe45394a519f035e602d6caa7cfc3f40bbd6b4a422b12deb78a9320`; recibo `bounded-integration-review.protected.json`. Não criei commit integrado nem enviei push. A operação Git com índice temporário sobre base remota foi anteriormente rejeitada pela política do executor; não tentei outra forma de commit nem publiquei os 25 commits. HEAD continua D398. `origin/main` continua 304953b. Sem revisão/commit aprovado, não há novo SHA candidato nem novo manifesto integrado.

Checkout, índice, staged, alterações alheias e os três stashes foram preservados. O SHA-256 do índice segue `4272ACC8F9E9AF66C3909B2A059CF03216184A2B9638918CCF888561932DA90D`. Nenhuma evidência funcional foi copiada automaticamente de 10/10, e nenhum artefato classe C foi incluído no pacote. Plane TAP-76 permanece In Progress/high; a tentativa de registro desta rodada deve ficar pendente se o MCP continuar indisponível.

### Checkpoint futuro e parecer

A próxima coleta final deve: (a) obter autorização e registrar uma janela sem novas escritas de aplicação; (b) impedir mutações concorrentes de uploads no mesmo intervalo sem parar o serviço; (c) marcar início UTC, capturar `pg_dump` consistente do banco enquanto o freeze está ativo, copiar em seguida o diretório efetivo de uploads sob o mesmo freeze e gerar inventário de cada arquivo (caminho relativo, tamanho, SHA-256, mtime UTC); (d) comparar contadores/ledger/estado de escrita e inventário no início/fim, vinculando banco, schema, ledger e uploads a um identificador único de checkpoint; se ocorrer escrita ou diferença durante a coleta, descartar esse par e repetir; (e) liberar as escritas somente após ambos os materiais e hashes estarem protegidos. O dump de 12/10 e cópia de uploads, coletados em instantes diferentes, continuam ensaio, não checkpoint sincronizado.

**Parecer: NO-GO para janela/migração produtiva.** Os gates funcionais pós-sequência passam em QA; faltam revisão e integração Git sobre a base remota correta, execução visual no navegador após liberação técnica do serviço QA, decisão humana sobre as três sessões do Thiago, aprovação produtiva classe C para exatamente o digest acima (se essa disposição for escolhida) e autorização explícita de janela com checkpoint sincronizado. Nenhuma dessas condições foi executada em produção. `PROD_DEPLOY_REQUIRED=YES` para uma revisão integrada futura; `PROD_GO=NO`.

### Consolidação da integração delimitada — 13/10/2026

Este adendo substitui os estados operacionais anteriores que diziam que não havia commit/push e que o launcher ainda aguardava concessão; esses trechos preservam o histórico das tentativas anteriores.

O commit de integração foi criado sem checkout, a partir de `origin/main` confirmado em `304953bff4013e0ad54e33f6be443d5cfda1c130`, por índice Git alternativo. Commit `08c1eddf0a9b15246b4d8802b2f330919ae4972f`, tree `35b2fd3cb9250313cb59c23f02f8ddc28ae3c1b4`, pai único igual à base remota. Contém somente os cinco caminhos do patch de SHA-256 `5332c9777fe45394a519f035e602d6caa7cfc3f40bbd6b4a422b12deb78a9320`: três ferramentas de migração e dois arquivos de harness QA. O patch foi validado por caminho, conteúdo D398 e `diff --check`.

As diferenças de aplicação observadas em D398 foram excluídas da integração: `backend/src/routes/operacao/index.ts`, `frontend/src/components/EventoCaixaPanel.tsx`, `frontend/src/components/EventoResumoKpis.tsx` e `frontend/src/pages/ComandasPage.tsx`. As três mudanças de UI removiam guards de permissões de caixa; a rota também alterava a guarda de tenant ausente. O pacote final é portanto construído sobre a aplicação de `304953b`, sem essas alterações paralelas.

Pacote imutável final: `generated-release-candidates/08c1eddf0a9b15246b4d8802b2f330919ae4972f/`; manifesto SHA-256 completo `4874e328fbd55863b881699cec164eea4649c6ecf4d9772ab58284f981d930cb`. São 353 arquivos; todos os hashes de arquivo passaram, com 101 migrations reconciliadas ao ledger sanitizado SHA-256 `9d48404035fac78a2c253c622f28b5867a571e2a440d21d96393b30869b86e7d`. Node `v24.18.0`, npm `11.16.0`; lock SHA-256 `9330ae831d6ea407a47dbf50a6158c60fd9ffb54fe99ed87e17fd6c6e5ec60d0`, schema SHA-256 `38b47bd10a86aa0b8784b54a2829442cd3ae5a9012fb784bdd763e29f8ffd98b`. O pacote não contém `node_modules`, `.env`, credenciais ou fixtures protegidas; verificação de nomes de arquivo e busca de padrões conhecidos de segredo retornaram zero ocorrências. O Prisma Client `6.19.3` foi gerado na cópia descartável de runtime a partir do schema empacotado.

Comparação com D398: cinco caminhos do pacote têm arquivo/hashes diferentes: `backend/dist/routes/operacao/index.js`, `frontend/assets/index-BAJH5pR8.js` (em lugar do asset D398), `frontend/index.html`, `frontend/sw.js` e `source-snapshot-inventory.json`. Logo, evidência D398 de UI não foi transferida. As jornadas via API sobre D398 e as evidências intercaladas/replay/retomada/reconciliação/recuperação permanecem registradas como anteriores; a validação visual precisa usar o pacote final.

O preparador existente tinha duas incompatibilidades no validador do ledger/arquivo arquivado: SHA de release `956f3a...` hardcoded apesar do manifesto D398 SHA-256 integral já fixado, e leitura exclusiva de flags `t|f` enquanto o ledger sanitizado registra `true|false`. Corrigidas localmente no harness para validar a identidade/hash integral do manifesto passado e aceitar as duas codificações, mantendo os filtros de nome, SHA-256, confirmação de migration e checagem dos bytes Git. O preparador então concluiu build, integridade e publicação imutável do pacote; essas correções do empacotador não foram adicionadas ao commit runtime de cinco caminhos.

O commit foi enviado sem force para `origin/codex/pdv-migration-08c1eddf-20261013`; `origin/main` não foi alterado. Checkout e HEAD continuam no estado anterior, índice real SHA-256 `4272ACC8F9E9AF66C3909B2A059CF03216184A2B9638918CCF888561932DA90D` e os três stashes permanecem preservados.

**Navegador pendente por bloqueio técnico do executor.** Após a concessão explícita para QA, o executor rejeitou `Start-Process` do backend local antes da inicialização. Nenhum processo/porta foi criado e não houve tentativa por mecanismo alternativo. A cópia de runtime e Prisma Client estão preparados sob QA protegido, ligados ao PostgreSQL descartável `127.0.0.1:55447`, mas os fluxos em 390px/768px, capturas, console e rede ainda não foram validados. Assim, nenhum resultado de navegador ou screenshot é afirmado.

**Parecer consolidado: NO-GO.** Não há decisão produtiva embutida: seguem necessárias a regularização humana das três sessões abertas do Thiago, a aprovação/rejeição da disposição QA classe C para os 579 IDs do digest `6d649ade7c8471adba44b381bd113d0fe2c8c04191287b1f8504e84ad9e908a9`, a autorização da janela e o checkpoint sincronizado de banco+uploads. A única pendência técnica nesta rodada é executar o smoke visual do pacote final após habilitação do launcher QA pelo executor. `PROD_DEPLOY_REQUIRED=YES`; `PROD_GO=NO`.

Evidência desta rodada registrada na TAP-76 como comentário interno `65c02b9a-6c5d-44f1-8d67-84fa6b8e7a68`; o item foi lido antes da atualização e permanece In Progress/high, labels Product/Quality. O executor deixou 0 listeners em `127.0.0.1:3101` após rejeitar a inicialização QA; nenhum runtime visual foi iniciado.

## Validação direcionada do pacote final 08c1eddf — 14/10/2026

Esta rodada usou somente o pacote imutável do candidato `08c1eddf0a9b15246b4d8802b2f330919ae4972f` (manifesto SHA-256 completo `4874e328fbd55863b881699cec164eea4649c6ecf4d9772ab58284f981d930cb`) e a restauração QA do backup SHA-256 `3ba54e26d9d5b7042e65695217eae396d1c7d291c87aed48f024d5963386cd3e` em `127.0.0.1:55447`. Nenhum acesso a PRD ocorreu.

### Diferenças relevantes em relação a D398

Os quatro caminhos de aplicação presentes em D398 e excluídos do candidato final foram comparados com os snapshots imutáveis:

- `backend/src/routes/operacao/index.ts`: a origem final mantém a recusa 404 para identidade autenticada sem tenant, antes de carregar contexto operacional. Na cópia QA, contexto do tenant autorizado retornou 200 e a identidade sintética sem tenant recebeu 404.
- `frontend/src/components/EventoCaixaPanel.tsx`: a origem final condiciona leitura de valores e controles de abrir, movimentar e fechar caixa às permissões específicas. As rotas API no pacote final deram 403 sem grants para abrir/movimentar/fechar; sessões e movimentos persistidos ficaram idênticos antes/depois (53 sessões e 0 movimentos no escopo medido).
- `frontend/src/components/EventoResumoKpis.tsx`: `event.dashboard.read` controla a consulta e a exibição dos KPIs. No endpoint real, owner autorizado recebeu 200 e atendente sintético sem grant recebeu 403.
- `frontend/src/pages/ComandasPage.tsx`: `event.dashboard.read` também controla a consulta, o estado de carregamento e a exibição do dashboard na página de comandas. A API confirma a autorização correspondente; comportamento visual permanece sem prova enquanto o navegador não puder ser executado.

API direcionada PASS contra `buildApp` do runtime empacotado e PostgreSQL QA real. Houve leitura autenticada de contexto e caixa autorizados (200); recusas 404/403 esperadas; as três recusas mutáveis de caixa foram verificadas contra contagens persistidas, sem escrita em sessão ou movimento. Receipt protegido `qa-targeted-api-08c1eddf.protected.json`, SHA-256 `e1bcaebf30063165f4366eace5f1202bfa80a3014c6a247257c23a432a010d92`. As contas de teste foram sintéticas e limitadas ao tenant QA; dois registros Usuario sintéticos adicionais permaneceram somente na restauração QA após uma preparação de harness interrompida antes das requisições mutáveis. Nenhum registro financeiro ou de caixa foi escrito por essa preparação. Recibo consolidado TAP-76 protegido SHA-256 `248467c06a38f1afd8e3544bcf84e9a54d0d357e810392b75a02e2806b2bcdb7`. A UI não foi considerada coberta por chamadas API.

### Bloqueio do navegador e integração

A ação técnica exata rejeitada foi a invocação autorizada de `Start-Process` para `node --import @elastic/opentelemetry-node dist/index.js`, no diretório do runtime do candidato, com `HOST=127.0.0.1`, `PORT=3101` e conexão exclusivamente à restauração PostgreSQL QA. A concessão loopback QA já havia sido dada; o executor bloqueou a chamada antes de criar processo ou listener. Verificação posterior encontrou zero listeners na porta 3101. Conforme solicitado, não repeti a configuração, não usei launcher alternativo e não substituí navegador por testes estáticos. Esta etapa requer executor autorizado. Não existem screenshots, validação 390px/768px, console ou rede observados.

Como o gate de navegador não passou, o candidato **não foi integrado em `main`**. O commit candidato e pacote permanecem imutáveis no branch remoto `codex/pdv-migration-08c1eddf-20261013`; esta rodada não alterou `origin/main`, checkout, índice, staged ou stashes. A evidência de sequência, replay, retomada, reconciliação e recuperação continua reaproveitável porque migrations, schema e lock do pacote final não diferem de D398; evidências de interface não foram transferidas.

**Parecer continua NO-GO.** Pendências técnicas: somente smoke curto no navegador do pacote final, depois que um executor autorizado iniciar o serviço QA. Pendências produtivas separadas: decisão humana sobre as sessões do Thiago; aprovação específica ou rejeição da disposição para os 579 pagamentos classe C vinculados ao digest `6d649ade7c8471adba44b381bd113d0fe2c8c04191287b1f8504e84ad9e908a9`; autorização de janela e checkpoint sincronizado de banco/uploads. Nenhuma decisão produtiva foi executada.




## Tentativa final de smoke visual — 14/10/2026

Com a autorização renovada, o runtime do candidato iniciou pelo comando QA já preparado: PID 9932, backend `node --import @elastic/opentelemetry-node dist/index.js`, `127.0.0.1:3101`, ligado somente ao PostgreSQL descartável `127.0.0.1:55447` do backup SHA-256 `3ba54e26d9d5b7042e65695217eae396d1c7d291c87aed48f024d5963386cd3e`. `GET /api/health` respondeu. A raiz `GET /` retornou HTTP 404 porque o backend não resolveu a pasta frontend do pacote; não alterei a configuração nem iniciei outro serviço.

O controle Computer Use encerrou antes de qualquer entrada no navegador com a rejeição exata: “could not determine the current browser URL on Windows with enough confidence to enforce policy.” Parei a automação conforme a instrução da ferramenta. Não houve navegação autenticada, teste em 390px/768px, screenshot, inspeção de console ou rede. O processo QA que iniciei foi encerrado; a porta 3101 ficou sem listener.

A validação visual continua pendente e o candidato **não foi integrado a `main`**. Não repeti os gates aprovados, não usei harness alternativo e não criei script, launcher, clone ou worktree. Branch remota do candidato permanece publicada; `origin/main` não foi alterada. Nenhuma operação atingiu PRD.

Recibo protegido consolidado atualizado: `tap76-functional-certification-20261013.protected.json`, SHA-256 `1b5888c166884b29e85e9390b983f7263bae11729f1715f722a7e4fcf1c6a77f`. Parecer NO-GO permanece até o smoke visual passar; as decisões produtivas sobre sessões do Thiago, classe C e janela seguem separadas.
## Smoke visual do candidato 08c1eddf (14/10/2026) — PENDENTE

- Pacote preservado: `08c1eddf0a9b15246b4d8802b2f330919ae4972f`; SHA-256 integral do manifesto: `4874e328fbd55863b881699cec164eea4649c6ecf4d9772ab58284f981d930cb` (353 entradas). O manifesto do runtime preservado é byte a byte igual; os 11 arquivos do frontend listados nele conferem com os hashes.
- Preparação de frontend corrigida com a configuração já suportada pelo runtime (`FRONTEND_DIST` apontando para `browser-runtime-08c1eddf\frontend`). Na primeira instância QA, `/api/health` e `/` responderam HTTP 200; os sete recursos referenciados pela página carregaram HTTP 200 e seus SHA-256 coincidem com o manifesto. O HTML não contém URL absoluta para API produtiva. A inspeção de rede do navegador não ocorreu.
- API QA executada em `127.0.0.1:3101`, pelo `node --import @elastic/opentelemetry-node dist/index.js` no runtime protegido, conectada ao PostgreSQL QA privado `127.0.0.1:55447`. O campo `releaseSha` do health retornou `dev`; ele não foi usado como prova da identidade do pacote. Nenhum acesso a PRD ocorreu.
- O Playwright existente iniciou 11 casos a 390 px, mas a fixture legada tentou criar PDVs adicionais; os quatro preparos correspondentes receberam HTTP 409 antes da jornada. A origem canônica possui um único PDV ativo. Outros casos pararam ao ler o storage state temporário com BOM; um worker também emitiu `UV_HANDLE_CLOSING`. Nenhuma dessas ocorrências comprova defeito de produto. Tempo até essas falhas: 8,2 s. Não houve screenshot funcional, captura de console/rede nem jornada aprovada.
- Foram criadas cópias descartáveis `cervejaria_qa_visual_390` e `cervejaria_qa_visual_768` a partir do banco QA já migrado, sem reaplicar migrations. Na instância 390, o login sintético retornou HTTP 500 embora a leitura Prisma confirme usuário, tenant, senha hash e `passwordChangedAt` consistentes. A causa do 500 não foi exposta pela resposta genérica.
- A ação de reiniciar a API QA já autorizada, usando o runtime existente, loopback e o banco descartável, com `LOG_LEVEL=error` para coletar o erro interno, foi rejeitada pelo executor: `CreateProcess ... Rejected ... blocked by policy`. Não se tentou outro launcher. A API QA foi encerrada depois; a porta 3101 está sem listener. As duas cópias de banco permanecem somente em QA protegido.
- O harness e os dois estados de autenticação temporários foram restaurados byte a byte; checkout permaneceu em `d398d67ed9d128bbb9528d983911fe41eeb7dc0b`, três stashes preservados e nenhum `git add`, commit ou push foi executado. Integração em `main` não realizada porque o smoke obrigatório não passou.

**Pendências técnicas indispensáveis:** executor autorizado para relançar a API QA e obter a exceção real do HTTP 500; fixture Playwright ajustada ao PDV canônico único; repetir o smoke existente em 390 px e 768 px, salvar screenshots e verificar console/rede e persistência. Até isso passar, candidato não aprovado visualmente e integração técnica pendente. Decisões produtivas sobre sessões do Thiago, classe C e janela continuam separadas; PRD permanece fora do escopo.

### Current visual smoke and harness update - 2026-10-14

The user granted explicit technical authorization to start only the immutable candidate API, SHA 08c1eddf0a9b15246b4d8802b2f330919ae4972f, on 127.0.0.1:3101, connected to disposable QA PostgreSQL cervejaria_qa_visual_390, with protected internal logs. The authorized execution was rejected before process creation: CreateProcess rejected by policy (blocked by policy), when PowerShell was asked to load configuration in memory and start the preserved runtime process node --import @elastic/opentelemetry-node dist/index.js. No alternate launcher was used and the attempt was not repeated.

Therefore the internal exception for the previously observed login HTTP 500 could not be collected and its cause remains unproven. The API did not start in this attempt. There was no browser navigation, smoke at 390px/768px, screenshot, console, network or visual persistence check. Integration to main was not attempted because the smoke gate is still pending. No PRD service was accessed.

Harness corrections are retained locally: auth setup captures status without retrying logins, uses Playwright-generated storageState and normalizes JSON as UTF-8 without BOM; E2E_SYNTHETIC_ONLY=1 limits auth generation to the synthetic kiosk account; the fixture helper requires and reuses exactly one active canonical PDV without creating more; the focused smoke supports viewport and artifact environment variables and implements one real API/PostgreSQL journey with console/network and persisted payment checks. These are test-only changes outside the immutable application package. Their full SHA-256 values are in protected receipt visual-smoke-final-08c1eddf-20261014.protected.json.

HEAD remains d398d67ed9d128bbb9528d983911fe41eeb7dc0b. The checkout, index, staged changes and three stashes were preserved. No commit or push occurred. TAP-76 remains In Progress/high. Production decisions about Thiago sessions, disposition of the 579 Class C payments and window authorization remain separate and pending. Integration/production verdict: NO-GO until visual smoke passes; previously approved migration gates were not repeated.

### Reconstituted candidate smoke completion — 2026-10-14

This section supersedes the pending visual-smoke result above. The user approved the limited API/frontend QA execution (“Aprovar execução limitada”). No new approval rejection occurred. The archived package was absent, so the existing Git-blob preparer rebuilt release `08c1eddf0a9b15246b4d8802b2f330919ae4972f` from tree `35b2fd3cb9250313cb59c23f02f8ddc28ae3c1b4`. The new manifest SHA-256 is `4278b8549b7f192117ff8867ef23e443a661dededd74dd2169796ce2a2b8df02` with 353 files and 1,524 materialized blobs. The prior recorded manifest SHA-256 is `4874e328fbd55863b881699cec164eea4649c6ecf4d9772ab58284f981d930cb`; its file was unavailable. The manifest hashes differ, so byte-for-byte identity is not claimed. The source SHA, source tree, entry count and sanitized source-ledger hash match the recorded candidate.

The prior QA PostgreSQL container was absent; the other two active QA containers were preserved. A new loopback-only disposable container was restored from the authorized 12/10 backup after SHA-256 verification (`3ba54e26d9d5b7042e65695217eae396d1c7d291c87aed48f024d5963386cd3e`). The restored ledger had 85 finished migrations; 16 pending candidate migrations were applied to prepare this new copy, reaching 101 without repeating migration certification, recovery certification or RBAC. The three controlled session updates changed only status, close timestamp and the explicit QA fixture note; all 147 payment rows, values and links retained the same digest. A synthetic browser account from the prior protected QA fixture was recreated in this copy. The database container was stopped after the smoke and retained for QA evidence.

The earlier HTTP 500/P2022 documented in this report belongs to archived rollback runtime `c55`, not candidate `08c1eddf`: c55 queried `Usuario.podeDarDescontoQuiosque` after migration `20260924212000_rename_operational_discount_permission` renamed it to `podeDarDescontoOperacao`. Candidate `08c1eddf` logged in with HTTP 200 against its prepared schema. The first candidate QA startup also exposed missing QA-only `CORS_ORIGIN` and `JWT_SECRET` configuration; supplying the loopback origin and an ephemeral QA JWT secret allowed startup. An initial 401 was the absent synthetic browser account in the fresh restore; recreating that fixture resolved it.

The integrated Playwright journey passed at 390px and 768px. Both screenshots were visually reviewed. Each login returned HTTP 200; the smoke verified closed status, total R$ 13,00 and payment persistence of R$ 13,00. There were no HTTP 5xx responses or failed business requests. The network record contains the expected pre-auth `/api/auth/me` 401 and production-disabled `/api/public/dev/app-origin` 404. Audit POST returned 204; Playwright also reports the tracker's intentional `sendBeacon` on `beforeunload` as `net::ERR_ABORTED` during browser teardown.

The bounded candidate commit was a single child of the fetched `origin/main` (`304953bff4013e0ad54e33f6be443d5cfda1c130`). It was pushed to `origin/main` by fast-forward, without force, at `08c1eddf0a9b15246b4d8802b2f330919ae4972f`. The local checkout stayed on `main` at `d398d67ed9d128bbb9528d983911fe41eeb7dc0b`; all three stashes, staged work, unstaged work and untracked artifacts remain in place. No PRD runtime or database was accessed. The QA completion receipt and per-viewport artifacts are under `artifacts/rbac-permissions-ui-2026-10-10/run-08c1eddf-visual-smoke-20261013/`.

Preservation note: a read-only integration check attempted `git write-tree` and the workspace sandbox denied index-lock creation with `fatal: Unable to create 'C:/Users/Papai/Documents/Desenvolvimento/Cervejaria/.git/index.lock': Permission denied`. No approval request reached the user for that command; it created no lock and did not modify the index. Integration used read-only graph checks and a normal fast-forward push instead.

## Execução produtiva autorizada — abortada antes de mudanças — 15/10/2026

A janela autorizada para o candidato `08c1eddf0a9b15246b4d8802b2f330919ae4972f` iniciou somente o preflight às 06:46:08 -03 e foi abortada às 06:49:30 -03, antes de freeze ou de qualquer leitura/escrita no banco produtivo. Nenhum upload, arquivo de configuração, runtime ou arquivo publicado foi alterado; zero migrations, transformações, fechamento de sessão ou classificação classe C foram aplicados. `origin/main` local aponta para o SHA autorizado. A verificação de rede `git ls-remote` falhou por conexão bloqueada: `Failed to connect to github.com:443`; nenhuma operação de push foi tentada.

O pacote retido existe no caminho `deploy/release-candidates/08c1eddf0a9b15246b4d8802b2f330919ae4972f`, com tree `35b2fd3cb9250313cb59c23f02f8ddc28ae3c1b4`, manifesto SHA-256 `4278b8549b7f192117ff8867ef23e443a661dededd74dd2169796ce2a2b8df02` e inventário de origem SHA-256 `16505692765f602ff66d3cccd17249ad734839353816387958c8f3f553a5e456`. O smoke permanece coberto pelo recibo protegido anterior; não foi repetido.

**Abortamento de segurança:** o runbook disponível (`docs/ops/pdv-unico-cutover-runbook.md`) declara execução DEV-only. O wrapper produtivo disponível promove artefatos e pausa o deploy, mas não bloqueia/atesta todas as fontes de escrita indicadas na autorização (tarefas, filas, workers e uploads). O serviço `Cloudflared` estava `Running`. A tentativa de inventariar processos recebeu exatamente `Get-CimInstance : Acesso negado`; não foi solicitada elevação e nenhuma solicitação de aprovação técnica chegou ao usuário.

O código do SHA aprovado exige valores contados em todos os campos do fechamento de caixa (`contadoDinheiro`, `contadoPix`, `contadoCartaoDebito`, `contadoCartaoCredito`). Não foi encontrado endpoint de encerramento administrativo que preserve contagens nulas. Portanto não havia mecanismo suportado e verificável para encerrar administrativamente as três sessões sem representar um fechamento financeiro falso. Nenhuma sessão foi modificada. A disposição classe C também não foi aplicada; nenhum pagamento foi tocado.

A importação local do validador encontrou a política do PowerShell: `O arquivo C:\Users\Papai\Documents\Desenvolvimento\Cervejaria\scripts\prod\release-candidate.ps1 não pode ser carregado porque a execução de scripts foi desabilitada neste sistema.` Não foi contornada. Os scripts locais `scripts/prod/publish-artifacts.ps1` e `scripts/prod/release-candidate.ps1` têm alterações do usuário e foram preservados sem execução.

Resultado: **ABORTED_BEFORE_CHANGES**. Próximo passo necessário é disponibilizar um procedimento produtivo revisado que bloqueie e verifique todas as fontes de escrita e suporte o tratamento administrativo sem contagens financeiras inventadas. Depois desse preflight, executar em nova janela autorizada dentro de 90 minutos. `PROD_DEPLOY_REQUIRED=NO`; `PROD_GO=NO`.

Recibo protegido: `artifacts/rbac-permissions-ui-2026-10-10/run-prod-authorized-08c1eddf-20261015/production-execution-receipt.protected.json`.

## Preflight produtivo após correções administrativas e de freeze — 15/10/2026

A operação administrativa agora é distinta do fechamento financeiro: exige dono autenticado, motivo, ator e hora do servidor; fecha a sessão operacional sem preencher contagens, alterações de pagamento ou movimentos, mantém a conciliação pendente e retorna idempotente sem duplicar auditoria. Relatórios mostram dados financeiros como indisponíveis e não associam vendas por horário. A implementação, migration, build e ensaio QA direcionado estão identificados em `docs/ops/prod-freeze-and-recovery-runbook.md` e no recibo `artifacts/rbac-permissions-ui-2026-10-10/run-admin-freeze-20261015/admin-session-close-freeze.qa.json`.

O ensaio foi limitado ao backup autorizado, cujo SHA-256 foi conferido também dentro do container QA (`3ba54e26d9d5b7042e65695217eae396d1c7d291c87aed48f024d5963386cd3e`). As três sessões inventariadas e os 147 pagamentos aprovados foram comparados; o digest dos 147 pagamentos permaneceu `08d92bad55c84c8b798559d638dcb4aa2ac82ed0fb00c1243062f9cfdad0b359`, os campos de contagem permaneceram nulos e nenhum movimento foi criado. Autorização negativa, motivo mínimo, replay idempotente, relatório e abertura de novo turno foram exercitados. O freeze devolveu HTTP 503 para movimento, status de dono `blocked=true/inFlightWrites=0`, a operação administrativa controlada passou, e a escrita de QA voltou a persistir HTTP 201 após remover o marcador. A ativação ficou limitada a Thiago e CIA Marítima; os demais tenants foram testados em LEGACY. O banco QA foi restaurado novamente ao backup bruto e o ledger retornou a 85 migrations; containers descartáveis foram parados. Uma primeira tentativa de migrate a partir do checkout mutável encontrou migration paralela `20261002120000_unique_normalized_customer_phones` e abortou com P3018 antes de aplicar SQL; a cópia foi descartada. A repetição deve partir dos blobs exatos do candidato.

O inventário de escritores, tarefas que podem relançar serviços, uploads, coleta do checkpoint, manutenção do freeze, critérios de abortar, retorno compatível e orçamento de 75 minutos estão no runbook operacional. A aprovação de classe C continua vinculada somente aos 579 IDs e digest já aprovado `6d649ade7c8471adba44b381bd113d0fe2c8c04191287b1f8504e84ad9e908a9`, com disposição conservadora: preservar IDs e valores, manter os três vínculos nulos e registrar `CAIXA_NAO_COMPROVADA`, sem associação por horário. Sessões do Thiago permanecem com conferência financeira pendente; apenas Thiago e CIA Marítima são ativados.

**Bloqueio produtivo remanescente:** o deploy atual constrói a partir do checkout mutável, e o executor de transformação/replay continua DEV-only. O helper de publicação de candidate isolado não integra a sequência de negócio em produção. Não execute nem autorize janela produtiva até existir uma chamada produtiva revisada que valide e publique exatamente o pacote retido e que seja ensaiada de ponta a ponta em restore QA; não contorne usando SQL manual ou o runner DEV. Esta rodada não consultou banco, runtime, uploads ou configuração de PRD, não iniciou escritores produtivos e não migrou PRD. Resultado: `PROD_GO=NO` até a lacuna concreta de publicação/execução ser fechada.

O SHA completo da nova revisão integrada, o SHA-256 completo do manifesto e o inventário do pacote final estão no recibo de candidato gerado depois que a árvore Git foi fixada; esse recibo é a fonte exata de identidade para a publicação e não autoriza reconstrução ou promoção.
