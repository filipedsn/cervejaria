# TQ-PROD-01-D — Discovery: caixa de cervejaria

**Data:** 2026-09-02  
**Tipo:** discovery funcional; nenhuma implementação proposta neste artefato.  
**Escopo de evidência:** leitura de schema, backend, frontend, testes E2E/QA e documento de auditoria anterior.

## 1. Executive Summary

### Problema e recomendação

O problema é válido. A cervejaria já registra uma venda de forma consistente, inclusive venda avulsa, pagamento dividido e desconto. Porém, ao encerrar um evento, o dono só vê o que o sistema registrou; não há uma rotina que compare isso com o dinheiro físico e os totais efetivamente conferidos de PIX/cartão. O relatório atual responde “quanto vendeu”; não responde, de forma auditável, “bateu?”.

O menor modelo útil é um **caixa lógico por evento-sessão**, com um único ciclo aberto por evento no MVP: abertura opcional com troco inicial, expectativa por forma a partir dos pagamentos já registrados, movimentos de dinheiro apenas quando necessários, conferência por forma, diferença calculada e fechamento imutável. Isso é controle financeiro operacional, não contas a pagar/receber nem conciliação bancária.

**Recomendação:** `BUILD_AFTER_SMALL_FIELD_VALIDATION`. O código permite decidir o agregado e a fonte de verdade; faltam respostas de campo, principalmente sobre gaveta/troco, sangria e quantas pessoas/dispositivos recebem no mesmo evento. Essas respostas podem manter o MVP em um caixa por evento ou exigir que ele nasça com subcaixas por operador/trailer.

### Fluxo proposto (conceitual)

```text
Evento ABERTO
  → dono/atendente autorizado abre CaixaEvento (troco opcional)
  → comandas e vendas avulsas fechadas criam Pagamento(s) por forma
  → esperado = soma dos Pagamento(s) do evento
  → esperado de dinheiro na gaveta = troco + dinheiro + suprimentos − sangrias
  → operador informa valores conferidos por forma
  → diferença = contado − esperado, por forma e total
  → dono fecha CaixaEvento, preservando snapshot/auditoria
  → evento pode ser encerrado conforme política de caixa escolhida
```

## 2. Current Brewery Financial Flow

```text
Evento (trailer, status ABERTO)
  → comanda regular OU venda avulsa
  → itens e total (subtotal − desconto)
  → fechamento individual ou conjunto
  → uma ou mais linhas Pagamento(forma, valor)
  → Comanda FECHADA + TransacaoLog
  → dashboard enquanto aberto / resumo executivo e CSV após encerrar
```

- A `Comanda` de cervejaria tem `eventoId`; `Pagamento` pertence à comanda e armazena `forma`, `valor`, `valorRecebido`, `troco`, `registradoPorId` e `pagoEm`.
- Os fechamentos exigem que a soma dos pagamentos seja igual ao total da comanda. Pagamentos divididos são linhas independentes; portanto R$ X em dinheiro + Y PIX + Z cartão já é agregável sem nova regra.
- `vendas-avulsas.ts` cria uma `Comanda` `AVULSA` para o mesmo `eventoId`, aplica eventual desconto, fecha-a na mesma transação e usa o mesmo serviço de pagamentos. Ela participa tanto da receita como do `porPagamento` do resumo executivo.
- O fechamento conjunto recebe um conjunto de comandas do mesmo evento e distribui deterministamente cada linha de pagamento entre as comandas fechadas. Não cria pagamento adicional: a agregação do caixa deve somar `Pagamento`, não somar “total de comanda” e pagamentos em paralelo.
- Desconto reduz `Comanda.total`; logo altera o valor exigido/registrado e, corretamente, o esperado do caixa. Conta zerada não recebe pagamento.
- Comanda sem itens é cancelada; cancelamento não cria `Pagamento`. Não há estorno de venda já fechada no módulo cervejaria. Cancelamentos de cozinha são assunto separado (`PROD-04-F01`, política de estoque posterior) e não devem virar ajuste de caixa neste recorte.
- Evento só fecha sem comandas abertas. O resumo executivo só fica disponível ao DONO após `Evento.status = FECHADO`; calcula receita e pagamentos das comandas fechadas, incluindo avulsas. A rota simples de relatório também agrega os pagamentos dessas comandas.

