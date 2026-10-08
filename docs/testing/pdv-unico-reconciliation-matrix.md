# Matriz de reconciliação — PDV único CIA Marítima + Churrasquinho

Fotografia de origem aprovada: SHA-256 `2071d444df091fe85438278ca1e6d2329d4e2106679b23143f0e863b8769d16b`, 34 tabelas, 10.738 linhas, zero arestas cross-tenant. Execução final em 2026-10-08, código `9e86dc9daf6162fa8d5f92b10dd7911457157d13`, PostgreSQL QA descartável. Os estados `PASS` abaixo certificam a transformação dos dados restaurados; os limites pós-migração estão escritos como pendência, não inferidos.

| Domínio | Comparação exigida | Resultado do ensaio | Próximo gate / limite |
|---|---|---|---|
| Tenant, PDV, Trailer, agenda e ocorrência | ID, vínculo, estado, data e origem | PASS; CIA: 0 PDVs + 1 Trailer, 4 agendas/23 ocorrências; Churrasquinho: PDV existente preservado, 1 agenda/2 ocorrências | Não decidir unidades de outros tenants |
| Produtos, formato/volume, preços e cardápios | ID, unidade, preço e relação/override | PASS no catálogo; replay por escopo | Smoke autenticado pós-migração nos dois tenants pendente |
| Sessões e movimentos de caixa | ID, estado, PDV, valores e sessão | PASS; pausa/retomada/replay e dependências confirmadas | Fluxo de abrir/fechar autenticado na fotografia pendente |
| Pagamentos e recebimentos | ID e centavos; forma/origem; sessão explícita; sem duplicidade | PASS nos 605 pagamentos | Sem autorização para inferir sessão ausente por data/valor |
| Pagamentos classe A | 26 IDs e links de sessão | PASS; links exatos mantidos | — |
| Recebíveis classe B | 2 pagamentos, ID de recebível, principal/recibos/saldo | PASS; 5.200 centavos, identidade mantida e saldo reconciliado | — |
| Pagamentos classe C | 577 IDs aprovados, campos financeiros/contexto, duas FKs de sessão nulas e proveniência | PASS; 3.470.900 centavos; `CAIXA_NAO_COMPROVADA`; autorização antiga de 577 entradas e digest preservados | Não expandir/regerar autorização para novos registros |
| Comandas e itens | ID, tenant/PDV/ocorrência, estado, desconto/total, autor, timestamps, produto/volume/quantidade/preço e snapshots | PASS pela transformação comercial, recibos e replay | Operação autenticada sobre os tenants migrados pendente |
| Opcionais e snapshots | ID, vínculo, preço e conteúdo histórico | PASS pela transformação comercial e replay | — |
| Cozinha e histórico | ID de pedido/item, estado, histórico e relação | PASS; Churrasquinho preparou 431 registros; replay pós-comércio passou | Pedido independente e demais três decisões de ranking/consumo continuam sob decisão; não alterar nesta rodada |
| Estoque e ledger | Produto/PDV/unidade, saldo, movimentos e hash | PASS no escopo de migração/replay | Teste de operação de estoque autenticado na fotografia pendente |
| TAPs e montagens | ID, produto, número, data/estado, referências e conteúdo | PASS; 9 TAPs e 123 montagens; CIA 5/123, Churrasquinho 4/0 | Operação autenticada de montagem pendente |
| Clientes | ID e relações de histórico | PASS na transformação/replay comercial | API/portal autenticados sobre dados migrados pendentes |
| Auditoria (`TransacaoLog`) | IDs, relações e conteúdo preservados; confirmar dependências | PASS rowwise após transformações/replays, por ID e conteúdo escalar | — |
| Estatísticas (`ClienteEstatisticas`) | IDs, chaves de cliente e contadores | PASS rowwise após transformações/replays, por ID e conteúdo escalar | — |
| Permissões anteriores e novas concessões | Usuários/tenant, grants antes/depois, tentativas e revogação | PASS: todos os usuários preexistentes comparados; dono sem grants explícitos novos; sem grants exclusivos do dono para atendentes | Fluxo autenticado de concessão/revogação no tenant migrado continua pendente |
| Ranking histórico de Chope | Leitura por tenant, período e produto; comparar ordenação/valores ao legado | PASS; snapshot antes/depois das migrations, categorias e replays idêntico | Não definir métrica nem reconhecimento retroativo |

## Resumo por tenant

| Tenant | Transformações | Contagem de comércio | TAPs / montagens | Resultado |
|---|---|---:|---:|---|
| CIA Marítima | negócio, catálogo, TAPs, sessões, financeiro, preparação/cozinha, comércio, replay financeiro e de cozinha | 1.549 em 62 lotes | 5 / 123 | PASS nas transformações |
| Churrasquinho do Thiago | mesmas fases; preserva PDV existente | 3.004 em 121 lotes; 431 preparações de cozinha | 4 / 0 | PASS nas transformações |

O resultado completo com tempos, status de retomada/replay e hash do snapshot está em [`pdv-unico-integrated-representative-evidence.json`](pdv-unico-integrated-representative-evidence.json). `PROD_ACCESS_USED=NO`; `DEV_SHARED_ACCESS=NO`. A aprovação das transformações não é aprovação do corte ou de PROD.

