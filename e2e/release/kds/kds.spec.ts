import { expect, loginPage, PERSONA_PERMISSIONS, test, uniquePhone, uniqueSuffix, type Ops } from '../support/ops';

async function cozinhaPronta(ops: Ops, settings?: Record<string, unknown>) {
  const tenant = await ops.tenant(undefined, settings);
  await tenant.openCash(tenant.owner, 0);
  return tenant;
}

const pedidoDaPorcao = (comanda: { pedidos: Array<{ id: string; itens: Array<{ id: string; produtoId: string }> }> }, porcaoId: string) =>
  comanda.pedidos.find((pedido) => pedido.itens.some((item) => item.produtoId === porcaoId))!;

test('KDS-S01 fluxo recebido, em preparo, pronto, entregue e volta de etapa @api', async ({ ops }) => {
  const tenant = await cozinhaPronta(ops);
  const cozinha = await tenant.staff('Cozinha', PERSONA_PERMISSIONS.cozinha);
  const comanda = await tenant.openComanda(tenant.owner, [tenant.porcaoItem(1)]);
  const pedido = pedidoDaPorcao(comanda, tenant.catalog!.porcao.id);
  expect((await tenant.kitchenOrders(cozinha)).find((p: { id: string }) => p.id === pedido.id)).toMatchObject({ status: 'RECEBIDO' });
  await tenant.advanceKitchen(cozinha, pedido.id, ['EM_PREPARO', 'PRONTO']);
  const voltou = await cozinha.expect(cozinha.patch(`/api/operacao/cozinha/${pedido.id}/status`, { status: 'EM_PREPARO', expectedStatus: 'PRONTO' }), 200, 'voltar etapa');
  expect(voltou.status).toBe('EM_PREPARO');
  for (const [status, expectedStatus] of [['PRONTO', 'EM_PREPARO'], ['ENTREGUE', 'PRONTO']]) {
    await cozinha.expect(cozinha.patch(`/api/operacao/cozinha/${pedido.id}/status`, { status, expectedStatus }), 200, `${expectedStatus}->${status}`);
  }
  expect((await tenant.kitchenOrders(cozinha)).map((p: { id: string }) => p.id)).not.toContain(pedido.id);
  expect((await tenant.kitchenOrders(cozinha, true)).find((p: { id: string }) => p.id === pedido.id)).toMatchObject({ status: 'ENTREGUE' });
});

test('KDS-S02 cancelamento pendente confirmado pela Cozinha-Líder devolve estoque @api', async ({ ops }) => {
  const tenant = await cozinhaPronta(ops);
  const lider = await tenant.staff('CozinhaLider', PERSONA_PERMISSIONS.cozinhaLider);
  const comanda = await tenant.openComanda(tenant.owner, [tenant.porcaoItem(1), tenant.item('agua')]);
  const pedido = pedidoDaPorcao(comanda, tenant.catalog!.porcao.id);
  const item = pedido.itens.find((i) => i.produtoId === tenant.catalog!.porcao.id)!;
  expect((await tenant.stock())(tenant.catalog!.porcao.id)).toBe(19);
  const pendente = await tenant.owner.expect(tenant.owner.delete(`/api/operacao/comandas/${comanda.id}/itens/${item.id}`, { motivo: 'Cliente desistiu' }), 200, 'solicitar cancelamento');
  const itemPendente = pendente.pedidos.flatMap((p: { itens: Array<{ id: string; cancelamentoPendenteEm: string | null }> }) => p.itens).find((i: { id: string }) => i.id === item.id);
  expect(itemPendente.cancelamentoPendenteEm).toBeTruthy();
  await lider.expect(lider.patch(`/api/operacao/cozinha/${pedido.id}/itens/${item.id}/confirmar-cancelamento`), 200, 'confirmar cancelamento');
  const final = await tenant.comanda(tenant.owner, comanda.id);
  const itemFinal = final.pedidos.flatMap((p: { itens: Array<{ id: string; canceladoEm: string | null }> }) => p.itens).find((i: { id: string }) => i.id === item.id);
  expect(itemFinal?.canceladoEm ?? 'removido').toBeTruthy();
  expect(final.total).toBe(5);
  expect((await tenant.stock())(tenant.catalog!.porcao.id)).toBe(20);
});

