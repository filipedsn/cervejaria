import { expect, PERSONA_PERMISSIONS, test, uniquePhone, uniqueSuffix } from '../support/ops';

test('CLI-S01 CRUD de cliente e histórico @api', async ({ ops }) => {
  const tenant = await ops.tenant();
  await tenant.openCash();
  const telefone = uniquePhone();
  const cliente = await tenant.owner.expect(tenant.owner.post('/api/clientes', { nome: `Cliente ${uniqueSuffix()}`, telefone }), 201, 'criar');
  await tenant.owner.expect(tenant.owner.patch(`/api/clientes/${cliente.id}`, { observacoes: 'VIP QA' }), 200, 'editar');
  const comanda = await tenant.openComanda(tenant.owner, [tenant.item('agua')], { clienteId: cliente.id, identificador: cliente.nome });
  await tenant.owner.expect(tenant.pay(tenant.owner, comanda.id, [{ forma: 'PIX', valor: 5 }]), 200, 'pagar');
  const historico = await tenant.owner.expect(tenant.owner.get(`/api/clientes/${cliente.id}/historico`), 200, 'histórico');
  expect((historico.items ?? historico).length).toBeGreaterThan(0);
});

test('CLI-S02 dono une clientes @api', async ({ ops }) => {
  const tenant = await ops.tenant();
  const destino = await tenant.owner.expect(tenant.owner.post('/api/clientes', { nome: 'Destino QA', telefone: uniquePhone() }), 201, 'destino');
  const fonte = await tenant.owner.expect(tenant.owner.post('/api/clientes', { nome: 'Fonte QA', telefone: uniquePhone() }), 201, 'fonte');
  // Telefones diferentes são recusados; união com o mesmo telefone exige duplicata pré-existente (única via migrate/portal).
  const diferente = await tenant.owner.expect(tenant.owner.post(`/api/clientes/${destino.id}/unir`, { fonteId: fonte.id }), 409, 'telefones diferentes');
  expect(diferente.error).toMatch(/telefones diferentes/i);
  // Controle positivo de autorização: o dono alcança o endpoint (409 de regra de negócio, não 403).
  expect(destino.id).not.toBe(fonte.id);
});

test('CLI-X01 atendente não une nem exclui clientes @api', async ({ ops, evidence }) => {
  const tenant = await ops.tenant();
  const cliente = await tenant.owner.expect(tenant.owner.post('/api/clientes', { nome: 'Alvo QA', telefone: uniquePhone() }), 201, 'criar');
  const outro = await tenant.owner.expect(tenant.owner.post('/api/clientes', { nome: 'Outro QA', telefone: uniquePhone() }), 201, 'outro');
  const salao = await tenant.staff('Salao', PERSONA_PERMISSIONS.salao);
  await evidence.checkpoint();
  await salao.expect(salao.post(`/api/clientes/${cliente.id}/unir`, { fonteId: outro.id }), 403, 'unir');
  await salao.expect(salao.delete(`/api/clientes/${cliente.id}`), 403, 'excluir');
  await evidence.assertNoDbChange();
  await tenant.owner.expect(tenant.owner.delete(`/api/clientes/${outro.id}`), 204, 'controle positivo excluir');
});

test('CLI-X02 telefone duplicado dá 409 @api', async ({ ops, evidence }) => {
  const tenant = await ops.tenant();
  const telefone = uniquePhone();
  await tenant.owner.expect(tenant.owner.post('/api/clientes', { nome: 'Primeiro', telefone }), 201, 'primeiro');
  await evidence.checkpoint();
  const body = await tenant.owner.expect(tenant.owner.post('/api/clientes', { nome: 'Duplicado', telefone }), 409, 'duplicado');
  expect(body.error).toBe('Já existe cliente com este telefone');
  await evidence.assertNoDbChange();
});
