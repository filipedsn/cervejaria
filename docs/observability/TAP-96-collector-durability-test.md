# TAP-96 — ensaio descartável de fila persistente do Collector

Data: 2026-10-20, UTC (execução local em Docker Desktop). Escopo: Elasticsearch 8.17.0 e Collector Contrib 0.156.0, em rede interna isolada, sem portas no host, sem volumes compartilhados e sem documentos comerciais. A imagem do Collector foi fixada no digest `sha256:125bdbeb7590cc1952c5b3430ecf14063568980c2c93d5b38676cc0446ed8108`.

## Configuração experimentada

A configuração de referência está em [otel-collector-durable-queue-0.156.0.yml](examples/otel-collector-durable-queue-0.156.0.yml). Ela não é carregada pelo Compose nem por release. A POC usou `file_storage` num volume persistente do container, fila de logs por bytes, retry finito configurado a 1.000 tentativas, `block_on_overflow: false`, métricas internas Prometheus e armazenamento limitado pelo `max_size` da extensão.

O `max_size` limita cada arquivo de banco bbolt, não todo o volume. A fila lógica tem 64 MiB; o volume ainda requer quota/alarme de filesystem e reserva para overhead. `queue_size` mede bytes serializados com `sizer: bytes`; não é uma garantia de ocupação física igual. Não há atualmente prova de quota de disco total ou de alerta ligado às métricas do Collector.

## Casos executados

| Caso | Ação | Evidência | Resultado |
|---|---|---|---|
| Ingestão base | Enviar log OTLP sintético com Elasticsearch disponível | OTLP HTTP 200; stream descartável recebeu documento | Pipeline OTLP → batch → Elasticsearch funcional no probe. |
| Indisponibilidade e restart | Pausar o ES descartável; enviar uma requisição com ID sintético; reiniciar Collector usando o mesmo volume; retomar ES | Startup carregou `itemsSize=1`, `bytesSize=250`, `dispatchedItems=1`; após recuperação o stream recebeu o ID | A fila sobreviveu ao restart e drenou após o destino voltar. |
| Reenvio/duplicidade | Repetir o cenário com dois IDs únicos, uma requisição por ID | Cada ID apareceu duas vezes no índice sintético após a recuperação; `_id` Elasticsearch distintos | Duplicação observada durante a falha/replay. A semântica é pelo menos uma vez, não exactly-once. O ensaio não identificou em que ponto o resultado do bulk ficou ambíguo. |
| Saturação | Fila 8.192 bytes, ES pausado, lote de 200 logs sintéticos | Cliente recebeu OTLP HTTP 200; log: `sending queue is full`, `rejected_items=200`; métrica `otelcol_exporter_enqueue_failed_log_records_total=200`; `otelcol_exporter_queue_capacity=8192`; fila observada depois em zero | Confirmado que sucesso HTTP de ingestão pode não significar exportação/persistência. Overflow produz rejeição/perda visível nos logs/métrica interna. |
| Retry finito e retorno | Fila com limite pequeno, retry 1.000 tentativas; ES pausado e depois retomado sem reiniciar Collector | HTTP 200 de OTLP; ID sintético `persist-004` apareceu uma vez após o ES voltar | Retry/outage simples recuperou o item; um caso não mede duração máxima nem prova ausência geral de duplicação. |
| Falha limitada pela configuração anterior | ES parado e endpoint DNS indisponível com retry curto de 2 tentativas | `Exporting failed. Dropping data`, `dropped_items=1` | Mostra que retries finitos podem descartar eventos. Essa configuração inicial foi substituída por retry finito de 1.000 tentativas; não se concluiu sobre comportamento além do limite configurado. |

Os casos de restart e saturação não são teste de carga, medição RPO/RTO ou prova de crash de disco. A duplicação inesperada foi mantida como resultado e reforça a ausência de garantia exatamente uma vez. O teste não prova entrega se o volume for perdido/corrompido, se o filesystem atingir limite, se o pod/container for removido com o volume, se a ingestão de origem não receber ACK, nem a durabilidade de traces em memória do tail sampler.

## Implicações para rollout

- O Collector compartilhado atual é 0.130.1 e recebe tráfego DEV/PROD. Não foi alterado; não se habilitou filtro DEV-only.
- O piloto exige atualizar/fixar versão compatível, configurar volume durável, permissões, quota física e monitoramento de queue size/capacity, enqueue failures, send failures, receiver refused, espaço livre, reinícios e destino inacessível.
- Os contadores Alpha podem mudar entre versões. Não exponha 8888 publicamente; o scrape deve ficar em rede/host local restrito.
- Definir RPO/RTO e comportamento de perda/duplicação aceitos, rever métricas e limites no volume real, executar teste de backlog maior em ambiente isolado e validar recuperação antes de pedir aprovação de alteração compartilhada.
- O arquivo de exemplo requer composição com os transforms de namespace/infra e tail sampling atuais. Ele não deve substituir o Collector compartilhado sem revisão completa dos componentes, pipelines, credenciais e alvo real de hostmetrics.

Referências oficiais: [Elasticsearch exporter: retries](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/exporter/elasticsearchexporter/README.md), [Exporter Helper: fila, retry, overflow e persistência](https://github.com/open-telemetry/opentelemetry-collector/blob/main/exporter/exporterhelper/README.md), [File Storage: limite de tamanho e armazenamento](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/extension/storage/filestorage/README.md), [telemetria interna e métricas do Collector](https://opentelemetry.io/docs/collector/internal-telemetry/), [releases Contrib](https://github.com/open-telemetry/opentelemetry-collector-contrib/releases).