**PIX/cartão hoje:** são formas declaradas, sem conta destino, identificador de transação, adquirente, TEF, gateway ou conciliação externa. Há ainda o enum legado `CARTAO`, além de débito/crédito. Para o MVP, conferir o valor informado por forma é coerente; reconciliação bancária não é evidenciada nem necessária.

## 3. Current Kiosk Cash Model

O quiosque implementa uma sessão por **cervejaria + ponto de venda + dia operacional**. O mesmo ponto pode ter turnos sucessivos no dia, mas não dois turnos abertos simultaneamente.

```text
Ponto de venda selecionado
  → abrir SessaoCaixaQuiosque(trocoInicial, abertoPor, dia operacional)
  → liberar venda/comanda no ponto
  → pagamentos de comandas QUIOSQUE FECHADAS no intervalo da sessão
  → [sangria | suprimento]*
  → bloquear fechamento se há comandas não avulsas abertas
  → informar contado: dinheiro, PIX, débito, crédito
  → calcular diferenças e fechar
  → relatório de turno, movimentos e responsáveis
```

### Modelo e responsabilidades do quiosque

| Modelo | Responsabilidade / relações | Lifecycle e invariants | Escopo / cervejaria |
|---|---|---|---|
| `SessaoCaixaQuiosque` | Sessão, ponto, dia, abertura/fechamento, troco, contagens e observação; relaciona `MovimentoCaixaQuiosque`. | `ABERTO → FECHADO`; contagens são nulas enquanto aberto; uma aberta por ponto/dia; pode haver novo turno após fechar. | `cervejariaId` explícito e `PontoVenda` pertencente ao tenant. |
| `MovimentoCaixaQuiosque` | Sangria ou suprimento, valor, observação e identidade de registro; correções encadeiam original/estorno/substituição. | Valor > 0; apenas sessão aberta; original não é reescrito; correção exige motivo e credencial do dono. | Indireto pela sessão, cuja busca é sempre escopada por tenant. |
| `Comanda`/`Pagamento` de quiosque | Fonte de vendas da sessão por `origem=QUIOSQUE`, ponto, dia e janela abertura/fechamento. | Só comandas fechadas entram; pagamento total igual ao devido; o caixa não altera pagamentos. | Ponto é filtrado por cervejaria. |
| `TransacaoLog` | Rastro de abrir, movimentar, corrigir e fechar. | Append-only de aplicação; payload de senha não é logado. | `cervejariaId` obrigatório e entidade/evento/comanda opcionais. |

**Esperado de caixa:** por forma, soma os pagamentos; o dinheiro físico esperado é separado: `troco inicial + vendas em dinheiro + suprimentos − sangrias`. A divergência é `contado − esperado` por forma. PIX/débito/crédito não entram na gaveta, mas são conferidos no fechamento.

**Concorrência e auditoria existentes:** mutações de caixa usam transação PostgreSQL e advisory lock por ponto/dia; o fechamento volta a validar sessão aberta. O caixa impede venda sem sessão aberta e impede fechar com comandas abertas. Abre, movimento, correção e fechamento geram `TransacaoLog`; há resumo e E2E do ciclo, além de testes property-based das contas e da correção.

**Permissões atuais:** abrir/movimentar/fechar não têm `requireDono` na rota de caixa e aceitam a identidade autenticada do módulo; relatório fechado e correção de movimento exigem/são autorizados por dono. Isso é uma escolha do quiosque, não evidência de que deva ser copiada integralmente.

## 4. Reuse Assessment

| Capability | Reuse directly | Adapt | Do not reuse |
|---|---:|---:|---:|
| Fórmulas por forma, centavos e diferença |  | Sim |  |
| Conceito abertura → operar → conferir → fechar |  | Sim |  |
| Snapshot/relatório de fechamento e `TransacaoLog` |  | Sim |  |
| Lock transacional/advisory-lock |  | Sim, chave por evento |  |
| Pagamentos como fonte de esperado | Sim |  |  |
| Sangria/suprimento e correção imutável |  | Sim, somente se campo validar |  |
| Sessão por ponto + dia operacional |  |  | Sim |
| Catálogo/preço do turno |  |  | Sim |
| Bloquear toda venda por caixa aberto |  | Sim, decisão de produto |  |
| UI do `PainelCaixaQuiosque` |  | Sim, jornada e rótulos |  |
| Modelo Prisma do quiosque |  |  | Sim — pertence a ponto/dia, não evento |
| Correção de movimento com senha de dono |  | Sim, como referência para PROD-02 |  |
| Testes de cálculo e concorrência |  | Sim |  |

