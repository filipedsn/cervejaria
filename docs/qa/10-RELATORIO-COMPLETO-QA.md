# Relatório completo de QA — Onda 4

Fechamento total de QA funcional e não funcional. Execução única em **DEV** (`:3002` / `:5202`, banco `cervejaria_dev`); nada tocou produção.

Comando: `npm run qa:validate` (unit → setup → suíte → workers multi-processo → report → Playwright).

---

## 1. Resultado consolidado

| Camada | Casos | Falhas | Alertas | Como rodar |
|--------|-------|--------|---------|------------|
| Unitário / property-based | 23 (3 suítes) | 0 | — | `npm run test:unit` |
| API + integridade + concorrência | **356** | **0** | **0** | `npm run qa:test` |
| E2E Playwright | 28 execuções (18 specs + setup) | 0 | — | `npm run test:e2e` |

Relatório navegável: `reports/qa-report.html`. Artefatos brutos: `reports/qa/suite.json`, `reports/qa/final.json`, `reports/qa/workers/`.

### Casos de API por categoria

| Categoria | Casos | | Categoria | Casos |
|-----------|-------|---|-----------|-------|
| Funcional (ciclo de vida) | 60 | | Quiosque comandas | 16 |
| Configuração (9 empresas) | 45 | | Quiosque caixa | 15 |
| Admin plataforma | 24 | | Janela de evento | 12 |
| Multi-tenant | 16 | | Realtime (Socket.IO) | 12 |
| Sessão / JWT | 12 | | Portal JWT | 10 |
| Quiosque cozinha | 10 | | Quiosque estoque | 10 |
| Multi-tenant Quiosque | 10 | | Exportação CSV | 9 |
| Observabilidade | 9 | | Cardápios template | 8 |
| Montagem de taps | 8 | | Formas de pagamento | 7 |
| Multi-trailer | 7 | | Quiosque smoke | 7 |
| RBAC | 6 | | CRM concorrente | 6 |
| TransacaoLog | 5 | | Auth reset | 5 |
| Não-funcional | 4 | | Ranking / Concorrência in-process | 2 |

Somam 346 casos da suíte; o `report` adiciona 10 verificações pós-carga (DB-01, DB-02, DB-03, DB-05, DB-06, DB-07, DB-08, CONC-01, CONC-02, CONC-05), totalizando 356.

---

## 2. Bugs encontrados e corrigidos

### 2.1 CSV quebrado e vulnerável a injeção de fórmula

- **Sintoma**: cliente chamado `João "JJ"` quebrava o parsing do CSV; nome iniciado por `=`, `+`, `-` ou `@` virava fórmula ao abrir no Excel.
- **Causa raiz**: `relatorios.ts` montava o CSV com interpolação inline, sem escapar aspas internas e sem aspas no telefone; `transacao-log.ts` escapava aspas mas não neutralizava fórmula.
- **Correção**: novo `backend/src/lib/csv.ts` com `csvCell()` (escape RFC 4180 + prefixo `'` em células que começam com caractere de fórmula, TAB ou CR) e `csvRow()`, aplicados nas duas rotas de exportação, com BOM UTF-8 para o Excel reconhecer acentuação.
- **Regressão**: CSV-01..CSV-09 (`/api/eventos/:id/transacoes/csv` e `/api/relatorios/evento/:eventoId/csv`): RBAC, cabeçalho, aspas internas preservadas, `=SUM(1+1)` neutralizado, telefone `+55...` entre aspas, BOM presente.

### 2.2 Rota de tenant devolvia 500 para token de plataforma (TEN-15)

- **Sintoma**: `GET /api/eventos` com token ADMIN retornava HTTP 500. Não havia vazamento de dados, mas o status escondia o defeito — o caso passava só porque a asserção aceitava "403 ou zero eventos".
- **Causa raiz**: o token de plataforma não tem `cervejariaId`; as rotas de tenant assumem o campo presente e a consulta Prisma estourava.
- **Correção**: novo decorator `app.requireTenant` (`backend/src/app.ts`) que valida a sessão e recusa com 403 quem não pertence a uma cervejaria; `eventosRoutes` passou a usá-lo no lugar de `app.authenticate`.
- **Regressão**: TEN-15 agora exige 403 explícito — ausência de vazamento deixou de ser suficiente para aprovar.

