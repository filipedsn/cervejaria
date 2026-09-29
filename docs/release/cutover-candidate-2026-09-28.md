# Avaliação de cutover para a versão de Dev — 28/09/2026

## Atualização operacional — 29/09/2026

**Decisão: NO GO. O cutover não começou.** O túnel `cloudflared` permanece ativo, o endpoint público de readiness de Produção responde HTTP 200, e nem a aplicação nem o banco produtivo receberam deploy ou migrations. Não desligar o túnel enquanto os gates abaixo estiverem abertos: isso causaria indisponibilidade sem uma release aprovada para entrar no lugar.

- O banco Dev já contém 80 migrations aplicadas. O banco de Produção contém 56 aplicadas e 24 pendentes; a limpeza anterior de Dev não explica a divergência. A árvore candidata é `faa2c53fa70f0b2bc8506de437bc9f0b52d78d83`, executada com Node 24.18.0.
- Um **backup de ensaio, ainda com Produção online**, foi gerado em `deploy/backups-production/cutover-rehearsal-20260928/backup-prod-2026-09-28-232439.sql` (5.912.708 bytes, SHA-256 `d8fb667fbe0483dac998e0ea0ca765c60f9c7a8424ee0d523a8bf70521fe833f`). A cópia no destino externo configurado apresentou o mesmo hash. Isto **não** é o checkpoint final de corte; a sincronização efetiva para a nuvem também não foi comprovada.
- O dump foi restaurado em duas bases isoladas. Na primeira, as 24 migrations foram aplicadas e o backfill de 158 clientes concluiu sem erro. A segunda guarda o estado anterior para ensaio de volta. As quatro empresas tiveram contagens de usuários, clientes, eventos, comandas, itens, pagamentos, taps, turnos, saldos e movimentos preservadas; a soma paga por empresa não mudou. Os 36 produtos antigos constam no mapa de migração, sem referências órfãs observadas. Os dados de ensaio continuam isolados e não atendem clientes.
- O candidate imutável foi montado em `C:\TAPRC\faa2c53fa70f0b2bc8506de437bc9f0b52d78d83`, com 296 arquivos, checksum/varredura de segredos aprovados. O teste do gerador de release passou 11/11. As correções locais do preparador para Node 24 ainda não foram incorporadas ao SHA candidato; uma release final deverá congelar e recertificar o SHA efetivamente publicado.
- A certificação completa de Dev `TAP-CERT-20260929-022419-faa2c53` terminou **FAIL**: 34 falhas no relatório QA consolidado, 19 falhas e 18 testes não executados no navegador, além de HTTP 401 na verificação Elastic. Há falhas em portal, cozinha, estoque, autenticação, tela de configuração de modo e fluxo de PDV; não há evidência para dispensá-las. Evidência: `artifacts/certification/TAP-CERT-20260929-022419-faa2c53/summary.json` e logs do mesmo diretório.
- Continuam pendentes: investigar/corrigir as falhas e recertificar; provar os gates da bridge em Produção; ensaiar rollback integral com a release antiga; inventariar/copiar uploads, configuração e artefatos anteriores; confirmar cópia externa recuperável e resolver ou contornar formalmente a falha da tarefa agendada de backup; acordar janela e pausa operacional com as duas empresas. Só então bloquear escritas, parar o túnel no instante previsto e criar o **checkpoint final congelado**.

### Evidências adicionais — 29/09/2026

