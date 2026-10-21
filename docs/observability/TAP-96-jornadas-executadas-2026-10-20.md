# TAP-96 — jornadas finitas e validação integrada isolada

> Atualização 2026-10-21: as jornadas de portal TAP-114 e a emissão sintética de `payment.requested` / `payment.request_resolved` em ES 8.17.0 descartável estão em [matriz de observabilidade TAP-114](TAP-96-matriz-TAP-114-2026-10-21.md). Não houve consulta a eventos históricos do TAP-114 nem troca do DEV.

Data: 2026-10-20 (America/Sao_Paulo). Candidato testado: `d0ed1c189abd9df2dfefd98ebcfb40b58e01c4d4` (main local/remota reportada após PR #89).

## Estado dos ambientes nesta execução

| Ambiente | SHA/versão observada | Estado | Limite |
|---|---|---|---|
| Main | `d0ed1c189abd9df2dfefd98ebcfb40b58e01c4d4` | candidato isolado | Não significa deploy. |
| DEV oficial `127.0.0.1:3002` | `1c85adf2272afe50b5ee705c22fb7361cb24e50a` | `/api/health=ok`, `/api/ready=ready` | Release de outra tarefa; não foi alterada nem substituída. O SHA mudou durante a janela de validação. |
| PROD `127.0.0.1:3001` | prefixo `e39b2e6d`, `/api/ready=ready` | sem alteração | Nenhum deploy de produção. |
| Collector compartilhado | `0.130.1` | sem alteração | Não conectado pelo ensaio; a porta compartilhada 4318 permaneceu intacta. |

## Catálogo finito executado

A execução usa o catálogo Playwright de release já existente, com resultados observáveis pelo navegador/API e snapshots antes/depois no PostgreSQL descartável. A lista é fechada pelos IDs abaixo; qualquer expansão exige nova decisão de escopo.

| Jornada | IDs executados | Preparação e contexto | Contrato de resultado/sinal avaliado |
|---|---|---|---|
| Login, sessão e logout | `AUT-S01..04`, `AUT-X01`, `AUT-X02`, `AUT-X04` | DONO, ADMIN e atendente sintéticos; duas empresas; credencial inválida, empresa inativa e token adulterado | 2xx/401/403 previstos; `auth.login.*`, logout/sessão quando emitidos; HTTP com rota/status e tenant/ator. Segredos não devem entrar no documento. |
| Provisionamento e administração global | `ADM-S02`, `ADM-X01` | ADMIN sintético cria empresa; DONO/atendente tentam rota administrativa | Provisionamento canônico 201 e negação 403; ator global separado da empresa alvo. Campo universal de alvo administrativo continua ausente. |
| Permissões | `RBAC-S01..03`, `RBAC-X01..06` | Dono e atendente em tenant A; alvo de tenant B; matriz de 28 permissões | Concessão/revogação e resultados 200/403/404/409; controle negativo não altera o snapshot de banco. |
| Onboarding | `ONB-S01..02` | Empresa recém-provisionada e readiness sintética | Estado exibido corresponde ao setup; HTTP funcional e release/contexto. |
| Configuração e catálogo | `CFG-S01..05`, `CFG-X01`; `CAT-S01..05` | PDV e empresa canônicos; atendente sem acesso; produto/opcional/categoria/cardápio | Persistência da configuração, CRUD, escopo de preço e 403; não registrar valores livres de formulários como telemetria. |
| Caixa e turno | `CXA-S01..09` | Sessão de caixa, movimentos, correção, contagem e agenda sintéticos | Abertura/fechamento/correção com saldos esperados; eventos `transacao.cash_register_opened` e movimento quando o caminho os emite; tenant, PDV, ator e turno devem ser reconciliáveis. |
| Comanda, cobrança e cancelamento | `CMD-S01..12`, `CMD-X05..07`, `CMD-X12`, `CMD-X18`, `CMD-X20` | Comandas, itens, desconto, pagamento, fiado/parcelas, venda avulsa, estorno/cancelamento e dois navegadores | Resultados por operação e conflitos/negações; `transacao.comanda_*`, `transacao.sale_payment_recorded` e HTTP conforme o caminho; `correlationId` liga eventos da mesma requisição, não toda a jornada universalmente. |
| Dashboard e ranking | `DSH-S01..05` | Massa conhecida e filtros de mês/PDV | KPIs, filtro e link ao resumo conferem; GET 2xx fica auditado fora das exclusões de polling. |
| Estoque | `EST-S01..05` | Entrada, saída, ajuste, venda por volume, cancelamento e estoque mínimo | Saldos após operação; `transacao.inventory_movement` quando emitido; tenant/PDV/produto e request/correlation ID. |
| Cozinha | `KDS-S01..06`, `KDS-X01..04` | Fila, estados, cancelamento, concorrência e dois clientes visuais | Transições válidas/inválidas, conflito e resultado de cancelamento; polling GET é excluído, mutations são auditadas; Socket não tem ACK de entrega persistido. |
| Clientes e histórico | `CLI-S01..02` | CRUD/histórico e união de registros sintéticos | Identidades e tenant corretos; PII não é evidência de observabilidade e deve permanecer redigida. |
| Portal e sessão pública/equipe | `POR-S01..05`, `POR-X05` | Cliente PDV, QR/comanda e ator da equipe em tenant sintético | Pedido público e progresso visual; evento `transacao.portal_pedido_criado` esperado com `actor.type=cliente-pdv`, tenant, PDV/comanda e correlação; evento anônimo/unknown só é erro se contradisser a sessão usada. |
| PWA e telas | `PWA-S01..02` | Navegador desktop e viewport móvel | Manifest e modo offline; UI só emite eventos semânticos para ações explicitamente marcadas. |
| Agenda operacional | `AGD-S01..03`, `AGD-X01`, `AGD-X04` | Ocorrências, conflito de horário e permissão | Criação/cancelamento/restauração e 409/403; HTTP e mudança de estado conferidos no banco. |

IDs adicionais do catálogo NÃO foram executados nesta etapa: SMTP real, backup/download, upload de branding, recuperação de senha por e-mail, clientes/telas não listados, operações herdadas ou external integrations. Não são necessários para inflar o denominador; continuam fora desta amostra finita.

### Resultado funcional

`qa:release-e2e` executou **172 testes, 172 passaram**, em projetos desktop, mobile, tablet e TV, com um worker. Isso corresponde a **91 IDs únicos** do catálogo na primeira bateria. `ADM-S02` e `ADM-X01` foram executados adicionalmente; total desta seleção: **93 IDs únicos**. Os testes usaram frontend compilado, API Fastify real e PostgreSQL 17 em container descartável, com duas empresas sintéticas e seis usuários; as migrações do candidato foram aplicadas ao banco temporário. O container usou `tmpfs`, bind em loopback e credenciais aleatórias por execução e foi removido pelo runner. Nenhum dado comercial foi usado.

As evidências da bateria são JSON de chamadas/snapshots para 93 IDs em `artifacts/release-e2e/d0ed1c189abd9df2dfefd98ebcfb40b58e01c4d4/evidence/{api,db}/` no checkout temporário. O helper redige senha/cookie/token e armazena hashes de snapshots; os arquivos brutos permanecem fora do repositório principal. Exceções testadas com checkpoint afirmam que a negação não alterou o banco. As provas funcionais confirmam resultado de produto, não ingestão Elasticsearch por si sós.

## Ingestão real no pipeline descartável

Foi feita validação focada sem repetir a bateria inteira. Stack isolado: Elasticsearch `8.17.0` com security desligada apenas no container descartável; Collector Contrib `0.130.1`; rede privada Docker; Elasticsearch em `127.0.0.1:19200`; Collector em `127.0.0.1:4319` porque `4318` já estava ocupado por um serviço local que não foi acessado. O pipeline OTLP logs → batch → exporter Elasticsearch criou data streams e aceitou documentos do candidato. Containers, redes e arquivo temporário foram removidos ao final.

| Execução sintética | Casos | Documentos | Resultado pesquisável |
|---|---|---:|---|
| `6b555058adf0bbdd` | `AUT-S01`, `CMD-S06` (login/logout e pagamento dividido) | 87 | `releaseSha=d0ed1c1…`; 75 outcomes success, 12 failure de controles/sondas do setup; 1 `transacao.sale_payment_recorded`, 1 POST em `/api/operacao/comandas/:id/pagamentos` com 200. |
| `f5f980298b7c30ff` | `AUT-X01`, `POR-S02` (login inválido e pedido de cliente PDV) | 71 | 61 success, 10 failure de controles/sondas do setup; exatamente 1 `auth.login.failed` 401 (`actor.type=anonymous`, slug `unknown`, motivo `INVALID_CREDENTIALS`) e 1 `transacao.portal_pedido_criado` success (`actor.type=cliente-pdv`, tenant/PDV/comanda sintéticos, `requestId` e `correlationId`). |
| `d8d4ddbf933e3bf6` | `ADM-S02`, `ADM-X01`, `CMD-S11` (provisionamento, 403 e dois navegadores) | 7 | Só setup/login e leituras de configuração foram encontrados; não apareceu documento para a rota admin negada/provisionamento nem para a mutação concorrente. A causa não foi estabelecida; esses caminhos têm prova funcional, mas a prova de ingestão é ausente nesta amostra. |

Nas duas execuções com operações correlacionadas, documentos foram pesquisados nos data streams DEV sintéticos e carregam o mesmo release SHA do candidato. `unknown` na falha de login corresponde à ausência de empresa identificável antes da autenticação; não é classificado como defeito. No pedido público, o ator cliente e o tenant esperado apareceram. Isso não prova atribuição por empresa em todo endpoint.

### Atraso, duplicidade e limites da amostra

- Agrupando por **mesma ação + mesmo `correlationId`**, houve 0 grupos duplicados nas amostras de 87 e 71 documentos. Eventos distintos da mesma requisição (por exemplo `http.post` e `auth.login.succeeded`) não são duplicidade.
- O percentil 95 de `http.response.duration_ms` do servidor foi 104 ms em 54 observações na primeira execução e 155 ms em 47 na segunda. São durações de processamento nos cenários sintéticos; não são latência do Collector/Elasticsearch nem SLA.
- Não há campo de ingestão independente suficiente para medir atraso evento→Elasticsearch nesta prova. `@timestamp`/`observed_timestamp` vêm do registro emitido; sem relógio de chegada persistido, não calculamos atraso.
- Zero duplicatas em duas amostras não garante exactly-once. A POC anterior de fila 0.156.0 produziu duplicatas no replay e permanece válida como risco separado.
- A execução `d8d4...` não oferece prova pesquisável para admin/concorrência; não extrapolar os resultados dos outros cenários.

## Regras candidatas para detectar falha de entrega

Foram preparados `examples/tap96-collector-alerts.rules.yml` e `examples/tap96-collector-alerts.test.yml`. Os cinco alertas cobrem enqueue failure, send failure, fila acima de 80% por 2 min, registros recusados pelo receiver e ausência de métricas da fila. As expressões estão restritas ao job `quiver-otel-durable`, que só deve ser usado no futuro Collector dedicado.

Prometheus `3.5.0` (`sha256:63805ebb8d2b3920190daf1cb14a60871b16fd38bed42b857a3182bc621f4996`): `promtool check rules` encontrou 5 regras válidas; `promtool test rules` passou os 5 casos sintéticos. O teste valida avaliação das expressões, rótulos e anotações, não entrega em Alertmanager, volume real, thresholds operacionais, quota física nem compatibilidade de nomes de métricas em produção. Regras não ativadas; Collector compartilhado continua `0.130.1`.

## Correções já entregues e lacunas reais

- PR #87: resultado terminal de exportação CSV e `page_view` sem query/fragmento.
- PR #88: exemplo e POC descartável de fila persistente; sem ativação compartilhada.
- PR #89: `http.get` 2xx com rota parametrizada, status, duração do servidor e contexto; exclusões de polling mantidas.
- As correções de código estão em main `d0ed1c1…`; CI e sete checks remotos dos PRs foram aprovados. Não foi feito novo CI local: esta mudança desta rodada é documentação e arquivos candidatos, enquanto a validade do código do SHA não mudou. A branch/PR desta documentação deve passar pelos sete checks remotos antes de merge.
- A prova funcional de concorrência não comprova entrega/reconexão do Socket por documento. A amostra integrada também não encontrou eventos de admin/concorrência; correlação ator-versus-empresa alvo em operações globais continua sem contrato comum.
- Sem captura de IP/geografia. A preparação segura continua: confiar em header geográfico apenas por uma origem Cloudflare/Tunnel verificada; não habilitar `trustProxy` global, aceitar header de chamada direta ou registrar IP bruto. Mudança de origem/firewall/Cloudflare segue fora do escopo e sem autorização.
- Kibana deve permanecer ferramenta de operadores internos até inventário de usuários/roles real. Não foi obtida prova de acesso por empresa em Kibana/Elasticsearch; se clientes empresariais passarem a usar Discover, será necessária decisão explícita e modelo DLS/FLS por empresa. Atribuição empresarial nos eventos de aplicação continua obrigatória.
- Retenção audit 90d, technical 30d, traces 30d, metrics 45d e infra 15d segue proposta sem aprovação. Backings históricos, snapshots/restore e custo de expiração não foram alterados nesta fase.
- Pendentes: capacidade e durabilidade fora da POC, RPO/RTO, fila/quota física, alertas/notificação efetivos, prova de ingestão no DEV oficial, cobertura para os caminhos sem evento na amostra, atribuição ator/alvo global e decisão de acesso externo. O cluster é single-node compartilhado; DEV concentra cardinalidade mas PROD/infra usam o mesmo limite.

## Gates distintos

| Gate | Saldo |
|---|---|
| Código corrigido e merged | comprovado em main `d0ed1c189abd9df2dfefd98ebcfb40b58e01c4d4`; PRs #87–#89 e sete checks conforme registro de cada PR |
| Jornadas funcionais isoladas | 172/172 na bateria finita; mais três execuções focadas de `ADM-S02`, `ADM-X01`, `CMD-S11`; 93 IDs únicos no conjunto |
| Pipeline/ingestão isolada | parcial: login, 401, pagamento e pedido público pesquisáveis; admin e concorrência não reconciliados |
| DEV oficial | não validado para main; release observado `1c85adf2272afe50b5ee705c22fb7361cb24e50a` pertence a trabalho paralelo e não foi substituído |
| Collector/Elasticsearch compartilhados | sem alteração; retenção, templates, shards e rede não aplicados |
| Produção | sem deploy; PROD observado ainda `e39b2e6d`; `PROD_DEPLOY_REQUIRED=YES` |

## Próxima autorização operacional concreta

Quando o responsável pelo portal liberar a janela DEV, autorizar **uma única troca do DEV para main `d0ed1c189abd9df2dfefd98ebcfb40b58e01c4d4`**, pelo fluxo de release existente (`prepare-dev-release.ps1` e `swap-dev-release.ps1`). A troca substitui a release DEV atual e pode causar indisponibilidade temporária de DEV; não há medição confiável de duração nesta execução. Antes, confirmar o SHA ativo; abortar se o responsável do portal não liberar o slot, se SHA/manifesto não coincidirem, se `/api/ready` falhar ou se o destino sair de DEV. O script de swap tem retorno automático para o SHA anterior em falha.

Aceite após troca: `/api/health` expõe o SHA completo esperado e `/api/ready=ready`; repetir somente login válido, login 401, pedido PDV público/equipe e uma operação de leitura GET não-polling; localizar eventos com test.run.id, tenant/ator/namespace/release/correlation esperados no data stream DEV; abortar aceite se aparecer PROD/infra, se a rota/contexto estiver errada ou se nenhum documento chegar. A verificação Elasticsearch requer acesso somente leitura DEV temporário e guardado localmente, com revogação confirmada após uso. Nenhuma alteração ao Collector compartilhado ou política de retenção está incluída nessa autorização. **Deploy PROD continua proibido sem autorização específica separada.**

TAP-96 permanece **In Progress**. Este aditivo não declara cobertura total nem conclui a publicação oficial no DEV.

## Aditivo TAP-96: reconciliacao focada pos-PR #90 (2026-10-20)

A main depois do merge do PR #90 e `41f49a0aa8a8bbd3014e5bd4910d1228dbdee41a`. Ela inclui o runtime do merge do portal `a48d2357` alem do candidato anterior `d0ed1c18`; as arvores nao sao equivalentes. Os ensaios abaixo foram executados em `41f49a0` com API Fastify real, PostgreSQL 17 descartavel em tmpfs, Elasticsearch 8.17.0 e Collector 0.130.1. O Collector usou `mapping.mode: otel` e indice dinamico, conforme `deploy/observability/otel-collector-config.yml`; os atributos de log sao pesquisados sob `attributes.*`.

| Execucao | Casos e resultado funcional | Auditoria na origem e Elasticsearch | Contexto/limite |
|---|---|---|---|
| `1be0ae921f5fde9a` | `ADM-S02`, `ADM-X01` e `CMD-S11`; 6 execucoes Playwright: dois casos admin em desktop e CMD-S11 em desktop/mobile/tablet/TV; 6/6 passaram. | O contador in-memory da origem observou 451 registros OTEL; a consulta DEV em nove data streams retornou os mesmos 451 com `test.run.id`. Foram pesquisados 2 `auth.authorization.denied`, 2 GET 403 (atendente e DONO), o GET 200 de controle, POST de provisionamento 201 e quatro POST de pedido 201 de CMD-S11. | Todos os 451 documentos tinham requestId/correlationId e release SHA `41f49a0...`; o payload de negação nao carrega status HTTP, que aparece no evento HTTP pareado. As evidencias JSON dos casos confirmam provisionamento canonico, resultado 403/controle 200 e pedido 201; elas nao armazenam correlationId, portanto o vinculo individual API-artifact/documento e parcial. |
| `6da21fca9a43df99` | `RT-17` acrescentado ao ID existente; 1/1 passou. Handshake com token invalido rejeitado; token valido conecta; pedido de room de outro tenant nao recebe evento; room propria propaga atualizacao apos desconectar e reconectar. | 102 documentos de auditoria pesquisaveis; 102/102 com requestId/correlationId; 0 grupos repetidos por acao+correlationId. | `realtime.room.denied/joined` sao sinais tecnicos enviados a `app.log` (Pino), nao eventos audit funcionais. O runner de QA nao habilita instrumentacao Pino->OTLP; portanto o comportamento de isolamento foi comprovado pelo nao recebimento cross-tenant e por propagacao propria, mas esses sinais tecnicos nao foram localizados no Elasticsearch. `CMD-S11` tambem prova propagacao entre duas telas e atualizacao apos voltar online/recarregar. |

### Localizacao da falha anterior e duplicidades

A ausencia registrada na execucao antiga de sete documentos nao se reproduziu. O caminho atual foi observado da funcao `emitAuditEvent`/`emitAuthEvent`, pelo `LoggerProvider` OTEL em memoria, Collector e data streams corretos. A primeira configuracao exploratoria deste turno usou mapping ECS e indice fixo; o Collector reportou `document_parsing_exception` e `illegal_argument_exception`, por isso ela foi descartada e nao usada como evidência. Com a configuracao OTEL dinamica do projeto, as contagens origem/destino fecharam 451/451. Sem a configuracao original e payloads da execucao `d8d4...`, nao e possivel atribuir retroativamente uma causa unica para aquela amostra; nao ha causa de emissao da aplicacao reproduzida para corrigir.

Na execucao de 451 documentos foram observados 12 grupos duplicados, todos `ui.page_view`, com mesma acao, page, requestId, correlationId e timestamp igual ou a 1 ms. Nenhum grupo duplicado ocorreu nas acoes de negacao, provisionamento focado por correlationId, pedido ou RT-17. Isto prova duplicacao de page_view nesta amostra; nao prova exatamente-uma-vez do pipeline. O tempo do servidor nao mede atraso de ingestao. A consulta nao tinha timestamp independente de chegada que sustentasse um atraso evento->Elasticsearch.

### Alertas, snapshot e geolocalizacao

As cinco regras continuam sintaticamente validas. Em rede Docker local isolada, Prometheus 3.5.0 avaliou `OTelCollectorQueueHighWatermark`; fila sintetica de 90/100 por mais de 2 minutos gerou `firing`, e baixar para 10/100 gerou `resolved`. Alertmanager 0.28.1 entregou exatamente as duas notificacoes a um webhook local descartavel. Isto comprova avaliacao, recuperacao e entrega ao receptor de teste; nao comprova canal nem recebimento por operador real.

Em ES 8.17.0 descartavel, um indice e documento sinteticos foram incluidos em snapshot, apagados e restaurados do repositorio temporario; o documento voltou a ser consultavel. Isto nao comprova agenda, copia off-host, volume de producao, permissao do repositorio ou RPO/RTO.

O candidato `trusted-geolocation.ts` so calcula pais quando o peer imediato esta numa allowlist explicita e os headers Cloudflare contem IP valido. Quatro testes cobrem spoof direto, peer IPv4 confiavel, peer IPv6/IPv4-mapped, IP invalido e pais desconhecido. O helper nao esta ligado ao runtime; a allowlist esta vazia por padrao. Ainda falta descobrir/confirmar o endereco que `cloudflared` apresenta ao processo e restringir o caminho ate a origem. Nao se habilitou `trustProxy`, Cloudflare, firewall ou coleta de IP.

### Status por ID e limites da bateria

A matriz individual dos 93 IDs, com contrato de sinal esperado, sinais pesquisaveis, contexto disponivel e limite de cada linha, esta em [TAP-96-matriz-IDs-funcionais-2026-10-20.md](TAP-96-matriz-IDs-funcionais-2026-10-20.md).

A bateria antiga preserva 172/172 testes funcionais e 93 IDs, com evidencias API/DB por arquivo em `artifacts/release-e2e/d0ed1c1...`; nao foi repetida. Esses artefatos provam assercoes funcionais e snapshots do PostgreSQL, nao indexacao por ID no Elasticsearch. A validacao de eventos pesquisaveis fica limitada aos IDs e execucoes acima e aos cenarios anteriormente reconciliados. IDs funcionais sem runId/correlationId de pipeline permanecem sem prova de sinal individual; nao interpretar 172 testes ou 93 IDs como cobertura de observabilidade.

O teste de QA agora aceita qualquer porta OTLP loopback nao privilegiada (1024-65535), mantendo bloqueio de endpoint remoto. Isso permite usar 4319/4321 quando 4318 esta ocupado, sem conectar ao Collector compartilhado.

### Estado e proxima troca

SHA de main testado nesta validacao: `41f49a0aa8a8bbd3014e5bd4910d1228dbdee41a`. Nenhum deploy no DEV oficial ou PROD foi feito; o slot DEV permanece pertencente a tarefa paralela ate liberacao confirmada. A proxima publicacao DEV deve ser uma unica troca para o SHA final de `main` depois de PR/CI verdes e liberacao do slot, seguida do smoke minimo ja descrito. A aprovacao para PROD e independente e nao esta incluida. TAP-96 permanece **In Progress** e `PROD_DEPLOY_REQUIRED=YES`.

## Aditivo de certificação Pino e page_view — 2026-10-21

Este aditivo complementa o baseline `bf74eda30658a3b295f3182608491302a9bb7a63` em um clone descartável. Não reabre a ausência antiga de eventos admin/concorrência: a execução original não foi reproduzida e sua configuração/payloads não foram preservados; a execução posterior 41f49a0 já encontrou 451/451 sinais daquela amostra. A correção desta fase trata somente os 12 grupos repetidos de `ui.page_view` e a rastreabilidade dos artefatos QA.

### Pino → Collector → Elasticsearch

Com ES 8.17.0 e Collector Contrib 0.130.1 descartáveis, rede Docker privada e OTLP somente no loopback, foram executados `buildApp()` e o singleton Pino reais da aplicação sob `@elastic/opentelemetry-node`, não um produtor OTel substituto. `info`, `warn` e um erro HTTP 500 controlado chegaram pesquisáveis em `logs-technical.otel-dev`; os campos carregaram namespace DEV, release completo `bf74eda30658a3b295f3182608491302a9bb7a63`, request/correlation IDs e contexto sintético de tenant/ator quando disponível. A rota anônima teve tenant `system` e ator `anonymous`; uma segunda execução via `runWithTelemetryContext` carregou tenant/ator sintéticos. O marcador sintético de senha no campo redigido foi indexado como `[REDACTED]`. As consultas por probe acharam um `info`, um `warn` e um erro controlado; o escopo OTel foi `@opentelemetry/instrumentation-pino`.

Um `emitAuditEvent` sintético, no mesmo runtime/exportador, apareceu uma vez em `logs-audit_system.otel-dev` com `event.category=audit`. Assim, no ensaio atual não houve duplicação entre os dois caminhos de emissão. Evento de auditoria usa dataset `audit_system`/categoria audit; log técnico Pino usa dataset `technical`/escopo Pino. Uma ocorrência não estabelece exactly-once geral.

Não foram fornecidos dados pessoais ou comerciais. O resource detector EDOT acrescentou metadados do host, incluindo `host.name`, `host.id`, processo e SO; o ensaio não prova ausência de identificadores de máquina. Antes de publicar, o responsável deve decidir se mantém o detector de host ou configura detectores permitidos (por exemplo `env,process,os,serviceinstance`) no processo da aplicação e validar a mudança em pacote próprio. Nada foi alterado no serviço compartilhado.

### Duplicidade `ui.page_view`

A comparação preservada do run de 451 descreve 12 grupos iguais por ação, página, requestId e correlationId, com timestamps iguais ou separados por 1 ms; os `_id` e payloads brutos desses 12 grupos não foram preservados, portanto não é possível comparar cada ID/transporte retroativamente. A inspeção do único callsite (`AuditTracker.tsx`) encontrou efeito por `pathname/search` sob React `StrictMode`. O build exato `NODE_ENV=test`, servido por preview loopback, foi reproduzido antes da correção: uma abertura de `/login` enviou duas ações idênticas no mesmo POST de lote, antes de Collector/Elasticsearch. HMR de Vite não foi usado como prova. Isso confirma emissão repetida no efeito de origem para o mesmo location key nesta configuração.

Correção: o tracker guarda a última chave de navegação do React Router; replay do mesmo efeito é suprimido, enquanto outra chave continua emitindo uma nova página. O build pós-correção emitiu um `page_view` de `/login` e um para uma nova rota ao navegar para `/forgot-password`; PWA-S02 também afirma 1 para `/login` e 1 após navegar a `/operacao/comandas`. O teste existente `PWA-S02` agora afirma exatamente um `/login` na requisição à API de auditoria e manteve suas verificações offline. O PWA-S02 focado passou uma vez após a alteração do tracker; uma segunda execução, após a instrumentação dos IDs no fixture, passou em 4/4 projetos (desktop, mobile, tablet e TV). `npm run ci` local também passou; o gate remoto de sete checks do PR permanece necessário.

### Rastreabilidade dos artefatos e alcance

O fixture de release agora grava `x-request-id` e `x-correlation-id` recebidos em cada resposta API, inclusive nos registros do helper `Api.call`, mantendo a redação existente e sem guardar corpo livre adicional. Isso habilita junção futura entre operação funcional e documento pesquisável. Os JSON antigos não têm esses campos; não foram reescritos nem tratados como se os IDs pudessem ser inferidos.

| Prova | Status | Limite |
|---|---|---|
| Pino real → OTLP → Collector → ES | Comprovado em stack descartável | Não prova serviço compartilhado/DEV oficial, volume, alerta real ou ausência de metadados do host. |
| Redação do marcador sintético | Comprovada | Não substitui revisão do schema de todos os campos de log. |
| Separação audit vs técnico | Comprovada no probe | Uma emissão audit encontrada não prova exactly-once global. |
| Causa dos 12 `page_view` | Duplicação na origem reproduzida pelo StrictMode/mesmo location key no build de QA | Evidência histórica de 12 grupos sem `_id` bruto; não há atribuição de cada documento antigo ao efeito. |
| Correção da UI | Comprovada em build e teste Playwright focal; gate final no CI pendente | A ingestão de `page_view` pós-correção no Elasticsearch não foi necessária para provar que a requisição de origem deixou de duplicar, mas permanece validável no smoke DEV autorizado. |
| Correlação por chamada QA | Alteração implementada no harness | Evidências anteriores seguem sem correlation IDs. |
