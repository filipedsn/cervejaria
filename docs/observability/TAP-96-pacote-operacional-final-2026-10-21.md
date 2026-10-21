# TAP-96 — pacote operacional final (2026-10-21)

Este pacote distingue código candidato no PR #92 das intervenções operacionais. Base histórica: main `bf74eda30658a3b295f3182608491302a9bb7a63`; correções runtime, jornadas TAP-114 e provas posteriores preservadas na branch. DEV já liberado; publicação condicionada aos sete gates oficiais, sem bypass. As aprovações vigentes de piloto metrics DEV e dois alertas não autorizam PROD ou intervenções compartilhadas adicionais.

> **Decisões vigentes posteriores:** consultar o [aditivo operacional](TAP-96-aditivo-decisoes-operacionais-2026-10-21.md), que supersede as listas históricas de autorizações abaixo. Backup da observabilidade adiado pelo proprietário: nenhuma nova atividade de backup, sincronização OneDrive ou restauração; RPO/RTO pendentes para retomada futura não bloqueiam esta entrega. Evidências existentes preservadas. Backups transacionais e obrigatórios de deploy permanecem exigidos. O slot DEV já está liberado e não requer nova confirmação.

## A. Fronteira de proxy e país aproximado

**Ação candidata somente DEV, desligada:** Request Header Transform Rule restrita a `tapdev.quivercloud.com.br`, sobrescrevendo `x-tap-geo-country=ip.src.country` e `x-tap-geo-auth` com segredo DEV mantido fora do repositório. O validador implementado exige `NODE_ENV=development`, `TAP_GEO_MODE=authenticated-edge-dev` e comparação constante com `TAP_GEO_EDGE_TOKEN`; rejeita credencial incorreta/duplicada, país inválido/desconhecido e uso em produção. Somente país é propagado, sem IP. Allowlist de loopback sozinha não ativa o runtime.

**Impacto:** acrescenta país aproximado a sinais de auditoria; não fornece cidade, região nem prova de identidade. **Risco:** confiar em peer/header incorreto permite spoofing; alterar `trustProxy` global muda semântica de IP em todas as rotas.

**Pré-condições:** autorizar especificamente a regra do hostname DEV e a configuração segura do autenticador no DEV. O caminho Tunnel → frontend/proxy `:5202` → backend `:3002` foi identificado por configuração/conexão; peer loopback observado não prova confiança. A proteção candidata exige autenticador mesmo na conexão local. Não alterar `trustProxy`, firewall ou túnel global. PROD permanece separado e desligado.

**Verificação:** provas isoladas passaram para autenticação, duplicidade, país desconhecido, recusa em produção e redação do segredo. Após a autorização e CI, testar falsificação no hostname público (sobrescrita na borda), acessos diretos ao frontend/backend sem autenticador e requisição positiva correlacionada pelo caminho completo. A prova isolada não substitui essa prova operacional.

**Retorno/aborto:** desligar o modo DEV, remover somente a regra DEV e voltar ao pacote oficial anterior se necessário. Abortar se houver exposição de segredo, aceitação de header forjado ou alcance fora do hostname DEV. O teste direto sem token deve retornar país desconhecido; nenhuma alteração compartilhada foi executada.

**Decisão humana ainda necessária:** autorizar essa intervenção mínima DEV e seu segredo seguro. Até lá, geolocalização permanece desligada. Nenhuma autorização de PROD está implícita.

## B. Notificação a operador

**Ação já autorizada:** exatamente um firing e um resolved **TESTE TAP-96** pelo bot existente `@Tap_Quiver_Bot` e destinatário operacional existente, usando connector `.index` → índice → poller. Não usar Bot API avulsa nem provocar falha real. Nenhum envio foi realizado.

**Impacto:** prova fim a fim até um operador; não usar transação, cliente ou dado comercial. A prova local existente alcança somente webhook descartável, não o operador.

**Pré-condições:** localizar a fonte segura efetivamente usada pelo worker, confirmar rule/connector/índice e backlog. PID 32068 serve estado antigo de 29/09 sem avanço observado: o 404 é histórico. O health candidato permite conferir loop e metadados seguros sem inspecionar memória; ele ainda não está no processo compartilhado. Eventual configuração/restart somente do poller exige aprovação específica antes da execução, com impacto de pausa no despacho e risco de backlog, preservando cursor/dedup.

