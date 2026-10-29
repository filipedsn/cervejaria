# TQ-PROD-01 — Auditoria funcional e consolidação do backlog de produto

**Data:** 2026-09-02  
**Escopo:** leitura estática de backend, frontend, schema Prisma, testes QA/E2E, documentos de produto e histórico Git local.  
**Não feito:** nenhuma alteração de produto, banco, schema, teste, serviço, Support Analyst, observabilidade, commit, push ou deploy.

## 1. Executive Summary

O TAP Quiver é um **produto operacional de ponto de venda para eventos e quiosques**, não apenas uma base técnica. Ele já permite que uma pequena cervejaria opere evento com comandas, taps, venda avulsa, pagamentos divididos, portal por QR, clientes, ranking e análise posterior; e que um quiosque opere turno com caixa, comandas por mesa/ficha/apelido, balcão, cozinha e estoque opcionais.

O produto está em **USABLE_PRODUCT**, com prontidão comercial **YES_WITH_GAPS**. O núcleo transacional é forte e testado; o quiosque já oferece alerta simples de estoque e cancelamento de cozinha na UI. As lacunas mais concretas são onboarding até a primeira venda, exceções operacionais do dono e reduzir contexto/passos no pico. A proposta de caixa separado para cervejaria foi reframada, não é uma iniciativa ativa.

O próximo ciclo deve priorizar produtividade e controle diário. Não há evidência para priorizar mais IA, BI sofisticado, integrações de adquirência, offline-first ou CRM enterprise.

### Street Trailer Principle

O cliente típico opera um trailer ou quiosque simples, com uma ou duas pessoas, operação dinâmica e uso mobile-first. **O sistema deve ajudar a registrar a operação enquanto a pessoa trabalha, e não fazer a pessoa trabalhar para registrar no sistema.** Por isso, controles adicionais só entram quando reduzem risco ou trabalho de turno de forma observável; um caixa separado para cervejaria permanece `DEFERRED / REFRAMED` até haver essa evidência.

**Functional fit:** **8/10**. O produto atende bem à operação que escolheu, mas precisa fechar os “últimos metros” das rotinas repetidas e da confiança financeira do dono.

## 2. Current Value Proposition

`CURRENT VALUE PROPOSITION`: para trailer, cervejaria móvel e quiosque que vendem em alto giro, o TAP Quiver substitui a combinação de comanda de papel, memória do atendente e planilha posterior por uma operação compartilhada em celular/tablet: venda registrada, total correto, pagamento distribuído, status visível em tempo real e resumo para o dono.

Em comparação com caderno, planilha, WhatsApp ou POS simples, o diferencial atual é a combinação específica de:

- comandas e vendas avulsas no mesmo evento/turno;
- taps, chope por volume e ranking/TV para cervejaria;
- caixa com abertura, sangria, suprimento, divergência e histórico para quiosque;
- cozinha e estoque somente quando o quiosque precisa deles;
- QR portal que permite ao cliente consultar a própria comanda e enviar pedido para confirmação;
- isolamento por empresa, múltiplos dispositivos e atualizações em tempo real.

O produto não elimina a necessidade de conferir dinheiro físico nem substitui fiscal, adquirente, contabilidade ou logística.

## 3. Product Roles

| Papel | Objetivo e jornadas disponíveis | Restrições reais | Gaps e atritos |
|---|---|---|---|
| ADMIN | Cadastrar/editar/ativar empresa, dono, módulos e branding; configurar SMTP, backup e URL da plataforma. | Não entra na operação do tenant; rotas de tenant bloqueiam token sem cervejaria. | Cadastro inicial é funcional, mas o Admin não tem visão de adoção/primeira venda; agendamento de backup é só referência, sem cron no backend. |
| DONO | Configurar equipe, catálogo, trailers, taps, cardápios, operação e aparência; criar eventos/pontos; acompanhar dashboards, resumo/CSV, caixa do quiosque e clientes. | Não pode usar área ADMIN; ações financeiras privilegiadas permanecem protegidas. | Para cervejaria falta fechamento/conferência de caixa; não há onboarding guiado nem alertas operacionais simples. |
| ATENDENTE | Abrir/localizar comanda, adicionar/remover itens, vender avulso, receber pagamento, atender pedidos do portal; no quiosque operar caixa, comandas, cozinha/estoque conforme módulo. | Sem admin, dashboard/configurações do dono; cancelamento de pedido de cozinha é só DONO; desconto do quiosque é DONO ou permissão explícita. | Busca/identificação e lançamento têm vários passos no pico; correção de venda fechada não tem fluxo funcional de exceção. |
| CLIENTE / PORTAL | Abrir/retomar comanda por telefone e nome, consultar consumo, montar pedido, cancelar pedido pendente e acompanhar confirmação/recusa. | Não fecha/paga sozinho; pedido depende de confirmação do staff; escopo é um evento/trailer e sessão por cookie. | Sem ETA, status de preparo/entrega ou pagamento; o fluxo ainda depende de telefone e confirmação, que é seguro mas pode gerar espera. |

## 4. Company Modes

| Modo | Comportamento confirmado | Avaliação |
|---|---|---|
| Só Cervejaria | Eventos, trailer, taps, comandas, portal, clientes, ranking e dashboard; sem navegação de quiosque. | Coerente e suficiente para a proposta de evento. |
| Só Quiosque | Entrada cai em `/quiosque/comandas`; telas de cervejaria, trailer e evento são ocultadas/bloqueadas. | Coerente; reduz distração operacional. |
| Híbrida | Mesma sessão permite alternar entre cervejaria e quiosque; ambos aparecem na navegação. | Funcional e coberto por E2E, mas a troca pode confundir operação se os nomes/objetivos dos módulos não forem explicitados no onboarding. |
| `controlaEstoque` | Mostra rota/nav/API de estoque, baixa em vendas e alerta mínimo por produto/ponto. | Coerente; leitura de perda por produto continua futura. |
| `temCozinha` | Mostra fila/cozinha/TV e gera pedidos para itens com preparo. | Coerente; cancelamento não está exposto na tela e o ciclo de entrega não é visível ao cliente. |
| `usaCardapio` | Habilita templates e preço por evento/turno. | Útil para operação variável, mas é uma decisão avançada; deve vir desligada/explicada por padrão. |
| `quantidadeMesas` | Gera grade de mesas no quiosque. | Útil quando há mesa; configuração numérica é um bom candidato a default por tipo de operação. |