Não se recomenda uma abstração prematura “caixa universal”. O modelo do quiosque carrega ponto, dia operacional, catálogo do turno e regras de venda que não pertencem à cervejaria. Uma regra pequena específica de evento, compartilhando fórmulas/utilitários somente se isso permanecer simples, tem menor risco.

## 5. Event/Cash Relationship

**Melhor aggregate candidato: A. caixa por EVENTO (sessão de evento), com relação explícita ao trailer apenas como contexto.**

Evidência: toda venda de cervejaria, inclusive avulsa, é ligada a `eventoId`; pagamentos são filhos dessas comandas; relatórios e resumo agregam por `eventoId`; o evento já é o ciclo de abertura/encerramento. O trailer organiza equipamento e agenda, mas não é a chave de faturamento: um trailer pode realizar eventos em datas distintas e o mesmo evento já aponta a um trailer.

`TRAILER + EVENTO` não melhora isolamento funcional, pois o trailer já é determinado pelo evento. `OPERADOR` e `TERMINAL` não possuem entidade ou vínculo nas vendas atuais; adotá-los exigiria atribuir cada pagamento a uma subcaixa, o que é uma expansão de escopo e não uma adaptação neutra.

### Um ou vários caixas

**MVP: `PROBABLY` um único caixa lógico por evento é suficiente.** Há múltiplos usuários autenticados e múltiplos dispositivos/realtime, mas não há modelo atual de terminal, atendente responsável por pagamento ou múltiplos trailers dentro de um evento. Ao mesmo tempo, o código não informa se há uma gaveta/conta PIX única em campo. Validar antes de cristalizar o modelo.

O “um caixa” é lógico: vários atendentes podem registrar pagamento dentro dele, mas o fechamento produz uma conferência única. Se campo confirmar caixas físicos independentes ou PIX/cartão por operador, o próximo desenho deve ser “sessões de caixa por evento”, não trocar a chave dos pagamentos históricos.

## 6. Cash Ownership and Permissions

O sistema possui somente `DONO` e `ATENDENTE` para tenant. Nas rotas de cervejaria, ambos autenticados podem criar/operar eventos, comandas, venda avulsa e pagamentos; resumo executivo, transações e relatórios são de DONO. Desconto de cervejaria reutiliza uma permissão cujo nome é de quiosque — evidência de dívida de nomenclatura, não de autorização financeira própria.

Proposta mínima a decidir:

- **Abrir:** DONO por padrão; ATENDENTE somente se o dono delegar a operação de caixa.
- **Movimentar:** operador autorizado; registrar responsável e observação.
- **Fechar:** DONO, ou ATENDENTE autorizado com revisão do DONO visível no relatório.
- **Corrigir pós-fechamento:** fora de PROD-01; reservar para DONO e trilha auditável em PROD-02.
- **Consultar:** DONO; atendente pode ver estado operacional e o esperado necessário para operar, mas não precisa de histórico financeiro completo.

Essa matriz precisa de decisão de product owner, porque a autorização de caixa não existe no domínio cervejaria hoje.

## 7. Payment Aggregation

A fonte de verdade deve ser `Pagamento` de `Comanda` do evento com status `FECHADA`, não o total de itens nem o total dos relatórios. Isso cobre:

- comanda regular e venda avulsa;
- pagamento dividido;
- pagamento conjunto, pois suas linhas são alocadas entre comandas e cada linha existe uma vez;
- descontos, porque diminuem a comanda e a validação impõe pagamentos iguais ao total final;
- comandas canceladas/vazias, que não possuem pagamentos.

