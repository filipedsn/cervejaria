# TAP-96 — pacote operacional final (2026-10-21)

Este pacote não autoriza nem executa deploy, mudança compartilhada, retenção, envio real, exclusão ou alteração de credenciais. Decisões separadas abaixo continuam necessárias. Base técnica: main `bf74eda30658a3b295f3182608491302a9bb7a63`; certificação de Pino e correção `page_view` em branch de PR pendente de CI/merge. O DEV oficial estava ocupado por outra tarefa na última observação; confirmar slot antes de qualquer troca.

## A. Fronteira de proxy e país aproximado

**Ação candidata:** expor somente código de país obtido de `CF-IPCountry`, sem IP bruto, e aceitar o header apenas quando o peer TCP imediato for um proxy/Tunnel explicitamente confiável. O helper testado `trusted-geolocation.ts` tem allowlist vazia por padrão e rejeita peer direto, header ausente/inválido e país desconhecido. Ele não está ligado ao runtime.

**Impacto:** acrescenta país aproximado a sinais de auditoria; não fornece cidade, região nem prova de identidade. **Risco:** confiar em peer/header incorreto permite spoofing; alterar `trustProxy` global muda semântica de IP em todas as rotas.

**Pré-condições:** observar no processo o peer real encaminhado por `cloudflared`; comprovar que a origem não aceita conexão direta alternativa; escolher finalidade, campos e retenção de país. Nenhuma lista Cloudflare presumida serve para uma conexão Tunnel local.

**Verificação:** testes positivos de peer Tunnel exato, spoof direto, header contraditório e formato inválido; confirmar que apenas o country code/unknown é emitido e que não sai IP. Depois, validar no DEV com um evento sintético.

**Retorno/aborto:** desabilitar a chamada do helper e publicar runtime anterior; abortar se não for possível identificar o peer/origem ou se houver caminho direto à API. Mudança em Cloudflare, firewall, Tunnel ou serviço precisa de autorização operacional própria e janela, separada deste PR de código.

**Decisão humana:** aprovar finalidade/precisão país-only e, em uma operação distinta, fornecer a fronteira de rede aprovada observada para Tunnel. Até lá, manter geolocalização desligada.

## B. Notificação a operador

**Ação candidata:** após identificar o canal e destinatário já configurados e dono responsável, enviar uma mensagem sintética firing e a correspondente resolved usando a regra existente; texto: `TAP-96 synthetic observability alert firing/resolved (no transaction data)`.

**Impacto:** prova fim a fim até um operador; não usar transação, cliente ou dado comercial. A prova local existente alcança somente webhook descartável, não o operador.

**Pré-condições:** confirmar receptor/canal já existente, destinatário e janela; usar alerta sintético sem criar incidente comercial; mensagem real requer autorização explícita específica do usuário.

**Verificação:** registrar horário de firing/resolved, acknowledgement humano do recebimento e ausência de payload comercial. A resposta HTTP do Alertmanager sozinha não é aceite.

**Retorno:** silenciar/remover apenas a regra/receiver sintético e restaurar configuração anterior; nenhum canal foi enviado nesta fase.

**Decisão humana:** indicar canal/destinatário e autorizar expressamente dois envios sintéticos. Sem isso, manter como “entrega ao operador não comprovada”.

## C. Retenção e capacidade

**Ação candidata para futura aprovação:** piloto restrito a novas gerações naturais de `metrics-generic.otel-dev`, policy proposta `quiver-tap96-dev-metrics-45d-v1` e template de nome exato definido na preparação; janela candidata 45 dias contados após rollover. A simulação Elasticsearch 8.17.0 e conflitos/composição estão registrados em `TAP-96-preparacao-retencao-2026-10-20.md`. Não criar template abrangente `logs-*`/`metrics-*` nem mudar policy compartilhada.

**Impacto/limite:** a fotografia administrativa encontrou 540 streams OTel (525 DEV, 12 PROD, 3 infra), 547 backings e ~2,4 GiB; 574 primários ativos + 49 réplicas não alocadas, limite efetivo 1000 shards/node. DEV domina a cardinalidade, mas compartilha nó e capacidade com PROD/infra. A métrica DEV observada era 16,9M docs / 1,601 GiB em backing existente; policy/template futuro não apaga esse backing. Um backing futuro custa no mínimo um primary; total com réplica depende do template efetivo, hoje deve ser revalidado no cluster e cabe no orçamento apenas após decisão explícita. A contagem dos 574 primários não representa consumo total: considerar demanda de 623 shards alocados+não alocados e o estado yellow.

**Pré-condições:** obter segunda fotografia comparável ou histórico de crescimento; revalidar versão, health, template vencedor/composição/settings/replicas/shard limit, stream, política e espaço imediatamente antes. Aprovar janela e custo para DEV sem inferir que outros namespaces são DEV.

**Verificação antes/depois:** `_simulate_index` para nome exato DEV e negativos PROD/infra/APM; registrar prioridade, templates compostos, mappings, TSDS, policy, shards e store; monitorar criação apenas no rollover natural, `_ilm/explain`, shards/health, docs/store e métricas de fila. Alertas devem avisar antes do budget aprovado.