As nove combinações de empresa (cervejaria; quiosque com/sem estoque/cozinha; híbrida com as mesmas flags) têm cobertura QA declarada. A modelagem é proporcional ao problema, não um excesso de arquitetura.

## 5. Functional Inventory

| Domínio | O que existe hoje | Estado funcional |
|---|---|---|
| A. Operação | Seleção de trailer, evento ativo, ponto de venda, conexão e PWA instalável. | IMPLEMENTED |
| B. Comandas | Abrir, listar/buscar, item, quantidade, desconto, cancelar aberta, fechar individual/conjunto, recibo; tipos mesa/ficha/apelido no quiosque. | IMPLEMENTED, com exceção de correção pós-fechamento. |
| C. Pedidos | Portal pendente → confirmação/recusa pelo staff; pedidos do quiosque vinculados à comanda. | IMPLEMENTED/PARTIAL |
| D. Pagamentos | Dinheiro, PIX, cartão, débito/crédito, divisão; troco no quiosque; validação de total. | IMPLEMENTED |
| E. Clientes | Cadastro/resolução por telefone, histórico/estatísticas, opt-in, edição, união e exclusão pelo dono. | IMPLEMENTED |
| F. Produtos/Cardápio | Catálogo de bebida/comida, preço/volume, ativos, templates e preço de evento/turno opcionais. | IMPLEMENTED |
| G. Estoque | Saldo por ponto, entrada, perda/cortesia/consumo interno, ajuste e baixa por venda no quiosque. | PARTIAL: sem mínimo/alerta e não cobre estoque da cervejaria/taps. |
| H. Chope/Taps | Cadastro/ativação, montagem por evento, troca/histórico, volume e ranking. | IMPLEMENTED |
| I. Quiosque | PDV avulso, comandas, ponto de venda, turnos e mesa configurável. | IMPLEMENTED |
| J. Cozinha | Fila, estados recebido/preparo/pronto/entregue, TV, realtime e cancelamento por dono. | PARTIAL: sem visão de atraso; cancelamento não devolve estoque automaticamente por decisão aberta. |
| K. Caixa/Financeiro | Quiosque: abertura, troco, sangria, suprimento, correção autorizada, fechamento/divergência/histórico. Cervejaria: pagamentos e relatórios por evento. | PARTIAL: ausência de caixa operacional na cervejaria. |
| L. Portal do Cliente | QR, identidade, comanda, cardápio, pedido/cancelamento, confirmação/recusa. | IMPLEMENTED, com autonomia deliberadamente limitada. |
| M. Ranking/TV | Ranking por chope de evento, período/série e TV/demo. | IMPLEMENTED; valor depende do tipo de evento. |
| N. Administração | Empresas, dono, módulos, branding, ativação e configurações de plataforma. | IMPLEMENTED |
| O. Relatórios/BI | Dashboard mensal, resumo de evento/turno, produtos, pagamentos, funcionário, CSV e ranking. | IMPLEMENTED/PARTIAL: muitos dados; faltam alertas orientados a ação. |
| P. Configuração | Equipe, trailers, catálogo, cardápios, operação, aparência, pontos/mesas. | IMPLEMENTED; configuração avançada pode sobrecarregar a primeira semana. |
| Q. Auditoria | Log transacional/auditoria técnica e CSV de transações do evento. | IMPLEMENTED como apoio, não interface principal do operador. |
| R. Realtime | Socket rooms, portal/staff, comandas, ranking e cozinha; indicador de reconexão. | IMPLEMENTED; escrita não é enfileirada offline. |

## 6. Requirements Matrix

| RF | Área | Requisito | Papel | Status | Evidence | Value |
|---|---|---|---|---|---|---|
| RF-01 | Operação | Entrar e operar apenas empresa autorizada. | Todos internos | IMPLEMENTED | `auth.ts`, `app.ts`, QA sessão/RBAC/tenant | HIGH |
| RF-02 | Eventos | Criar agenda avulsa/semanal, iniciar, fechar, reabrir e cancelar ocorrência. | Dono/atendente | IMPLEMENTED | `eventos.ts`, `EventoPage.tsx`, EVJ-* | HIGH |
| RF-03 | Comandas | Abrir comanda de evento com cliente identificado. | Atendente | IMPLEMENTED | `comandas.ts`, `NovaComandaPage.tsx`, RF-05/06 | HIGH |
| RF-04 | Comandas | Lançar/remover item e recalcular total com proteção concorrente. | Atendente | IMPLEMENTED | `comanda-service.ts`, CONC-* | HIGH |
| RF-05 | Pagamentos | Fechar comanda e distribuir pagamentos com total exato. | Atendente | IMPLEMENTED | `pagamentos.ts`, `PaymentFormModal.tsx`, PAG-* | HIGH |
| RF-06 | Comandas | Corrigir uma venda já fechada com trilha de auditoria. | Dono | MISSING | fechada é somente leitura; sem rota/UI de estorno | HIGH |
| RF-07 | Portal | Cliente abre/consulta própria comanda por QR (PDV `/c/.../p/...`). | Cliente | IMPLEMENTED | `public.ts`, `PortalPdvPage.tsx`, POR-* | HIGH |
| RF-08 | Portal | Pedido chega ao staff, que confirma ou recusa com motivo. | Cliente/atendente | DEPRECATED | portal de evento `/t/` descontinuado (TAP-141); fluxo assistido legado | HIGH |
| RF-09 | Portal | Cliente acompanha preparo/entrega ou previsão. | Cliente | MISSING | portal PDV ainda sem status rico de preparo | MEDIUM |
| RF-10 | Clientes | Consultar histórico e reconhecer recorrência simples. | Dono/atendente | IMPLEMENTED | `clientes.ts`, `ClienteDetailPage.tsx`, CRM-* | MEDIUM |
| RF-11 | Taps | Posicionar/trocar chope por evento e preservar histórico. | Dono/atendente | IMPLEMENTED | `eventos.ts`, `TapMontagem`, TAP-M-* | HIGH |
| RF-12 | Quiosque | Abrir comanda por apelido, mesa ou ficha com prevenção de duplicata. | Atendente | IMPLEMENTED | `quiosque/comandas.ts`, QCM-* | HIGH |
| RF-13 | Quiosque | Venda avulsa rápida com pagamento/troco. | Atendente | IMPLEMENTED | `quiosque/vendas.ts`, E2E PDV | HIGH |
| RF-14 | Caixa | Abrir, movimentar, fechar e conferir turno do quiosque. | Atendente/dono | IMPLEMENTED | `quiosque/caixa.ts`, `PainelCaixaQuiosque.tsx`, QCX-* | HIGH |
| RF-15 | Caixa | Ter equivalente de abertura/fechamento de caixa em evento de cervejaria. | Atendente/dono | MISSING | só pagamentos/relatórios no módulo de evento | HIGH |
| RF-16 | Estoque | Baixar por venda e registrar entrada/saída/ajuste por ponto. | Atendente | IMPLEMENTED | `quiosque/estoque.ts`, QES-* | HIGH |
| RF-17 | Estoque | Sinalizar saldo mínimo e item indisponível antes da venda. | Atendente/dono | IMPLEMENTED | mínimo por produto/ponto, LOW/OUT_OF_STOCK e bloqueio de venda sem saldo | HIGH |
| RF-18 | Cozinha | Operar fila com estados e atualização em tempo real. | Atendente | IMPLEMENTED | `quiosque/cozinha.ts`, `CozinhaPedidoCard.tsx`, QCZ-* | HIGH |
| RF-19 | Cozinha | Cancelar pedido aberto pela interface, com confirmação contextual e reflexo financeiro. | Dono | IMPLEMENTED | UI operacional, API existente e E2E de cancelamento | HIGH |
| RF-20 | Relatórios | Dono consulta venda, ticket, produto, pagamento e período. | Dono | IMPLEMENTED | dashboards/resumos, `relatorios.ts` | HIGH |
| RF-21 | Relatórios | Dono recebe exceções acionáveis (caixa, estoque, pedido atrasado). | Dono | PARTIAL | divergência existe no quiosque; sem central de atenção | HIGH |
| RF-22 | Onboarding | Nova empresa chega à primeira venda com roteiro/predefinições. | Admin/dono | MISSING | cadastro cria tenant/dono, sem checklist | HIGH |
| RF-23 | Realtime | Atualizar comanda, pedido, cozinha/ranking entre dispositivos. | Todos | IMPLEMENTED | Socket.IO, RT-*, E2E portal/cozinha/TV | HIGH |
| RF-24 | Offline | Manter escrita operacional quando internet cai. | Todos | MISSING / KNOWN_LIMITATION | PWA cacheia shell; escrita requer rede | MEDIUM |
| RF-25 | Ranking | Exibir competição/TV de consumo de chope. | Cliente/dono | IMPLEMENTED | `ranking.ts`, TV E2E | LOW/MEDIUM |
| RF-26 | Administração | Configurar empresa e módulos sem expor rotas indevidas. | Admin | IMPLEMENTED | `admin.ts`, `AdminCervejariasPage.tsx`, ADM-* | MEDIUM |