O caixa deve normalizar ou exibir separadamente o legado `CARTAO`; há decisão pendente sobre mapeá-lo a “cartão não especificado” ou exigir escolha débito/crédito nas operações futuras. Não deve inventar conciliação de PIX, banco, adquirente ou taxa de cartão.

## 8. Opening

Estados mínimos: `NOT_OPENED → OPEN → CLOSED`. Não há evidência para `REOPENED`; a preferência é não reabrir um caixa fechado. Se novas vendas forem permitidas após fechamento, criar **novo ciclo** vinculado ao mesmo evento, preservando o primeiro snapshot; isto requer decisão de produto e pode ficar fora do MVP se o evento for bloqueado após o caixa fechar.

**Abertura MVP:** apresentar uma única ação antes/na primeira operação financeira do evento, com troco inicial opcional (default 0), responsável e horário. Não condicionar a criação de comanda, lançamento de item ou navegação ao caixa; condicionar somente o fechamento de pagamentos é uma opção, mas altera operação e deve ser validada no campo.

### Troco, sangria e suprimento

| Conceito | Classificação | Proposta condicionada |
|---|---|---|
| Troco inicial | `FIELD_VALIDATION_REQUIRED` | Se houver uma gaveta/bolsa de dinheiro, registrar na abertura e usar apenas no esperado físico. Se só PIX/cartão ou dinheiro sem fundo separado, default zero basta. |
| Sangria | `OPTIONAL` | Incluir somente se operadores confirmarem retirada durante evento por segurança/troca de responsável. Valor, motivo curto e autor devem afetar apenas dinheiro esperado. |
| Suprimento | `OPTIONAL` | Incluir apenas para reforço de troco durante o evento; não é receita e não deve afetar PIX/cartão/total de vendas. |

Movimentos não são necessários para provar o valor básico do MVP; podem ser capacidade 7/8, condicionada à validação. Caso existam, a referência correta é o padrão do quiosque: valor positivo, tipo explícito, usuário, horário, observação e correção por novos lançamentos — nunca editar silenciosamente.

## 9. Closing and Divergence

Tela mobile-first proposta:

1. **Sistema registrou:** Dinheiro, PIX, cartão (débito/crédito e cartão legado quando aplicável), total de pagamentos; para dinheiro, mostrar separadamente vendas e `esperado na gaveta`.
2. **Operador confere:** dinheiro contado; PIX conferido; débito/crédito conferidos. “Conferido” é valor informado, não integração externa.
3. **Resultado:** diferença por forma e diferença total, destaque para diferença não zero.
4. **Confirmar fechamento:** responsável, data/hora e observação; motivo curto obrigatório apenas quando houver divergência é a melhor hipótese simples.

`expected` é o valor de pagamentos por forma; `counted` é a informação de fechamento; `difference = counted − expected`. Para dinheiro, o `expected` da contagem precisa considerar o troco e movimentos, não apenas vendas em dinheiro. Exibir diferença por forma e total evita esconder um PIX a maior com dinheiro a menor; o total é resumo, não substituto da visão por forma.

O fechamento não deve editar pagamento, comanda, desconto nem evento. Ele registra uma conferência/snapshot dos dados daquele instante. Essa decisão é a base para PROD-02: correção financeira posterior deve criar ajuste/estorno auditado e explicitar se afeta um caixa já fechado, sem reabrir livremente ou recalcular um fechamento histórico sem rastro.

## 10. Event Close and Reopen Interaction

Hoje `PATCH /eventos/:id/fechar` só bloqueia comandas abertas; não sabe de caixa. `PATCH /reabrir` permite reabrir evento fechado dentro de prazo, zera `encerradoEm` e reinicia o contador de comandas. Portanto permitir encerrar evento com caixa aberto conservaria o problema atual: seria possível ter relatório financeiro incompleto.

Opções a decidir:

| Opção | Impacto |
|---|---|
| Impedir encerrar evento com caixa aberto | Mais forte e compreensível; recomenda-se se o caixa for MVP. Requer fechar (inclusive com zero) antes do resumo final. |
| Permitir encerrar e fechar caixa depois | Menos atrito, mas cria janela de alteração e incerteza no resumo; exige estado “evento encerrado / caixa pendente”. |
| Fechar automaticamente | Não recomendado: uma contagem não pode ser inventada pelo sistema. |