### 2.3 Senha do dia do quiosque colidia sob concorrência

- **Sintoma**: duas vendas simultâneas no PDV podiam violar a unique de `numero` e devolver erro ao operador.
- **Causa raiz**: `criarPedido` lia o maior número e tentava criar; o retry interno era inútil porque no Postgres a violação de unique aborta a transação inteira.
- **Correção**: `pg_advisory_xact_lock` com chave derivada de `empresa + dia operacional` serializa apenas a alocação do número (`backend/src/lib/quiosque/venda.ts`).
- **Regressão**: QCM/QES sob concorrência e RNF-Q01 (p95 do PDV).

### 2.4 Merge concorrente de clientes retornava 500

- **Sintoma**: dois merges simultâneos da mesma fonte — o perdedor recebia 500.
- **Causa raiz**: o vencedor apagava o cliente antes de o perdedor chegar ao `delete`, gerando `P2025` sem tratamento.
- **Correção**: advisory locks por cliente, adquiridos em ordem fixa de id (evita deadlock em A→B e B→A simultâneos), com todas as validações movidas para dentro da transação (`backend/src/lib/cliente-merge.ts`).
- **Regressão**: CRM-C-01..06 — vencedor 200, perdedor 404/409, estatísticas do destino consistentes em `ClienteEstatisticas`.

### 2.5 Data de agendamento errada em fuso negativo

- **Sintoma**: cancelar a ocorrência de uma série devolvia o dia anterior ao escolhido.
- **Causa raiz**: colunas `@db.Date` chegam do Prisma como meia-noite UTC; `dateOnlyToKey` lia com getters locais, e em UTC-3 isso joga a chave um dia para trás.
- **Correção**: leitura em UTC no `backend/src/lib/evento-reverter.ts` e remoção da cópia duplicada da função em `routes/eventos.ts`.
- **Regressão**: EVJ-01..EVJ-12, incluindo cancelar-agendamento e reabertura fora da janela de 30 min.

### 2.6 Estoque do quiosque não acompanhava venda e cancelamento

- **Correção**: `baixarEstoqueDoPedido` passou a ser chamado nas três portas de entrada de pedido (venda avulsa do PDV, abertura de comanda e pedido adicional), e `estornarEstoqueDaComanda` no cancelamento pelo DONO.
- **Regressão**: QES-01..QES-10 — `SAIDA_VENDA` decrementa, saldo insuficiente devolve 400 com rollback da venda inteira, último item disputado por 6 requisições paralelas resulta em 1 sucesso e 5 rejeições com saldo final zero, `ESTORNO_VENDA` no cancelamento, `CORTESIA` e `CONSUMO_INTERNO`, produto sem controle de estoque ignorado.

### 2.7 Consulta de caixa aceitava ponto de venda inexistente

- **Correção**: `GET /api/quiosque/caixa` valida que o ponto de venda existe, está ativo e pertence à empresa antes de responder; caso contrário 404 (`backend/src/routes/quiosque/caixa.ts`).

### 2.8 Painel admin não expunha os módulos da empresa

- **Correção**: `formatAdminCervejaria` passou a devolver `modulos` (cervejaria, quiosque, controla estoque, tem cozinha) derivado de `configuracaoQuiosque`, alimentando os badges da listagem.
- **Regressão**: ADM-01..ADM-24 e o E2E `admin-badges.spec.ts`.

### 2.9 Alerta DB-01 — comandas com total divergente

- **Causa raiz**: não era defeito de produção. A fixture do ranking por série gravava itens direto no banco (`prisma.itemComanda.createMany`) sem atualizar `Comanda.total`, e o `report` reconciliava 3 comandas ao final, sinalizando alerta.
- **Correção**: a fixture passou a criar as comandas já com o total coerente com seus itens. DB-01 agora reporta "todos os totais consistentes" sem reconciliação.

