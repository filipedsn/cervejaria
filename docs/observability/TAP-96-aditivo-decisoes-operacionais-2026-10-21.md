# TAP-96 — decisões operacionais e resultados (2026-10-21)

TAP-96 permanece **In Progress** e `PROD_DEPLOY_REQUIRED=YES`. Este aditivo registra decisões confirmadas pelo proprietário e o resultado observado nesta sessão. Ele atualiza listas históricas de decisões pendentes sem apagar a evidência que era correta na data de cada relatório. O TAP-114 permanece preservado e inalterado.

## Decisões aprovadas

| Frente | Decisão vigente | Resultado observado |
|---|---|---|
| Discover/Kibana | Uso exclusivo da equipe interna autorizada. Não há requisito de pesquisa por empresa no produto. | Contexto de tenant continua nos eventos; isso não é ACL Elasticsearch por tenant. A prova exigida é para operadores internos. |
| Retenção | Piloto somente em futuras gerações de `metrics-generic.otel-dev`; excluir 45 dias após rollover. Sem backings atuais, rollover forçado, PROD ou outras famílias. Preflight de capacidade/templates é condição. | Não aplicado. Elasticsearch respondeu HTTP 401; Kibana local e `kibana.quivercloud.com.br` mostraram login. Nenhuma sessão administrativa aprovada estava disponível. |
| Backup | Destino `C:\Users\Papai\OneDrive\Quiver\Tap Quiver\Backup banco\Observabilidade TAP-96`; RPO 24h e RTO 8h somente para observabilidade. Preservar `Dev` e `PRD`. | Subpasta local e remota criadas. ACL local protegida verificada para `FILIPE\Papai`, SYSTEM e Administrators. Um artefato sintético foi restaurado em ES isolado; a sincronização do arquivo local não foi confirmada e o destino remoto ainda aparece vazio. RPO/RTO reais permanecem sem prova. |
| Telegram | Exatamente um alerta sintético de falha e um de recuperação para o bot e destinatário operacional já configurados. | Não enviado: `OBS_ALERT_TELEGRAM_BOT_TOKEN` e `OBS_ALERT_TELEGRAM_CHAT_ID` estão vazios nos arquivos locais de desenvolvimento/produção acessíveis. Nenhuma credencial foi lida para fora, copiada ou exibida. Recebimento humano não foi solicitado porque não houve envio. |
| DEV | Slot liberado; a única troca continua condicionada aos gates oficiais. | Sem publicação. PR #92 está em `85b31165b4b457800cf4c262210c8982815539fb`; run `39599024132` terminou com os sete checks em falha, sem steps/logs de execução. O padrão indica bloqueio antes dos jobs; o motivo específico do run atual não foi publicado pela API. O proprietário informou que Actions billing segue bloqueado. Sem bypass/rerun. |
| Cloudflare/origem | Nenhuma alteração compartilhada autorizada ainda. | Peer do caminho DEV identificado como loopback `127.0.0.1` por configuração de túnel e conexão estabelecida correlacionada. Nenhum header confiável foi ativado. Ver proposta específica abaixo. |

## Retenção DEV: estado e preflight necessário

O candidato versionado em `deploy/observability/es-ilm-policy-metrics.json` define rollover em `max_age=7d` ou `max_primary_shard_size=30gb` e delete `min_age=45d` após rollover. Assim, o primeiro backing pode permanecer aproximadamente até 52 dias desde sua criação, além de atraso do ILM; 45 dias após rollover não é um limite absoluto de idade do evento. Não alterar esta janela nem o rollover por causa do relatório histórico.

A simulação compatível com Elasticsearch 8.17.0 registrada em `TAP-96-preparacao-retencao-2026-10-20.md` é evidência descartável, não substitui o estado atual do cluster. O preflight do cluster atual não pôde ser feito sem sessão administrativa. O provisionador `scripts/observability/setup-ilm.ps1` planeja cinco famílias DEV de uma vez e usa template bare priority 300; ele não atende ao escopo autorizado de um único stream e pode prevalecer sobre templates/componentes que precisem ser preservados. Não executar esse script para este piloto.

Roteiro Console, somente leitura, para o administrador devolver respostas compactas antes de qualquer gravação:

```http
GET /_cluster/health
GET /_cluster/settings?include_defaults=true&flat_settings=true&filter_path=persistent.cluster.max_shards_per_node,transient.cluster.max_shards_per_node,defaults.cluster.max_shards_per_node
GET /_data_stream/metrics-generic.otel-dev
GET /_ilm/explain/metrics-generic.otel-dev?only_managed=false
GET /_cat/indices/metrics-generic.otel-dev*?format=json&h=index,docs.count,store.size,pri,rep,creation.date
GET /_cat/shards/metrics-generic.otel-dev*?format=json&h=index,shard,prirep,state,node,unassigned.reason
GET /_ilm/policy/metrics
GET /_index_template?filter_path=index_templates.name,index_templates.index_template.index_patterns,index_templates.index_template.priority,index_templates.index_template.composed_of,index_templates.index_template.template.settings.index.lifecycle.name,index_templates.index_template.template.settings.index.number_of_replicas
POST /_index_template/_simulate_index/metrics-generic.otel-dev
```

A resposta deverá identificar o template vencedor, os componentes efetivamente compostos, lifecycle, réplica, shard/write index, volume e margem total de shards primários+réplicas. O futuro template precisa manter o mapping/data-stream/TSDS do vencedor sem mudar templates genéricos compartilhados. A execução fica restrita ao nome exato DEV e a futuras gerações naturais. Backings existentes e write index atual não serão atualizados retroativamente.

