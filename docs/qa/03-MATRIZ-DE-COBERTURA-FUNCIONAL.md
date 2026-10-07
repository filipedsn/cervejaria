# Matriz de cobertura funcional — Quiver Tap

Referência do que está coberto por testes automatizados vs manual. Atualizar quando uma onda de QA fechar lacunas.

**Legenda**

| Status | Significado |
|--------|-------------|
| Verde | Automatizado (`backend/qa/suite.ts`, `test:unit` ou smokes); regressão repetível |
| Amarelo | Parcial (happy path, 1 tenant, ou só roteiro manual) |
| Vermelho | Sem cobertura automatizada |

**Camadas de critério**

1. **Bloqueadores** — sempre verde e automático (multitenant, RBAC, financeiro, módulo desligado na API)
2. **Críticos por módulo** — 1 fluxo principal por módulo habilitado em cada config
3. **Complementares** — manual ou E2E posterior (UI, PWA, TV, admin branding)

---

## Por módulo

| Área | Status | Automatizado hoje | Lacuna principal | Onda |
|------|--------|-------------------|------------------|------|
| Sessão / JWT | Verde | SESS-01..12 + OBS-09 | Invalidação mid-sessão Socket.IO | 3 |
| RBAC (cobertura geral) | Amarelo | TAP-76: primeira fatia de permissões individuais; evento, caixa, cancelamento, tenant, Socket.IO real com flags ligada/desligada e projeção de cozinha | Demais módulos e ações ainda não auditados; ensaio representativo NOT_RUN | 4 |
| Multitenant Cervejaria | Verde | TEN-01..16 (token de plataforma → 403 em rota de tenant) | — | 4 |
| Comandas + pagamento | Verde | RF-05/06 + PAG-01..07 (CARTAO, DEBITO, CREDITO, split) | — | 4 |
| Pagamento conjunto | Verde | RF-13 + property `fechar-comanda.property.test.ts` | — | 3 |
| CRM | Verde | RF-16 + CRM-C-01..06 (merge concorrente, cross-tenant) | — | 4 |
| Portal cliente | Verde | PORTAL-01..11 + PJW-01..10 + E2E comanda/pedido/cancel | Tema por tenant (manual) | 4 |
| Venda avulsa | Verde | RF-VA-01..06 | — | — |
| Eventos | Verde | RF-04, RF-04a..d + EVJ-01..12 (janela 30 min, cancelar ocorrência) | — | 4 |
| Ranking evento/série | Amarelo | RF-07 + E2E TV demo/live | Modo TV polling 60s | 2 |
| Dashboard / BI / resumo | Verde | RF-14, RF-15 + CSV-01..09 (escape, injeção, BOM) | — | 4 |
| Concorrência Cervejaria | Verde | CONC-01..05 + workers | Exaustão de pool sob disputa extrema (documentada) | 4 |
| Multi-trailer | Verde | MT-01..07 | — | — |
| Socket.IO | Verde | RT-01..12 (rooms, join cross-tenant, isolamento, latência) | — | 4 |
| **9 configs de empresa** | **Verde*** | Bloco CFG-* (45 casos) | — | **1** |
| Quiosque PDV | Verde | QCM + RNF-Q01 + E2E `quiosque-pdv.spec.ts` | — | 4 |
| Quiosque comandas | Verde | QCM-01..16 (MESA/FICHA, duplicata, troco, split, cancelar) | — | 4 |
| Quiosque cozinha | Verde | QCZ-01..10 + E2E `quiosque-cozinha-cancel.spec.ts` | — | 4 |
| Quiosque caixa | Verde | QCX-01..15 + property `caixa.property.test.ts` + E2E | Virada de meia-noite (manual) | 4 |
| Quiosque estoque | Verde | QES-01..10 (baixa, rollback, último item concorrente, estorno) | — | 4 |
| Multitenant Quiosque | Verde | TEN-Q-01..10 em `suite.ts` | — | 1b |
| Admin plataforma | Verde | ADM-01..24 + E2E badges/cadastro | SMTP real, cron de backup | 4 |
| Auth forgot/reset | Verde | AUTH-RP-01..05 | SMTP prod real | 2 |
| Cardápios template | Verde | CARD-01..08 (CRUD, bloqueio chope, aplicar evento) | — | 2 |
| Montagem de taps | Verde | TAP-M-01..08 (posicionar/trocar/remover/histórico) | — | 2 |
| Fila pedidos staff | Amarelo | PORTAL-05/06 + E2E confirma/recusa | chope ambíguo | 2 manual |
| PWA / offline | Amarelo | E2E SW + formulário offline + troca usuário | — | 2 |
| Modo TV / demo | Amarelo | E2E demo/live + fullscreen nativo | — | 2 |
| Observabilidade / erros HTTP | Verde | OBS-01..09 (health, ready, audit, contrato `{ error }`) | ingestão Elasticsearch em CI | 3 |
| TransacaoLog | Verde | TX-01..05 (criar/item/fechar/CSV/RBAC) | ingestão Elasticsearch | 3 |