## 7. Attendant Journey

**Evento de cervejaria — percurso atual:** login/seleção de trailer e evento (quando necessário) → Comandas → Nova comanda → telefone → localizar/criar/confirmar cliente → Abrir → detalhe → Adicionar item → aba/tap/produto/volume/quantidade → Confirmar → Fechar → forma(s) de pagamento → confirmar → recibo → Comandas.

São aproximadamente **7–10 telas/estados** para a primeira venda em uma comanda e **4–6** para novo item + fechamento de comanda existente. O modal de item, botões grandes, busca e pagamentos divididos reduzem erro; ainda assim, telefone/cliente antes de abrir e a seleção repetida de produto/volume são os atritos de maior frequência.

Riscos: abrir a comanda errada em fila, lançar volume errado de chope, remover item errado, trocar de forma de pagamento tarde e tentar fechar uma comanda que foi alterada por outro aparelho. Há proteção de estado/concorrência no backend, mas a experiência pode exigir nova orientação após erro.

Oportunidades sem reduzir segurança financeira: busca persistente por número/nome/telefone, ação “repetir último item” ou favoritos por evento, default de volume por tap, voltar direto à grade após confirmação e resumo de pagamento mais explícito antes da confirmação final.

## 8. Owner Journey

O dono consegue: configurar catálogo, equipe, trailer/taps ou ponto; abrir/configurar operação; ver dashboard de mês, resumo encerrado, produtos, recebimentos por forma, funcionário, ticket e CSV; consultar cliente; no quiosque conferir caixa/turno e divergência.

| Pergunta do dono | Resposta atual |
|---|---|
| Quanto vendi / recebi? | Sim, dashboards e resumos; por forma de pagamento. |
| O que vende mais? | Sim, produtos mais vendidos e chope. |
| Quanto tenho de estoque? | Sim somente no quiosque com estoque habilitado. |
| Há diferença de caixa? | Sim no quiosque; não como rotina de caixa para cervejaria. |
| Quais clientes voltam? | Parcial: histórico/estatística por cliente, sem lista de recorrentes acionável. |
| Quais eventos foram melhores? | Sim, dashboard por agenda/evento, embora denso para uso em pé. |
| Há algo exigindo atenção? | Parcial: fila e divergência locais; não há painel de exceções. |

## 9. Customer Journey

O QR abre o **portal PDV** (`/c/:slug/p/:pontoVendaId`) enquanto o caixa do ponto estiver aberto. O cliente informa telefone; se existe, confirma identidade, senão cadastra nome; então vê a comanda, monta pedido operacional e pode solicitar pagamento (a equipe fecha no caixa). O portal de evento/trailer (`/c/.../t/...`) foi **descontinuado** (TAP-141): links antigos redirecionam para `/p/` quando o ponto existe (cutover) ou mostram página de descontinuado.

Não é checkout com PIX do cliente — fronteira de produto mantida. Gaps: status de preparo/cozinha ainda fraco no portal PDV.

## 10. Brewery Journey

Evento/agendamento → selecionar trailer → preparar taps/cardápio → iniciar → abrir comandas ou venda avulsa → lançar chope por tap/volume e itens → atender pedidos do portal → receber/fechar → encerrar evento → resumo/ranking/CSV.

Pontos fortes: modelo de tap preserva troca no evento; comanda e pagamento são transacionais; ranking/TV atualiza ao vivo; evento não fecha com comandas abertas. Gaps: não há estoque de barril/insumo, conferência de caixa, fluxo de exceção de venda fechada ou cozinha integrada no modo cervejaria.

## 11. Kiosk Journey