- QA aprofundada no Node 24: **414 aprovados, zero falhas e zero alertas** (1 cenário intencionalmente ignorado). Playwright do modelo operacional, executado com a API e o frontend no mesmo host Dev: **18/18 aprovados**, cobrindo venda com opcionais/estoque, os dois modos e as 16 combinações de modo × torneiras/estoque/cozinha. Unit tests do backend: **176 aprovados, zero falhas, 2 ignorados**; contratos de release: **11/11**. Build TypeScript do backend passou.
- A certificação ampla `TAP-CERT-20260929-030019-faa2c53` permanece **FAIL** e não é aprovação final: QA/API passou, mas Playwright executou chamadas de setup em `localhost:3102` e usou a interface `localhost:5202` (proxy para `localhost:3002`), resultando em cookies de host diferente e sessões redirecionadas ao login. Há também testes antigos de UI que ainda esperam textos de diálogos que mudaram. A verificação Elastic retornou HTTP 401 por credenciais ausentes. Deve-se recertificar depois de congelar o SHA, com hosts de browser/API coerentes e contrato visual atualizado; não mascarar esses itens.
- Os três gates **read-only** da bridge foram repetidos contra Produção e passaram após corrigir a referência Prisma legada (`configuracaoOperacao`, mapeada para `quiosque.ConfiguracaoQuiosque`): configuração operacional `4/4` materializada, modos não materializados `0`, PDVs ativos `3/3` com capacidade de caixa explícita, fallback pendente `0`; ambos os dry-runs indicaram `eligible=0`, `errors=0`. Nenhum backfill, migration ou escrita foi executado em Produção. Falta ainda o gate de telemetria/smoke que depende de Elastic autenticado e jornada autorizada.
- `npm run ci:validate` compilou o frontend e gerou seus artefatos, mas `prisma generate` não pôde substituir o engine Windows porque estava bloqueado por processos Dev/Prod em execução (`EPERM` ao renomear `query_engine-windows.dll.node`). O build TypeScript backend foi executado e passou; regeneração limpa do Prisma Client deve ocorrer em worktree/host isolado ou após janela segura.
- A árvore de trabalho ainda contém alterações não commitadas; o SHA `faa2c53...` não representa o conteúdo atual e nenhum artifact final pode ser publicado a partir dele. Produção segue sem alterações e o túnel continua ativo.
- Ainda NO GO: certificação final do SHA imutável; credenciais Elastic somente leitura e prova PROD exigida; restore demonstrado fora do host; pacote completo (uploads, configuração/runtime e release antiga independente); ensaio da versão antiga no restore pré-migration e RTO; correção/alternativa validada da tarefa agendada; janela e confirmação operacional para o turno aberto do Churrasquinho e evento aberto da CIA Marítima.

### Revalidação técnica — 29/09/2026

- Após corrigir a navegação de um teste que ainda usava `page.goto` durante a ativação do service worker, o teste isolado passou e a suíte E2E completa passou **103/103** no ambiente isolado (API em `127.0.0.1:3102`, frontend em `127.0.0.1:5212`). Isso atualiza o resultado dos testes de interface citados acima; não substitui a certificação completa nem resolve o gate de Elastic.
- QA/API repetido: **414 aprovados, 0 falhas, 0 alertas** (415 casos; 1 intencionalmente ignorado; total aprofundado 424 aprovados, 0 falhas, 1 ignorado). Testes unitários: **177 aprovados, 0 falhas, 2 ignorados**. Builds de deploy do frontend e TypeScript do backend passaram; schema Prisma validado. Testes dos contratos de deploy **11/11**, contratos do gerador de release **11/11** e guarda de escrita em Produção **3/3** passaram. Node usado: 24.18.0.
- `prisma generate` foi tentado após a validação do schema e falhou com `EPERM` ao renomear `query_engine-windows.dll.node`, bloqueado por um processo do Dev compartilhado. Os serviços QA isolados nas portas 3102/5212 foram encerrados; os serviços compartilhados 3002/5202 permaneceram ativos. Não interromper o Dev compartilhado para liberar o arquivo.
- `git diff --check` não apontou erros de whitespace. A árvore permanece modificada e não commitada (HEAD continua `faa2c53fa70f`); logo, os testes ainda não certificam um SHA imutável para publicar. Nenhum commit, push, deploy, migration ou escrita em Produção foi feito nesta revalidação.

### Avanço dos gates de recuperação — 29/09/2026

Esta seção atualiza os itens de backup, pacote anterior e rollback citados acima; **não altera o NO GO**.

