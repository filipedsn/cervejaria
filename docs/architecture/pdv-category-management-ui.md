# Gestão de categorias do cardápio

A tela `Cardápio` reúne as abas **Catálogo**, **Cardápios salvos** (quando habilitados no contexto) e **Categorias**. Cadastro, edição e exclusão de categorias canônicas ficam na aba Categorias; o formulário de produto continua selecionando a categoria cadastrada pelo mesmo `CategoriaProdutoPdv.id`.

## Contratos preservados

- `GET/POST /api/operacao/produtos/categorias`, `PUT /api/operacao/produtos/categorias/:id` e `PUT /api/operacao/produtos/categorias/ordem` continuam sendo os contratos canônicos existentes.
- No modo canônico, `operacaoCategoriasOrdem.catalogo` é a sequência única de nomes das `CategoriaProdutoPdv`. `PUT /api/produtos/categorias-comanda/ordem` e `PUT /api/operacao/produtos/categorias/ordem` preservam o contrato e gravam essa mesma sequência.
- A ordem salva do catálogo é a base. Categorias novas ou sem posição salva são anexadas por `nomeNormalizado` e nome. A chave histórica `comanda` (grupos fixos) não é regravada nem apagada; é usada somente no caminho LEGACY. A chave `catalogo` é atualizada no mesmo registro JSON já usado, sem migration ou alteração de schema.
- Renomear categoria mantém sua posição, atualizando o nome correspondente na ordem dentro da transação da categoria e do vínculo textual de produtos. Os IDs `CategoriaProdutoPdv` e `Produto.categoriaPdvId` permanecem estáveis.
- Os endpoints de ordem preservam seus guards existentes de `catalog.manage`. As rotas de cadastro, edição e exclusão canônica também exigem `catalog.manage`.
- `DELETE /api/operacao/produtos/categorias/:id` foi adicionado. O servidor busca a categoria no tenant autenticado, bloqueia exclusão enquanto qualquer produto estiver vinculado e não remove/desvincula produtos. A FK `onDelete: Restrict` continua sendo a proteção concorrente do banco.
- Quando o contexto retorna modo LEGACY, a aba não abre cadastro canônico. Ela mantém disponíveis os controles de ordenação já suportados pelo contrato LEGACY. Se o contexto falha, a página não monta a manutenção.

## Classificação de Chope e gamificação

A edição do produto usa `tipo`/`formato` e a identidade atual da categoria para preservar Chope após uma renomeação. O nome apresentado não controla a classificação por volume nem a disponibilidade de torneiras. A flag `gamificada` continua sendo persistida explicitamente como `true` ou `false`, sem pontuação, recálculo histórico ou mudança no ranking. A descrição da interface informa esse limite.

## Ordem compartilhada e validação

No contexto canônico, o endpoint de seleção da comanda retorna categorias reais e a ordem do catálogo. A comanda operacional mostra uma opção por categoria disponível; a escolha especial para vender Chope por Tap continua separada da classificação estável do produto. Portal do PDV e portal do cliente recebem a mesma ordem. Cada consumidor agrupa apenas categorias com produtos disponíveis, preservando a sequência relativa recebida. O modo LEGACY mantém os quatro grupos e as preferências anteriores.

`e2e/pdv-gamified-categories.spec.ts` cobre três abas, atalhos duplicados, cadastro/edição, erro e retry, descarte, valores explícitos da flag, ordem única simulada, categoria selecionada no produto, renomeação de Chope, permissão, LEGACY, erro de contexto e exclusão permitida/bloqueada. APIs são simuladas; isso não substitui a validação de API real no PostgreSQL descartável requerida para mudanças backend.

Capturas de 390px e 768px são geradas em `artifacts/pdv-category-management/`.

## Validação anterior da gestão de categorias

Na entrega inicial da aba Categorias, a API foi exercitada no PostgreSQL descartável; nenhuma categoria real de cliente, banco compartilhado de DEV ou PROD foi usada naquele ensaio.
