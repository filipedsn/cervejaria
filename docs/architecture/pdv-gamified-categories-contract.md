# PDV: categorias gamificadas e preparação de rankings

## Base entregue nesta revisão

`CategoriaProdutoPdv` é o catálogo canônico por empresa. Cada linha mantém o nome apresentado, a chave normalizada e `gamificada`; `Produto.categoriaPdvId` referencia a categoria com chave composta por empresa. O texto legado `Produto.categoria` permanece durante a transição. A migration `20261008120000_pdv_gamified_categories` só cria a tabela, a coluna, os índices e as FKs. A transformação e o rollback são SQLs separados e ensaiados somente no PostgreSQL descartável de QA.

O índice único é por empresa e chave normalizada. Normalização remove acentos portugueses, ignora caixa e comprime espaços; não troca o nome armazenado. Valores diferentes que resultem na mesma chave bloqueiam a transformação. Nenhuma categoria desconhecida vira “Outros” na transformação. A flag `gamificada` não é lida pelo motor de pontuação.

O catálogo canônico começa desligado (`PDV_GAMIFIED_CATEGORY_CATALOG` ausente ou diferente de `1`). Enquanto desligado, os leitores e gravadores operacionais mantêm o caminho de categorias legadas e não consultam `CategoriaProdutoPdv`. Ao habilitá-lo em QA, o cadastro/edição usa `catalog.manage`, categorias livres são selecionáveis em produtos, e a ordenação permanece salva na configuração existente. Chope segue identificado por categoria, tipo/formato e suas faixas de preço; esta entrega não mexe em preços, taps, estoque, cardápios, adicionais ou cozinha.

## Inventário de consumidores e evidências de código

| Área | Consumidor atual | Contrato observado e limite |
|---|---|---|
| Categorias | `backend/src/lib/operacao/categorias.ts`, `frontend/src/lib/operacao.ts` | Lista operacional fixa com Bebidas, Cervejas, Drinks, Porções, Lanches, Salgados, Doces e sobremesas, Combos e Outros; Chope é condicional a Tap. Helpers reduzem rótulos desconhecidos a Outros para agrupamento visual. O cadastro geral aceita rótulos livres até 80 caracteres. A transformação preserva rótulo e não usa esse fallback. |
| Produtos | `backend/src/routes/produtos.ts`, `backend/src/routes/operacao/produtos.ts`, `frontend/src/pages/operacao/OperacaoCatalogoPage.tsx` | Produtos mantêm categoria textual e IDs estáveis; a categoria canônica é uma referência aditiva. Alterar classificação tipo/formato após venda é recusado. |
| Cardápios e adicionais | `backend/src/routes/operacao/produtos.ts`, rotas de cardápio/opcionais e `frontend/src/pages/operacao/CardapiosOperacaoPage.tsx` | Cardápio aponta para ID do produto; preço por volume e vínculos de opcionais continuam no produto/cardápio. A transformação não altera esses registros. |
| Ranking e TV | `backend/src/routes/ranking.ts`, `backend/src/lib/chope-ranking.ts`, páginas `Ranking*` e respectivas telas `/ranking/tv/*` | Evento soma somente itens de bebida Chope por volume/quantidade. A rota de série seleciona eventos pelo `serieId`; período seleciona eventos por trailer e mês. TV consome os mesmos endpoints. Nenhum desses agregadores consulta categoria gamificada, estado de cancelamento ou ocorrência. |
| Histórico do cliente | `backend/src/routes/clientes.ts` (`/:id/historico`) | Escopo da empresa autenticada, comandas fechadas, não avulsas e com pagamento positivo; exibe itens, evento ou ponto, pagamentos e conta a receber. Não resolve a identidade da recorrência a partir de todas as ocorrências. |
| Ocorrência e recorrência | `AgendaOperacional`, `OcorrenciaOperacional`, `SessaoCaixaOperacao`, `Comanda` em `backend/prisma/schema.prisma`; `backend/src/lib/operacao/contexto-ocorrencia.ts` | Agenda define recorrência operacional; ocorrência é uma data concreta, ligada opcionalmente à agenda. Sessão/comanda guardam a ocorrência exata quando há evidência; contexto é opcional. Registros históricos sem evidência permanecem sem vínculo. |
| Cancelamento, estorno e cozinha | `backend/src/routes/comandas.ts`, `pagamentos.ts`, `operacao/comandas.ts`, `backend/src/lib/operacao/venda.ts`; modelos `ItemComanda`, `Pagamento`, `PedidoOperacao` | Itens registram `cancelamentoPendenteEm` e `canceladoEm`; pedidos têm estados RECEBIDO, EM_PREPARO, PRONTO, ENTREGUE, CANCELAMENTO_PENDENTE e CANCELADO, com histórico de transição. O ranking atual não filtra estes fatos. Pagamentos e conta a receber são trilhas distintas; não inferir entrega nem consumo elegível só pelo fechamento financeiro. |