**Retorno/aborto:** remover/desassociar apenas a configuração futura aprovada e restaurar o template vencedor documentado. Abortar se afetar destino fora do nome exato DEV, remover composição Elastic, tocar backing existente, consumir réplica incompatível ou a segunda medição mostrar crescimento sem budget. Rollback de config não recupera documentos excluídos.

**Backings existentes:** nenhuma expiração retroativa está autorizada. Preparar lista por backing com write index, idade da criação/rollover, policy real, docs/store e candidatos a exclusão; comprovar snapshot off-host e restore antes de qualquer ação destrutiva. Backings sem lifecycle (incluindo os 132 traces da fotografia) exigem análise e autorização separadas.

**Decisão humana:** aprovar somente a política futura específica (inclusive 45 dias após rollover), o orçamento total primário+r​​éplica e limites de aborto; política em backings atuais e as janelas audit 90d, technical 30d, traces 30d e infra 15d continuam sem aprovação.

## D. Durabilidade, backup e recuperação

**Ação candidata:** usar o exemplo 0.156.0 de fila `file_storage` somente após decidir RPO/RTO, tamanho máximo da fila e armazenamento persistente com quota física. A POC preservada carregou 1 item após restart; replay duplicou IDs; fila artificial de 8 KiB recusou 200 logs enquanto OTLP respondeu 200, com contador `otelcol_exporter_enqueue_failed_log_records_total=200`. `max_size` por arquivo bbolt não limita o volume inteiro. Snapshot/restore descartável recuperou um documento marcador, não o conjunto, a agenda, cópia off-host ou permissões reais.

**Impacto:** fila aumenta tolerância à indisponibilidade e ocupa disco; replay pode duplicar. OTLP 200 não significa exportação final.

**Pré-condições:** dono de operação, volume persistente independente do container, quota monitorada, credenciais/criptografia, destino off-host e procedimento de alerta. Definir RPO: por exemplo, snapshot diário implica janela potencial de até 24h, horário implica até 1h, sujeito à frequência/atraso real. RTO não deve ser prometido antes de ensaio cronometrado de restauração.

**Verificação:** ambiente descartável deve medir enchimento, recusa, contador, restart, replay/duplicidade e restore de uma amostra representativa; calcular idade do último backup, tamanho, checksum e duração. Uma restauração completa requer inventário de índices/backings, templates/policies/config e compatibilidade de versão.

**Retorno/aborto:** voltar ao exporter anterior só após drenar fila ou aceitar explicitamente a perda/duplicação pendente; não apagar volume antigo. Abortar com espaço não monitorado, erro de restore/checksum ou RPO/RTO sem dono.

**Decisão humana:** escolher destino off-host, escopo de backup, frequência e limites de perda/recuperação; autorizar ensaio compartilhado separado depois de aprovados os resultados descartáveis.

## E. Acesso Kibana e separação por empresa

**Estado observado:** Discover é acesso de operadores internos. A API key temporária concedeu leitura DEV ao executor e foi revogada; chave ES não dá acesso à UI nem ACL empresarial. Eventos carregam tenant/ator como contexto de consulta; isso não é autorização por tenant. Não existe evidência de que clientes/administradores empresariais usem Kibana diretamente.

**Ação candidata:** manter Discover operacional interno, sem criar roles empresariais. Se o produto passar a permitir acesso externo, desenhar modelo DLS/FLS com identidade/tenant autenticados e fazer teste positivo e negativo cross-tenant antes de conceder acesso.

**Verificação:** auditar periodicamente usuários/roles reais de Kibana e confirmar que somente operadores internos conseguem acessar os data views. Acesso humano do usuário durante Discover não é prova de ACL entre empresas.

**Retorno:** remover usuário/role temporário por ID, confirmar revogação e limpeza conforme procedimento; não conceder acesso PROD.

**Decisão humana:** confirmar como decisão de produto se Discover continua exclusivamente interno. Enquanto isso for verdade, ACL empresarial para Kibana é não aplicável; a atribuição correta de tenant/ator nos eventos continua aplicável.

## Sequência recomendada e autorização agrupada

1. Integrar por PR a correção de origem `page_view` e a captura de correlation IDs, validar CI e só depois publicar o SHA final em uma única troca DEV quando o responsável liberar o slot. Isto publica runtime de aplicação; não mexe em Collector/Elasticsearch.
2. Separadamente, decidir geolocalização e fronteira Tunnel; nenhum header confiável é ativado agora.
3. Separadamente, confirmar canal/destinatário e autorizar os dois alertas sintéticos ao operador.
4. Separadamente, aceitar RPO/RTO/destino off-host e aprovar o futuro piloto metrics DEV com orçamento de shards primário+r​​éplica após fotografia comparável. Retenção em backings existentes permanece outra autorização destrutiva.
5. Confirmar a decisão do produto sobre Discover interno versus acesso empresarial.

A maior etapa técnica de código já reproduzida é `page_view`; a operação compartilhada com maior benefício/controlabilidade é a troca única DEV após CI e liberação do slot. Não há autorização para PROD, retenção, alertas reais, rede ou credenciais nesta entrega. TAP-96 permanece In Progress e `PROD_DEPLOY_REQUIRED=YES` até validação/publicação aplicável.