test('KDS-S03 TV da cozinha pagina a fila completa', async ({ ops, page, evidence }) => {
  const tenant = await cozinhaPronta(ops);
  await tenant.owner.expect(tenant.owner.post('/api/operacao/estoque/entrada', { pontoVendaId: tenant.pointId, produtoId: tenant.catalog!.porcao.id, quantidade: 20 }), 201, 'reforço de estoque');
  for (let i = 0; i < 30; i++) await tenant.openComanda(tenant.owner, [tenant.porcaoItem(1)], { identificador: `Fila ${i}` });
  const cozinha = await tenant.staff('Cozinha', PERSONA_PERMISSIONS.cozinha);
  await loginPage(page, cozinha.email, cozinha.senha);
  await page.goto('/operacao/cozinha/tv', { waitUntil: 'networkidle' });
  const label = page.getByText(/Página 1 de (\d+) · 30 pedidos/);
  await expect(label).toBeVisible();
  const pages = Number((await label.textContent())!.match(/Página 1 de (\d+)/)![1]);
  for (let index = 2; index <= pages; index++) {
    await page.getByRole('button', { name: 'Próxima' }).click();
    await expect(page.getByText(new RegExp(`Página ${index} de ${pages} · 30 pedidos`))).toBeVisible();
  }
  await evidence.screenshot('tv-paginacao');
});

test('KDS-S04 TV da cozinha e modo demonstração renderizam', async ({ ops, page, evidence }) => {
  const tenant = await cozinhaPronta(ops);
  await tenant.openComanda(tenant.owner, [tenant.porcaoItem(1)], { identificador: 'Mesa TV QA' });
  await loginPage(page, tenant.ownerEmail, tenant.ownerPassword);
  await page.goto('/operacao/cozinha/tv', { waitUntil: 'networkidle' });
  await expect(page.getByText(/Página 1 de \d+ · 1 pedidos/)).toBeVisible();
  await expect(page.getByText('Mesa TV QA').filter({ visible: true }).first()).toBeVisible();
  await evidence.screenshot('tv');
  await page.goto('/operacao/cozinha/tv?demo=1', { waitUntil: 'networkidle' });
  await expect(page.getByText(/Página 1 de \d+ · \d+ pedidos/)).toBeVisible();
  await evidence.screenshot('tv-demo');
});

test('KDS-S05 pedido novo aparece na cozinha sem recarregar', async ({ ops, page, evidence }) => {
  const tenant = await cozinhaPronta(ops);
  const cozinha = await tenant.staff('Cozinha', PERSONA_PERMISSIONS.cozinha);
  await loginPage(page, cozinha.email, cozinha.senha);
  await page.goto('/operacao/cozinha', { waitUntil: 'networkidle' });
  const identificador = `Chegou ${uniqueSuffix()}`;
  await expect(page.getByText(identificador)).toHaveCount(0);
  await tenant.openComanda(tenant.owner, [tenant.porcaoItem(1)], { identificador });
  await expect(page.getByText(identificador).filter({ visible: true }).first()).toBeVisible({ timeout: 10_000 });
  await evidence.screenshot('pedido-novo');
});

test('KDS-S06 cozinha avisa pedido pronto pelo WhatsApp', async ({ ops, page, evidence }) => {
  const tenant = await cozinhaPronta(ops, { kitchenItemsChargeAtLaunch: true, whatsappPedidoProntoEnabled: true, whatsappPedidoProntoNaCozinha: true });
  const telefone = uniquePhone();
  const comanda = await tenant.openComanda(tenant.owner, [tenant.porcaoItem(1)], { identificador: 'Zap Cozinha QA', clienteNome: 'Cliente Pronto QA', clienteTelefone: telefone });
  const pedido = pedidoDaPorcao(comanda, tenant.catalog!.porcao.id);
  await tenant.advanceKitchen(tenant.owner, pedido.id, ['EM_PREPARO', 'PRONTO']);
  const cozinha = await tenant.staff('Cozinha', PERSONA_PERMISSIONS.cozinha);
  await page.addInitScript(() => {
    (window as unknown as { __opened: string[] }).__opened = [];
    window.open = ((url?: string | URL) => { (window as unknown as { __opened: string[] }).__opened.push(String(url)); return null; }) as typeof window.open;
  });
  await loginPage(page, cozinha.email, cozinha.senha);
  await page.goto('/operacao/cozinha', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Avisar/ }).first().click();
  await evidence.screenshot('aviso-whatsapp');
  const opened = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);
  expect(opened).toHaveLength(1);
  expect(opened[0]!.startsWith(`https://wa.me/55${telefone}?text=`)).toBe(true);
  const texto = decodeURIComponent(opened[0]!.split('?text=')[1]!);
  expect(texto).toMatch(/^Olá, Cliente Pronto QA! Seu pedido \(senha \d+\) está pronto para retirada/);
});