- Novo backup online de Produção: `deploy/backups-production/cutover-predeploy-20260929/backup-prod-2026-09-29-014736.sql`, 5.912.708 bytes, SHA-256 `24B53C1FED6B7ADBF46AE6E0F56B1FF308600CBB8E55FE5D71AD2D7A93F3EE1B`. Como foi feito com o serviço ativo, é ensaio, não checkpoint final.
- Cópia do dump em `OneDrive\Quiver\Tap Quiver\Backup banco\PRD\cutover-20260929\backup-prod-2026-09-29-015527.sql`, 5.912.708 bytes, SHA-256 `9d95afb84656cd081547fd44515fe0ad22cd3c636e8dea84cdb1262cbe97e24c`. O restore dessa cópia local passou: 56 migrations aplicadas, 24 pendentes exatas do candidato, zero falhas. O cliente OneDrive está bloqueado por uma tela de revisão/aceite de termos; **a sincronização remota ainda não foi comprovada**, portanto não chamar esta cópia de off-host confirmado.
- Também foram copiados para a pasta local sincronizada os 18.293 arquivos dos artefatos anteriores (449.010.904 bytes), conferindo contagem/tamanho e hash do manifesto; os 2 uploads (75,4 KB) também conferem. A configuração de Produção foi preservada apenas no backup local restrito e verificada por hash; não foi enviada em texto aberto ao OneDrive. O estado local do alert poller também foi copiado. Precisamos comprovar destino remoto seguro para os dados de recuperação antes do GO.
- Ensaio de rollback: a release anterior `c55abc0a6d96fb2659d4ee32c214a21d3c56bf1a` foi iniciada no loopback `127.0.0.1:3311`, apontando para a cópia restaurada pré-migration, e `/api/ready` respondeu `ready`. Duração total medida: 27,038 s, incluindo restore (1,478 s) e startup/readiness. Banco temporário removido; Produção não foi tocada. Relatórios: `deploy/restore-drills/restore-drill-20260929-050929.json` e `deploy/restore-drills/rollback-drill-20260929-050929.json`.
- Pacote anterior, uploads e rollback estão agora comprovados localmente. A tarefa agendada `QuiverTap-ProdBackup` continua apontando para um workspace removido e sua última execução falhou; tentativa de reparo sem elevação foi negada. O script manual local + cópia + checksum funciona, mas o fallback precisa ser formalmente aceito e a sincronização remota comprovada, ou a tarefa corrigida com privilégio apropriado.
- Verificações deste avanço: backend unit **177 pass / 0 fail / 2 skip**; build frontend passou (avisos de chunk grande e import misto), build backend de deploy passou; gerador de release **11/11**; helper de restore **6/6**; `git diff --check` limpo. O rollback reporta somente o SHA anterior: ainda falta commitar, congelar e certificar a candidata atual em um SHA Node 24.

**Bloqueios restantes para deploy:** árvore ainda sem commit/SHA imutável e recertificação integral desse SHA; ciente operacional/pausa autorizada e decisão sobre o turno aberto do Churrasquinho do Thiago e o evento aberto da CIA Marítima; sincronização remota segura e solução/fallback aprovado para a tarefa de backup; confirmação do operador para a janela de corte. Até resolver tudo, não parar o túnel compartilhado nem iniciar migration/publicação. O próximo backup deverá ser um checkpoint final após congelar escritas.
- Decisão permanece **NO GO** pelos gates operacionais e de recuperação ainda pendentes acima, além da geração limpa do Prisma Client e recertificação do SHA congelado. Produção/readiness e túnel compartilhado não foram alterados.

### Backup e restore do último checkpoint de ensaio — 29/09/2026

- Novo `pg_dump` via fluxo versionado para Produção: **5.912.708 bytes**, SHA-256 `9d95afb84656cd081547fd44515fe0ad22cd3c636e8dea84cdb1262cbe97e24c`. A cópia no caminho local do OneDrive foi criada e o fluxo conferiu tamanho/hash (`offHostChecksum=PASS`). Ainda não há prova de sincronização na nuvem: o OneDrive web exige revisão dos Termos de Serviço, que só o usuário pode aceitar; o browser não confirmou a presença do arquivo remoto.
- O restore drill inicialmente falhou por tratar as 24 migrations futuras como erro. Corrigi o contrato: a lista do Prisma agora só é aceita como `EXPECTED_PENDING` quando coincide exatamente com as pastas ainda não aplicadas, não existem migrations incompletas nem histórico desconhecido; acrescentei seis testes Pester (6/6). O dump anterior de ensaio restaurou em **1,428 s**, validou schemas/tabelas/contagens e registrou 56 migrations aplicadas, 24 pendentes, zero falhas; a base temporária foi removida. Relatório: `deploy/restore-drills/restore-drill-20260929-045348.json`.
- A tarefa `QuiverTap-ProdBackup` aponta para o workspace antigo `Cervejaria-tap33-dev-final4` e falhou com `4294770688`. Exportei a configuração antiga sem senha para o diretório privado de backup, mas `Set-ScheduledTask` retornou acesso negado; não alterei a tarefa. O procedimento manual versionado de backup local + cópia/hash para OneDrive passou, mas é preciso confirmar o acesso web e, idealmente, corrigir a tarefa com elevação antes de declarar automação recuperada.
- No restore drill, a base de Produção recebeu apenas databases temporários nomeados `cervejaria_restore_drill_*`; todos os temporários dos drills que falharam foram identificados pelo nome e owner e removidos. O último drill removeu sua base ao concluir PASS. Nenhuma migration foi aplicada nem houve escrita no database produtivo `cervejaria`.
- Permanecem NO GO: validar a cópia off-host via web; backup completo e seguro de artefatos/configuração/uploads; regeneração Prisma limpa sem interromper Dev; recertificar e congelar SHA; ensaio de rollback integral; telemetria Elastic; janela operacional e encerramento/pausa autorizados dos contextos abertos; elevação Windows para terminar alert poller e executar o deploy.