Selecionar ponto → abrir caixa (troco e, se aplicável, cardápio do turno) → abrir comanda ou venda avulsa → produto/quantidade → baixa de estoque e pedido de cozinha quando aplicável → preparo/pronto/entregue → pagamento → fechamento de comandas → sangria/suprimento/correção autorizada → contar por forma e fechar → consultar resumo do turno.

É o fluxo funcionalmente mais completo e tem boa velocidade na venda avulsa. A exigência de ponto/caixa antes de vender é correta para controle, mas representa treinamento inicial. Cancelamento de cozinha já está na UI; estoque continua dependente de entrada manual, mas agora antecipa saldo crítico e indisponibilidade.

## 12. High-Frequency Operations

`HIGH_FREQUENCY_OPERATION`

| Operação repetida | Público | Valor de otimização |
|---|---|---|
| Localizar/abrir comanda | Atendente | Alto: ocorre a cada novo cliente e pode evitar conta errada. |
| Adicionar item/chope e quantidade | Atendente | Muito alto: ocorre dezenas/centenas de vezes no turno. |
| Venda avulsa e escolha de pagamento | Atendente | Muito alto em balcão; segundos importam. |
| Confirmar pedido do portal | Atendente | Alto em evento com QR; atraso vira fila percebida. |
| Avançar pedido de cozinha | Cozinha | Alto onde há preparo; erro de toque afeta entrega. |
| Reposição/baixa de estoque | Operador | Médio/alto quando controle está ligado. |
| Conferir caixa e divergência | Dono/caixa | Menos frequente, mas alto impacto financeiro. |

## 13. Functional Friction

1. Identificação de cliente antes de abrir comanda de cervejaria pode ser lenta em pico.
2. Seleção de tap, volume e quantidade se repete; o fluxo não aparenta ter favoritos/default por evento.
3. Híbrido oferece dois domínios corretos, mas sem orientação contextual explícita no primeiro uso.
4. Configurações de cardápio, grade, KPIs e layout são úteis, porém avançadas para o momento de primeira venda.
5. Dashboards têm valor para decisão, mas são densos para uma pergunta operacional imediata.
6. Portal deixa o cliente sem visibilidade após envio/confirmado, especialmente se há preparo.
7. Estoque informa saldo, mas não prioriza o que exige reposição.

## 14. Operational Error Risks

| Risco | Probabilidade | Impacto | Mitigação funcional simples |
|---|---|---|---|
| Comanda errada | Média | Alto | Busca por identificador/nome/telefone e cabeçalho muito destacado; recentes por atendente. |
| Item/volume errado | Alta | Médio | Favoritos, default de volume e resumo visual antes de adicionar. |
| Pagamento incorreto | Média | Alto | Manter validação de total/troco; reforçar resumo por forma antes de concluir. |
| Pedido duplicado | Média | Médio | Estado “enviando/enviado”, idempotência percebida e histórico curto do pedido. |
| Perda de pedido de cozinha | Baixa/média | Alto | Badge de idade do pedido e confirmação explícita de entrega. |
| Baixa/ajuste de estoque errado | Média | Médio | Mostrar saldo antes/depois e exigir motivo para ajuste/perda; já há observação opcional, que pode tornar-se obrigatória para ajuste. |
| Venda fechada com erro | Baixa/média | Alto | Fluxo exclusivo do dono para estorno/correção auditada; não reabrir livremente. |
| Divergência de caixa | Média | Alto | O quiosque já mitiga com conferência e correção autorizada; estender conceito para cervejaria. |

## 15. Near-Complete High-Value Features

`NEAR_COMPLETE_HIGH_VALUE`

1. **Exceções acionáveis do dono no quiosque** — dados de divergência, estoque, pedidos e dashboards existem; falta consolidar poucos alertas de atenção. Valor 5/5, esforço M.
3. **Status percebido do pedido do portal** — estados pendente/confirmado/recusado e realtime existem; falta comunicar próxima etapa/tempo e, onde aplicável, pronto/entregue. Valor 4/5, esforço M.
4. **Estoque operacional** — entradas, baixas e saldo existem; falta mínimo configurável e bloqueio/alerta preventivo no catálogo/PDV. Valor 5/5, esforço M.
5. **Reconhecimento de recorrentes** — histórico e estatística existem; falta uma lista/indicador simples de retorno e última visita. Valor 3/5, esforço S/M.

## 16. Missing High-Value Features

- Caixa de evento para cervejaria: abertura, esperado por forma, contado, diferença e histórico.
- Correção financeira pós-fechamento com autorização/auditoria, sem “reabrir qualquer comanda”.
- Estoque mínimo e indisponibilidade simples no quiosque; estoque de barril/insumo apenas se validado em campo.
- Checklist de primeira venda e pré-configuração por modo de empresa.
- Painel curto de atenção do dono, não outro BI.

## 17. Field Feedback

**REAL_USER_FEEDBACK encontrado:** nenhum. `docs/roadmap/pos-primeiro-dia.md` foi criado para registrar o primeiro uso em campo (08/07/2026), mas contém zero itens P0/P1/P2, sem solicitante, contexto ou pedido real.

**ENGINEERING_IDEA / evidência de produto não equivalente a feedback:** histórico de commits e testes mostra evolução de quiosque, caixa, cardápio, cozinha, segurança e Analyst; a especificação contém intenções de design; o E2E de cozinha registra explicitamente que cancelamento não está na tela. Somente o último é evidência objetiva de gap de interface, não opinião de cliente.

Consequência: o backlog abaixo é uma hipótese bem fundamentada em fluxo/código; deve ser revisado após entrevistas curtas ou observação de turnos antes de comprometer Big Bets.

## 18. Reports / BI

| Relatório | Classificação | Decisão que apoia |
|---|---|---|
| Dashboard mensal de cervejaria/quiosque | ACTIONABLE | Comparar período, agenda/ponto, ticket e produtos. |
| Resumo de evento/turno | ACTIONABLE | Fechar o dia, revisar pagamentos, ritmo e responsáveis. |
| Produtos mais vendidos | ACTIONABLE | Repor, ajustar cardápio/preço e planejar produção. |
| Receita por forma de pagamento | ACTIONABLE | Conferir recebimento, sobretudo junto ao caixa. |
| Ranking/TV | INFORMATIVE / diferencial | Engajar evento de chope; não é controle operacional. |
| CSV/transações | INFORMATIVE | Auditoria e análise posterior. |
| Alertas de estoque crítico/caixa/pedido atrasado | MISSING_HIGH_VALUE | Ação imediata, não só leitura. |