**Verificação:** registrar horário de firing/resolved, acknowledgement humano do recebimento e ausência de payload comercial. A resposta HTTP do Alertmanager sozinha não é aceite.

**Retorno:** silenciar/remover apenas a regra/receiver sintético e restaurar configuração anterior; nenhum canal foi enviado nesta fase.

**Ação externa necessária:** o operador identifica a referência segura de configuração existente e o administrador retorna os metadados Kibana atuais, sem segredos. Não pedir novamente autorização dos dois envios. Depois de executá-los, obter confirmação humana dos dois recebimentos; entrega ainda não comprovada.

## C. Retenção e capacidade

**Piloto já aprovado, condicionado ao preflight:** novas gerações naturais de `metrics-generic.otel-dev`, policy `quiver-tap96-dev-metrics-45d-v1`, rollover 7d/30gb e delete 45 dias após rollover. Não usar o provisionador amplo de cinco famílias; preservar a composição integral do template vencedor, mudando somente lifecycle na resolução. Simulação histórica ES 8.17.0 não substitui composição/capacidade atuais.

**Impacto/limite:** a fotografia administrativa encontrou 540 streams OTel (525 DEV, 12 PROD, 3 infra), 547 backings e ~2,4 GiB; 574 primários ativos + 49 réplicas não alocadas, limite efetivo 1000 shards/node. DEV domina a cardinalidade, mas compartilha nó e capacidade com PROD/infra. A métrica DEV observada era 16,9M docs / 1,601 GiB em backing existente; policy/template futuro não apaga esse backing. Um backing futuro custa no mínimo um primary; total com réplica depende do template efetivo, hoje deve ser revalidado no cluster e cabe no orçamento apenas após decisão explícita. A contagem dos 574 primários não representa consumo total: considerar demanda de 623 shards alocados+não alocados e o estado yellow.

**Pré-condições:** obter segunda fotografia comparável ou histórico de crescimento; revalidar versão, health, template vencedor/composição/settings/replicas/shard limit, stream, política e espaço imediatamente antes. Aprovar janela e custo para DEV sem inferir que outros namespaces são DEV.

**Verificação antes/depois:** `_simulate_index` para nome exato DEV e negativos PROD/infra/APM; registrar prioridade, templates compostos, mappings, TSDS, policy, shards e store; monitorar criação apenas no rollover natural, `_ilm/explain`, shards/health, docs/store e métricas de fila. Alertas devem avisar antes do budget aprovado.

**Retorno/aborto:** remover/desassociar apenas a configuração futura aprovada e restaurar o template vencedor documentado. Abortar se afetar destino fora do nome exato DEV, remover composição Elastic, tocar backing existente, consumir réplica incompatível ou a segunda medição mostrar crescimento sem budget. Rollback de config não recupera documentos excluídos.

**Backings existentes:** nenhuma expiração retroativa está autorizada. Preparar lista por backing com write index, idade da criação/rollover, policy real, docs/store e candidatos a exclusão; comprovar snapshot off-host e restore antes de qualquer ação destrutiva. Backings sem lifecycle (incluindo os 132 traces da fotografia) exigem análise e autorização separadas.

**Acesso externo necessário:** coleta administrativa atual de metadados e simulação, seguida das duas escritas exatas no Console do administrador após validar os corpos. A chave temporária de verificação não recebe `manage_ilm`/`manage_index_templates`, que são privilégios de cluster sem restrição por nome. Não solicitar outra aprovação do piloto; backings atuais e outras famílias permanecem fora do escopo.

## D. Durabilidade, backup e recuperação

**Escopo vigente:** backup da observabilidade adiado. Os parágrafos abaixo preservam a proposta e provas históricas; não executar backup, sincronização ou restore e não usar RPO/RTO como gate atual. O destino provisório e as metas anteriormente aprovadas não são novas decisões pendentes. Backups transacionais e obrigatórios de deploy continuam exigidos.