Documento de análise e plano. Na avaliação inicial de 28/09, as consultas ao banco foram somente leitura. Os números iniciais abaixo são uma fotografia e devem ser repetidos imediatamente antes da janela; a seção de atualização acima registra os ensaios posteriores, sem migration, deploy ou alteração no banco produtivo.

## Decisão proposta

Usar a história completa do banco atual, aplicar as migrations versionadas e publicar os artefatos da mesma árvore de código validada em Dev. Ensaiar primeiro em uma cópia isolada de Produção. Uma instalação vazia com importação seletiva de dados acrescentaria mapeamento de IDs, reconstrução de relações e conciliação de pagamentos sem reduzir o risco desta release.

**Estado atual: NO GO para Produção.** Faltam backup completo restaurado em ensaio, prova de execução das 24 migrations sobre cópia atual de Produção, rollback ensaiado e certificação aprovada do SHA final. A tarefa agendada de backup de Produção teve resultado de erro na última execução. O documento `bridge-operational-migration.md` ainda registra as portas de Produção para liberação da remoção física como pendentes; é preciso comprovar que foram cumpridas ou publicar primeiro uma etapa de compatibilidade.

## Base observada

| Item | Evidência em 28/09/2026 |
| --- | --- |
| Release publicada | Manifest `c55abc0a6d96fb2659d4ee32c214a21d3c56bf1a`; `/api/ready` e `/` responderam 200. |
| Código candidato | `faa2c53fa70f0b2bc8506de437bc9f0b52d78d83`; é descendente do `origin/main` atual, mas ainda não há candidate retido em `deploy/release-candidates/`. |
| Banco | PostgreSQL 16, banco `cervejaria`, cerca de 18 MB, quatro empresas, 56 migrations aplicadas, três registros revertidos e nenhuma migration incompleta. O candidato tem 80 diretórios de migration: 24 ainda não aplicados em Produção. |
| Backups | Nenhum `backup-prod-*.sql` em `deploy/backups/` nem `deploy/backups-production/`. Existe um dump feito pelo painel em `deploy/prod-artifacts/backend/data/backups/` (5,8 MB, 27/09); não há evidência de restore validado dele. A tarefa `QuiverTap-ProdBackup` terminou em `0xFFFD0000` na última execução observada e não deixou o log esperado. A causa do erro não foi estabelecida. |
| Arquivos | `backend/uploads-prod/` contém dois arquivos de logo, cerca de 77 KB. O frontend e backend publicados existem, mas `prod-artifacts.previous` não contém os artefatos necessários para rollback antes do próximo publish. |
| Certificação | O último relatório completo encontrado foi do SHA `b7dcab3`, com status `FAIL`; é anterior ao candidato `faa2c53`. O resultado não prova que o candidato falha, mas também não o certifica. |

### Empresas prioritárias

| Empresa | Situação observada | Transformação necessária |
| --- | --- | --- |
| Churrasquinho do Thiago | Configuração CAIXA; 164 comandas de origem `QUIOSQUE` (147 fechadas, 17 canceladas), 34 produtos `quiosque.ProdutoQuiosque`, cinco cardápios antigos com 89 vínculos de produto, 28 turnos (um aberto), 31 saldos de estoque, nenhum cliente cadastrado. | Preservar IDs dos 34 produtos na tabela canônica, preços e vínculos de itens; converter origem histórica para `CAIXA`; transportar cardápios e referência dos turnos; preservar saldos, movimentos, pagamentos e histórico. Validar o turno aberto antes da janela. |
| CIA Maritima | Configuração EVENTO; 24 eventos (um aberto), 443 comandas (430 fechadas, 11 canceladas, duas abertas), 11 produtos canônicos, um cardápio, 156 clientes, cinco taps. | Preservar eventos, recorrência, cardápio, clientes, montagens, comandas e pagamentos. Confirmar que o evento aberto continua íntegro e que EVENTO permanece o modo efetivo. |

