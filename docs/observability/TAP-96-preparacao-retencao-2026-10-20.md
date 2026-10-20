# TAP-96: preparação segura de retenção (2026-10-20)

Esta seção registra preparação de código/documentação. Nenhuma policy, template, backing index, retenção, Collector ou ambiente compartilhado foi alterado. TAP-96 permanece **In Progress**; `PROD_DEPLOY_REQUIRED=YES` enquanto os gates de produto e autorização permanecerem pendentes.

## Estado observado e limites de acesso

- A consulta DEV anterior encontrou **525 data streams**: 397 `logs-*`, 127 `traces-*` e 1 `metrics-generic.otel-dev`; foram reportados 525 backings no `_ilm/explain`. A chave DEV permitiu `_data_stream` e `_ilm/explain`, mas recebeu 403 ao consultar definições de policy e estatísticas de índice/cluster. Portanto, retenção efetiva, tamanho, shards primários/réplicas, ingestão por família e tendência de crescimento permanecem **desconhecidos**. O estado `hot` não prova ausência de expiração.
- No resultado acessível, 398 backings eram `managed` (397 sob policy `logs`, 1 sob `metrics`) e 127 de traces apareciam sem policy. Isso descreve somente a resposta consultada; não revela a fase delete nem sua idade.
- O Collector envia audit com `data_stream.dataset=audit_<slug>` e namespace de ambiente. O runner sintético usa slug de tenant variável por execução; isso pode criar streams audit adicionais por slug QA. Não há inventário que separe os 525 entre tenant real, QA e outras execuções. Não consolidar datasets nem apagar streams por inferência.
- Propostas versionadas: audit 90d (rollover 14d ou 30 GB), technical 30d (7d ou 30 GB), traces 30d (7d ou 30 GB), metrics 45d (7d ou 30 GB), infra 15d (3d ou 10 GB). São propostas sem aceite operacional. `max_age` pode criar gerações de streams pequenos não vazios; `max_primary_shard_size` não evita rollover ao atingir `max_age`. Elasticsearch não faz rollover de índice vazio por padrão, salvo configuração explícita para incluir vazios.

## Revisão e proteção do provisionador

`setup-ilm.ps1` anterior carregava `_elastic-auth.ps1` no início, então até um modo chamado dry-run poderia importar credenciais; no seu fluxo normal enviava PUT de policy e template. Os destinos antigos `traces-*`, `logs-audit*`, `metrics-generic.otel-*`, `logs-{generic,technical}.otel-*` e `metrics-infra.otel-*` não restringiam todos os casos a DEV. A expressão com chaves não é uma allowlist verificável do padrão de índice. O helper de autenticação apenas importa ambiente/monta cabeçalhos até ser chamado; o provisionador antigo enviava mutações no início do fluxo.

O provisionador exige `-Environment dev`, constrói uma allowlist DEV estreita e apenas imprime um plano por padrão. PROD, infra e ambiente omitido são rejeitados. O plano usa nomes `quiver-tap96-dev-…-v1`, sem substituir nomes de policies PROD compartilhadas; não inclui réplicas, limites, deletes diretos ou rollover manual. O helper com credenciais só é carregado com `-Apply -ConfirmApply TAP96-DEV-RETENTION`. Mesmo então, são feitas precondições somente leitura antes de qualquer escrita e o script falha fechado se detectar conflito. Policies com mesmo nome precisam ser idênticas. Templates composable existentes são conflito, pois o Elasticsearch escolhe o de maior prioridade e não mescla templates concorrentes. Um template afeta novos data streams e novas gerações de backing (inclusive o próximo rollover de um data stream existente), mas não altera o backing atual retroativamente. Não executar ainda: a confirmação técnica explícita não substitui aprovação dos prazos e do rollout.