**Ação candidata:** usar o exemplo 0.156.0 de fila `file_storage` somente após decidir RPO/RTO, tamanho máximo da fila e armazenamento persistente com quota física. A POC preservada carregou 1 item após restart; replay duplicou IDs; fila artificial de 8 KiB recusou 200 logs enquanto OTLP respondeu 200, com contador `otelcol_exporter_enqueue_failed_log_records_total=200`. `max_size` por arquivo bbolt não limita o volume inteiro. Snapshot/restore descartável recuperou um documento marcador, não o conjunto, a agenda, cópia off-host ou permissões reais.

**Impacto:** fila aumenta tolerância à indisponibilidade e ocupa disco; replay pode duplicar. OTLP 200 não significa exportação final.

**Pré-condições:** dono de operação, volume persistente independente do container, quota monitorada, credenciais/criptografia, destino off-host e procedimento de alerta. Definir RPO: por exemplo, snapshot diário implica janela potencial de até 24h, horário implica até 1h, sujeito à frequência/atraso real. RTO não deve ser prometido antes de ensaio cronometrado de restauração.

**Verificação:** ambiente descartável deve medir enchimento, recusa, contador, restart, replay/duplicidade e restore de uma amostra representativa; calcular idade do último backup, tamanho, checksum e duração. Uma restauração completa requer inventário de índices/backings, templates/policies/config e compatibilidade de versão.

**Retorno/aborto:** voltar ao exporter anterior só após drenar fila ou aceitar explicitamente a perda/duplicação pendente; não apagar volume antigo. Abortar com espaço não monitorado, erro de restore/checksum ou RPO/RTO sem dono.

**Retomada futura:** nova instrução do proprietário para retomar essa frente. Nenhuma decisão de backup é solicitada nesta entrega e nenhum arquivo existente deve ser excluído.

## E. Acesso Kibana e separação por empresa

**Estado observado:** Discover é acesso de operadores internos. A API key temporária concedeu leitura DEV ao executor e foi revogada; chave ES não dá acesso à UI nem ACL empresarial. Eventos carregam tenant/ator como contexto de consulta; isso não é autorização por tenant. Não existe evidência de que clientes/administradores empresariais usem Kibana diretamente.

**Ação candidata:** manter Discover operacional interno, sem criar roles empresariais. Se o produto passar a permitir acesso externo, desenhar modelo DLS/FLS com identidade/tenant autenticados e fazer teste positivo e negativo cross-tenant antes de conceder acesso.

**Verificação:** auditar periodicamente usuários/roles reais de Kibana e confirmar que somente operadores internos conseguem acessar os data views. Acesso humano do usuário durante Discover não é prova de ACL entre empresas.

**Retorno:** remover usuário/role temporário por ID, confirmar revogação e limpeza conforme procedimento; não conceder acesso PROD.

**Decisão já confirmada:** Discover/Kibana exclusivo da equipe interna autorizada. ACL empresarial de Kibana não é requisito deste produto; atribuição correta de tenant/ator e autorização das rotas permanecem aplicáveis.

## Sequência recomendada e autorização agrupada

1. Proprietário GitHub regulariza billing/spending limit; executar os sete checks oficiais no HEAD final do PR #92. Depois de verdes, concluir revisão/integração e uma única troca DEV já autorizada, com SHA/health/ready/smoke comprovados. TAP-114 e provas válidas preservados. Não pedir novamente slot nem contornar gates.
2. Administrador executa uma coleta consolidada somente leitura para o piloto metrics DEV e metadados do fluxo operacional de alertas. Corpos de escrita do piloto somente após preflight/simulação, sem backings atuais. Não repetir a coleta histórica inteira.
3. Operador confirma a fonte segura do poller; se necessário, aprovar a intervenção exata somente nesse worker, preservando estado e controlando backlog. Executar os dois alertas já autorizados e obter confirmação humana.
4. Decidir a intervenção mínima de geolocalização DEV descrita em A. Não ativar headers por confiança em loopback nem executar proposta compartilhada ampla/PROD.
5. Backup/RPO/RTO adiados e Discover interno confirmado: não reapresentar como bloqueios ou decisões pendentes.

A troca única DEV após gates oficiais é distinta do piloto metrics e da operação do poller. Não houve mudança de infraestrutura compartilhada ou produção nesta execução. TAP-96 permanece In Progress e `PROD_DEPLOY_REQUIRED=YES`; o adiamento de backup não elimina os demais gates.