As outras duas empresas também são parte do mesmo banco e precisam passar pelas conferências globais. No banco inteiro há 36 produtos antigos, 526 itens de comanda que os referenciam, seis cardápios antigos, 90 vínculos de cardápio, 605 itens de cardápio de turno e seis turnos vinculados a cardápio antigo. Consultas de preflight encontraram **zero** colisões de ID entre produto antigo e canônico, **zero** referências duplas conflitantes de item, **zero** colisões nos IDs previstos para cardápios migrados e **zero** relações cruzadas entre empresas nas associações examinadas. Isso reduz riscos conhecidos, mas não substitui a execução de ensaio.

## Pontos técnicos que mudam o plano

1. As migrations `20260924120000`, `20260924183000` e `20260924190000` copiam produtos antigos para `public.Produto`, redirecionam chaves estrangeiras e removem `quiosque.ProdutoQuiosque` e `ItemComanda.produtoQuiosqueId`. A remoção torna um rollback apenas de código incompatível com o banco migrado.
2. A migration `20260927180000` copia os cardápios antigos para `public.Cardapio`, atualiza os turnos e remove as tabelas e o campo antigo de cardápio. Há cinco cardápios do Churrasquinho a reconciliar. As migrations posteriores incluem variantes de volume de chope e mudança de precisão do estoque.
3. O `prod:deploy` atual gera um dump **antes** de parar a API e o poller. O script de dump de produção não cria SHA-256, não copia para fora do host e não testa restore. Para RPO zero durante a janela, o último snapshot deve ocorrer depois de bloquear novas escritas e concluir transações em curso.
4. `prod:rollback` troca artefatos, mas não restaura o banco. Se uma das 24 migrations falhar ou a release anterior precisar voltar após as remoções, restaurar o banco inteiro a partir do checkpoint validado é obrigatório. Preservar uma cópia independente e íntegra de ambos os artefatos publicados: o ponto `.previous` pode ser parcial se o publish falhar.
5. O backup pelo painel reside em `prod-artifacts/backend/data/backups`. O publish move esse diretório junto com a API e o próximo publish remove o ponto `.previous`; esses dumps não podem ser o único meio de recuperação.
6. O script de restore drill existente exige que `prisma migrate status` passe contra as migrations da árvore em execução. Para validar o snapshot **antes** da migração, executá-lo com a árvore compatível com o schema de Produção ou ajustar o ensaio para distinguir corretamente as 24 pendências; executá-lo diretamente da árvore candidata pode produzir falha esperada.
7. O preparador de candidate retido exige Node 20, enquanto o projeto declara Node 24 como baseline atual. Resolver e testar essa divergência antes de considerar o artefato pronto. Build e testes devem se referir à mesma árvore/SHA que será publicada.
8. O runbook de bridge documenta `PROD=PENDING_PROD` e bloqueia a remoção física até comprovar bridge, backfills, reconciliação e fallback exercitado zero. O estado observado no banco já tem as flags de modo e recursos preenchidas e os pontos de venda ativos com `usaCaixa` explícito, mas isso não comprova os gates de telemetria e smoke. Registrar evidências faltantes; se não existirem, separar uma release de compatibilidade antes da candidata.

## Backup completo exigido

Criar um conjunto de recuperação **identificado pelo SHA de origem e timestamp** depois do bloqueio de escritas. Mantê-lo fora do diretório publicado e em uma segunda localização fora do host, com acesso restrito e criptografia. Registrar tamanho, SHA-256 e resultado de leitura/restore de cada componente. Não gravar credenciais ou dados de clientes em Git, tickets ou relatórios.