O template versionado de single-node define `number_of_replicas=0`, mas prioridade/precedência efetiva atual não foi confirmada pela chave restrita. No Elasticsearch, um template composable de prioridade maior vence; no teste descartável 8.17, `logs-*-*` e `logs-*.otel-*` se sobrepuseram ao destino audit DEV. A simulação do template priority 300 não trouxe os mappings/settings dos templates perdedores, então a guarda do script recusa esse conflito. Não se deve elevar prioridade e substituir silenciosamente um vencedor sem incorporar mappings/component templates. O tempo `max_age` conta da criação para decidir rollover. Para fases ILM, `min_age` de um backing que já sofreu rollover conta a partir do rollover; em backing não rolado, a idade se baseia na criação (salvo data de origem customizada). O estado atual deve ser obtido com as consultas abaixo antes de qualquer rollout.

## Testes e execução isolada

O modo padrão não carrega `_elastic-auth.ps1` e retorna antes de construir cliente HTTP. O teste de processo aponta `ELASTICSEARCH_URL` para `http://127.0.0.1:1` (porta local fechada); a execução bem-sucedida do plano comprova que nenhuma chamada foi feita. `scripts/observability/setup-ilm.test.ps1` cobre ambiente ausente/inválido, allowlist, plano sem segredo, colisões/idempotência e exclusão de ações sobre backings. Um Elasticsearch 8.17.0 descartável, sem rede nem volume, aceitou a policy e template. `_simulate_index` mostrou os templates built-in concorrentes; a data stream criada antes da alteração manteve o lifecycle antigo no backing existente, enquanto rollover depois da alteração gerou backing novo com lifecycle diferente. Isso confirma que o template não altera backings atuais, mas afeta a próxima geração de data streams existentes. O rollover foi executado somente no cluster descartável. Em outro ES descartável 8.17 publicado apenas em loopback, a execução real de `setup-ilm.ps1 -Apply` com chave fictícia foi recusada antes de PUT pela colisão com `logs` e `logs-otel@template`; consulta posterior confirmou 404 para a policy/template novos. Nenhuma chamada chegou ao cluster compartilhado.

## Capacidade: estimativa ilustrativa, não previsão

Com 397 streams de logs, 127 traces e 1 metrics, o número de gerações se a idade dominar rollover semanal seria aproximadamente:

| Hipótese | Cálculo de gerações de backings | Gerações estimadas |
|---|---:|---:|
| Logs technical 30d + traces 30d + metrics 45d | `397×ceil(30/7) + 127×ceil(30/7) + 1×ceil(45/7)` | 2.627 |
| Todos os logs tratados como audit 90d/14d + traces 30d/7d + metrics 45d/7d | `397×ceil(90/14) + 127×ceil(30/7) + 1×ceil(45/7)` | 3.421 |
| Estresse: mesmo cenário audit, mas rollover semanal em tudo | `397×ceil(90/7) + 127×ceil(30/7) + 1×ceil(45/7)` | 5.803 |

São cenários aproximados de gerações ativas por stream, não previsão: os 397 logs não estão divididos entre audit/technical/generic; rollover por tamanho, streams vazios, datas e policy efetiva mudam o resultado. O cenário semanal é apenas estresse, não proposta para audit. Shard count não foi medido. Se cada backing tivesse um primary e nenhuma réplica, esses números também seriam primaries, mas essa premissa não foi verificada. Rollover semanal para centenas de streams pequenos não está aprovado.

## Plano futuro de rollout e recuperação