## Addendum: closing reconciliation gates (2026-10-08)

The sequenced disposable QA order is: restore the approved photo with its source schema (`66ec008`, baseline `20260930150000_company_pix_key`); prove a QA backup/restore; snapshot legacy Chope rankings; deploy minimum migrations through `20261004150000`; run business/catalog/kitchen preparation with the pre-commerce client (`128f69f`); deploy dependent migrations with the original `20261004170000` preflight; run the existing canonical category SQL; compare rankings; run tenant transformations, final replays, and integrated reconciliation.

| Gate | Result | Executor |
|---|---|---|
| Source restore + QA recovery | PASS, 34 tables / 10,738 rows | `run-pdv-unico-sequenced-qa.mjs` |
| `TransacaoLog` and `ClienteEstatisticas` rowwise by key and content after transformations/replays | PASS | `pdv-unico-representative-qa.isolated.test.mjs` |
| Existing-user grants compared before/after migrations; no explicit new owner grants or owner-only grants to attendants | PASS | Same representative QA run |
| Canonical categories; original product labels/IDs, same-tenant links, `gamificada=false` | PASS | Existing canonical category SQL + representative assertions |
| Historical Chope ranking snapshot before/after migrations, category transform, and replays | PASS, identical | `pdv-unico-ranking-snapshot.qa.mjs`; no new scoring rule |
| Historical 605 payments | PASS only for exact original IDs; class C remains pinned to the approved 577 IDs | Representative reconciliation |

Authenticated operational flows **on the two migrated photo tenants** remain pending. The existing authenticated suite uses synthetic tenants and does not meet this gate. A global preflight on all shared DEV tenants and an apply-capable guarded DEV entrypoint exercised against disposable QA also remain pending. No cutover is authorized by these results.

## Final sequenced execution record

Temporary report: `%TEMP%\pdv-sequenced-final-81422d1b515d4247a0fbc7e68ea12644.json` (started 2026-10-08 15:12:24 UTC; total 2,296,748 ms / 38 min 16.748 s). All ten runner phases passed. Direct phase timings: source migrations 2.118 s; source restore/compare 3.963 s; QA backup/recovery 2.312 s; pre-transform ranking 0.410 s; minimum migrations 1.714 s; pre-commerce transforms and kitchen prep 275.193 s; dependent migrations/preflight 1.706 s; categories 0.162 s; ranking comparison 0.378 s. Tenant migrations/replays/integrated reconciliation occupied approximately 2,008.8 s by residual from total; the earlier runner version did not time this child execution separately. The runner now records that phase explicitly for future certifications.

| Tenant | Result | Replayed phases | Representative records |
|---|---|---|---|
| CIA Marítima | PASS, no missing phases | business, catalog, TAP, sessions, finance, kitchen preparation, commerce, finance revalidation, kitchen revalidation | 1,549 commercial records / 62 batches; 5 TAPs / 123 montages; 0 source PDVs + 1 Trailer -> one canonical PDV |
| Churrasquinho do Thiago | PASS, no missing phases | same phases | 3,004 commercial records / 121 batches; 431 kitchen preparations; 4 TAPs / 0 montages; existing PDV retained |

The original 605 payments remained reconciled by exact ID/value set; the existing 577 class-C authorization was not changed. Recovery dump SHA-256: `66ab0cabb83afd73d6ef9c56a7fbb87743cab75d00af1697948a430d49a050b6`; restored 34 tables / 10,738 rows in the QA-only recovery database. The dependent DDL validated `MovimentoEstoqueQuiosque_pedidoId_tenant_point_fkey` with the original preflight enabled.

This was a working-tree QA run based on repository HEAD `ad2d979` plus existing local changes and this delivery's uncommitted changes. It is not an immutable release-SHA certification. Authenticated operation against these migrated tenants, all-tenant DEV preflight, and apply-capable entrypoint QA remain open. Shared DEV/PROD were not accessed.

## Bloqueio de fechamento encontrado na operação focada (2026-10-08)

A reconciliação da foto aprovada confirma a comanda `cmuqaoyta0007hvdg3q4v7hkj` já existente no Churrasquinho: total 0, pagamentos 0, itens 0, saldo 0; `ABERTA`, `APELIDO`, origem `CAIXA`, dia 2026-10-01, criada em 2026-10-02T01:39:21.790Z. Está vinculada ao PDV `cmsry9xry0004hvlge0wgboza` e ao cliente `cmumnla0z0014hv18nth4smgx`, sem evento, ocorrência, sessão ou usuário de abertura; sem recebível. Não houve alteração do registro. A regra `contarComandasAbertas` bloqueia por origem CAIXA + PDV alvo do tenant + estado ABERTA + tipo diferente de AVULSA, sem restringir dia ou sessão.

Defeito de migração: não encontrado. Condição operacional preexistente: confirmada. Falhas de fixture: portal anônimo incorretamente esperado como sucesso, vínculo de volume ausente no menu aprovado de CIA, transição de estorno incompleta e limpeza direta de sessões que não representa fechamento autenticado; corrigidas/classificadas como descrito no JSON de evidência. Resultado cliente a cliente está no plano de teste e no JSON. Bloqueio exige decisão operacional aprovada antes do teste de fechamento em DEV.