| Componente | Conteúdo mínimo | Prova |
| --- | --- | --- |
| Banco | Dump consistente de `cervejaria` com schemas `public` e `quiosque`, `_prisma_migrations`, funções, constraints e dados; versão PostgreSQL; papéis/globals ou procedimento documentado de recriação; opcionalmente snapshot físico consistente do volume `postgres_data` como segunda via. | Hash local e fora do host; restauração em banco novo; contagens, somatórios financeiros e integridade por empresa idênticos ao momento congelado. Medir duração real do restore. |
| Arquivos persistentes | Árvore integral de `backend/uploads-prod/`, inclusive futuros `portal-backgrounds`; dumps administrativos que estejam em `prod-artifacts/backend/data/backups/`; `deploy/runtime/alert-poller-state.json`. | Inventário de arquivos, tamanhos e hashes na origem e no destino. |
| Release anterior | Cópia independente de `deploy/prod-artifacts/frontend`, `backend` (inclusive Prisma, package/lock e runtime), manifest, SHA da árvore e dependências necessárias. | Hashes conferidos; backend e frontend antigos iniciam sobre um restore do banco anterior. |
| Configuração e host | `backend/.env.production` protegido, configurações externas necessárias, Docker Compose/versão do Postgres, metadados de volumes, tarefa de autostart e de backup, configuração do túnel/ingress e instruções para recuperar o token sem registrá-lo no relatório. Logs/recovery state são evidência operacional. | Inventário e ensaio de recuperação em ambiente privado. |

O dump atual do painel não atende sozinho a esses requisitos. A tarefa agendada deve ser investigada e uma execução completa com cópia fora do host e restore validado precisa passar. O backup de cutover deve ter retenção própria, sem poda automática durante a janela.

Para cobrir perda do PC inteiro, guardar também imagem recuperável do host ou um inventário reproduzível de Windows, Docker, volumes, serviços, tarefas e túnel, acompanhado dos instaladores/versões necessários. Uma imagem feita com PostgreSQL em escrita não substitui o dump consistente e o restore ensaiado. Definir quem guarda a cópia fora do host e quem tem acesso às credenciais de recuperação antes da janela.

## Preparação e ensaio

| Etapa | Ação planejada | Gate para avançar |
| --- | --- | --- |
| P1 — congelar release | Definir SHA/árvore exatos, revisar PR/CI, gerar frontend e backend do mesmo commit em worktree limpa; corrigir divergência Node 20/24 no fluxo de candidate; registrar checksums. | Candidate verificável, testes/CI e certificação do SHA final aprovados, sem `FAIL` ou `UNKNOWN` obrigatório. |
| P2 — baseline de Produção | Repetir inventário das quatro empresas, modos, clientes, eventos, comandas, itens, pagamentos, produtos, preços, cardápios, taps, estoque, turnos, uploads e migrations. Guardar contagens e somatórios por empresa, status, origem e período. | Sem divergência preexistente relevante; destino e fontes das 24 migrations identificados. |
| P3 — bridge | Confrontar cada gate `PENDING_PROD` do runbook com evidência real. Confirmar configuração materializada, backfills idempotentes, smoke e fallback exercitado zero; se faltar a bridge, preparar uma release compatível separada. | Liberação documental e técnica da remoção física; nenhuma suposição baseada apenas nas flags do banco. |
| P4 — ensaio com dados reais | Restaurar uma cópia recente de Produção em ambiente local isolado e privado, com PostgreSQL 16; não apontá-la para Dev público. Aplicar exatamente as 24 migrations e o backfill do deploy. Iniciar o candidate contra essa cópia. | Todas as migrations `APPLIED`, sem erro ou dados órfãos; compare as invariantes abaixo e execute jornadas de ambas empresas. |
| P5 — ensaio de volta | Na cópia isolada, simular falha antes, durante e após migration/publicação. Medir restauração do checkpoint e reinício dos artefatos antigos. | RTO real registrado; hashes, contagens, autenticação e smoke da versão antiga passam. |
| P6 — janela | Definir janela sem vendas, avisar operadores e nomear responsável por decisão. Resolver o turno aberto do Churrasquinho e o evento aberto da CIA: encerrá-los normalmente quando apropriado ou provar em ensaio a continuidade segura, sempre sem transações em curso no congelamento. | Operadores confirmam pausa; nenhum escritor ativo; procedimento de bloqueio de tráfego testado. |

## Sequência de cutover