Reabertura após caixa fechado não deve reabrir o caixa automaticamente. Alternativas válidas são: (B) novo ciclo de caixa no mesmo evento, preservando o fechado; ou (C) impedir reabertura após fechamento financeiro. A escolha depende do uso real de reabertura; `A` (reabrir o mesmo caixa) é a mais fraca para auditoria e deve ser evitada. `B` é mais flexível, mas implica múltiplas sessões e deve ser validada antes do MVP.

## 11. Concurrency, Tenant Scope and Invariants

### Riscos e invariants mínimos

1. Todo caixa deve pertencer ao evento **e** à `cervejariaId`; toda busca valida `evento.id + cervejariaId`, nunca apenas ID do evento.
2. No máximo um caixa aberto por evento no MVP; uma constraint/invariante transacional deve vencer duas aberturas simultâneas.
3. Fechar deve serializar com a operação de pagamento: uma venda não pode entrar entre o cálculo do esperado e o snapshot de fechamento.
4. Todo pagamento contabilizado precisa pertencer a uma comanda fechada daquele evento, dentro da janela/ciclo definido.
5. Pagamentos não são alterados pelo fechamento; divergência é derivada, não digitada.
6. Valores conferidos não são negativos; movimentos são positivos e com tipo.
7. Fechamento é terminal e auditável; correção posterior cria registro novo e relação com o original.
8. Vendas avulsas e conjuntas entram exatamente uma vez.
9. Encerrar/reabrir evento deve obedecer uma política explícita de caixa, não uma consequência acidental da UI.

O quiosque é boa evidência técnica para usar transaction + advisory lock; para cervejaria a chave deve incluir `cervejariaId + eventoId` (e identificador de ciclo se múltiplos forem aceitos). Realtime atual atualiza comandas/pedidos/eventos, mas não há evento realtime de caixa de cervejaria; isso é adaptação de UX, não requisito para a consistência do MVP.

## 12. Auditability and Reports

Dados mínimos por ciclo: evento/tenant, estado, responsável e horário de abertura/fechamento, troco, cada movimento, esperado por forma, contado por forma, diferença por forma/total, observação/motivo, e referência de correções futuras. `TransacaoLog` já oferece mecanismo tenant-scoped e relação opcional ao evento; é reutilizável para eventos de abertura/movimento/fechamento.

O cálculo existente do resumo executivo já produz `porPagamento`, receita total, venda avulsa e responsável pelo fechamento de comandas. Ele é uma boa leitura/validação, mas o caixa deve ter uma consulta única e bem definida de pagamentos para evitar duas fórmulas concorrentes. A função `accumulatePorPagamento` também sinaliza `SEM_REGISTRO` se algum dado histórico tiver total sem pagamentos; o MVP deve expor essa exceção/impedir fechamento silencioso, não somá-la arbitrariamente a uma forma.

## 13. MVP Proposal

Máximo de oito capacidades funcionais:

1. Um caixa lógico por evento, `NOT_OPENED/OPEN/CLOSED`, com tenant/evento e responsáveis.
2. Abertura com troco inicial opcional e horário.
3. Esperado por forma derivado exclusivamente dos pagamentos de comandas fechadas do evento, incluindo avulsas e pagamento conjunto.
4. Fechamento mobile com valores conferidos para dinheiro, PIX e cartão; diferença por forma e total.
5. Observação/motivo de divergência não zero.
6. Snapshot e consulta de fechamento para o DONO, com esperado, contado, diferença e responsáveis.
7. Opcional condicionado a campo: sangria e suprimento de dinheiro, com responsável e observação.
8. Bloqueio transacional de abertura/fechamento e política explícita para encerrar evento com caixa aberto.

Jornada: **Abrir → operar normalmente → conferir → fechar**. O atendente não deve preencher formulário financeiro a cada venda; pagamentos existentes continuam como estão.

## 14. Out of Scope

- contas a pagar ou receber, banco e conciliação automática;
- TEF, adquirente, captura automática, MDR/taxas de cartão;
- DRE, custo, lucro, fornecedor, fiscal, contabilidade ou múltiplas moedas;
- ERP, dashboard financeiro novo ou gestão de terminais;
- reescrever pagamento, desconto, evento, relatório ou regras de cancelamento;
- PROD-02 completo (correção pós-fechamento) e `PROD-04-F01` (política de estoque após cancelamento de cozinha).

