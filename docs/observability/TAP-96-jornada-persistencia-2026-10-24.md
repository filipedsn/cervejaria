# TAP-96 — identidade, payload e confirmação da persistência

## Escopo desta entrega

Base inicial: `origin/main` c68cd9d3. Branch `feat/tap96-journey-persistence`. O proprietário realizou a segregação durante esta entrega: **PC local é DEV; VPS Hostinger é produção**. O DEV não depende de DNS público nem do antigo tunnel. Este documento descreve a instrumentação; a reconstrução local, o alinhamento dos papéis e a inspeção somente leitura da produção oficial estão em [validação operacional](TAP-96-validacao-operacional-2026-10-24.md). A aplicação na VPS não foi publicada por esta entrega. Relatórios antigos de namespace PRD no PC são históricos e não certificam a VPS.

## Correções

- Eventos recebem `event.id` e horário de ocorrência UTC. As duas saídas existentes Pino/OTel compartilham o mesmo ID; duas cópias de transporte não devem contar como duas ações.
- O cliente encaminha `X-Interaction-Id` da ação marcada `data-audit` às chamadas iniciadas no mesmo turno do navegador, incluindo microtasks de mutations. Cada HTTP mantém seu próprio correlation ID. O servidor valida UUID e propaga a interação em auditoria, logs e spans. O header é somente uma referência de investigação; não autentica nem seleciona tenant.
- Operações Prisma usam query extension, preservando PrismaPromise e transações em lote. As escritas de modelos emitem `db.write.completed`, sem SQL, parâmetros ou resultado completo. Leituras rápidas não geram um evento adicional por query. Operações do cliente transacional também são observadas.
- Auditoria de sucesso emitida dentro de `$transaction` fica em memória até a confirmação do commit. Rollback descarta sucessos; métricas de negócio envolvidas seguem a mesma regra. `db.transaction.committed` confirma conclusão; `rolled_back` identifica callback rejeitado; `not_confirmed` evita afirmar rollback quando o erro pode ocorrer durante o COMMIT. Transações raiz independentes dentro de um callback não devem ser usadas como parte da mesma unidade de negócio.
- `cervejaria.id` e `actor.*` conservam o contexto autenticado. `target.cervejaria.id` deriva do registro retornado pelo banco quando disponível, permitindo distinguir o ator administrativo da empresa afetada. Payload não sobrescreve esses campos.
- Payload HTTP segue allowlist de IDs, itens/opcionais, quantidades, valores, enums e flags. Dados pessoais, textos livres, credenciais e idempotency keys não entram. Limites: 20 itens por lista, 6 níveis e 200 valores visitados. `metadata.payloadPolicy` informa omissões/truncamento e identidade não validada da entrada. Payloads sem campos permitidos não comprovam ausência de entrada.
- Redação de auditoria cobre variantes de token/API key, documentos, nomes genéricos e observações, credenciais em strings, profundidade e tamanho. Não se captura corpo de resposta completo.
- Fila UI é limitada a 500 eventos, tem um envio por vez, repete falhas transitórias e descarta eventos ao trocar sessão ou receber 401. Um envio antigo não recoloca eventos na sessão nova. Eventos sem sessão não são reatribuídos ao próximo operador.
- Resposta HTTP 200 com JSON inválido gera um único terminal `invalid_response`, em vez de sucesso enganoso. A duração de JSON bem-sucedido inclui leitura e decodificação da resposta; não equivale ao término de renderização.
- Polling continua fora da auditoria HTTP de sucesso, mas preserva tenant/ator para sinais técnicos e persistência.
- Ops Panel permite filtro por interação e exibe evento, transação, estado, empresa afetada e payload permitido. Reaplica uma política de campos aos documentos históricos antes de devolvê-los ao navegador; nunca retorna metadata inteira ou texto bruto de logs. Filtros de tenant/ator cobrem as variantes existentes nos streams audit e technical.

## Matriz de cobertura desta mudança

| Jornada | Sinais reutilizados e ampliados | Validação necessária |
|---|---|---|
| Login e troca de operador | auth existente + isolamento da fila UI | Testes de sessão e de 401/relogin; conferir versão publicada no DEV |
| Caixa, venda, comanda, pagamento e estorno | HTTP + eventos semânticos existentes + receipts de escrita + transação | Prova PostgreSQL commit/rollback/batch; regressão de jornadas |
| Cozinha e estoque | contexto mesmo em polling + escritas/transações + HTTP de mutação | Regressão de regras, UI e realtime; prova de ingestão na release |
| Portal QR/PDV | ator da sessão assinada existente + resumo seguro dos itens enviados + persistência | Regressão de sessão concorrente staff/cliente; ingestão por tenant |
| Administração | ator global + tenant alvo obtido do resultado persistido | Conferir operações cujo select não retorna id/cervejariaId; não inferir alvo de texto enviado |
| Permissões negadas | sinais auth/HTTP existentes; não há receipt de escrita inexistente | Testes RBAC e consulta no Elastic |
| Assíncrono/realtime | instrumentação existente preservada | Não afirmar entrega de evento Socket ou execução durável de job a partir de receipt HTTP |

