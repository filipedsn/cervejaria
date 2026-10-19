import { expect, loginPage, test, uniquePhone, uniqueSuffix } from '../support/ops';

test('CMD-S21 propagates a corrected client name to open commands and preserves custom aliases', async ({ ops, page, evidence }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The cross-session regression runs once in the disposable browser suite.');
  const tenant = await ops.tenant();
  await tenant.openCash(tenant.owner);
  await loginPage(page, tenant.ownerEmail, tenant.ownerPassword);

  const originalName = `Wrongly typed ${uniqueSuffix()}`;
  const correctedName = `Corrected client ${uniqueSuffix()}`;
  await page.goto('/operacao/comandas/nova', { waitUntil: 'networkidle' });
  await page.getByPlaceholder('(11) 9 9999-9999').fill(uniquePhone());
  await page.getByPlaceholder('Digite o nome...').fill(originalName);
  const openingResponse = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/operacao/comandas');
  await page.getByRole('button', { name: 'Abrir comanda' }).click();
  const opened = await openingResponse;
  expect(opened.status()).toBe(201);
  const created = await opened.json();
  const commandId = created.id as string;
  const clientId = created.cliente.id as string;
  expect(created).toMatchObject({ identificador: originalName, cliente: { nome: originalName } });

  const browser = page.context().browser();
  if (!browser) throw new Error('Browser unavailable for second authenticated session.');
  const secondPage = await browser.newPage();
  try {
    await loginPage(secondPage, tenant.ownerEmail, tenant.ownerPassword);
    await secondPage.goto('/operacao/comandas', { waitUntil: 'networkidle' });
    await expect(secondPage.getByText(originalName, { exact: true })).toBeVisible();

    await page.goto(`/clientes/${clientId}`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Editar' }).click();
    await page.locator('input.input').first().fill(correctedName);
    const updateResponse = page.waitForResponse((response) => response.request().method() === 'PATCH' && new URL(response.url()).pathname === `/api/clientes/${clientId}`);
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    const updated = await updateResponse;
    expect(updated.status()).toBe(200);
    await expect(page.getByRole('heading', { name: correctedName })).toBeVisible();

    await expect(secondPage.getByText(correctedName, { exact: true })).toBeVisible({ timeout: 5_000 });
    await page.goto(`/operacao/comandas/${commandId}`, { waitUntil: 'networkidle' });
    await expect(page.locator('h2').filter({ hasText: correctedName })).toBeVisible();
    await secondPage.goto(`/operacao/comandas/${commandId}`, { waitUntil: 'networkidle' });
    await expect(secondPage.locator('h2').filter({ hasText: correctedName })).toBeVisible();

    const refreshed = await tenant.owner.expect(tenant.owner.get(`/api/operacao/comandas/${commandId}`), 200, 'command after client correction');
    expect(refreshed).toMatchObject({ identificador: correctedName, cliente: { id: clientId, nome: correctedName } });
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('h2').filter({ hasText: correctedName })).toBeVisible();
    await evidence.recordApi({ actor: 'owner-api', method: 'GET', url: `/api/operacao/comandas/${commandId}`, status: 200, before: { identificador: created.identificador, clienteNome: created.cliente.nome }, after: { identificador: refreshed.identificador, clienteNome: refreshed.cliente.nome } });

    const customAlias = `Custom alias ${uniqueSuffix()}`;
    const custom = await tenant.openComanda(tenant.owner, [], { identificador: customAlias, clienteNome: correctedName, clienteId: clientId });
    expect(custom.identificador).toBe(customAlias);
    const finalName = `Final client name ${uniqueSuffix()}`;
    await tenant.owner.expect(tenant.owner.patch(`/api/clientes/${clientId}`, { nome: finalName }), 200, 'second client correction');
    expect((await tenant.comanda(tenant.owner, custom.id)).identificador).toBe(customAlias);
    expect((await tenant.comanda(tenant.owner, commandId)).identificador).toBe(finalName);

    const mesa = await tenant.openComanda(tenant.owner, [], { tipo: 'MESA', identificador: '12', clienteNome: finalName, clienteId: clientId });
    const ficha = await tenant.openComanda(tenant.owner, [], { tipo: 'FICHA', identificador: 'F-12', clienteNome: finalName, clienteId: clientId });
    const closed = await tenant.openComanda(tenant.owner, [tenant.item('lata')], {
      identificador: `Historical ${uniqueSuffix()}`,
      clienteNome: finalName,
      clienteId: clientId,
    });
    const closedBefore = await tenant.pay(tenant.owner, closed.id, [{ forma: 'PIX', valor: 8 }]);
    expect(closedBefore.status).toBe(200);
    const closedSnapshot = await tenant.comanda(tenant.owner, closed.id);

    const unauthorized = await tenant.staff('NoClientPermission', []);
    await unauthorized.expect(unauthorized.patch(`/api/clientes/${clientId}`, { nome: 'Unauthorized name' }), 403, 'client rename without permission');
    const otherTenantOwner = await ops.persona('ownerB');
    const foreign = await otherTenantOwner.expect(otherTenantOwner.post('/api/clientes', {
      nome: `Foreign ${uniqueSuffix()}`,
      telefone: uniquePhone(),
    }), 201, 'foreign tenant client');
    await tenant.owner.expect(tenant.owner.patch(`/api/clientes/${foreign.id}`, { nome: 'Cross tenant attempt' }), 404, 'foreign client isolation');

    const laterName = `Later client name ${uniqueSuffix()}`;
    await tenant.owner.expect(tenant.owner.patch(`/api/clientes/${clientId}`, { nome: laterName }), 200, 'third client correction');
    expect((await tenant.comanda(tenant.owner, mesa.id)).identificador).toBe('12');
    expect((await tenant.comanda(tenant.owner, ficha.id)).identificador).toBe('F-12');
    expect((await tenant.comanda(tenant.owner, closed.id))).toMatchObject({
      status: 'FECHADA',
      identificador: closedSnapshot.identificador,
      total: closedSnapshot.total,
      pagamentos: closedSnapshot.pagamentos,
    });
    expect((await tenant.comanda(tenant.owner, commandId)).identificador).toBe(laterName);
  } finally {
    await secondPage.close();
  }
});