## 15. Product Decisions

### Can decide from code

- Agregado mais coerente: evento, não trailer/operador/terminal.
- Fonte de esperado: `Pagamento` das comandas fechadas do evento.
- Venda avulsa, desconto e pagamento conjunto já entram no mesmo fluxo financeiro.
- PIX/cartão não possuem integração externa atual; conferência manual é suficiente para MVP.
- Tenant scoping e serialização são obrigatórios; não usar apenas `eventoId`.

### Needs product owner decision

- Quem pode abrir, movimentar e fechar: DONO somente ou delegação explícita ao ATENDENTE.
- Impedir ou não encerrar evento com caixa aberto.
- Permitir nova sessão em evento reaberto ou impedir reabertura após fechamento financeiro.
- Tratar `CARTAO` legado como categoria própria ou agrupar com débito/crédito.
- Se sangria/suprimento entram no primeiro release caso a validação seja inconclusiva (recomendação: deixar fora até serem necessários).

### Needs field validation

- Uma gaveta/bolsa de dinheiro por evento ou mais de uma?
- Troco inicial, sangria, suprimento e conferência por forma acontecem de verdade?
- O mesmo PIX/cartão é usado por todos os atendentes?
- Há fechamentos parciais/troca de turno que tornem um único ciclo insuficiente?

## 16. Field Validation Questions

1. Em um evento típico, quantas pessoas recebem pagamentos ao mesmo tempo?
2. Elas usam uma única gaveta/bolsa de dinheiro ou cada uma controla seu dinheiro?
3. Vocês separam um troco inicial? Qual é o procedimento hoje?
4. Há retirada de dinheiro durante o evento (sangria)? Com que frequência e por quê?
5. Alguém coloca dinheiro extra para troco durante o evento (suprimento)?
6. PIX vai para uma única conta/chave ou varia por operador/trailer?
7. Cartões usam uma única maquininha/relatório ou várias?
8. No fim, vocês conferem dinheiro, PIX e cartão separadamente ou só um total?
9. Quando há diferença, o que precisa ficar registrado para resolver depois?
10. Com que frequência um evento precisa ser reaberto depois de fechado, e o que normalmente mudou?

Registrar feedback futuro em: **Data | Papel | Contexto | Problema | Frequência | Impacto | Sugestão do usuário**.

## 17. Risks

| Risco | Mitigação de produto/invariante |
|---|---|
| Dupla contagem de total e pagamentos | Somar somente `Pagamento`; testar venda avulsa e fechamento conjunto. |
| Caixa no evento/tenant errado | Sempre filtrar evento + cervejaria e relacionar caixa ao evento. |
| Dois operadores abrem/fecham simultaneamente | Lock transacional e máximo um estado aberto. |
| Pagamento durante fechamento | Serializar pagamento e fechamento no mesmo agregado; snapshot consistente. |
| Uma gaveta para vários atendentes confundida com várias | Validar em campo antes de criar caixa por operador. |
| Reabertura apagar evidência | Nunca reabrir caixa fechado; novo ciclo ou bloqueio explícito. |
| Divergência mascarada no total | Mostrar e registrar diferença por forma e total. |
| Permissão ampla demais | Matriz DONO/ATENDENTE e auditoria de quem agiu. |
| Escopo virar ERP | Manter fora banco, adquirente, taxas, fiscal e DRE. |
| Dados históricos sem pagamento | Exibir `SEM_REGISTRO` como exceção e não atribuir forma fictícia. |

## 18. Effort

Estimativa após validar o escopo MVP (sem PROD-02 e sem integrações):

| Área | Estimativa | Razão |
|---|---|---|
| Backend | M | agregação, estados, locks, regras de evento e auditoria. |
| Schema | S/M | sessão, snapshot/contagens e possivelmente movimentos; cresce se múltiplos ciclos já forem exigidos. |
| Frontend | M | abertura, conferência responsiva, estados e histórico simples. |
| Tests | M | unit/property, integração de concorrência e E2E dos fluxos financeiros. |
| **Total** | **M** | Reuso conceitual alto, mas exige integridade financeira. |

