import { expect, loginPage, PERSONA_PERMISSIONS, ALL_PERMISSIONS, randomUUID, strongPassword, test, uniqueSuffix } from '../support/ops';

test('RBAC-S01 concede e revoga as 28 chaves sem novo login @api', async ({ ops }) => {
  const tenant = await ops.tenant();
  const staff = await tenant.staff('Caixa', []);
  const failures: string[] = [];
  expect(ALL_PERMISSIONS).toHaveLength(28);
  for (const permission of ALL_PERMISSIONS) {
    await tenant.owner.expect(tenant.owner.patch(`/api/usuarios/${staff.userId}/permissoes-operacao`, { permissoesOperacao: [permission] }), 200, `grant ${permission}`);
    const live = await staff.expect(staff.get('/api/auth/me'), 200, `me ${permission}`);
    if (!live.usuario.permissoesOperacao.includes(permission)) failures.push(`${permission}: grant not reflected`);
    await tenant.owner.expect(tenant.owner.patch(`/api/usuarios/${staff.userId}/permissoes-operacao`, { permissoesOperacao: [] }), 200, `revoke ${permission}`);
    const after = await staff.expect(staff.get('/api/auth/me'), 200, `me after ${permission}`);
    if (after.usuario.permissoesOperacao.includes(permission)) failures.push(`${permission}: revoke not reflected`);
  }
  expect(failures).toEqual([]);
});

test('RBAC-S02 dono acessa o contexto operacional completo @api', async ({ ops }) => {
  const tenant = await ops.tenant();
  const ctx = await tenant.owner.expect(tenant.owner.get('/api/operacao/contexto'), 200, 'contexto');
  expect(ctx).toMatchObject({ ativo: true, operationalSettingsSource: 'CANONICAL_PDV', temCozinha: true, controlaEstoque: true });
});

test('RBAC-S03 cadastro pelo dono cria sempre ATENDENTE sem acesso inicial @api', async ({ ops }) => {
  const tenant = await ops.tenant();
  const body = await tenant.owner.expect(tenant.owner.post('/api/usuarios', {
    nome: 'Novo Atendente QA', email: `new-${uniqueSuffix()}@example.invalid`, senha: strongPassword(),
  }), 201, 'criar atendente');
  expect(body).toMatchObject({ papel: 'ATENDENTE', permissoesOperacao: [] });
});

test('RBAC-X01 sem permissões recebe 403 e não vê menu', async ({ ops, page, evidence }) => {
  const tenant = await ops.tenant();
  const vazio = await tenant.staff('Vazio', PERSONA_PERMISSIONS.semPermissao);
  await evidence.checkpoint();
  await vazio.expect(vazio.get('/api/operacao/comandas'), 403, 'comandas');
  await vazio.expect(vazio.post('/api/operacao/comandas', { pontoVendaId: tenant.pointId, tipo: 'APELIDO', identificador: 'X', itens: [] }), 403, 'escrita');
  await evidence.assertNoDbChange();
  await loginPage(page, vazio.email, vazio.senha);
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.getByText('Seu usuário ainda não tem acesso à operação')).toBeVisible();
  await expect(page.getByRole('link', { name: /^Cozinha$/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /^Estoque$/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /^Catálogo$/ })).toHaveCount(0);
  test.info().annotations.push({ type: 'product-decision', description: 'Com zero permissões a tela de "sem acesso" aparece; a barra inferior ainda mostra Comandas/Clientes (atalhos). Recomendação: ocultar esses atalhos sem permissão.' });
  await evidence.screenshot('sem-permissao');
  await evidence.checkpoint();
  await evidence.assertNoDbChange();
});