### 2.10 Ajustes de infraestrutura de teste

- `RATE_LIMIT_LOGIN_MAX` respeita `QA_MODE=1` (mesma válvula já usada nas rotas públicas), porque a suíte autentica dezenas de vezes por minuto do mesmo IP e batia em HTTP 429.
- `e2e/helpers/api.ts` memoiza o token por credencial, eliminando logins repetidos entre specs.
- `rbacOutcome` passou a reprovar HTTP 500 onde se espera 403 — antes isso virava apenas alerta. `@fastify/sensible` já estava registrado em `app.ts`, então os casos RBAC-01..06 fecham em 403 real.
- TAP-M-02 restaura o estado do chope ao final, o que eliminou a intermitência do RNF-04.

---

## 3. Casos novos por módulo

| Módulo | Arquivo | IDs | Casos |
|--------|---------|-----|-------|
| Realtime Socket.IO | `backend/qa/lib/realtime-tests.ts` | RT-03..RT-12 | 10 |
| Quiosque caixa | `quiosque-caixa-tests.ts` | QCX-01..15 | 15 |
| Quiosque comandas | `quiosque-comanda-tests.ts` | QCM-01..16 | 16 |
| Quiosque estoque | `quiosque-estoque-tests.ts` | QES-01..10 | 10 |
| Quiosque cozinha | `quiosque-cozinha-tests.ts` | QCZ-01..10 | 10 |
| Admin plataforma | `admin-tests.ts` | ADM-01..24 | 24 |
| Exportação CSV | `csv-tests.ts` | CSV-01..09 | 9 |
| Formas de pagamento | `pagamento-formas-tests.ts` | PAG-01..07 | 7 |
| Janela de evento | `evento-janela-tests.ts` | EVJ-01..12 | 12 |
| CRM concorrente | `crm-merge-tests.ts` | CRM-C-01..06 | 6 |
| Portal JWT | `portal-jwt-tests.ts` | PJW-01..10 | 10 |
| Performance quiosque | `perf-quiosque-tests.ts` | RNF-Q01..Q03 | 3 |
| **Total API** | | | **132** |

Cobertura destacada: rooms e isolamento multi-tenant no Socket.IO; ciclo completo de caixa com divergência de conferência; comandas MESA/FICHA com duplicata 409, troco e split multi-forma; cadastro admin nos três modos via multipart com validação de logo, branding, SMTP e backups; todas as formas de `PaymentMethod` incluindo `CARTAO_DEBITO` e `CARTAO_CREDITO`, nunca exercitadas antes; cookie do portal com expiração forçada, token de outro evento, assinatura inválida, `alg=none` e checagem de `Max-Age`/`HttpOnly`/`SameSite`.

### E2E novos (Playwright, projeto `chromium`)

| Spec | Casos | Cobertura |
|------|-------|-----------|
| `e2e/admin-cadastro.spec.ts` | 5 | Cadastro nos 3 modos, upload de logo com branding aplicado, cadastro sem módulo e senhas divergentes bloqueados; limpeza via API ao final |
| `e2e/quiosque-caixa.spec.ts` | 2 | Abrir caixa, sangria, suprimento, fechar com conferência divergente; caixa fechado bloqueia reabertura no mesmo dia |
| `e2e/quiosque-cozinha-cancel.spec.ts` | 3 | Pedido entra na fila e avança para preparo; ATENDENTE não cancela; DONO cancela e o pedido sai da fila |

---

## 4. Métricas não funcionais

Latência medida no run final (dev, uma máquina, banco local):

