# TAP-96 — avaliação operacional de observabilidade

## Escopo e método

Avaliação em 24/10/2026, Elastic/Kibana 8.17.0, licença Basic ativa. Consultas locais autenticadas, sem registrar credenciais. `scripts/observability/report-platform.mjs` coleta inventário, ILM, regras e SLIs agregados. O relatório não modifica retenção, documentos ou regras. A aplicação de produção não foi publicada. Após a avaliação inicial, o usuário autorizou recriar a infraestrutura e descartar o histórico Elastic sem importância; a reconstrução descrita abaixo inclui os dados OTel dos ambientes DEV, PRD e infra do cluster compartilhado. Segregação física permanece reservada para execução conjunta.

## Regressão e preservação funcional

A base antiga foi reproduzida para distinguir regressões de testes desatualizados. Agenda exigia `aPartirDe`; pedido da cozinha exigia `idempotencyKey`. A sessão adulterada passou na base: o teste precisava substituir o cookie na mesma origem/caminho do cookie real. As assertivas continuam verificando os contratos de erro e isolamento.

O candidato incorpora os três commits que estavam no DEV `77a466829b8a9a84da0aad4b0a02b0ac6680e379` e a atualização de main `81d64bc2`. Preserva o modal da comanda e consulta de turno encerrado. Outras expectativas de jornadas foram atualizadas aos contratos vigentes: venda avulsa separada de comanda, ranking vinculado a agenda/ocorrência, confirmação de abertura de caixa e de produto no portal, cancelamento com tratamento de estoque e chave idempotente.

Foi corrigida uma lacuna real: a inicialização da sessão descartava também o primeiro page view autenticado. Agora a página privada atual é emitida após resolver a sessão, com deduplicação por sessão/página. Eventos anônimos antigos continuam descartados para não serem atribuídos ao próximo operador.

O runner `backend/scripts/run-observability-release-qa.mjs` usa Postgres, Elasticsearch e collector descartáveis. Inclui ingestão real de pagamento, em vez de omitir o teste que depende de Elastic. A suíte cresceu de 342 para 351 cenários com a preservação do DEV. Resultado final e SHA devem ser conferidos no comentário de evidências do TAP-96 e no PR; execução interrompida ou parcial não constitui aprovação.

## Cobertura e limites

| Camada | Evidência e cobertura | Limite operacional |
| --- | --- | --- |
| Interface | page view, controles com `data-audit`, HTTP do cliente; cenários desktop/mobile | Nem todo controle possui identificação semântica; tarefas assíncronas posteriores podem iniciar outra interação |
| HTTP | ator autenticado, tenant resolvido no servidor, request/correlation/interaction, resultado e duração | Polling omitido deliberadamente; ausência de evento não comprova disponibilidade |
| Payload | estrutura de negócio permitida, limites de tamanho, flags omitted/truncated | Não captura texto livre, senha, token ou SQL; identidade enviada no corpo é não confiável |
| Persistência | recibo de escrita Prisma, entidade/tenant alvo, transação confirmada e descarte após rollback | Não é outbox durável nem exactly-once; SQL bruto não gera recibo de negócio |
| Operação | três detectores DEV e relatório reproduzível | Sem canal externo autorizado; SLO de aplicação completo ainda exige janela representativa e sinais de ausência |

## Alertas DEV

Ativados com autorização explícita, intervalo de um minuto, sem ações externas:

| Regra | Condição | Janela |
| --- | --- | --- |
| `quiver-tap-http-5xx-dev` | HTTP servidor com status >= 500, contagem > 0 | 5 minutos |
| `quiver-tap-db-technical-failure-dev` | Falha técnica de conexão/operação/transação; categorias técnicas, excluindo conflitos esperados | 5 minutos |
| `quiver-tap-telemetry-gap-dev` | Ausência de métricas do serviço DEV, contagem < 1 | 15 minutos |

Às 18:01 UTC todas estavam habilitadas e com execução `ok`, ações = 0. O mecanismo real do Kibana foi exercitado com regra/índice temporários próprios: disparo, recuperação e limpeza confirmados. Isso valida o agendador, não entrega externa nem todas as modalidades de falha da aplicação. Configurações e validações estão em `deploy/observability/kibana-alert-*-dev.json` e `scripts/observability/apply-dev-alerts.mjs`.

## SLI/SLO

Janela móvel de 24 horas, leitura às 18:00 UTC, antes da publicação do candidato:

| Indicador | DEV | PRD (somente leitura) |
| --- | ---: | ---: |
| Documentos de auditoria | 2.330 | 15.945 |
| Requisições servidor elegíveis | 1.245 | 6.708 |
| Proporção sem 5xx | 100% | 100% |
| Requisições com duração <= 500ms | 100% | 99,508% |
| p95 | 90ms | 74,6ms |
| p99 | 343,6ms | 243,7ms |