test('RBAC-X02 atendente com ambas as permissões pode cancelar item entregue @api', async ({ ops, evidence }) => {
  const tenant = await ops.tenant();
  await tenant.openCash();
  const atendente = await tenant.staff('Atendente', [
    'command.read', 'command.operate', 'command.item.cancel', 'kitchen.read', 'kitchen.operate',
  ]);
  const outraSessao = await ops.login(atendente.email, atendente.senha, 'atendente-session-2');
  const aberta = await tenant.openComanda(tenant.owner, [tenant.porcaoItem(2)]);
  const pedido = aberta.pedidos.find((p: { itens: Array<{ produtoId: string }> }) => p.itens.some((i) => i.produtoId === tenant.catalog!.porcao.id));
  await tenant.advanceKitchen(tenant.owner, pedido.id, ['EM_PREPARO', 'PRONTO', 'ENTREGUE']);
  const item = (await tenant.comanda(tenant.owner, aberta.id)).pedidos.flatMap((p: { itens: Array<{ id: string; produtoId: string }> }) => p.itens).find((i: { produtoId: string }) => i.produtoId === tenant.catalog!.porcao.id);
  await evidence.checkpoint();
  const payload = (quantidade: number) => ({
    quantidade, quantidadeEsperada: 2, motivo: 'Erro registrado no pedido', tratamentoEstoque: 'PREPARADO_ENTREGUE_OU_PERDIDO', idempotencyKey: randomUUID(),
  });
  const negado = await atendente.expect(atendente.delete(`/api/operacao/comandas/${aberta.id}/itens/${item.id}`, payload(1)), 403, 'sem permissão especial');
  expect(negado.error).toMatch(/permiss/i);
  await evidence.assertNoDbChange();

  await tenant.owner.expect(tenant.owner.patch(`/api/usuarios/${atendente.userId}/permissoes-operacao`, {
    permissoesOperacao: ['command.read', 'command.operate', 'command.item.cancel', 'command.item.cancel.delivered', 'kitchen.read', 'kitchen.operate'],
  }), 200, 'grant em sessão ativa');
  for (const session of [atendente, outraSessao]) {
    const me = await session.expect(session.get('/api/auth/me'), 200, 'permissões sem novo login');
    expect(me.usuario.permissoesOperacao).toContain('command.item.cancel.delivered');
  }
  await atendente.expect(atendente.delete(`/api/operacao/comandas/${aberta.id}/itens/${item.id}`, {
    quantidade: 1, quantidadeEsperada: 2, motivo: 'Cliente devolveu', tratamentoEstoque: 'PREPARADO_ENTREGUE_OU_PERDIDO', idempotencyKey: randomUUID(),
  }), 200, 'atendente com ambas as permissões');
  const atualizada = await tenant.comanda(atendente, aberta.id);
  expect(atualizada.total).toBe(30);
  const cancelamento = atualizada.pedidos.flatMap((p: { itens: Array<{ cancelamentosEntregue?: Array<{ motivo: string; quantidade: number }> }> }) => p.itens)
    .flatMap((i: { cancelamentosEntregue?: Array<{ motivo: string; quantidade: number }> }) => i.cancelamentosEntregue ?? [])[0];
  expect(cancelamento).toMatchObject({ motivo: 'Cliente devolveu', quantidade: 1 });
  await tenant.owner.expect(tenant.owner.patch(`/api/usuarios/${atendente.userId}/permissoes-operacao`, {
    permissoesOperacao: ['command.read', 'command.operate', 'command.item.cancel', 'kitchen.read', 'kitchen.operate'],
  }), 200, 'revogar permissão especial');
  for (const session of [atendente, outraSessao]) {
    const me = await session.expect(session.get('/api/auth/me'), 200, 'revogação sem novo login');
    expect(me.usuario.permissoesOperacao).not.toContain('command.item.cancel.delivered');
  }
  await evidence.checkpoint();
  for (const session of [atendente, outraSessao]) {
    await session.expect(session.delete(`/api/operacao/comandas/${aberta.id}/itens/${item.id}`, {
      quantidade: 1, quantidadeEsperada: 1, motivo: 'repetição após revogação', tratamentoEstoque: 'PREPARADO_ENTREGUE_OU_PERDIDO', idempotencyKey: randomUUID(),
    }), 403, 'recusar após revogação');
  }
  await evidence.assertNoDbChange();
});

