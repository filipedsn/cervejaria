# Plano de Teste — Cervejaria Móvel (QA aprofundado)

> Suíte automatizada executada contra a API real (`http://localhost:3002`) + PostgreSQL.
> Foco: **requisitos funcionais**, **não-funcionais**, **controle de sessão** e **isolamento multi-tenant**.
> Concorrência real gerada por **múltiplos processos (subagents)** atacando uma *arena* compartilhada.

## 1. Arquitetura da suíte

| Etapa | Script | Papel |
|-------|--------|-------|
| Setup | `qa/setup.ts` | Limpa dados QA, cria N cervejarias, usuários (DONO+3 ATENDENTES), produtos, taps, evento e comandas. Cria a **arena** (evento+comanda compartilhados) e persiste `reports/qa/context.json`. |
| Suíte | `qa/suite.ts` | Executa todos os casos funcionais, de sessão, RBAC, multi-tenant e não-funcionais em processo único. Persiste `reports/qa/suite.json`. |
| Workers | `qa/worker.ts` | Gerador de carga. Cada instância é um **processo separado** (subagent) que ataca a arena: rajada de itens + tentativa de abrir evento duplicado. Persiste `reports/qa/workers/worker-<id>.json`. |
| Report | `qa/report.ts` | Agrega `suite.json` + todos os `worker-*.json`, roda verificações finais de integridade no banco e gera `reports/qa-report.html`. |

Orquestração: `setup → suite → (N workers em paralelo, via subagents) → report`.

## 2. Requisitos funcionais (RF)

| ID | Requisito | Critério de aceite |
|----|-----------|--------------------|
| RF-01 | Autenticação | Login válido retorna JWT + usuário + cervejaria |
| RF-02 | Catálogo | Listar/criar/editar/ativar/excluir produtos (com validação de vínculo) |
| RF-03 | Taps | CRUD de taps; só chope pode ser vinculado; número único **por trailer** |
| RF-04 | Evento | Abrir, listar, fechar, reabrir; conflito de horário **por trailer** |
| RF-05 | Comanda | Criar, adicionar item, remover item, fechar com pagamento |
| RF-06 | Pagamento | Soma dos pagamentos deve bater com total; fecha comanda |
| RF-07 | Ranking | Ordena clientes por volume de chope; ignora não-chope |
| RF-08 | Dashboard | Métricas do evento retornadas |
| RF-09 | Resumo executivo | Disponível só para DONO e evento FECHADO |
| RF-10 | Usuários | DONO cria ATENDENTE; e-mail único |

## 3. Requisitos não-funcionais (RNF)

| ID | Requisito | Meta |
|----|-----------|------|
| RNF-01 | Latência login | p95 < 500 ms |
| RNF-02 | Latência listagem comandas | p95 < 800 ms |
| RNF-03 | Latência adição de item | p95 < 600 ms |
| RNF-04 | Throughput sob carga (40 tenants) | < 5% de erros |
| RNF-05 | Integridade sob concorrência | `total == Σ itens` sempre |
| RNF-06 | Escalabilidade | Suportar 40 cervejarias simultâneas |
| RNF-07 | Consistência de invariantes | ≤ 1 evento ABERTO por **trailer** (vários trailers podem operar em paralelo) |

## 4. Controle de sessão (SESS)

| ID | Caso | Esperado |
|----|------|----------|
| SESS-01 | Requisição sem token | 401 |
| SESS-02 | Token malformado (garbage) | 401 |
| SESS-03 | Token assinado com secret errado | 401 |
| SESS-04 | Assinatura adulterada (tampering) | 401 |
| SESS-05 | Algoritmo `none` (bypass) | 401 |
| SESS-06 | Token expirado (exp no passado) | 401 |
| SESS-07 | Token válido sem `exp` (nunca expira) | **Finding** — sessão infinita |
| SESS-08 | Header sem `Bearer` | 401 |
| SESS-09 | Token de usuário excluído ainda aceito | **Finding** — sem revalidação de usuário |
| SESS-10 | Token de cervejaria desativada mid-sessão | 403 (bloqueia acesso) |
| SESS-11 | `cervejariaId` forjado no payload (re-assinado com secret errado) | 401 |

## 5. Isolamento multi-tenant (TEN) — matriz IDOR

Token da **Cervejaria A** tentando acessar recursos da **Cervejaria B**. Esperado: **404** (não vazar, não 200).