1. **T−30 a T−10:** confirmar candidate e SHA, espaço em disco, saúde da API/banco, configuração do túnel, baseline, destino fora do host, responsável e limite de tempo. Se qualquer gate preparatório falhou, não iniciar.
2. **T−10:** bloquear novas operações e escritas externas, aguardar requisições/transações em curso, parar API e poller sob controle do watchdog. Confirmar ausência de escritores. Não usar uma cópia feita enquanto vendas continuam como checkpoint final.
3. **T0:** fazer o backup completo acima; calcular e conferir hashes nas duas localizações; restaurar o dump em banco isolado e comparar as invariantes congeladas. Se a prova de restauração falhar, reabrir a release antiga sem alterar o banco.
4. **T+backup:** manter o tráfego bloqueado. Aplicar as 24 migrations em ordem com `prisma migrate deploy`, registrando saída e estado de `_prisma_migrations`. Executar apenas os backfills previstos, verificando antes a necessidade e depois a idempotência. Não usar `db push`, `reset`, seed ou importação seletiva.
5. **T+migration:** conferir as invariantes de banco e modos de ambas empresas. Publicar frontend/backend da mesma release, validar manifest e Prisma Client, reiniciar API. Se uma migration parou no meio, não iniciar a release antiga sobre esse banco.
6. **T+smoke:** com escrita ainda bloqueada, testar readiness, login autorizado, isolamento entre empresas, páginas e dados históricos, cardápio, evento e caixa, uploads, clientes, dashboard, ranking, estoque/cozinha conforme flags. Conferir ausência de erros críticos e telemetria. Decidir **GO** ou **ROLLBACK** dentro da janela acordada.
7. **GO:** liberar tráfego gradualmente, acompanhar a primeira operação real de cada empresa e reconferir contagens/somatórios. Gerar novo checkpoint após estabilização; preservar o checkpoint anterior e os artefatos antigos pelo período de observação definido.

### Invariantes de aceitação

- Quatro empresas preservadas, mesmos IDs, usuários e permissões; CIA segue EVENTO e Churrasquinho segue CAIXA; recursos complementares não mudam sem decisão explícita.
- Para o Churrasquinho: 34 produtos antigos tornam-se 34 canônicos com os mesmos IDs; os 164 registros de comanda continuam presentes e as origens históricas tornam-se `CAIXA`; os cinco cardápios antigos reaparecem no catálogo único com 89 vínculos; 28 turnos, 31 saldos, preços, itens, pagamentos e movimentos conservam identidade e valores. Confirmar o estado do turno que estava aberto.
- Para a CIA: 24 eventos, 443 comandas, 11 produtos, um cardápio, 156 clientes, cinco taps, vínculos e valores históricos permanecem; confirmar evento aberto e jornadas de ranking/portal.
- No banco inteiro: nenhum órfão nas novas FKs, nenhum cruzamento entre empresas, nenhum preço/quantidade alterado sem regra expressa, mesmo total de pagamentos e de itens históricos por empresa. O mapa `ProdutoMigracaoMapa` deve conter os 36 vínculos antigos após a migração completa, salvo alteração justificada no inventário final.
- Validação de código: casos CAIXA e EVENTO, navegação, seleção e propagação de cardápio, opcionais, estoque, cozinha, QR/portal, dashboard por mês e ranking em Dia/Mensal/Geral e Tela cheia. Testes mutáveis devem ocorrer na cópia privada; smoke de Produção antes do GO deve ser somente leitura.

## Plano de volta

| Momento da falha | Resposta | Dados |
| --- | --- | --- |
| Antes das migrations | Cancelar, manter/restaurar tráfego e release anterior. | Banco inalterado; confirmar integridade do checkpoint. |
| Durante migration ou após uma migration sem GO | Manter escrita bloqueada e watchdog pausado. Preservar logs/recovery. Restaurar **o banco completo do checkpoint final** em destino controlado, conferir contagens e schema antigo; restaurar o pacote independente da release anterior e uploads/configuração conforme necessidade; smoke antes de liberar. | RPO zero **até T0**, pois não houve escrita após o checkpoint. `prod:rollback` sozinho é insuficiente. |
| Publish/start/smoke falhou sem GO | Mesmo procedimento, pois a release antiga não foi comprovada compatível com as remoções de tabela/coluna. | Não reabrir com banco parcialmente migrado. |
| Após GO e novas vendas | Bloquear imediatamente novas escritas, preservar banco atual e trilhas transacionais, capturar/reconciliar operações feitas após T0. Preferir correção à frente que mantenha o banco atual; restaurar T0 apenas quando houver plano comprovado para recuperar cada escrita posterior. | Sem PITR/WAL ou replay ensaiado, um restore simples apagaria vendas novas. Não prometer RPO zero após GO com os mecanismos atuais. |

O recovery state e a pausa do watchdog só devem ser liberados depois de validação do banco e dos artefatos. A meta de tempo de recuperação será definida com a duração medida nos ensaios, não estimada apenas pelo tamanho de 18 MB.

