import { expect, loginPage, PERSONA_PERMISSIONS, test, uniqueSuffix } from '../support/ops';

test('CAT-S01 CRUD de produto, opcional e categoria @api', async ({ ops }) => {
  const tenant = await ops.tenant();
  const o = tenant.owner;
  const categoria = await o.expect(o.post('/api/operacao/produtos/categorias', { nome: `Cat ${uniqueSuffix()}` }), 201, 'categoria');
  const produto = await o.expect(o.post('/api/operacao/produtos', { nome: 'Produto CRUD QA', categoriaPdvId: categoria.id, tipo: 'COMIDA', precoUnit: 12 }), 201, 'produto');
  const opcional = await o.expect(o.post('/api/operacao/produtos/opcionais', { nome: 'Extra QA', preco: 2 }), 201, 'opcional');
  await o.expect(o.put(`/api/operacao/produtos/${produto.id}/opcionais`, { opcionalIds: [opcional.id] }), 200, 'vincular');
  await o.expect(o.put(`/api/operacao/produtos/${produto.id}`, { nome: 'Produto CRUD QA Editado', precoUnit: 14 }), 200, 'editar produto');
  await o.expect(o.put(`/api/operacao/produtos/opcionais/${opcional.id}`, { preco: 3 }), 200, 'editar opcional');
  await o.expect(o.put(`/api/operacao/produtos/categorias/${categoria.id}`, { nome: `Cat Edit ${uniqueSuffix()}` }), 200, 'editar categoria');
  await o.expect(o.delete(`/api/operacao/produtos/${produto.id}`), 204, 'desativar produto');
});

test('CAT-S02 cardápio salvo criar e ativar @api', async ({ ops }) => {
  const tenant = await ops.tenant();
  await tenant.seedCatalog();
  const o = tenant.owner;
  const cardapio = await o.expect(o.post('/api/operacao/cardapios', { nome: `Cardápio ${uniqueSuffix()}`, produtoIds: [tenant.catalog!.lata.id, tenant.catalog!.agua.id] }), 201, 'criar');
  await o.expect(o.patch(`/api/operacao/cardapios/${cardapio.id}/ativo`, { ativo: true }), 200, 'ativar');
  const lista = await o.expect(o.get('/api/operacao/cardapios?ativo=true'), 200, 'listar ativos');
  const ids = (Array.isArray(lista) ? lista : lista.cardapios ?? []).map((c: { id: string }) => c.id);
  expect(ids).toContain(cardapio.id);
});

test('CAT-S03 desativar produto tira do PDV e do portal @api', async ({ ops }) => {
  const tenant = await ops.tenant();
  await tenant.openCash();
  const o = tenant.owner;
  await o.expect(o.put(`/api/operacao/produtos/${tenant.catalog!.agua.id}`, { ativo: false }), 200, 'desativar');
  const body = await o.expect(o.post('/api/operacao/comandas', { pontoVendaId: tenant.pointId, tipo: 'APELIDO', identificador: 'Inativo', itens: [tenant.item('agua')] }), 400, 'vender inativo');
  expect(body.error).toMatch(/indisponível|não encontrado|catálogo/i);
});

test('CAT-S04 preço no escopo TURNO com catalog.shift.manage @api', async ({ ops }) => {
  const tenant = await ops.tenant();
  await tenant.openCash();
  const turno = await tenant.staff('Turno', [...PERSONA_PERMISSIONS.caixa, 'catalog.shift.manage']);
  await turno.expect(turno.patch(`/api/operacao/caixa/cardapio/preco?pontoVendaId=${tenant.pointId}`, {
    produtoId: tenant.catalog!.lata.id, precoUnit: 9, escopo: 'TURNO',
  }), 200, 'preço turno');
  const comanda = await tenant.openComanda(tenant.owner, [tenant.item('lata')]);
  expect(comanda.total).toBe(9);
});

