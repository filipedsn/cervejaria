# TAP-96 — jornadas finitas e validação integrada isolada

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