Evitar expandir gráficos antes de expor as seis perguntas de dono com ação direta: venda hoje, recebido, ticket, produto líder, estoque crítico e diferença de caixa.

## 19. Payments / Cash

Pagamentos em ambos os módulos aceitam dinheiro, PIX e cartão; a soma é validada contra a comanda e há divisão. O quiosque inclui valor recebido/troco, caixa aberto, movimentos, correção mediante credencial do dono, contagem de dinheiro/PIX/cartões, divergência e resumo. Isso é um bom núcleo de confiança.

Na cervejaria, pagamentos por evento são confiáveis como registro, porém não existe o ritual de caixa: abertura, sangria, contado e diferença. Portanto, o dono pode ver “recebi X no sistema”, mas não recebe resposta igualmente forte para “a gaveta bate?”. Este é o maior gap de controle financeiro funcional.

## 20. Inventory

O estoque do quiosque é deliberadamente simples e adequado: saldo por ponto, entrada, saída por perda/cortesia/consumo interno, ajuste, baixa transacional na venda e proteção de último item concorrente segundo QA. Não há fornecedor, custo, inventário complexo ou logística — correto para o público.

Faltam mínimo por produto, destaque de criticidade e explicação de indisponibilidade antes de o atendente começar uma venda. Não há controle para cervejaria/barris; isso pode ser uma necessidade real, mas requer feedback de campo antes de virar módulo.

## 21. Kitchen

O quiosque possui fila por ordem de chegada, pedidos de itens que exigem preparo, estados `RECEBIDO → EM_PREPARO → PRONTO → ENTREGUE`, retorno para corrigir toque, TV e realtime. A fila preserva pendências através da mudança de dia, que evita perda operacional.

Fragilidade: o cancelamento protegido está na tela do dono, mas não há tempo/alerta de atraso claramente voltado ao operador; e o cliente do portal não recebe ciclo de cozinha. A devolução automática de estoque no cancelamento permanece uma decisão aberta; priorizar idade do pedido antes de qualquer integração sofisticada.

## 22. Comandas

Comandas são o core e estão maduras para o estágio: identificação, numeração/evento ou mesa/ficha/apelido, cliente, itens, descontos protegidos, pagamentos divididos, fechamento, cancelamento aberto, recibo, fechamento em grupo e isolamento/concorrência. Comanda fechada é somente leitura, uma boa escolha de segurança.

Gaps de maior valor: acelerar a entrada/localização e criar exceção financeira controlada para venda fechada errada. “Reabrir comanda” livre não é recomendação; a solução deve preservar rastreabilidade e caixa.

## 23. Portal

O portal canônico é o **PDV** (`/c/:slug/p/:pontoVendaId`): QR contextual ao ponto/caixa; autenticação leve por telefone/nome; pedido operacional; solicitar pagamento (equipe fecha no caixa). Não é checkout com PIX do cliente. O portal de evento/trailer (`/t/`) foi descontinuado (TAP-141).

Prioridade: esclarecer estados de preparo no PDV. Não priorizar pagamento integrado, cadastro social, CRM de marketing ou app separado sem evidência real.

## 24. Realtime

Realtime entrega valor diretamente em: atualização de comandas entre atendentes, fila do portal, cozinha e ranking/TV. Há rooms e testes de isolamento/latência, mais indicador de conexão/reconexão. Esse é valor funcional real, não apenas infraestrutura.

Quando a conexão cai, o shell PWA pode permanecer disponível e a interface mostra “Sem conexão”, mas escritas não entram em fila e exigem internet. Classificação: **KNOWN_LIMITATION**. A resposta de produto agora é tornar a limitação visível e recuperável; offline-first não entra neste roadmap.

## 25. Onboarding

Admin cria empresa, dono, módulos e branding. O dono então precisa decidir e cadastrar catálogo, preço, trailer/taps ou ponto, cardápio opcional, equipe e evento/caixa antes da primeira venda. A capacidade existe, mas o caminho é distribuído entre telas e depende de conhecimento prévio.

Oportunidade: checklist por modo com progresso e defaults mínimos, por exemplo: “1. produto; 2. ponto/trailer; 3. caixa/evento; 4. primeira venda”. Não requer ERP nem importação complexa no primeiro incremento.

## 26. First-Day Experience

**Cenário cervejaria:** Admin cadastra empresa → dono cria produto/preço → trailer → taps → evento e montagem → abre comanda.  
**Cenário quiosque:** Admin escolhe flags → dono cria produto/ponto → abre caixa → vende.

O cliente consegue começar se receber orientação, mas o sistema não confirma que cada pré-requisito foi concluído nem explica escolhas opcionais como cardápio, grade de mesas e KPIs. O risco é configurar demais antes de vender. O checklist guiado é a melhoria de primeira experiência com melhor relação valor/esforço.

## 27. Quick Wins

`TOP QUICK WINS` (máximo 10)

| ID | Melhoria | Valor | Esforço | Por quê |
|---|---|---:|---|---|
| QW-01 | Expor cancelamento de cozinha ao DONO com confirmação contextual. | 5 | S | DONE — reutiliza o fluxo já implementado no backend; o contrato atual não possui motivo. |
| QW-02 | Exibir idade e destaque simples para pedido de cozinha/portal pendente. | 4 | S | Reduz pedido esquecido. |
| QW-03 | Busca/atalho mais forte de comanda (recentes + identificador). | 5 | S/M | Remove tempo no fluxo mais repetido. |
| QW-04 | Favoritos/último item e volume padrão por tap/evento. | 5 | M | Poupa muitos toques sem mudar regra financeira. |
| QW-05 | Estoque crítico com mínimo simples e badge no PDV. | 5 | M | Evita venda frustrada/ruptura. |
| QW-06 | Checklist “pronto para vender” por modo. | 5 | M | Acelera ativação e reduz suporte. |
| QW-07 | Cartão de atenção do dono: caixa divergente, pedido atrasado, estoque crítico. | 5 | M | Converte dados existentes em ação. |
| QW-08 | Indicador de recorrente/última visita no cliente/comanda. | 3 | S/M | Usa dados já agregados sem virar CRM. |
| QW-09 | Simplificar/ocultar preferências avançadas até necessidade. | 3 | S | Reduz carga de configuração. |

## 28. Big Bets

