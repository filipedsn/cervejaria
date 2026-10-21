# TAP-96 — decisões operacionais e resultados (2026-10-21)

TAP-96 permanece **In Progress** e `PROD_DEPLOY_REQUIRED=YES`. Este aditivo registra decisões confirmadas pelo proprietário e o resultado observado nesta sessão. Ele atualiza listas históricas de decisões pendentes sem apagar a evidência que era correta na data de cada relatório. O TAP-114 permanece preservado e inalterado.

> **Escopo vigente — decisão posterior do proprietário em 21/10/2026:** backup da observabilidade adiado. Não executar novas atividades de snapshot/backup, sincronização OneDrive ou restauração. RPO/RTO ficam pendentes para uma retomada futura e **não bloqueiam a entrega atual do TAP-96**. Preservar arquivos e evidências existentes; nenhum novo WI. Esta decisão não altera backups do banco transacional nem backups obrigatórios dos procedimentos de deploy. As seções históricas de backup abaixo não constituem uma ordem de execução.

## Decisões aprovadas

| Frente | Decisão vigente | Resultado observado |
|---|---|---|
| Discover/Kibana | Uso exclusivo da equipe interna autorizada. Não há requisito de pesquisa por empresa no produto. | Contexto de tenant continua nos eventos; isso não é ACL Elasticsearch por tenant. A prova exigida é para operadores internos. |
| Retenção | Piloto somente em futuras gerações de `metrics-generic.otel-dev`; excluir 45 dias após rollover. Sem backings atuais, rollover forçado, PROD ou outras famílias. Preflight de capacidade/templates é condição. | Não aplicado. Elasticsearch respondeu HTTP 401; Kibana local e `kibana.quivercloud.com.br` mostraram login. Nenhuma sessão administrativa aprovada estava disponível. |
| Backup | **Adiado pelo proprietário; fora dos gates da entrega atual.** RPO/RTO pendentes para retomada futura. Preservar `Dev`, `PRD` e demais evidências. | A prova sintética e os arquivos já preparados continuam preservados, sem certificação de recuperação real. Não executar novas atividades de backup/sincronização/restauração de observabilidade. Backups transacionais e os obrigatórios de deploy continuam vigentes. |
| Telegram | Exatamente um firing e um resolved identificados como **TESTE TAP-96**, pelo bot existente `@Tap_Quiver_Bot` e destinatário já utilizado. | Histórico visível da conversa confirma alertas da regra `quiver-tap-api-ready-down-prd` em 20/09/2026. O listener atual é PID 32068, iniciado em 20/10; o health serve estado de 29/09 e não avançou no intervalo observado. Variáveis ausentes nos arquivos/sessão atuais não provam ausência no ambiente herdado pelo processo. Nenhum envio realizado. |
| DEV | Slot liberado; a única troca continua condicionada aos gates oficiais. | Sem publicação. Antes desta revisão documental, HEAD remoto do PR #92 confirmado em `a11d62dbf9b89f9a520fea7b87195469628d5700`; run `39614102543` com sete checks em falha antes de executar steps. A anotação atual do job `frontend` confirma pagamentos falhos ou spending limit insuficiente; zero steps. O SHA final e os checks devem ser conferidos após a revisão documental e regularização, sem bypass. |
| Cloudflare/origem | Nenhuma alteração compartilhada autorizada ainda. | Peer do caminho DEV identificado como loopback `127.0.0.1` por configuração de túnel e conexão estabelecida correlacionada. Nenhum header confiável foi ativado. Ver proposta específica abaixo. |

## Retenção DEV: estado e preflight necessário

O candidato versionado em `deploy/observability/es-ilm-policy-metrics.json` define rollover em `max_age=7d` ou `max_primary_shard_size=30gb` e delete `min_age=45d` após rollover. Assim, o primeiro backing pode permanecer aproximadamente até 52 dias desde sua criação, além de atraso do ILM; 45 dias após rollover não é um limite absoluto de idade do evento. Não alterar esta janela nem o rollover por causa do relatório histórico.

A simulação compatível com Elasticsearch 8.17.0 registrada em `TAP-96-preparacao-retencao-2026-10-20.md` é evidência descartável, não substitui o estado atual do cluster. O preflight do cluster atual não pôde ser feito sem sessão administrativa. O provisionador `scripts/observability/setup-ilm.ps1` planeja cinco famílias DEV de uma vez e usa template bare priority 300; ele não atende ao escopo autorizado de um único stream e pode prevalecer sobre templates/componentes que precisem ser preservados. Não executar esse script para este piloto.

Roteiro Console, somente leitura, para o administrador devolver respostas compactas antes de qualquer gravação:

```http
GET /_cluster/health
GET /_cluster/settings?include_defaults=true&flat_settings=true&filter_path=persistent.cluster.max_shards_per_node,transient.cluster.max_shards_per_node,defaults.cluster.max_shards_per_node
GET /_data_stream/metrics-generic.otel-dev
GET /metrics-generic.otel-dev/_ilm/explain?only_managed=false
GET /_cat/indices/metrics-generic.otel-dev*?format=json&h=index,docs.count,store.size,pri,rep,creation.date
GET /_cat/shards/metrics-generic.otel-dev*?format=json&h=index,shard,prirep,state,node,unassigned.reason
GET /_ilm/policy/metrics
GET /_index_template?filter_path=index_templates.name,index_templates.index_template.index_patterns,index_templates.index_template.priority,index_templates.index_template.composed_of,index_templates.index_template.template.settings.index.lifecycle.name,index_templates.index_template.template.settings.index.number_of_replicas
POST /_index_template/_simulate_index/metrics-generic.otel-dev
```

A resposta deverá identificar o template vencedor, os componentes efetivamente compostos, lifecycle, réplica, shard/write index, volume e margem total de shards primários+réplicas. O futuro template precisa manter o mapping/data-stream/TSDS do vencedor sem mudar templates genéricos compartilhados. A execução fica restrita ao nome exato DEV e a futuras gerações naturais. Backings existentes e write index atual não serão atualizados retroativamente.

## Backup: evidência histórica preservada; execução adiada

**Fora do escopo de execução atual por decisão do proprietário.** O conteúdo desta seção preserva o que foi realizado antes do adiamento; RPO/RTO não são gates atuais. Não retomar sincronização, upload, snapshot ou restore sem nova instrução de retomada. Nenhum arquivo foi excluído.

O diretório local foi criado em `C:\Users\Papai\OneDrive\Quiver\Tap Quiver\Backup banco\Observabilidade TAP-96`. A ACL final está protegida contra herança e concede FullControl somente à conta Windows responsável, SYSTEM e Administrators. As pastas `Dev` e `PRD` existentes não foram alteradas.

Foi criado um snapshot Elasticsearch 8.17.0 com apenas um documento `synthetic_restore_probe`, sem rede nem portas publicadas. O snapshot `synthetic-20261021` restaurou em outro Elasticsearch descartável com repositório somente leitura; a consulta devolveu o marcador esperado. O ZIP local mede 6.304 bytes; SHA-256 `3AC79AB88BE06D1AA5FABA0C0CA643F807984820F730BEBC107E526023EB2D6A`. Esta amostra não contém eventos comerciais e não é backup do cluster compartilhado.

OneDrive Web confirmou a conta e a pasta remota aprovada; a subpasta `Observabilidade TAP-96` foi criada. O cliente `OneDrive.exe` apareceu em execução, mas o remoto continuou mostrando zero arquivos. O upload via navegador foi impedido porque a extensão Edge não tem “Allow access to file URLs”; essa permissão ampla não foi habilitada. Portanto, não afirmar sincronização off-host nem restauração a partir do OneDrive. Antes do adiamento também foi preparado um pacote de 2.775 bytes de configurações sem segredos, `TAP96-observability-configuration-20261021T152252Z.zip`, SHA-256 `EC9623828A2EAFAB1400BECA130D14C03871C1E79802077729BD4CA5749CB786`; contém YAML do Collector, referências de compose, estado do poller e manifesto. A cópia remota não foi comprovada e nenhum snapshot real foi certificado. Arquivos e evidências ficam preservados para eventual retomada, sem novas operações agora. Um arquivo sintético no diretório não comprova agenda ou RPO real; o RTO do conjunto real não foi medido. Essas lacunas não bloqueiam a entrega atual.

## Telegram e confirmação humana

O bot existente é `@Tap_Quiver_Bot`, nome “Tap Quiver”. A conversa humana já aberta no Telegram Web mostra alertas de `quiver-tap-api-ready-down-prd` em 20/09/2026, inclusive às 10:50:21 de Brasília. Isso comprova entrega histórica ao chat existente, não a configuração carregada atualmente pelo worker.

O listener `127.0.0.1:3098`, o PID file e o log de inicialização apontam para o PID 32068, iniciado em `2026-10-20T01:36:41Z`. Os módulos compilados e o launcher precedem esse início. O log atual contém somente “Alert poller worker health endpoint”, sem “poller iniciado”. Duas leituras atuais, separadas por mais de um intervalo de polling, retornaram o mesmo `lastPollAttemptAt=2026-09-29T10:28:40.353Z`; o state file também permanece em 29/09. Logo, o 404 mostrado é **histórico** e não comprova que uma consulta Elasticsearch atual retornou 404. Não criar índice nem alterar endpoint com base somente nele. A ausência de início do ciclo e de avanço do estado é compatível com polling desabilitado na inicialização; a flag e os canais efetivamente herdados pelo PID ainda não foram comprovados.

O launcher oficial usa `backend/.env.production`, a configuração observacional opcional e ambiente herdado. Foram localizadas referências comentadas em `.env.development`; o campo de token é um exemplo, não uma credencial confirmada. As variáveis do processo executor/arquivos atuais não equivalem ao ambiente do worker. A leitura protegida desse ambiente não foi realizada: Windows negou acesso e a revisão automática rejeitou inspeção de memória. O inspetor preparado foi substituído por leitura de metadados/arquivos, sem extração de ambiente ou credenciais; sua sintaxe foi validada, mas a ExecutionPolicy impediu executar o arquivo e não foi contornada.