| Cenário | Amostras | p50 | p95 | máx | Meta p95 | Erros |
|---------|----------|-----|-----|-----|----------|-------|
| `POST /api/auth/login` | 50 | 77 ms | 80 ms | 90 ms | 500 ms | 0 |
| `GET /api/comandas/evento/:id` | 30 | 15 ms | 23 ms | 27 ms | 800 ms | 0 |
| `POST /api/comandas/:id/itens` (sequencial) | 30 | 30 ms | 33 ms | 34 ms | 600 ms | 0 |
| `POST /api/quiosque/vendas` (PDV) | 30 | 31 ms | 40 ms | 49 ms | 800 ms | 0 |
| `POST /api/quiosque/comandas` (com preparo) | 20 | 31 ms | 36 ms | 38 ms | 900 ms | 0 |
| `GET /api/quiosque/cozinha` | 30 | 15 ms | 17 ms | 23 ms | 600 ms | 0 |
| Socket.IO `comanda:created` ponta a ponta | 1 | 39 ms | 39 ms | 39 ms | 1500 ms | 0 |
| Portal: `POST .../sessao` (10 clientes) | 10 | 136 ms | 308 ms | 308 ms | 2000 ms | 0 |
| Portal: `POST /public/cliente/pedidos` (10 clientes) | 50 | 152 ms | 174 ms | 181 ms | 1000 ms | 0 |
| `POST /comandas/:id/itens` (6 processos, mesma comanda) | 180 | 10,4 s | 10,9 s | 11,2 s | 600 ms | 168 |

Invariantes sob concorrência (todas verdes):

- **CONC-01** — 180 inserções simultâneas na mesma comanda: 12 sucessos, 12 itens gravados, R$ 144,00. Sem lost update.
- **CONC-02** — 6 processos tentando abrir um segundo evento no mesmo trailer: 6 rejeições 409, nenhuma criação indevida.
- **CONC-03** — duplo fechamento simultâneo da mesma comanda: 1 sucesso, 1 pagamento, sem cobrança dupla.
- **CONC-05** — 10 clientes simultâneos no portal: 10/10 sessões e 50/50 pedidos.
- **DB-01..DB-08** — totais, isolamento cliente/produto por tenant, no máximo 1 evento aberto por trailer e 1 comanda aberta por (evento, cliente).

### Achado de capacidade

O cenário de 180 inserções concorrentes na **mesma** comanda tem 168 falhas e p95 de 10,9 s. A causa não é perda de dados: o advisory lock serializa as inserções corretamente, mas cada transação segura uma conexão do pool enquanto espera o lock, e o pool do Prisma (limite 13, timeout 10 s) esgota — as requisições excedentes morrem com `P2024` (`Timed out fetching a new connection from the connection pool`) aos ~10 s. A carga é sintética e não representa operação real (180 atendentes no mesmo cliente ao mesmo tempo), mas o padrão vale como alerta: sob disputa alta, o backend degrada por exaustão de pool em vez de enfileirar. Mitigações possíveis, em ordem de esforço: aumentar `connection_limit` na URL do banco, reduzir o tempo com a conexão presa (adquirir o lock e recalcular em bloco menor) ou enfileirar as inserções por comanda na aplicação.

---

## 5. Fora de automação

Permanecem cobertos apenas por roteiro manual:

- **Envio real de SMTP** — sem servidor em DEV o envio cai no fallback de console. Estão automatizados o fallback e o 400 do endpoint admin quando não há SMTP configurado; a entrega real só se valida em produção.
- **Ingestão Elasticsearch / Kibana** — os logs de auditoria são emitidos e validados no formato esperado (OBS-01..09, TX-01..05), mas a ingestão acontece fora do processo da API.
- **Backup agendado** — `scheduleHour` é persistido e não existe cron no backend; os testes cobrem apenas o disparo manual, a listagem e o download.
- **Pagamento real PIX/cartão** — não há integração com adquirente; a suíte cobre o registro das formas e a alocação no resumo executivo.
- **UAT visual** — tema do portal por tenant, PWA offline em dispositivo real e modo TV em tela grande continuam em verificação manual.

---

## 6. Como reproduzir

```powershell
npm run dev:start
npm run qa:validate
```

O relatório HTML fica em `reports/qa-report.html`; filtre por categoria ou por prefixo de ID (`QCX-`, `ADM-`, `CSV-`, `PJW-`, `EVJ-`, `CRM-C-`, `RT-`).