| ID | Endpoint | Esperado |
|----|----------|----------|
| TEN-01 | `GET /eventos/:idB` | 404 |
| TEN-02 | `GET /eventos/:idB/dashboard` | 404 |
| TEN-03 | `GET /eventos/:idB/resumo-executivo` | 404/403 |
| TEN-04 | `GET /comandas/:idB` | 404 |
| TEN-05 | `GET /comandas/evento/:idB` | 404 |
| TEN-06 | `POST /comandas/:idB/itens` | 404 |
| TEN-07 | `GET /produtos/:idB` | 404 |
| TEN-08 | `PATCH /produtos/:idB/ativo` | 404 |
| TEN-09 | `DELETE /produtos/:idB` | 404 |
| TEN-10 | `PUT /taps/:idB` | 404 |
| TEN-11 | `DELETE /taps/:idB` | 404 |
| TEN-12 | `GET /ranking/evento/:idB` | 404 |
| TEN-13 | `POST /pagamentos/comandas/:idB/fechar` | 404 |
| TEN-14 | Listagens escopadas (produtos/clientes/taps) não retornam dados de B | isolado |
| TEN-15 | ADMIN não acessa dados de tenant específico via rotas de tenant | isolado |

## 6. RBAC (papéis)

| ID | Caso | Esperado |
|----|------|----------|
| RBAC-01 | ATENDENTE cria produto (`requireDono`) | 403 |
| RBAC-02 | ATENDENTE cria usuário | 403 |
| RBAC-03 | ATENDENTE acessa resumo executivo | 403 |
| RBAC-04 | ATENDENTE acessa rota admin | 403 |
| RBAC-05 | DONO acessa rota admin | 403 |
| RBAC-06 | DONO cria ATENDENTE | 201 |

> Observação de projeto: `requireDono`/`requireAdmin`/`assertCervejariaAtiva` usam `app.httpErrors.*`
> mas `@fastify/sensible` **não está registrado** → respondem **500** em vez de 403 (bloqueiam, mas com status errado).

## 7. Concorrência (CONC) — multi-processo via subagents

| ID | Cenário | Invariante verificada |
|----|---------|-----------------------|
| CONC-01 | K workers × M itens na **mesma comanda** (arena) | `total == nº itens × preço`; nenhum lost update |
| CONC-02 | K workers tentando abrir evento no **mesmo trailer** (arena) | 409 — conflito de horário/trailer |
| CONC-03 | Duplo-fechamento simultâneo da mesma comanda | 1 sucesso, demais 404/409; sem pagamento duplicado |
| CONC-04 | Latência agregada sob carga multi-processo | percentis p50/p95/p99 |

## 8. Integridade de dados (DB)

| ID | Verificação |
|----|-------------|
| DB-01 | `Comanda.total == Σ(item.precoUnit × qtd)` em todas as comandas QA |
| DB-02 | Nenhuma comanda com cliente de outra cervejaria |
| DB-03 | Nenhum item órfão / produto de outra cervejaria numa comanda |
| DB-04 | Arena: nº de itens == Σ sucessos dos workers |
| DB-05 | No máximo 1 evento ABERTO por trailer (dados QA) |

## 8. Multi-trailer (MT)

Cervejaria dedicada `qa-multi-trailer` com **2 trailers**, **2 eventos ABERTOS** simultâneos e comandas separadas.

| ID | Caso | Esperado |
|----|------|----------|
| MT-01 | `GET /trailers/operacional` | 2 trailers; `eventoAberto` correto por trailer |
| MT-02 | `GET /eventos/ativos` | 2 eventos abertos em paralelo |
| MT-03 | `GET /eventos/ativos?trailerId=` | Só evento do trailer filtrado |
| MT-04 | `GET /comandas/evento/:id` | Comandas isoladas por evento/trailer |
| MT-05 | `GET /ranking/evento/:id` | Ranking isolado por evento |
| MT-06 | `POST /eventos` mesmo trailer/horário | 409 |
| MT-07 | `GET /trailers?ativo=true` | 2 trailers ativos |

## 11. Venda avulsa (RF-VA)

| ID | Caso | Esperado |
|----|------|----------|
| RF-VA-01 | Dashboard ao vivo após venda avulsa | `receitaAvulsa` e `vendasAvulsas` incrementam; `valorFechado` não inclui avulsa |
| RF-VA-04 | Dashboard mensal após fechar evento | `receitaTotal`, `vendasAvulsas` e `receitaAvulsa` refletem avulsas |
| RF-VA-06 | Resumo executivo + fluxo 15 min | `vendasAvulsas`, `receitaAvulsa`, `comandasRegulares`; bucket com `fechadoAvulsa > 0` |

## 10. Portal cliente (PORTAL)

| ID | Caso | Esperado |
|----|------|----------|
| PORTAL-07 | Sessão portal após fechar/reabrir evento | Cookie antigo retorna **401** após `PATCH /eventos/:id/fechar` e após `PATCH /eventos/:id/reabrir`; nova `POST /sessao` retorna **201** com comanda válida |

Fluxo PORTAL-07: abrir sessão via QR → `GET /cliente/comanda` **200** → fechar comandas abertas do evento → fechar evento → cookie antigo **401** → reabrir evento → cookie antigo ainda **401** → nova sessão **201**.

## 9. Critérios de "pronto para produção"

- 0 falhas em SESS, TEN, RBAC (bloqueio de acesso) e DB.
- 0 falhas em CONC de integridade (CONC-01, CONC-03).
- RNF dentro das metas ou com plano de mitigação.
- Findings conhecidos documentados com recomendação.