test('CAT-S05 preço TEMPLATE com catalog.manage @api', async ({ ops }) => {
  const tenant = await ops.tenant();
  await tenant.openCash();
  await tenant.owner.expect(tenant.owner.patch(`/api/operacao/caixa/cardapio/preco?pontoVendaId=${tenant.pointId}`, {
    produtoId: tenant.catalog!.lata.id, precoUnit: 7, escopo: 'TEMPLATE',
  }), 200, 'preço template');
});

test('CAT-X01 sem catalog.manage: escritas 403, tela redireciona, GET liberado', async ({ ops, page, evidence }) => {
  const tenant = await ops.tenant();
  await tenant.seedCatalog();
  const salao = await tenant.staff('Salao', PERSONA_PERMISSIONS.salao);
  await evidence.checkpoint();
  await salao.expect(salao.post('/api/operacao/produtos', { nome: 'Bloqueado', categoriaPdvId: tenant.catalog!.categoriaId, tipo: 'COMIDA', precoUnit: 1 }), 403, 'POST produto');
  await salao.expect(salao.put(`/api/operacao/produtos/${tenant.catalog!.lata.id}`, { nome: 'X' }), 403, 'PUT produto');
  await salao.expect(salao.delete(`/api/operacao/produtos/${tenant.catalog!.lata.id}`), 403, 'DELETE produto');
  await evidence.assertNoDbChange();
  const leitura = await salao.expect(salao.get('/api/operacao/produtos'), 200, 'GET liberado para venda');
  expect(Array.isArray(leitura) ? leitura.length : (leitura.produtos?.length ?? 0)).toBeGreaterThan(0);
  test.info().annotations.push({ type: 'observed', description: 'GET /api/operacao/produtos permanece liberado sem catalog.manage porque a venda usa essa leitura.' });
  await loginPage(page, salao.email, salao.senha);
  await page.goto('/operacao/catalogo', { waitUntil: 'networkidle' });
  await expect(page).not.toHaveURL(/\/operacao\/catalogo/);
  await evidence.screenshot('catalogo-bloqueado');
  await tenant.owner.expect(tenant.owner.post('/api/operacao/produtos', { nome: `Ok ${uniqueSuffix()}`, categoriaPdvId: tenant.catalog!.categoriaId, tipo: 'COMIDA', precoUnit: 1 }), 201, 'controle positivo');
});

test('CAT-X02 TURNO sem catalog.shift.manage dá 403 @api', async ({ ops, evidence }) => {
  const tenant = await ops.tenant();
  await tenant.openCash();
  const salao = await tenant.staff('Salao', PERSONA_PERMISSIONS.salao);
  await evidence.checkpoint();
  await salao.expect(salao.patch(`/api/operacao/caixa/cardapio/preco?pontoVendaId=${tenant.pointId}`, {
    produtoId: tenant.catalog!.lata.id, precoUnit: 9, escopo: 'TURNO',
  }), 403, 'sem shift.manage');
  await evidence.assertNoDbChange();
  const turno = await tenant.staff('Turno', [...PERSONA_PERMISSIONS.caixa, 'catalog.shift.manage']);
  await turno.expect(turno.patch(`/api/operacao/caixa/cardapio/preco?pontoVendaId=${tenant.pointId}`, {
    produtoId: tenant.catalog!.lata.id, precoUnit: 9, escopo: 'TURNO',
  }), 200, 'controle positivo');
});

test('CAT-X03 produto inativo não pode ser vendido @api', async ({ ops, evidence }) => {
  const tenant = await ops.tenant();
  await tenant.openCash();
  await evidence.checkpoint();
  const body = await tenant.owner.expect(tenant.owner.post('/api/operacao/comandas', {
    pontoVendaId: tenant.pointId, tipo: 'APELIDO', identificador: 'Inativo', itens: [tenant.item('inativo')],
  }), 400, 'produto inativo');
  expect(body.error).toMatch(/indisponível|não encontrado|catálogo/i);
  await evidence.assertNoDbChange();
});