## Riscos e mitigação

| Risco | Evidência/impacto | Mitigação e parada |
| --- | --- | --- |
| Backup falha ou não restaura | Última tarefa agendada com erro; dump do painel dentro do artefato; nenhum dump oficial recente comprovado. | Backup completo fora do host, hashes e restore isolado antes de migration; falha = NO GO. |
| Contrato destrutivo impede rollback de código | Migrations removem produto, cardápio e colunas antigos. | Snapshot de banco e pacote antigo independente; ensaiar restore; não depender apenas de `prod:rollback`. |
| Dados cruzados/perdidos em catálogo | 36 produtos antigos, 526 referências, 90 itens de cardápio e 605 itens de turno. | Verificações de colisão e integridade antes/depois; comparar IDs, preços, vínculos e somatórios por empresa. |
| Mudança de modo ou operação em aberto | Um evento CIA e um turno Churrasquinho abertos na fotografia. | Escolher janela sem vendas; decidir estado dos dois contextos com operador; ensaiar continuidade se permanecerem abertos. |
| Outras empresas afetadas | Banco tem quatro empresas, migrations são globais. | Inventário, ensaio e reconciliação das quatro; smoke prioritário nas duas nomeadas. |
| Artefato diferente do Dev validado | Candidate retido ainda ausente; preparador Node 20 x baseline Node 24; último certificado disponível falhou. | Congelar árvore, resolver builder, CI e certificação sobre SHA final; falha = NO GO. |
| Escrita após GO e necessidade de restore | Snapshot T0 não inclui transações posteriores; PITR/replay não demonstrado. | Segurar tráfego até smoke; monitorar primeiras operações; preparar correção à frente. Se exigido RPO zero também após GO, habilitar e ensaiar captura/replay antes do cutover. |
| Porta de bridge não comprovada | Runbook marca PROD pendente para remoção física. | Evidenciar gates ou publicar etapa de compatibilidade antes das migrations destrutivas. |

## Instalação limpa versus migração no banco atual

Uma instalação **vazia** exigiria importar usuários, senhas, permissões, quatro empresas, eventos e séries, 607 comandas das duas empresas prioritárias, itens, pagamentos, clientes, tap/montagem, 28 turnos, estoque, cardápios e arquivos, preservando IDs e vínculos. Teria ainda de conciliar mudanças que ocorressem durante a cópia. O esforço e a superfície de erro superam os da migração versionada já prevista. **Não recomendar para este cutover.**

Uma instância temporária **nova com restore integral do banco atual** é adequada para o ensaio e pode ser opção de recuperação/isolamento, mas continua exigindo as mesmas 24 migrations, congelamento das escritas e conferência de dados. Não há benefício comprovado que justifique manter infraestrutura duplicada depois da release.

## Inventário legado preservado para análise futura

A análise anterior de Dev apontou `ProdutoOpcionalGrupo` e `ProdutoOpcional` (ambos vazios) e o campo antigo `ItemComandaOpcional.opcionalId` (sem uso nos registros observados) como candidatos futuros de limpeza. `PontoVenda.usaCaixa`, `ConfiguracaoQuiosque` e tipos `QUIOSQUE_*` ainda têm dependências de compatibilidade, script, QA ou histórico. As tabelas de pedidos, caixa e estoque sob o schema físico `quiosque` continuam em uso; `Cardapio` e `usaCardapio` são recursos ativos.

**Retificação importante:** `ProdutoMigracaoMapa` estava vazio no banco Dev, mas a migração de Produção deverá registrar os 36 produtos antigos. Manter esse mapa como prova da conversão e não incluir sua remoção neste cutover. Qualquer limpeza futura precisa de inventário e retenção histórica de Produção, não apenas de Dev.

## Fontes locais principais

- `deploy/README.md`, `deploy/RECOVERY.md`, `docs/release/bridge-operational-migration.md`, `docs/ops/restore-drill.md`.
- `scripts/prod/deploy.ps1`, `backup-db.ps1`, `rollback.ps1`, `publish-artifacts.ps1`, `restore-drill.ps1`, `rollback-drill.ps1`; `scripts/backup/backup-db.ps1`.
- `backend/prisma/schema.prisma`, migrations `20260924120000` a `20260928150000`, `backend/scripts/backfill-cliente-stats.ts`.
- `artifacts/certification/TAP-CERT-20260928-122926-b7dcab3/summary.json` (certificação anterior com status FAIL).