test('RBAC-X03 e-mail duplicado retorna 409 @api', async ({ ops, evidence }) => {
  const tenant = await ops.tenant();
  const staff = await tenant.staff('Caixa', PERSONA_PERMISSIONS.caixa);
  await evidence.checkpoint();
  const body = await tenant.owner.expect(tenant.owner.post('/api/usuarios', {
    nome: 'Duplicado', email: staff.email, senha: strongPassword(),
  }), 409, 'email duplicado');
  expect(body.error).toMatch(/já|cadastrado|e-mail/i);
  await evidence.assertNoDbChange();
});

test('RBAC-X04 atendente não edita permissões @api', async ({ ops, evidence }) => {
  const tenant = await ops.tenant();
  const staff = await tenant.staff('Caixa', PERSONA_PERMISSIONS.caixa);
  await evidence.checkpoint();
  await staff.expect(staff.patch(`/api/usuarios/${staff.userId}/permissoes-operacao`, { permissoesOperacao: [] }), 403, 'self edit');
  await evidence.assertNoDbChange();
});

test('RBAC-X05 dono A não altera permissões da empresa B @api', async ({ ops, evidence }) => {
  const a = await ops.tenant();
  const b = await ops.tenant();
  const staffB = await b.staff('StaffB', PERSONA_PERMISSIONS.salao);
  await evidence.checkpoint();
  await a.owner.expect(a.owner.patch(`/api/usuarios/${staffB.userId}/permissoes-operacao`, { permissoesOperacao: ['command.read'] }), 404, 'cross-tenant');
  await evidence.assertNoDbChange();
});

test('RBAC-X06 dono não edita alvo não-atendente @api', async ({ ops, evidence }) => {
  const tenant = await ops.tenant();
  const me = await tenant.owner.expect(tenant.owner.get('/api/auth/me'), 200, 'me');
  await evidence.checkpoint();
  const body = await tenant.owner.expect(tenant.owner.patch(`/api/usuarios/${me.usuario.id}/permissoes-operacao`, { permissoesOperacao: ['command.read'] }), 409, 'alvo dono');
  expect(body.error).toBe('Permissão aplicável apenas a atendentes');
  await evidence.assertNoDbChange();
});

test('RBAC-X07 chaves de evento no canônico', async ({ ops, page, evidence }) => {
  const tenant = await ops.tenant();
  const staff = await tenant.staff('Caixa', []);
  await tenant.owner.expect(tenant.owner.patch(`/api/usuarios/${staff.userId}/permissoes-operacao`, {
    permissoesOperacao: ['event.dashboard.read', 'event.menu.manage'],
  }), 200, 'persistir chaves de evento');
  const me = await staff.expect(staff.get('/api/auth/me'), 200, 'me');
  expect(me.usuario.permissoesOperacao).toEqual(expect.arrayContaining(['event.dashboard.read', 'event.menu.manage']));
  await loginPage(page, tenant.ownerEmail, tenant.ownerPassword);
  await page.goto('/operacao/configuracoes/equipe', { waitUntil: 'networkidle' });
  const eventKeysVisible = await page.getByText(/event\.dashboard\.read|event\.menu\.manage|Dashboard do evento|Cardápio do evento/i).count();
  test.info().annotations.push({
    type: 'product-decision',
    description: `API persiste event.dashboard.read/event.menu.manage. Editor de equipe mostrou ${eventKeysVisible} menções a chaves de evento. Recomendação: remover essas chaves do editor no modelo canônico.`,
  });
  await evidence.screenshot('rbac-event-keys');
  await evidence.checkpoint();
  await evidence.assertNoDbChange();
});