1. **Novos streams/backings:** aprovar os prazos; conferir policies, inventário e template winner em DEV. Resolver integração com templates preexistentes sem perder mappings. Aplicar primeiro a um subconjunto DEV escolhido; verificar `_simulate_index`, `_ilm/explain`, template efetivo, shards e ingestão antes de ampliar. O template vale para criação futura e não prova atualização retroativa.
2. **Backings existentes:** inventariar cada backing, policy, criação, lifecycle date, origem e estado. Preparar plano separado de associação de policy. Não presumir mudança retroativa via template; não forçar rollover.
3. **Exclusão potencial:** identificar backing por backing o que satisfaz as idades propostas e validar obrigações operacionais/negociais. Snapshot/export somente com destino e restauração testados. Reverter policy interrompe exclusões futuras, mas não recupera índices/documentos apagados.
4. **Verificação e reversão:** guardar estado anterior (policies, templates, winner, backings e shard stats), verificar amostra e crescimento; em falha, remover nova template/policy apenas se não estiver em uso e restaurar definições anteriores. Não há rollback que recupere dados excluídos sem backup restaurável.

Consultas administrativas somente leitura para o operador autorizado (Console Elasticsearch; não ampliar a chave de auditoria):

```http
GET /_data_stream/logs-*.otel-dev,traces-*.otel-dev,metrics-generic.otel-dev
GET /_index_template
POST /_index_template/_simulate_index/logs-audit_tap96-probe.otel-dev
POST /_index_template/_simulate_index/logs-technical.otel-dev
POST /_index_template/_simulate_index/traces-generic.otel-dev
POST /_index_template/_simulate_index/metrics-generic.otel-dev
GET /_ilm/policy/logs,metrics,quiver-tap96-dev-audit-90d-v1,quiver-tap96-dev-technical-30d-v1,quiver-tap96-dev-traces-30d-v1,quiver-tap96-dev-metrics-45d-v1
GET /logs-*.otel-dev,traces-*.otel-dev,metrics-generic.otel-dev/_stats/store,docs,indexing,search
GET /_cluster/stats
GET /_cat/shards/logs-*.otel-dev,traces-*.otel-dev,metrics-generic.otel-dev?v&h=index,shard,prirep,state,docs,store,node
GET /_ilm/explain/logs-*.otel-dev,traces-*.otel-dev,metrics-generic.otel-dev?only_managed=false
```

Para tendência, repetir `store`, `docs`, `indexing` e shards em janelas registradas (por exemplo, semanalmente por quatro semanas) e comparar volume por família e contagem de streams por namespace. `_cat/shards` pode ser longo; salvar localmente em pasta operacional protegida, sem credenciais. `/_cluster/stats` é cluster-wide e requer Console administrativo aprovado.

## Decisão operacional necessária

O responsável pela retenção deve aprovar ou substituir explicitamente os cinco prazos, definir o que ocorre com backings existentes e autorizar acesso administrativo somente leitura para inventariar policies/templates/shards/tendência. Em seguida, aprovar o subconjunto DEV e janela de verificação. A namespace `infra` requer decisão separada, pois os padrões/campos atuais não provam isolamento por ambiente. Esta preparação não autoriza PROD.

O saldo geral TAP-96 continua parcial: 47 documentos foram contados visualmente/API no intervalo e SHA reportados; API reconciliou login 401/403 e pedido PDV, mas a confirmação visual individual dessas ações não foi recebida. Isso não demonstra todas as jornadas, autorização de consulta por empresa, retenção, capacidade ou durabilidade. As correções runtime já mergeadas, eventuais deploys de aplicação e rollout destas policies/templates são operações distintas. Nenhum deploy PROD foi executado.

## Aditivo: coleta administrativa e proposta revisada — 2026-10-20

Fonte: coleta somente leitura concluída em **2026-10-20 17:57 America/Sao_Paulo**; 24 respostas HTTP 200, registradas localmente em `docs/observability/tap96-admin-inventory-2026-10-20_175727/`. Endpoint `http://127.0.0.1:9200`, cluster `docker-cluster`, Elasticsearch **8.17.0**. Nenhum conteúdo de documento comercial foi consultado. Os números abaixo são uma fotografia; não são tendência. Os números antigos deste relatório (525 DEV streams consultados com chave restrita e 522 shards ativos/limite 1000) permanecem como **históricos** e foram substituídos para o estado atual pela coleta administrativa.