| ID | Iniciativa | Valor | Esforço | Condição |
|---|---|---:|---|---|
| BB-01 | Caixa completo para eventos de cervejaria. | 5 | L | Priorizar se cervejaria é vertical comercial principal. |
| BB-02 | Fluxo de correção/estorno de venda fechada, autorizado e auditado. | 5 | L | Desenhar com caixa e regras de auditoria; não reabrir livremente. |
| BB-03 | Acompanhamento operacional do pedido do portal até entrega. | 4 | L | Só após validar que pedidos de portal incluem preparo/entrega no campo. |
| BB-04 | Estoque de chope/barris para cervejaria. | 4 | L/XL | Fazer discovery real antes; pode sair do escopo simples. |

## 29. Do Not Build Now

`DO_NOT_BUILD_NOW`

- ERP, contabilidade, folha, fornecedores, compras e logística.
- Emissão fiscal completa e integração complexa com adquirentes.
- CRM enterprise, campanhas automáticas ou automação de marketing.
- BI self-service, cubos, dashboards configuráveis e métricas sem decisão clara.
- Offline-first com fila de transações conflitantes.
- Aplicativo nativo separado, multilíngue/multimoeda.
- IA como funcionalidade de balcão sem problema de usuário e evidência concreta.
- Reabertura irrestrita de venda/comanda fechada.

## 30. Consolidated Functional Backlog

| ID | Área | Problema | Requisito | Papel | Tipo | V/F/R/E* | Prioridade | Evidência |
|---|---|---|---|---|---|---|---|---|
| PROD-01 | Caixa cervejaria | Registro de pagamento não confere gaveta. | Reframar a conferência leve de evento somente se observação de campo demonstrar necessidade. | Atendente/dono | DEFERRED / REFRAMED | - | DEFERRED | caixa separado adicionaria burocracia ao trailer simples sem evidência de uso. |
| PROD-02 | Comandas | Venda fechada errada não tem exceção segura. | Estorno/correção autorizado, auditado e refletido no caixa/relatório. | Dono | FUNCTIONAL_GAP | 5/3/5/L | P1 | fechada é somente leitura. |
| PROD-03 | Fluxo de venda | Muitos toques para localizar e lançar item. | Busca rápida e continuidade segura do lançamento. | Atendente | IMPROVEMENT | 5/5/3/M | DONE | Busca local já disponível, pós-lançamento otimizado e validação transacional preservada. |
| PROD-04 | Cozinha | Cancelamento antes exigia contorno pela API. | Ação de dono com confirmação contextual e atualização de conta/fila. | Dono | FUNCTIONAL_GAP | 5/3/4/S | DONE | UI operacional e E2E cobrem o fluxo; o contrato atual não possui motivo. |
| PROD-05 | Estoque | Saldo não antecipava ruptura. | Mínimo por item, alerta e indisponibilidade clara. | Atendente/dono | FUNCTIONAL_GAP | 5/4/4/M | DONE | mínimo por produto/ponto, alerta LOW/OUT_OF_STOCK, indisponibilidade visível e validação integrada. |

**PROD-04-F01 — OPEN PRODUCT DECISION:** o cancelamento de pedido de cozinha continua sem devolver estoque automaticamente. PROD-05 não altera essa regra financeira/operacional.
| PROD-06 | Onboarding | Configuração inicial depende de conhecimento do produto. | Checklist por modo até primeira venda. | Admin/dono | IMPROVEMENT | 5/3/3/M | P1 | rotas existem, sem jornada guiada. |
| PROD-07 | Dono | Dados não viram exceções priorizadas. | Painel curto de atenção operacional. | Dono | IMPROVEMENT | 5/3/4/M | P1 | dashboards, caixa/estoque/fila já fornecem dados. |
| PROD-08 | Portal | Cliente não sabe se/como pedido avançou. | Estado claro e próxima ação; mapear entrega quando aplicável. | Cliente | IMPROVEMENT | 4/3/3/M | P2 | portal confirma/recusa, sem preparo/ETA. |
| PROD-09 | Clientes | Recorrência existe apenas em detalhe. | Indicador simples de retorno/última visita. | Dono/atendente | IMPROVEMENT | 3/3/2/S/M | P2 | `ClienteEstatisticas`. |
| PROD-10 | Configuração | Preferências avançadas surgem cedo demais. | Defaults e seção “avançado”. | Dono | IMPROVEMENT | 3/3/2/S | P2 | flags de cardápio/KPI/layout/mesas. |
| PROD-11 | Cozinha | Pedido pode envelhecer sem destaque. | Idade/SLA visual simples e alerta local. | Cozinha/dono | IMPROVEMENT | 4/4/3/S | P1 | timestamps/realtime existem. |
| PROD-12 | Estoque cervejaria | Sem visão de barril/insumo. | Validar necessidade de campo antes de desenhar mínimo viável. | Dono | NEW_CAPABILITY | 4/3/3/L | P3 | não há modelo atual. |

\* V/F/R/E = User Value / Frequency / Risk Reduction / Effort.

**BUG:** nenhum bug funcional confirmado nesta auditoria estática. Itens acima são `FUNCTIONAL_GAP`, `IMPROVEMENT` ou `NEW_CAPABILITY`; não devem ser reclassificados como bug sem reprodução.

## 31. Top 10 Functional Priorities

1. **PROD-03 — Venda/comanda rápida:** atendente; menos tempo e conta errada; busca/favoritos/defaults; M; acontece a cada venda.
2. **PROD-05 — Estoque crítico do quiosque:** DONE; atendente/dono; evita ruptura; mínimo/alerta; M.
3. **PROD-04 — Cancelamento de cozinha na UI:** DONE; dono; ação protegida; S.
5. **PROD-06 — Onboarding até primeira venda:** admin/dono; reduz abandono/suporte; checklist por modo; M; melhora conversão inicial.
6. **PROD-07 — Atenção do dono:** dono; menos perda e trabalho mental; exceções de caixa/estoque/fila; M; antes de novo BI.
7. **PROD-02 — Correção financeira auditada:** dono; reduz erro irreversível; estorno autorizado; L; relevante, mas exige desenho cuidadoso.
8. **PROD-11 — Idade de pedido de cozinha:** cozinha/dono; reduz atraso; badges/alerta; S; simples e frequente.
9. **PROD-08 — Status do portal:** cliente; reduz espera e chamadas; estado/entrega; M; depende da operação local.
10. **PROD-09 — Recorrência simples:** dono/atendente; atendimento e retenção; indicador de retorno; S/M; usa dados existentes.