\* Verde após `npm run qa:test` com seed das 9 configs (`qa-cfg-*`).

---

## Por configuração de empresa

| Código | Slug seed | Cervejaria | Quiosque | Estoque | Cozinha | Exclusivo |
|--------|-----------|------------|----------|---------|---------|-----------|
| CERVEJARIA | `qa-cfg-cervejaria` | sim | não | — | — | — |
| QUIOSQUE-00 | `qa-cfg-quiosque-00` | não | sim | não | não | sim |
| QUIOSQUE-10 | `qa-cfg-quiosque-10` | não | sim | sim | não | sim |
| QUIOSQUE-01 | `qa-cfg-quiosque-01` | não | sim | não | sim | sim |
| QUIOSQUE-11 | `qa-cfg-quiosque-11` | não | sim | sim | sim | sim |
| HIBRIDA-00 | `qa-cfg-hibrida-00` | sim | sim | não | não | não |
| HIBRIDA-10 | `qa-cfg-hibrida-10` | sim | sim | sim | não | não |
| HIBRIDA-01 | `qa-cfg-hibrida-01` | sim | sim | não | sim | não |
| HIBRIDA-11 | `qa-cfg-hibrida-11` | sim | sim | sim | sim | não |

Checks CFG por config (5 × 9 = 45 casos): contexto, operação principal, submódulo bloqueado na API, isolamento, erro.

---

## Estimativa agregada

```text
                        Antes Onda 1    Depois Onda 1    Depois Onda 4
Cervejaria core         ~80%            ~80%             ~95%  (CSV, formas de pagamento, janela de evento)
Portal cliente          ~70%            ~70%             ~90%  (PJW: expiração, cross-evento, alg=none)
Quiosque happy path     ~40%            ~40%             ~90%  (QCX/QCM/QES/QCZ, 51 casos)
9 configs empresa         0%            ~90%             ~90%
Admin plataforma        ~10%            ~10%             ~85%  (ADM: cadastro 3 modos, branding, SMTP, backup)
UI / PWA / TV             0%            ~35%             ~50%  (18 specs Playwright)
Multitenant quiosque      0%            ~80%             ~80%
Realtime Socket.IO      ~15%            ~15%             ~85%  (RT: rooms, isolamento, latência)
```

Execução de referência: 356 casos de API, 23 unitários e 28 execuções Playwright, todos verdes — detalhes em [10-RELATORIO-COMPLETO-QA.md](10-RELATORIO-COMPLETO-QA.md).

---

## Comandos

```powershell
npm run dev:start
npm run qa:validate   # unit + qa:test + test:e2e (dev :5202 / :3002)
npm run qa:test          # setup + suite + workers + report
npm run test:unit        # regras de negócio unitárias
npm run test:e2e         # Playwright (dev :5202 / :3002; quiosque requer qa:setup)
node backend/scripts/diag-smoke-quiosque-pdv.mjs   # etc.
```

Relatório HTML: `reports/qa-report.html` — filtrar categoria **Configuração** ou IDs `CFG-*`.

---

## Próximo incremento (fora da Onda 4)

1. ~~TEN quiosque — IDOR em `/api/quiosque/comandas`, `/caixa`, `/estoque`~~ (Onda 1b)
2. ~~3–5 E2E Playwright — login, PDV, portal QR, ranking TV~~ (Onda 2: 9 specs)
3. ~~Property-based — pagamento conjunto~~ (`fechar-comanda.property.test.ts`)
4. ~~Socket.IO rooms, quiosque completo, admin, CSV, JWT do portal~~ (Onda 4: 132 casos novos)
5. Pendente: SMTP real em produção, ingestão Elasticsearch em CI, cron de backup agendado e capacidade do pool de conexões sob disputa alta
