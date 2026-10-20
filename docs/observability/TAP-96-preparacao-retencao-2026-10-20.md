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

O modo padrão não carrega `_elastic-auth.ps1` e retorna antes de construir cliente HTTP. O teste de processo aponta `ELASTICSEARCH_URL` para `http://127.0.0.1:1` (porta local fechada); a execução bem-sucedida do plano comprova que nenhuma chamada foi feita. `scripts/observability/setup-ilm.test.ps1` cobre ambiente ausente/inválido, allowlist, plano sem segredo, colisões/idempotência e exclusão de ações sobre backings. Um Elasticsearch 8.17.0 descartável, sem rede nem volume, aceitou a policy e template. `_simulate_index` mostrou os templates built-in concorrentes; a data stream criada antes da alteração manteve o lifecycle antigo no backing existente, enquanto rollover depois da alteração gerou backing novo com lifecycle diferente. Isso confirma que o template não altera backings atuais, mas afeta a próxima geração de data streams existentes. O rollover foi executado somente no cluster descartável. Nenhuma chamada chegou ao cluster compartilhado.

## Capacidade: estimativa ilustrativa, não previsão

Com 397 streams de logs, 127 traces e 1 metrics, o número de gerações se a idade dominar rollover semanal seria aproximadamente:

| Hipótese | Cálculo de gerações de backings | Gerações estimadas |
|---|---:|---:|
| Logs technical 30d + traces 30d + metrics 45d | `397×ceil(30/7) + 127×ceil(30/7) + 1×ceil(45/7)` | 2.627 |
| Todos os logs tratados como audit 90d + traces 30d + metrics 45d | `397×ceil(90/7) + 127×ceil(30/7) + 1×ceil(45/7)` | 6.207 |

São cenários de teto para uma geração por stream por semana, não previsão: os 397 logs não estão divididos entre audit/technical/generic; rollover por tamanho, streams vazios, datas e policy efetiva mudam o resultado. Shard count não foi medido. Se cada backing tivesse um primary e nenhuma réplica, esses números também seriam primaries, mas essa premissa não foi verificada. Rollover semanal para centenas de streams pequenos não está aprovado.

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