Dependências reais: PROD-03 usa dados atuais de comandas/produtos; PROD-04 usa transição/API existente; PROD-05 amplia saldo/movimento atuais; PROD-06 depende somente de estados já consultáveis. PROD-01 só volta a discovery se houver evidência de campo. Não há dependência de Support Analyst, LLM, refatoração preventiva ou novo banco analítico.

## 32. Next 3 Functional Initiatives

1. **PROD-03 — Acelerar venda e comanda.** Maior retorno por frequência e menor risco; aplicar em ambos os módulos quando o padrão for realmente compartilhado.
2. **PROD-06 — Onboarding até primeira venda.** Reduz abandono/suporte e já usa estados consultáveis.
3. **PROD-07 — Atenção do dono.** Converte dados existentes em poucas exceções acionáveis. PROD-04 e PROD-05 estão concluídos.

### Acceptance concept

**PROD-03**

Given um atendente com evento/turno ativo, When procura uma comanda ou lança item recorrente, Then consegue selecionar o destino e registrar o item com menos passos, mantendo produto, quantidade, total e restrições atuais visíveis antes da confirmação.

### PROD-03 — fechamento funcional (2026-09-02)

**Baseline reconstruída no código**

| Fluxo | Antes | Depois |
|---|---|---|
| Localizar comanda — cervejaria | Aba → busca por nome/número/telefone → selecionar cartão. A busca já era local. | Mesmo fluxo; o campo explicita os três identificadores suportados. |
| Localizar comanda — quiosque | Aba → busca por número/mesa/ficha/apelido → selecionar cartão. A busca já era local. | Mesmo fluxo; o campo explicita os quatro identificadores suportados. |
| Lançar próximo item — cervejaria | Confirmar item → modal fecha → tocar `+ Itens` → abrir modal outra vez. | Confirmar item → modal permanece aberto, mostra sucesso e conserva produto, volume, quantidade e total visíveis para revisão/novo lançamento. |
| Lançar próxima rodada — quiosque | Confirmar itens → modal fecha → tocar `+ Itens` → abrir modal outra vez. | Confirmar itens → carrinho limpa e modal permanece aberto para selecionar a próxima rodada. |

**Resultado:** dois toques/modais eliminados por rodada adicional nos fluxos de item da cervejaria e do quiosque. A confirmação continua explícita e o backend continua validando preço, disponibilidade/estoque e estado concorrente da comanda.

**Decisões de escopo:** não foram criadas comandas recentes (persistência/risco de destino errado), favoritos (exigiria configuração ou fonte segura de ranking), nem novo volume padrão (o primeiro volume configurado já é escolhido de forma visível). Quantidade 1 e a busca local sem requests por tecla já existiam e foram preservadas. Venda avulsa foi preservada.

**Backlog derivado:** `PROD-03-F01` — avaliar recentes por sessão somente após observação de operação; benefício é reduzir busca, mas ficou fora por risco de seleção errada e ausência de persistência/contexto seguro. `PROD-03-F02` — avaliar favoritos derivados de turno/evento quando houver uma fonte de dados já autorizada; ficou fora para não criar modelo/CRUD novo.

**PROD-01**

Given um evento aberto, When o caixa é iniciado, movimentado e encerrado, Then o sistema mostra esperado e contado por forma, calcula diferença, registra responsável/motivo e não altera pagamentos já consolidados sem trilha auditável.

**PROD-05**

Given controle de estoque habilitado, When o saldo chega ao mínimo configurado ou não suporta a venda, Then atendente e dono veem estado inequívoco antes de concluir uma nova venda, sem bloquear itens acima do mínimo nem exigir módulo de compras.

## 33. Dual-Track Roadmap

| Horizonte | TRACK A — PRODUCT FUNCTIONAL EVOLUTION | TRACK B — PLATFORM / SUPPORT ANALYST |
|---|---|---|
| Próximo ciclo | PROD-06; PROD-07; registrar feedback de 3–5 turnos. | Concluir somente o piloto/aceite já planejado, de modo separado e limitado. |
| Ciclo seguinte | PROD-02 ou uma hipótese observada em campo; considerar PROD-01 somente se houver evidência. | Operar/revisar resultados do Analyst; corrigir apenas bloqueadores comprovados. |
| Depois | PROD-02 e portal/recorrência conforme uso; decidir se estoque cervejaria merece discovery. | Evoluções técnicas somente com problema de produto/operacional explicitamente ligado. |

## 34. Product Scorecard

| Dimensão | Nota | Justificativa curta |
|---|---:|---|
| Operational Value | 8 | Operação real de comandas/PDV, caixa quiosque e realtime. |
| Ease of Use | 7 | Mobile-first e botões grandes, mas configuração e pico ainda exigem passos. |
| Speed of Operation | 7 | Venda avulsa é boa; comanda/item pode ser mais rápida. |
| Owner Value | 7 | Relatórios bons, caixa quiosque forte; caixa cervejaria é lacuna. |
| Attendant Value | 8 | Core de venda completo e protegido; há atrito de lançamento/localização. |
| Customer Value | 6 | QR e transparência ajudam, mas pedido/pagamento continuam assistidos. |
| Functional Completeness | 8 | Fluxos principais implementados; gaps importantes são localizados. |
| Mobile Usability | 8 | PWA, navegação inferior, alvos de toque e telas de operação. |
| Differentiation | 7 | Taps+comandas+portal/realtime ou caixa+cozinha/estoque distinguem do caderno. |
| Commercial Readiness | 7 | Vendável com escopo claro e gaps de controle reconhecidos. |

## 35. Commercial Readiness

**YES_WITH_GAPS.** O produto é comercializável para clientes que aceitam internet como premissa e cujo fluxo se encaixa em cervejaria de evento ou quiosque simples. O valor é demonstrável já na primeira operação: controle de comanda, pagamento, equipe simultânea, portal e fechamento/relatório.

Blockers práticos para ampliar venda: explicar a limitação de conexão; não vender caixa de cervejaria como se já tivesse conferência física; validar o onboarding na primeira conta; e não prometer estoque de barril, fiscal, adquirência ou CRM avançado. A retenção tende a vir de diminuir trabalho de turno e dar confiança ao dono, não de adicionar módulos enterprise.