## 19. Roadmap Recommendation

`PROD-01` continua como próximo investimento funcional **se** a validação curta confirmar que há conferência manual e pelo menos uma fonte de recebimento físico/digital a comparar. Ele fecha uma pergunta de alto impacto financeiro que o produto ainda não responde e usa pagamentos/relatórios existentes.

Se for adiado porque a operação não confere recebimentos ou já usa outro POS conciliado, o próximo item recomendado é **PROD-05 — estoque crítico**, pois o quiosque já controla saldo e a lacuna de alerta/indisponibilidade tem impacto operacional direto. `PROD-11` (idade do pedido) é o próximo se a cozinha for central na operação observada; `PROD-06` é prioritário quando o obstáculo principal for primeira venda/adopção de novas empresas.

## 20. Final Decision

### DECISION SUMMARY

| Campo | Decisão / evidência |
|---|---|
| **PROBLEM VALIDITY** | Válido: há registro de venda, mas não conferência registrada de esperado vs conferido no evento. |
| **BEST CASH AGGREGATE** | Evento-sessão; trailer é contexto e operador/terminal não existem no modelo de pagamentos. |
| **ONE OR MULTIPLE CASH SESSIONS** | Um por evento no MVP: `PROBABLY`; validar gaveta, turnos e múltiplas maquininhas. |
| **KIOSK REUSE** | Reusar conceitos, fórmulas, lock, auditoria e testes; adaptar UI/serviço; não reutilizar modelo por ponto/dia. |
| **MVP SCOPE** | Abertura opcional, esperado por forma, conferência, divergência, snapshot, auditabilidade e política de evento; movimentos só se campo validar. |
| **OWNER VALUE** | Responde esperado, conferido e diferença do evento, inclusive dinheiro, PIX e cartão. |
| **ATTENDANT IMPACT** | Baixo durante vendas; uma abertura e um fechamento, sem formulário extra por pagamento. |
| **FIELD VALIDATION REQUIRED** | Sim: gaveta/troco, sangria/suprimento, número de recebedores e dispositivos. |
| **PRODUCT OWNER DECISIONS** | Permissões, fechamento de evento com caixa aberto, reabertura e cartão legado. |
| **MAJOR RISKS** | Dupla contagem, concorrência no fechamento, subcaixas não modeladas, reabertura e permissões. |
| **ESTIMATED EFFORT** | Total M; backend M, schema S/M, frontend M, testes M. |
| **BUILD RECOMMENDATION** | `BUILD_AFTER_SMALL_FIELD_VALIDATION`. |
| **PROD-01 ROADMAP PRIORITY** | Sim, próximo após a validação curta; se adiado, PROD-05. |
| **NEXT FUNCTIONAL ITEM IF DEFERRED** | PROD-05 — estoque crítico (ou PROD-11 quando a cozinha for o gargalo comprovado). |

## Evidence limitations and files inspected

Não houve entrevista, telemetria de uso de campo nem acesso a extratos de banco/adquirente. “Provável”, “opcional” e `FIELD_VALIDATION_REQUIRED` representam essa limitação, não fatos operacionais. A descoberta foi leitura estática; esforço aproximado: **uma sessão de análise de repositório**.

Arquivos principais inspecionados:

- `backend/prisma/schema.prisma`
- `backend/src/routes/eventos.ts`, `comandas.ts`, `pagamentos.ts`, `vendas-avulsas.ts`, `relatorios.ts`
- `backend/src/lib/fechar-comanda.ts`, `pagamento-report.ts`, `evento-resumo-executivo.ts`, `evento-dashboard.ts`, `transacao-log.ts`
- `backend/src/lib/quiosque/caixa.ts` e `backend/src/routes/quiosque/caixa.ts`
- `frontend/src/pages/EventoPage.tsx`, `ResumoExecutivoPage.tsx`, `QuiosqueCaixaPage.tsx`, `QuiosqueTurnoResumoPage.tsx`
- `e2e/quiosque-caixa.spec.ts`, `e2e/quiosque-pdv-flow.spec.ts`
- `docs/product/TQ-PROD-01-functional-value-review.md`