A próxima ação administrativa é conferir no mecanismo operacional existente a fonte segura de bot/destinatário e devolver somente presença/flag, endpoint e índice; no Kibana, conferir a regra conhecida e o connector `.index` efetivamente associado. Antes de qualquer restart, consultar apenas a contagem de backlog elegível e preservar cursor/dedup. Se necessário, apresentar para aprovação a mudança de configuração e restart **somente do alert-poller**, com pausa de despacho e risco de backlog, sem reiniciar API/DB/Collector. As duas mensagens continuam autorizadas, mas ainda não foram enviadas. Executar pelo connector/índice/poller existentes, nunca Bot API avulsa; depois solicitar confirmação humana dos dois recebimentos.

## Geolocalização: peer, mudança proposta e retorno

`%USERPROFILE%\.cloudflared\config.yml` encaminha `tapdev.quivercloud.com.br` para `http://localhost:5202`; `localhost` resolve para `::1` e `127.0.0.1`. No momento da inspeção, o processo `cloudflared` (PID observado 9288) manteve conexão estabelecida de `127.0.0.1:63071` para `127.0.0.1:5202`, coerente com o listener Node DEV `0.0.0.0:5202`. O peer imediato observado para esse caminho foi `127.0.0.1`. Não há essa mesma prova de conexão para PROD.

Geolocalização permanece desativada. A proposta de simplesmente confiar em loopback não atende à prova pedida e foi substituída por uma alternativa **somente DEV**, ainda não implementada/aplicada: uma Request Header Transform Rule restrita a `tapdev.quivercloud.com.br` sobrescreve `x-tap-geo-country` com `ip.src.country` e `x-tap-geo-auth` com um segredo DEV inserido diretamente na configuração segura da borda e do backend. O backend deve exigir comparação constante desse autenticador, país válido e rejeição de headers duplicados, mantendo modo desligado por padrão e segredo redigido. O proxy frontend DEV preserva a dupla no caminho `/api`; o token não aparece em respostas, logs ou eventos. Não confiar em `CF-IPCountry` recebido diretamente. Request Header Transform Rules não permitem alterar headers reservados `cf-*`; por isso os campos são customizados.

Componentes: uma regra Cloudflare apenas do hostname DEV, configuração/validador do backend DEV e passagem dos headers pelo frontend/proxy `:5202` → API `:3002`. Teste requerido após autorização: cabeçalhos falsos pelo hostname são sobrescritos; chamadas diretas a `:5202` e `:3002` sem autenticador correto não produzem país; uma requisição correlacionada comprova borda → Tunnel → proxy → backend. Retorno: desligar o modo DEV primeiro, remover a regra e restaurar o pacote DEV oficial, voltando a país desconhecido. Nenhuma mudança em `tap.quivercloud.com.br`, origem PROD, proxy global, firewall ou mTLS compartilhado integra essa proposta. PROD exige proposta/aceite/autorização próprios posteriores. Não foi gerado segredo nem habilitada confiança de headers.

## Única lista de dependências externas restantes

1. **GitHub:** o proprietário regulariza Actions billing/spending limit e executa novamente os sete checks oficiais no HEAD final do PR #92. O run atual não tem logs de steps; não atribuir a causa específica apenas por inferência. Depois dos checks verdes, seguir merge oficial e uma única publicação DEV já autorizada. PROD segue fora do escopo.
2. **Elasticsearch:** o administrador executa a coleta GET/POST somente leitura acima e entrega o resultado não secreto para fechar preflight de composição/capacidade. Só então preparar/aplicar o template/policy exatos do piloto DEV aprovado. Não solicitar novamente aprovação de 45 dias.
3. **Telegram:** o operador responsável confirma a fonte segura realmente utilizada pelo worker e os metadados da regra/connector existentes; se necessária, aprovar especificamente a alteração e restart apenas do poller após preflight de backlog. Enviar exatamente um firing e um resolved “TESTE TAP-96” e confirmar recebimento humano. Não solicitar novamente autorização para as duas mensagens.
4. **Cloudflare DEV:** decisão específica sobre a regra customizada e o autenticador DEV descritos acima, sem ampliar para PROD. Geolocalização segue desativada até autorização e prova do trajeto/teste de falsificação.

**Fora desta lista de bloqueios:** backup da observabilidade e RPO/RTO foram adiados pelo proprietário e não impedem a entrega atual. Preservar as evidências e retomar somente mediante nova instrução. Backups transacionais e obrigatórios de deploy permanecem exigidos.

Nenhum deploy de produção, mudança de rede, template/policy real, alteração de backing ou envio Telegram foi efetuado. TAP-96 continua **In Progress** e `PROD_DEPLOY_REQUIRED=YES`.