test('KDS-X01 transição inválida é recusada com código @api', async ({ ops, evidence }) => {
  const tenant = await cozinhaPronta(ops);
  const comanda = await tenant.openComanda(tenant.owner, [tenant.porcaoItem(1)]);
  const pedido = pedidoDaPorcao(comanda, tenant.catalog!.porcao.id);
  await evidence.checkpoint();
  const body = await tenant.owner.expect(tenant.owner.patch(`/api/operacao/cozinha/${pedido.id}/status`, { status: 'ENTREGUE', expectedStatus: 'RECEBIDO' }), 409, 'pular etapas');
  expect(body.code).toBe('KITCHEN_ORDER_TRANSITION_INVALID');
  await evidence.assertNoDbChange();
  await tenant.owner.expect(tenant.owner.patch(`/api/operacao/cozinha/${pedido.id}/status`, { status: 'EM_PREPARO', expectedStatus: 'RECEBIDO' }), 200, 'controle positivo');
});

test('KDS-X02 dois tablets mudando o mesmo pedido: o atrasado recebe conflito @api', async ({ ops, evidence }) => {
  const tenant = await cozinhaPronta(ops);
  const tabletA = await tenant.staff('TabletA', PERSONA_PERMISSIONS.cozinha);
  const tabletB = await tenant.staff('TabletB', PERSONA_PERMISSIONS.cozinha);
  const comanda = await tenant.openComanda(tenant.owner, [tenant.porcaoItem(1)]);
  const pedido = pedidoDaPorcao(comanda, tenant.catalog!.porcao.id);
  await tabletA.expect(tabletA.patch(`/api/operacao/cozinha/${pedido.id}/status`, { status: 'EM_PREPARO', expectedStatus: 'RECEBIDO' }), 200, 'tablet A');
  await evidence.checkpoint();
  const body = await tabletB.expect(tabletB.patch(`/api/operacao/cozinha/${pedido.id}/status`, { status: 'PRONTO', expectedStatus: 'RECEBIDO' }), 409, 'tablet B atrasado');
  expect(body.code).toBe('KITCHEN_ORDER_STATUS_CONFLICT');
  await evidence.assertNoDbChange();
});

test('KDS-X03 cancelar pedido exige kitchen.cancel e sale.refund @api', async ({ ops, evidence }) => {
  const tenant = await cozinhaPronta(ops);
  const cozinha = await tenant.staff('Cozinha', PERSONA_PERMISSIONS.cozinha);
  const soCancel = await tenant.staff('SoCancel', [...PERSONA_PERMISSIONS.cozinha, 'kitchen.cancel']);
  const lider = await tenant.staff('CozinhaLider', PERSONA_PERMISSIONS.cozinhaLider);
  const comanda = await tenant.openComanda(tenant.owner, [tenant.porcaoItem(1)]);
  const pedido = pedidoDaPorcao(comanda, tenant.catalog!.porcao.id);
  await evidence.checkpoint();
  const url = `/api/operacao/cozinha/${pedido.id}/status`;
  await cozinha.expect(cozinha.patch(url, { status: 'CANCELAMENTO_PENDENTE', expectedStatus: 'RECEBIDO' }), 403, 'sem kitchen.cancel');
  await soCancel.expect(soCancel.patch(url, { status: 'CANCELAMENTO_PENDENTE', expectedStatus: 'RECEBIDO' }), 403, 'sem sale.refund');
  await evidence.assertNoDbChange();
  await lider.expect(lider.patch(url, { status: 'CANCELAMENTO_PENDENTE', expectedStatus: 'RECEBIDO' }), 200, 'controle positivo');
});

test('KDS-X04 com a cozinha desligada a API devolve 404 e a rota some', async ({ ops, page, evidence }) => {
  const semCozinha = await ops.tenant({ kitchen: false }, {});
  await evidence.checkpoint();
  const body = await semCozinha.owner.expect(semCozinha.owner.get('/api/operacao/cozinha'), 404, 'cozinha desligada');
  expect(body.error).toBe('Operação sem cozinha');
  await loginPage(page, semCozinha.ownerEmail, semCozinha.ownerPassword);
  await page.goto('/operacao/cozinha', { waitUntil: 'networkidle' });
  await expect(page).not.toHaveURL(/\/operacao\/cozinha/);
  await expect(page.getByRole('link', { name: /^Cozinha$/ })).toHaveCount(0);
  await evidence.screenshot('sem-cozinha');
  await evidence.assertNoDbChange();
  const comCozinha = await ops.tenant();
  await comCozinha.owner.expect(comCozinha.owner.get('/api/operacao/cozinha'), 200, 'controle positivo');
});