Não são certificação de disponibilidade: só abrangem rotas auditadas, não incluem lacunas de coleta nem toda a experiência do usuário. O DEV estava indisponível antes da recuperação dos artefatos; o denominador só considera requisições observadas. Documentos antigos não têm `event.id`, impossibilitando deduplicação confiável retroativa. A política revisada exige denominador válido e trata ausência como desconhecida. Antes de assumir cumprimento contínuo, medir janela representativa após a publicação e validar orçamento de erro em `sli-slo.yml`.

## Volume, capacidade, custo e retenção

Cluster de um nó, saúde yellow, 750 shards primários ativos, zero primários sem alocação e 216 shards sem alocação (réplicas). Não há comprovação de perda de primários. Alterar réplicas da plataforma compartilhada ficou fora do escopo.

| Grupo | Índices | Documentos | Armazenamento primário aproximado |
| --- | ---: | ---: | ---: |
| DEV | 690 | 17.900.969 | 2,09 GiB |
| PRD | 18 | 507.128 | 130,5 MiB |
| Infra/outros sinais OTel | 6 | 6.382.486 | 396,8 MiB |

Os primários incluem também índices de sistema não mostrados na tabela. A fragmentação em muitos datasets é mais preocupante que os poucos GiB atuais. Identificadores de tenant, operador e correlação ficam nos logs; não devem tornar-se dimensões de métricas. O histórico sintético contribui para a cardinalidade de datasets. O runner descartável evita continuar alimentando o cluster compartilhado com a regressão.

DEV: 525 streams, 524 sem exclusão explícita. Desses, 397 usam `logs` com rollover e sem delete, 127 não têm ILM; apenas um usa `quiver-tap-metrics-dev-45d`. PRD: 12 streams sem exclusão explícita. Rollover não limita sozinho o total retido. Um delete ILM, quando existe rollover, conta idade a partir do rollover. Políticas em arquivo não comprovam aplicação aos streams reais.

Cenário de capacidade: volume de auditoria nas 24h multiplicado pela média histórica de bytes/documento de todos os sinais do namespace resulta em aproximadamente 0,28 MiB/dia DEV e 4,10 MiB/dia PRD; em 30 dias, 8,34 MiB e 123,1 MiB. É uma aproximação grosseira, com composição histórica diferente do novo candidato; não representa tamanho preciso de auditoria, crescimento total, réplicas, snapshots ou fatura. Sem preço unitário contratado e amostra pós-publicação não há custo monetário defensável. O relatório gera esse cenário explicitamente, sem inventar valores.

## Reconstrução autorizada e verificação

Às 18:20 UTC, após autorização explícita de descarte, foram removidos **540 streams OTel**, enumerados por nome exato. Índices de segurança/sistema, configurações e regras do Kibana e bancos da aplicação foram preservados. O collector foi pausado durante a operação e reiniciado com configuração validada em container sem rede. A configuração ativa foi atualizada no arquivo montado em `deploy/observability/otel-collector-config.yml`.

O roteamento limita datasets a `audit`, `technical` e `generic`, separados por namespace; mantém tenant, operador e correlação nos campos dos logs. Não há um stream por tenant. Os templates personalizados preservam os componentes de mappings OTel gerenciados e as configurações TSDB. Um primário e zero réplicas por índice são adequados ao nó único atual; isso não oferece redundância.

| Namespace | Auditoria | Técnico | Métricas | Traces |
| --- | ---: | ---: | ---: | ---: |
| DEV | 7d | 7d | 7d | 3d |
| PRD | 30d | 14d | 30d | 7d |
| Infra | 7d | 7d | 14d | 3d |

Os prazos de exclusão contam após rollover; rollover diário ou ao atingir 1 GiB por shard primário. Portanto, a idade total pode ultrapassar o prazo de delete em até aproximadamente um intervalo de rollover, além do ciclo de execução ILM. Índices vazios podem não fazer rollover; não há crescimento de dados nesses índices.

Na primeira leitura após reconstrução (18:21 UTC), o cluster estava **green**, com **38 primários**, **zero shards sem alocação** e todos os streams OTel então recriados com exclusão explícita. A base anterior de SLIs/volume acima é histórica, não uma janela pós-reconstrução. Sem eventos suficientes, os indicadores retornam desconhecido; não é válido declarar 100% de disponibilidade ou custo zero. A amostragem pós-publicação e a prova de ingestão são registradas separadamente nas evidências do TAP-96.

`scripts/observability/rebuild-platform.mjs` requer autorização de descarte explícita, valida nomes de streams e exclui em lotes de nomes exatos, sem wildcard. Sua suíte verifica proteção de índices de sistema, autorização, preservação de mappings e aplicação de ILM.

## Parecer

As configurações anteriores não eram suficientes para certificar excelência operacional: não havia regras ativas e a retenção real era majoritariamente ilimitada. A detecção DEV foi implantada e testada; a instrumentação ganhou correlação e confirmação transacional. Com a nova autorização, a consolidação e retenção foram aplicadas e o histórico sem valor foi descartado. Permanecem a segregação física conjunta, acompanhamento de uma janela operacional representativa e definição de custo monetário a partir de preço e consumo reais. A autorização de reconstrução não inclui publicação da aplicação em produção.