Esta matriz descreve o alcance da instrumentação compartilhada. Não substitui a matriz finita de casos e não representa certificação de toda jornada no DEV oficial.

## Investigação

1. Selecionar ambiente e janela curta no Ops Panel; filtrar empresa e operador. Para ações administrativas, a empresa afetada pode diferir da empresa do ator.
2. Partir de interactionId quando existir; abrir correlationId e requestId de cada chamada. `clientTimestamp` é informação enviada pelo navegador, não um relógio confiável de auditoria.
3. Separar `ui.*`, `http.*`, `transacao.*`, `db.write.completed` e `db.transaction.*`. Eventos diferentes da mesma correlação são etapas, não duplicatas.
4. Para transação explícita, exigir `db.transaction.state=committed` e conferir entidade. Um receipt isolado informa conclusão da query, não confirmação de uma unidade de negócio maior.
5. Usar `event.id` para deduplicar cópias de transporte. Dados antigos sem esse ID não permitem a mesma garantia.
6. Usar `deploy/observability/es-query-journey-evidence.json` no stream do ambiente correto, substituindo o placeholder. Trocar o filtro por `attributes.interactionId` para reunir chamadas de uma ação. Conferir mappings efetivos antes de adaptar campos; não adicionar `.keyword` automaticamente.
7. Consultas do Ops Panel têm limite de 200 eventos; reduzir período/filtros quando atingi-lo. Payload é um subconjunto permitido; campos omitidos ou truncados não devem ser interpretados como valor original.

## Confiabilidade, alertas e custo

Manter os SLOs e regras existentes de `deploy/observability/sli-slo.yml` e `kibana-alert-*.json` como base versionada; sua existência não prova ativação nem entrega de notificação. Não introduzir IDs de operador, interação ou transação em dimensões métricas.

Antes de ativar a release: medir volume de `db.write.completed` por 24h, bytes/evento, atraso e falha de exportação. Estimar armazenamento por taxa medida × retenção × réplicas e overhead observado. Manter auditoria necessária independente do sampling de traces. Não reduzir retenção em produção sem decisão explícita.

Monitorar separadamente erros técnicos de banco, recusas de negócio e transações sem confirmação. Rollback funcional não deve virar alerta de indisponibilidade indiscriminadamente. Validar firing/recovery e destinatário autorizado antes de habilitar novos alertas. Falta de tráfego não comprova falha da coleta: cruzar heartbeat/métricas e tráfego esperado.

## Limites e promoção

- Telemetria continua best effort. A fila pós-commit não é outbox durável; uma queda do processo entre commit e publicação pode perder emissão. TransacaoLog permanece a fonte persistida para os fluxos que o gravam. Não há alegação de exactly-once ou trilha imutável para todas as entidades.
- Interações após tarefas/awaits posteriores não herdam automaticamente o clique; não usar janela global longa que atribuiria polling ao clique anterior. Nem todos os controles possuem data-audit. Uma expansão por jornada exige instrumentação explícita e prova.
- Não são adicionados snapshots universais antes/depois: isso exigiria leituras e política específica por entidade. Usar os eventos semânticos existentes e os campos permitidos, distinguindo entrada de resultado persistido.
- Consultas raw não têm interpretação automática de escrita, entidade ou payload; mantêm sinais técnicos. Erros durante COMMIT exigem reconciliação por chave de negócio antes de repetir operações.
- DEV observado em 24/10: `77a466829b8a9a84da0aad4b0a02b0ac6680e379`, três commits exclusivos em relação à base main (modal e consulta de comandas encerradas). Não substituir essa versão por uma branch sem essas mudanças. Integrar pelo fluxo de PR antes da troca oficial.
- No diagnóstico inicial, a consulta Elastic respondeu 401. Depois o usuário autorizou uso em memória da credencial do container e descarte do histórico OTel. Consultar a avaliação operacional para o estado posterior; a prova DEV deve identificar o SHA publicado. Credenciais não são impressas nem gravadas.
- Segregação física foi realizada pelo proprietário: PC DEV e VPS PROD. O collector local descarta sinais de produção. A inspeção da VPS encontrou os exportadores OTEL desativados, sem streams de aplicação nem regras; a ativação/promoção na produção oficial permanece pendente de autorização e implantação próprias. Backup de observabilidade não deve ser confundido com o backup Postgres já configurado na VPS.

## Testes e rollback

Executar em backend: `node scripts/run-tap96-persistence-disposable-qa.mjs`. O runner cria PostgreSQL 17 descartável em tmpfs, somente loopback 55439–55449, senha aleatória e labels de ownership; remove somente seu container ao final. Cobre commit, rollback, batch PrismaPromise, erro no lote e concorrência entre tenants.

Também executar testes frontend, backend, Ops Panel e `npm run ci` no SHA candidato. Atestado sobre o SHA base com alterações locais não substitui atestado do commit final. Regressões de release devem identificar o commit e os casos executados.

Não há migration de banco nesta mudança. Rollback consiste em republicar a release anterior pelo procedimento do ambiente; não apagar registros. Eventos novos permanecem no Elastic sob a retenção existente. Reduzir geração de sinais somente por decisão explícita e após medir impacto; não desligar auditoria para esconder falhas.