## Contrato de dados para ranking futuro

| Fato | Fonte possível | Lacuna que continua aberta |
|---|---|---|
| Categoria gamificada | `Produto.categoriaPdvId` → `CategoriaProdutoPdv.gamificada` | Produto histórico pode ainda não ter referência se a transformação estiver desligada ou bloqueada por colisão. |
| Cliente | `Comanda.clienteId` e `Cliente` do mesmo tenant | Vendas avulsas, cliente nulo e registros de sistema não identificam participante sem regra aprovada. |
| Ocorrência exata | `Comanda.ocorrenciaId`, com validação do PDV/tenant | Valores nulos em história antiga não permitem atribuir ocorrência sem prova. |
| Agenda/recorrência | `OcorrenciaOperacional.agendaId` → `AgendaOperacional` | Associação é opcional; ranking de evento legado usa `Evento.serieId`, uma estrutura distinta. |
| Mês | data da ocorrência, evento ou dia operacional da sessão | A política ainda precisa escolher qual data ancora o período e o fuso de negócio. |
| Quantidade/volume | `ItemComanda.quantidade`, `volumeMl`, `precoUnit` | Um item cancelado/estornado pode seguir presente; o critério de reversão precisa ser decidido. |
| Cancelamento/estorno | `cancelamentoPendenteEm`, `canceladoEm`, pagamentos, transações | Solicitação, conclusão e estorno financeiro são eventos diferentes; o agregador atual não os reconcilia. |
| Preparo/entrega | `PedidoOperacao.status`, `entregueEm`, histórico, `ItemComanda.pedidoCozinhaId` | Produto sem cozinha não tem prova de entrega; estado financeiro não substitui estado de preparo/entrega. |

Não foram criados pontos, sessões, associações cliente/ocorrência nem datas históricas artificiais. Não foi recalculado nem reclassificado consumo histórico do ranking de Chope.

## Decisões de produto ainda pendentes

1. Métrica de pontuação: quantidade, volume, valor ou outra métrica aprovada.
2. Momento de reconhecimento do consumo: lançamento, fechamento/pagamento, preparo ou entrega.
3. Aplicação a consumos anteriores: sem backfill, com backfill validado ou outra política explícita.

Essas decisões também determinam como tratar item cancelado, estorno parcial, cliente sem identificação, categoria renomeada e ocorrência ausente.

## Sequência futura para retirar o campo legado

1. Inspecionar fontes autorizadas e relatório de colisões por empresa/PDV; decidir cada colisão explicitamente, sem merge automático.
2. Aplicar a migration aditiva e executar a transformação com snapshot, relatório e rollback testados em QA; conferir IDs, vínculos, cardápios, preços e adicionais.
3. Ativar leitura/escrita canônica e validar todos os consumidores de categorias e a compatibilidade legada.
4. Migrar cada consumidor remanescente de `Produto.categoria`, comparar resultados e manter a projeção antiga até todas as verificações passarem.
5. Em uma revisão própria, remover a coluna textual, fallback/normalizações históricas e seus testes; então atualizar schema/migration e provar rollback operacional aprovado.

Esta entrega não executa backfill real, cutover, deploy nem remoção de legado.

## Adendo de correcao certificada

A correcao operacional resolve dois desvios: as rotas generica e operacional agora derivam o texto do ID canonico quando a categoria muda; edicoes parciais preservam ID e nome canonicos, e texto livre divergente sem ID e recusado. Um ID e validado dentro da empresa antes de gravar. Com o catalogo ativo, o nome apresentado de Chope nao define formato: classificacao CHOPE, precos por volume e validacoes TAP permanecem vinculados ao tipo/formato e a configuracao existente. O agregador legado continua baseado nos itens de Chope e nao consulta a flag.

A migration aditiva guarda evidencias em duas tabelas vinculadas a chave de transformacao: fotografia de categoria (criada ou reaproveitada) e fotografia antes/depois por produto. Replay e rollback comparam o estado atual com essas fotografias. O rollback restaura apenas produtos registrados e exclui somente categorias criadas pela transformacao. Edicao posterior de categoria, texto ou vinculo, ou produto novo associado a categoria criada, bloqueia a operacao com diagnostico. A prova SQL sintetica nao e prova de API, UI nem compatibilidade de banco legado.

Sequencia futura para remover legado: (1) auditar consumidores de Produto.categoria e dependencias externas; (2) aplicar migration aditiva em QA descartavel; (3) gerar relatorio de colisoes sem fusao e revisar nomes/vinculos; (4) executar transformacao reiniciavel e conferir fotografias/contagens; (5) certificar APIs, cardapios, vendas, estoque, cozinha, ranking legado e esquema anterior; (6) aprovar explicitamente cutover e periodo de observacao; (7) somente depois, em outra entrega autorizada, migrar todos os leitores/escritores e remover campos legados por migration separada. Nenhum passo de backfill real, cutover ou remocao ocorreu nesta correcao.