### Fotografia de cluster, famílias e cardinalidade

| Medida em 2026-10-20 | Valor comprovado |
|---|---:|
| Nós / saúde | 1 / yellow |
| Primários ativos / réplicas ativas / não alocados | 574 / 0 / 49 |
| Limite efetivo `cluster.max_shards_per_node` | 1000 (settings completo; sem override persistent/transient) |
| Dados do cluster | 23.761.714 docs; 2.693.405.760 bytes (~2,51 GiB) |
| Streams OTel / backings OTel | 540 / 547 |
| Namespace | 525 DEV / 12 PROD / 3 infra |
| OTel | 23.759.951 docs; ~2,410 GiB |

Os 547 backings têm um primary cada. CAT indices mostra 49 índices yellow com `rep=1`; Cluster Stats registra 574 primários ativos, 574 shards ativos e 49 não alocados. Portanto, os 49 não alocados são **réplicas**, não primários. O shard demand medido é 574 + 49 = **623 cópias**, ou 62,3% do limite numérico. Isso não representa margem operacional garantida. Os 49 yellow se repartem em logs 34 (33 DEV, 1 PROD), traces 10 (DEV) e metrics 5 (1 DEV, 1 PROD, 3 infra). A hipótese mais forte é réplica sem nó elegível num cluster de um nó, mas os deciders atuais não foram coletados; a evidência disponível não permite atribuir cada réplica ao template que a criou. A coleta também não gravou o template histórico de criação para cada backing.

Famílias e concentração atuais:

| Família/namespace | Streams | Backings | Primários | Réplicas configuradas | Docs | Store |
|---|---:|---:|---:|---:|---:|---:|
| logs DEV | 397 | 398 | 398 | 33 | 702.162 | ~0,323 GiB |
| logs PROD | 6 | 7 | 7 | 1 | 232.502 | ~0,073 GiB |
| traces DEV | 127 | 127 | 127 | 10 | 35.455 | ~0,033 GiB |
| traces PROD | 5 | 5 | 5 | 0 | 37.893 | ~0,020 GiB |
| metrics DEV | 1 | 2 | 2 | 1 | 16.876.265 | ~1,601 GiB |
| metrics PROD | 1 | 2 | 2 | 1 | 180.769 | ~0,019 GiB |
| metrics infra | 3 | 6 | 6 | 3 | 5.694.905 | ~0,341 GiB |
| **OTel total** | **540** | **547** | **547** | **49** | **23.759.951** | **~2,410 GiB** |

Metrics concentra ~95,8% dos documentos e ~81,4% do armazenamento OTel. Traces e logs têm muitos shards pequenos em relação ao volume. A classificação por nome encontrou 510 streams rotulados como QA/sintéticos (389 audit + 121 traces), 14 streams em slugs empresariais conhecidos e 16 streams system/generic/unknown. É classificação nominal, não cadastro autoritativo de tenant; não apagar QA, não consolidar slugs e não mudar roteamento a partir dela. DEV concentra a cardinalidade, mas PROD e infra compartilham o mesmo cluster e limite. Não habilitar `filter/dev-only` no Collector compartilhado.

### Shards: consulta complementar mínima

Para confirmar alocação/deciders e obter a evidência que falta sobre procedência do template, o operador pode executar **somente estas consultas de leitura** no Console administrativo. A resposta é limitada às famílias yellow já identificadas, não ao conteúdo dos eventos:

```http
GET /_cat/shards/.ds-logs-audit_qa_release_*.otel-dev-*,.ds-logs-audit_release_*.otel-dev-*,.ds-logs-audit_unknown.otel-dev-*,.ds-logs-technical.otel-*,.ds-metrics-generic.otel-*,.ds-metrics-*receiver.otel-infra-*,.ds-traces-qa_release_*.otel-dev-*?format=json&h=index,shard,prirep,state,unassigned.reason,node
GET /.ds-logs-audit_qa_release_*.otel-dev-*,.ds-logs-audit_release_*.otel-dev-*,.ds-logs-audit_unknown.otel-dev-*,.ds-logs-technical.otel-*,.ds-metrics-generic.otel-*,.ds-metrics-*receiver.otel-infra-*,.ds-traces-qa_release_*.otel-dev-*/_settings?flat_settings=true&filter_path=*.settings.index.number_of_replicas,*.settings.index.number_of_shards,*.settings.index.lifecycle.name,*.settings.index.creation_date,*.settings.index.provided_name
GET /_data_stream/logs-audit_qa_release_*.otel-dev,logs-audit_release_*.otel-dev,logs-audit_unknown.otel-dev,logs-technical.otel-dev,logs-technical.otel-prd,metrics-generic.otel-dev,metrics-generic.otel-prd,metrics-*receiver.otel-infra,traces-qa_release_*.otel-dev?filter_path=data_streams.name,data_streams.template,data_streams.indices.index_name
GET /_index_template/logs,logs-otel@template,traces-otel@template,metrics,metrics-otel@template?filter_path=index_templates.name,index_templates.index_template.index_patterns,index_templates.index_template.priority,index_templates.index_template.composed_of,index_templates.index_template.template.settings
POST /_cluster/allocation/explain?filter_path=index,shard,primary,unassigned_info.reason,unassigned_info.last_allocation_status,node_allocation_decisions.node_name,node_allocation_decisions.node_decision,node_allocation_decisions.deciders.name,node_allocation_decisions.deciders.decision,node_allocation_decisions.deciders.explanation
{"index":"<um índice yellow retornado acima>","shard":0,"primary":false}
```

