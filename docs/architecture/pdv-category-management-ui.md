# Gestão de categorias do cardápio

A tela `Cardápio` reúne as abas **Catálogo**, **Cardápios salvos** (quando habilitados no contexto) e **Categorias**. Cadastro, edição e exclusão de categorias canônicas ficam na aba Categorias; o formulário de produto continua selecionando a categoria cadastrada pelo mesmo `CategoriaProdutoPdv.id`.

## Contratos preservados

- `GET/POST /api/operacao/produtos/categorias`, `PUT /api/operacao/produtos/categorias/:id` e `PUT /api/operacao/produtos/categorias/ordem` continuam sendo os contratos canônicos existentes.
- `PUT /api/produtos/categorias-comanda/ordem` mantém a preferência da comanda em `operacaoCategoriasOrdem.comanda`. A aba mostra os rótulos e a sequência devolvidos pelo endpoint de seleção.
- A ordem do catálogo permanece separada em `operacaoCategoriasOrdem.catalogo`, salva por `PUT /api/operacao/produtos/categorias/ordem`. As telas não combinam nem sobrescrevem as duas preferências.
- Ambas as ordens conservam os endpoints e guards existentes de `catalog.manage`. As rotas de cadastro, edição e exclusão canônica também exigem `catalog.manage`.
- `DELETE /api/operacao/produtos/categorias/:id` foi adicionado. O servidor busca a categoria no tenant autenticado, bloqueia exclusão enquanto qualquer produto estiver vinculado e não remove/desvincula produtos. A FK `onDelete: Restrict` continua sendo a proteção concorrente do banco.
- Quando o contexto retorna modo LEGACY, a aba não abre cadastro canônico. Ela mantém disponíveis os controles de ordenação já suportados pelo contrato LEGACY. Se o contexto falha, a página não monta a manutenção.

## Classificação de Chope e gamificação

A edição do produto usa `tipo`/`formato` e a identidade atual da categoria para preservar Chope após uma renomeação. O nome apresentado não controla a classificação por volume nem a disponibilidade de torneiras. A flag `gamificada` continua sendo persistida explicitamente como `true` ou `false`, sem pontuação, recálculo histórico ou mudança no ranking. A descrição da interface informa esse limite.

## Validação

`e2e/pdv-gamified-categories.spec.ts` cobre os três separadores, remoção dos atalhos duplicados no Catálogo, criação e edição, falha e retry sem perda do rascunho, descarte confirmado, flag `false`, ordens separadas com arraste e botões de movimento, categoria selecionada no produto, renomeação de Chope, permissão, LEGACY, erro de contexto e exclusão permitida/bloqueada. As APIs são simuladas.

Capturas de 390px e 768px são geradas em `artifacts/pdv-category-management/`. A API foi exercitada no PostgreSQL descartável pela suíte de categorias gamificadas; nenhuma categoria real de cliente, banco compartilhado de DEV ou PROD foi usada nesse ensaio.