## Backup: prova isolada e limite off-host

O diretório local foi criado em `C:\Users\Papai\OneDrive\Quiver\Tap Quiver\Backup banco\Observabilidade TAP-96`. A ACL final está protegida contra herança e concede FullControl somente à conta Windows responsável, SYSTEM e Administrators. As pastas `Dev` e `PRD` existentes não foram alteradas.

Foi criado um snapshot Elasticsearch 8.17.0 com apenas um documento `synthetic_restore_probe`, sem rede nem portas publicadas. O snapshot `synthetic-20261021` restaurou em outro Elasticsearch descartável com repositório somente leitura; a consulta devolveu o marcador esperado. O ZIP local mede 6.304 bytes; SHA-256 `3AC79AB88BE06D1AA5FABA0C0CA643F807984820F730BEBC107E526023EB2D6A`. Esta amostra não contém eventos comerciais e não é backup do cluster compartilhado.

OneDrive Web confirmou a conta e a pasta remota aprovada; a subpasta `Observabilidade TAP-96` foi criada. O cliente `OneDrive.exe` apareceu em execução, mas o remoto continuou mostrando zero arquivos. O upload via navegador foi impedido porque a extensão Edge não tem “Allow access to file URLs”; essa permissão ampla não foi habilitada. Portanto, não afirmar sincronização off-host nem restauração a partir do OneDrive. Próximo passo operacional: o cliente autorizado do OneDrive concluir a sincronização deste arquivo, ou o operador fazer o upload pela interface aprovada; confirmar nome, tamanho e hash remotamente e baixar esse objeto para repetir o restore isolado. Um arquivo sintético no diretório não comprova agenda de 24h nem RPO para dados reais. O RTO de 8h ainda não foi medido para o conjunto real.

## Telegram e confirmação humana

A inspeção mascarada dos arquivos `.env.development` e `.env.production` retornou `tokenConfigured=false` e `recipientConfigured=false`; nenhum valor foi impresso. As duas mensagens autorizadas não foram enviadas. Para fechar esta frente, o mecanismo local existente precisa disponibilizar a configuração já aprovada ao emissor autorizado, sem colar segredos em Plane/conversa/log. Depois do envio único de cada estado, registrar IDs não secretos e solicitar confirmação humana de recebimento.

## Geolocalização: peer, mudança proposta e retorno

`%USERPROFILE%\.cloudflared\config.yml` encaminha `tapdev.quivercloud.com.br` para `http://localhost:5202`; `localhost` resolve para `::1` e `127.0.0.1`. No momento da inspeção, o processo `cloudflared` (PID observado 9288) manteve conexão estabelecida de `127.0.0.1:63071` para `127.0.0.1:5202`, coerente com o listener Node DEV `0.0.0.0:5202`. O peer imediato observado para esse caminho foi `127.0.0.1`. Não há essa mesma prova de conexão para PROD.

Mudança candidata DEV-only: configurar `TAP_TRUSTED_GEO_PROXY_ADDRESSES=127.0.0.1` somente no ambiente do release DEV, mantendo PROD, Cloudflare e headers da origem sem alteração. O app só deve aceitar o país ISO dos headers Cloudflare quando o peer socket corresponder exatamente a essa allowlist; nunca armazenar IP do cliente. Risco: qualquer processo local que consiga conectar ao listener loopback pode forjar esses headers; o listener Node está ligado a `0.0.0.0`, portanto acesso direto por rede não é loopback e não deve ser confiável. Antes de aplicar, decidir se aceita esse limite local ou exige isolamento/autenticação adicional do proxy. Retorno: remover a variável do DEV e restaurar o ambiente/release anterior; nenhum efeito em dados. Nenhuma mudança foi aplicada.

## Única lista de dependências externas restantes

1. **GitHub:** o proprietário regulariza Actions billing/spending limit e executa novamente os sete checks oficiais no HEAD final do PR #92. O run atual não tem logs de steps; não atribuir a causa específica apenas por inferência. Depois dos checks verdes, seguir merge oficial e uma única publicação DEV já autorizada. PROD segue fora do escopo.
2. **Elasticsearch:** o administrador executa a coleta GET/POST somente leitura acima e entrega o resultado não secreto para fechar preflight de composição/capacidade. Só então preparar/aplicar o template/policy exatos do piloto DEV aprovado. Não solicitar novamente aprovação de 45 dias.
3. **OneDrive:** concluir e comprovar a sincronização/upload do ZIP sintético na subpasta remota. Depois, repetir restore a partir do objeto baixado e validar política/agendamento para RPO 24h; não substituir nem reorganizar backups existentes.
4. **Telegram:** o operador responsável torna disponíveis ao emissor autorizado o bot e destinatário já configurados no segredo local aprovado; enviar exatamente um alerta de falha e um de recuperação e confirmar recebimento humano. Não solicitar novamente autorização para as duas mensagens.
5. **Cloudflare/origem:** decisão específica ainda necessária sobre aplicar somente em DEV a allowlist `127.0.0.1` e aceitar risco de processos locais, ou exigir isolamento/autenticação adicional. Nenhuma mudança em Cloudflare, PROD, firewall ou origem foi autorizada.

Nenhum deploy de produção, mudança de rede, template/policy real, alteração de backing ou envio Telegram foi efetuado. TAP-96 continua **In Progress** e `PROD_DEPLOY_REQUIRED=YES`.