**Valor comercial:** PROD-03 torna a demonstração diária mais rápida; PROD-01 e PROD-05 justificam mensalidade por reduzir perda/conferência manual; PROD-06 reduz esforço de ativação; portal e realtime diferenciam o produto de caderno/planilha. A hipótese deve ser medida por primeira venda, uso recorrente e feedback de renovação, não por cálculo financeiro inventado.

## 36. Final Recommendation

Preservar os fluxos transacionais existentes e mover o centro de gravidade para o atendimento no pico e a confiança diária do dono. Executar primeiro redução de passos e gaps quase completos; fazer discovery curto antes de caixa de cervejaria/estoque de barril; colher feedback real por item e não por opiniões genéricas.

### Functional Value Gate

Antes de iniciar uma sequência longa de tickets técnicos, reservar uma revisão curta do backlog funcional: feedback com contexto de turno, operações de maior frequência, erros/perdas observados, funcionalidades 70–90% prontas e resultado comercial esperado. A saída é uma decisão simples: manter o ticket técnico, substituir por item de produto ou dividir capacidade entre as duas trilhas. Não exige comitê, métrica artificial ou aprovação burocrática.

### What is already good — preserve

- isolamento multi-tenant, RBAC e regras de pagamento;
- ciclo de comanda, pagamentos divididos e fechamento em grupo;
- caixa do quiosque, incluindo correção autorizada;
- taps/montagem por evento e ranking ao vivo;
- portal assistido com confirmação humana;
- flags de modo que escondem módulos não aplicáveis;
- atualização realtime e sinalização de conexão.

### What needs attention / simplify

- velocidade de encontrar/abrir comanda e lançar item;
- caixa da cervejaria e correção financeira controlada;
- estoque crítico e cancelamento visual de cozinha;
- onboarding/checklist e defaults de configuração;
- dashboards convertidos em poucas exceções acionáveis;
- ocultar preferências avançadas até necessidade, sem removê-las.

### Feature bloat review

| Classificação | Função | Decisão |
|---|---|---|
| KEEP | Comandas, pagamentos divididos, caixa do quiosque, taps, portal assistido e realtime. | São o valor central e não devem ser refeitos agora. |
| KEEP | Ranking/TV. | Diferencial para eventos de chope, embora não seja fluxo de venda. |
| SIMPLIFY | Dashboard e resumo. | Preservar dados, começar por perguntas e exceções que geram ação. |
| SIMPLIFY | Preferências de cardápio, KPIs, layout e mesas. | Manter opções, oferecer defaults e esconder “avançado” inicialmente. |
| HIDE | Ranking/TV em operações que não usam chope/evento. | Não remover; evitar ocupar atenção no quiosque. |
| REMOVE_LATER | Nenhuma função confirmada. | Não há evidência de uso baixo suficiente para propor remoção. |

## Decision Summary

**PRODUCT MATURITY:** USABLE_PRODUCT  
**COMMERCIAL READINESS:** YES_WITH_GAPS  
**CURRENT VALUE PROPOSITION:** POS operacional simples para evento/quiosque, com controle compartilhado de venda, comanda, pagamento e operação específica.  
**FUNCTIONAL FIT:** 8/10  
**BIGGEST USER PAIN:** passos repetidos para localizar comanda e lançar itens no pico.  
**BIGGEST OWNER PAIN:** confiar e agir sobre o fechamento, especialmente em cervejaria sem caixa físico.  
**BIGGEST ATTENDANT PAIN:** velocidade sem errar comanda/item/pagamento.  
**BIGGEST CUSTOMER PAIN:** espera pouco transparente após enviar pedido.  
**TOP QUICK WIN:** expor cancelamento de cozinha na UI e, em paralelo, acelerar busca/lançamento.  
**TOP 3 FUNCTIONAL INITIATIVES:** PROD-03, PROD-01, PROD-05 (com PROD-04 como quick win separado).  
**TOP 10 FUNCTIONAL PRIORITIES:** seção 31.  
**FUNCTIONAL BLOCKERS:** caixa de cervejaria, correção pós-fechamento, estoque crítico, onboarding e estado do pedido; nenhum impede o core atual, mas limitam confiança/escala comercial.  
**FUNCTIONS TO PRESERVE:** comandas, pagamentos, caixa quiosque, taps, portal assistido, realtime e modos.  
**FUNCTIONS TO SIMPLIFY:** configuração avançada, jornada de comanda, leitura de dashboard.  
**DO NOT BUILD NOW:** ERP/fiscal/adquirência/CRM enterprise/BI/offline-first/IA de balcão.  
**NEXT PRODUCT CYCLE:** produtividade do atendente + fechamento de gaps quase completos + discovery de caixa cervejaria.  
**ANALYST RELATION:** indireta; pode sinalizar indisponibilidade/erros que afetem vendas, mas não é dependência de nenhuma prioridade funcional acima.

## Evidence and limitations

### Modules/files inspected

- Backend: `backend/prisma/schema.prisma`; `backend/src/app.ts`; rotas de auth, admin, cervejaria, eventos, comandas, pagamentos, vendas avulsas, clientes, produtos, cardápios, taps, trailers, ranking, relatórios, público, pedidos e todo o módulo `routes/quiosque/*`; serviços de comanda/caixa/cozinha/estoque.
- Frontend: `frontend/src/App.tsx`, layouts/navegação, `ConnectionStatus`, páginas de evento/comanda/venda/portal/dashboard/resumo/clientes/configuração/ranking/admin e páginas/componentes de quiosque, caixa, cozinha, estoque e cardápio.
- Evidência de teste: matriz QA, plano/relatório QA e E2E de PDV, caixa, cozinha, portal, híbrida, RBAC, ranking, PWA e admin.
- Contexto: `README.md`, especificação, manual, `docs/roadmap/pos-primeiro-dia.md`, auditoria TQ-AUDIT-02 e histórico Git.

### Evidence limitations

- Auditoria estática: nenhum serviço foi iniciado e nenhum teste foi executado nesta tarefa.
- Não houve entrevista, telemetria de uso, observação de turno, dados de conversão ou feedback de cliente registrado.
- “Passos” e frequência são estimativas de fluxo, não medição cronometada; validação em campo é necessária antes de Big Bets.
- Documentação foi usada para contexto, mas status foi prioritariamente confrontado com rotas, schema, UI e testes.

### Approximate effort

Para implementação, os Quick Wins são S/M por item; o Top 3 representa aproximadamente **S/M + L + M** de esforço relativo. A estimativa deve ser refinada depois do discovery de caixa de cervejaria e de uma sessão de observação de operação real.