`_cat/shards` separa `p` e `r`; `_cluster/allocation/explain` identifica o impedimento atual. `number_of_replicas` e a lista de templates que hoje combinam ajudam a reconstruir a configuração, mas não provam sozinhos qual template venceu na data de criação. Se o campo `data_streams.template` não vier preenchido, a procedência histórica permanece indeterminada sem snapshots/audit log de configuração. Referências: [CAT shards](https://www.elastic.co/guide/en/elasticsearch/reference/8.17/cat-shards.html), [Allocation Explain](https://www.elastic.co/guide/en/elasticsearch/reference/8.17/cluster-allocation-explain.html), [Get data stream](https://www.elastic.co/guide/en/elasticsearch/reference/8.17/indices-get-data-stream.html).

### Policies e templates efetivos

415 backings são gerenciados (405 pela policy compartilhada `logs`, 10 por `metrics`) e estão na fase hot. Ambas as policies têm rollover `max_age=30d` / `max_primary_shard_size=50gb` e **nenhuma fase delete**. Há 132 backings traces sem lifecycle. `failed_step=0`. Templates atuais: `logs-otel@template`, `traces-otel@template`, `metrics-otel@template` em prioridade 120; built-ins `logs`/`metrics` em 100; templates específicos APM chegam a 210. Simulações atuais no cluster escolheram lifecycle `logs`, `metrics` ou nenhum para as sondas; os nomes `quiver-tap96-*` ainda não existem no cluster. A elevação de prioridade não faz merge automático de templates concorrentes.

No Elasticsearch descartável **8.17.0**, sem rede, portas publicadas ou volume, criei cinco policies/templates de proposta e simulei alvos DEV, PROD, infra e APM sem indexar documentos. As cinco policies retornaram `acknowledged` e as definições lidas tinham as fases hot/delete e janelas/max-age esperadas. Os alvos DEV específicos selecionaram a policy candidata e preservaram o mapping de data stream; logs mantiveram `logsdb`, metrics continuou time_series nos probes gerenciados. PROD selecionou `logs`/`metrics` atuais ou nenhum lifecycle em traces; os três nomes infra exatos selecionaram somente a policy infra; um receiver infra não inventariado continuou em `metrics`. Os nomes APM padrão `logs-apm.error-default`, `traces-apm.rum-default`, `traces-apm.sampled-default` e `metrics-apm.internal-1m` mantiveram as policies APM. `logs-generic.otel-dev` continuou em `logs`. As composições custom incorporaram as listas dos templates OTel atuais (incluindo settings/mappings e componentes ECS/TSDS, ignorando apenas componentes `@custom` ausentes no container). A simulação prova comportamento nesta versão descartável, **não** compatibilidade com futuras atualizações dos componentes Elastic nem a origem dos templates dos backings atuais. Não foram alterados o cluster compartilhado ou o provisionador.

| Família e escopo exato proposto | Streams atuais cobertos | Atual efetivo / conflito | Mudança mínima candidata | Rollover e idade propostos |
|---|---:|---|---|---|
| Audit DEV `logs-audit_*.otel-dev` | 395 | `logs` hot/rollover; vence com `logs-otel@template` (120) e `logs` (100) | template composable restrito ao sufixo DEV, prioridade 121; compor componentes logs/OTel existentes usados pelo vencedor; policy própria audit | rollover `max_age=90d` ou `30gb`; delete `min_age=90d` **após rollover** |
| Technical DEV `logs-technical.otel-dev` | 1 | policy `logs`, sem delete | template exato DEV prioridade 121 com componentes logs/OTel existentes e policy technical própria | `30d` ou `30gb`; delete `30d` após rollover |
| Traces DEV `traces-*.otel-dev` | 127 | sem lifecycle; concorre com `traces-otel@template` 120 e APM específico | template DEV prioridade 121 com componentes traces/OTel; preservar especializações APM de prioridade maior | `30d` ou `30gb`; delete `30d` após rollover |
| Metrics DEV `metrics-generic.otel-dev` | 1 | policy `metrics`, sem delete; concorrência ampla de templates métricos/OTel/APM | template de nome exato DEV prioridade 121 com componentes métricos OTel/TSDS existentes | `45d` ou `30gb`; delete `45d` após rollover |
| Infra `metrics-{hostmetricsreceiver,httpcheckreceiver,tcpcheckreceiver}.otel-infra` (três padrões literais) | 3 | policy `metrics`, sem delete; ampla concorrência de templates metrics | template somente para os três receivers infra confirmados, com componentes TSDS/OTel; namespace infra explícito | `15d` ou `10gb`; delete `15d` após rollover |

Todos os prazos seguem **não aprovados**. `max_age` determina quando rolar; o relógio de delete começa no rollover para backing rolado. Com `max_age` igual a `min_age` de delete, o conteúdo antigo pode ficar aproximadamente até 2× a janela a partir do começo de sua geração (e mais quando size rollover ocorrer antes ou houver atraso do ILM). Isso não equivale a um limite absoluto de idade de evento. Não alterar policies genéricas `logs`/`metrics`. Não aplicar o escopo infra a métricas PROD. Os templates propostos não definem mudança de réplicas.

### Projeção antes de qualquer mudança

Os destinos das cinco propostas incluem **527 data streams**, cada um com pelo menos um backing write; o inventário tem 532 backings nesses destinos por causa de cinco gerações antigas adicionais. Há 527 primários write atuais. Se cada stream ganhar uma segunda geração antes da exclusão da primeira, a projeção adiciona pelo menos **527 primários**: 574 + 527 = **1.101 primários**, acima do limite 1.000 mesmo supondo zero réplicas novas. Se cada nova geração receber uma réplica, o incremento seria até 1.054 cópias e a demanda total aproximada chegaria a 1.677, somada à demanda atual de 623. Os templates simulados não explicitam `number_of_replicas`; confirme o setting/default efetivo antes de estimar cópias. Essa projeção descarta streams que deixem de existir, atrasos, crescimento de cardinalidade e shards de sistema; portanto é cenário de risco, não previsão.

Os 527 backings write-alvo armazenam ~0,282 GiB nesta fotografia; um backing futuro com mesmo tamanho acrescentaria ~0,282 GiB. A família metrics isolada DEV já tem 1,601 GiB num backing antigo e volume insignificante no backing write atual; isso demonstra que a hipótese “geração futura igual à atual” pode subestimar bastante o volume. O total OTel de 2,410 GiB é uma observação pontual, não taxa de crescimento. Medir semanalmente em pelo menos quatro pontos comparáveis, por namespace/família, antes de aprovar projeção de armazenamento.

### Separação entre novos backings e os existentes

**A. Novos streams/backings.** A primeira etapa segura a propor é um piloto estrito para `metrics-generic.otel-dev`: um template/policy próprios, aplicáveis apenas ao próximo backing natural desse stream e a backings futuros com esse nome. Benefício: atacar a família que contém 16,9M de documentos/1,601 GiB e comprovar ciclo de policy sem alterar `metrics` compartilhada. Risco: template 121 pode conflitar com mudanças de componentes Elastic; qualquer novo backing consome pelo menos um primary e pode receber réplica não alocável no single-node. Pré-condições: confirmar winner/composição/settings/replicas no cluster real; comparar a geração futura com os sete templates atuais; aprovação explícita do dono dos dados para 45d e semântica “45d após rollover”; confirmar que alvo não alcança PROD/infra; orçamento de shards e alertas. Antes/depois: simulação, policy/template effective, `_ilm/explain`, stream/backings, shards/saúde, store/docs e coleta de erros. Abortar se template concorrente não puder ser composto sem perda, se destination resolve fora de DEV, se shard count/saúde piorar além do limite autorizado ou se houver crescimento inesperado. Não força rollover; a política só afeta geração futura.

**B. Backings existentes.** Os sete backings não-write enumerados são: `logs-technical` DEV/PROD, `metrics-generic` DEV/PROD e os três receivers infra, todos geração `000001` de 2026-09-20. São backings anteriores à geração write atual. A coleta não comprova backup restaurável nem restauração testada. Não associar policy retrospectivamente nesta etapa: isso pode iniciar rollover/expiração para backing antigo conforme idade e ILM date; dois traces já têm data de criação ~30,03 dias na fotografia, mas são unmanaged hoje. Aplicar delete de 30d diretamente a eles poderia torná-los elegíveis logo após associação/rollover, dependendo da data efetiva. Primeiro inventariar `is_write_index`, creation date, `lifecycle_date`, `age`, policy, docs e store por backing, validar retenção legal/operacional e provar restore fora do cluster. Não apagar nem forçar rollover. Rollback da policy/template interrompe efeitos futuros quando seguro, mas não recupera documentos eliminados; só restauração comprovada pode recuperar conteúdo.

### Decisão operacional pronta para aprovação

**Recomendação:** autorizar apenas a preparação/aplicação futura de um piloto de policy/template para `metrics-generic.otel-dev` e só para novas gerações naturais. Isso **não** aprova aplicação imediata nem janela 45d por si só: o proprietário deve confirmar a janela e o significado da contagem após rollover, e autorizar a mudança específica de cluster. A capacidade atual comporta um piloto muito menor do que as cinco famílias, mas a margem de shard do single-node não pode ser tratada como reserva de produção. Não avançar para as outras 526 streams até resolver a cardinalidade DEV, rever o orçamento de primários+réplicas e obter histórico de crescimento. Backings atuais ficam com as policies existentes até plano separado e autorização própria.

As 24 respostas foram armazenadas como evidência local de entrada e não são segredo; o relatório resume apenas metadados. A auditoria principal tem o saldo de jornadas, geo, autorização, durabilidade e produção; o merge runtime não conclui a aplicação de retenção. TAP-96 fica **In Progress** e `PROD_DEPLOY_REQUIRED=YES`. Aplicação na infraestrutura de observabilidade e publicação das correções runtime são operações separadas.
