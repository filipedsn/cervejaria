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

test('KDS-S03 TV da cozinha mostra a fila completa com scroll', async ({ ops, page, evidence }) => {
  const tenant = await cozinhaPronta(ops);
  await tenant.owner.expect(tenant.owner.post('/api/operacao/estoque/entrada', { pontoVendaId: tenant.pointId, produtoId: tenant.catalog!.porcao.id, quantidade: 20 }), 201, 'reforço de estoque');
  for (let i = 0; i < 30; i++) await tenant.openComanda(tenant.owner, [tenant.porcaoItem(1)], { identificador: `Fila ${i}` });
  const cozinha = await tenant.staff('Cozinha', PERSONA_PERMISSIONS.cozinha);
  await loginPage(page, cozinha.email, cozinha.senha);
  await page.goto('/operacao/cozinha/tv', { waitUntil: 'networkidle' });
  await expect(page.locator('.cozinha-tv-pager-bar')).toContainText('30 pedidos');
  await expect(page.locator('.cozinha-tv-grid article')).toHaveCount(30);
  const scrollMetrics = await page.locator('.cozinha-tv-grid').evaluate((grid) => ({
    scrollHeight: grid.scrollHeight,
    clientHeight: grid.clientHeight,
    overflowY: getComputedStyle(grid).overflowY,
  }));
  expect(scrollMetrics.overflowY).toMatch(/auto|scroll/);
  expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);
  expect(await page.getByRole('button', { name: 'Próxima' }).count()).toBe(0);
  await evidence.screenshot('tv-scroll');
});

test('KDS-S04 TV da cozinha e modo demonstração renderizam', async ({ ops, page, evidence }) => {
  const tenant = await cozinhaPronta(ops);
  await tenant.openComanda(tenant.owner, [tenant.porcaoItem(1)], { identificador: 'Mesa TV QA' });
  await loginPage(page, tenant.ownerEmail, tenant.ownerPassword);
  await page.goto('/operacao/cozinha/tv', { waitUntil: 'networkidle' });
  await expect(page.locator('.cozinha-tv-pager-bar')).toContainText('1 pedidos');
  await expect(page.getByText('Mesa TV QA').filter({ visible: true }).first()).toBeVisible();
  await evidence.screenshot('tv');
  await page.goto('/operacao/cozinha/tv?demo=1', { waitUntil: 'networkidle' });
  await expect(page.locator('.cozinha-tv-pager-bar')).toContainText('pedidos');
  await evidence.screenshot('tv-demo');

  await page.goto('/operacao/cozinha/tv?demo=1&tablet=1', { waitUntil: 'networkidle' });
  const cards = page.locator('.cozinha-tv-grid article');
  await expect(cards).toHaveCount(4);

  const expectedColumns = async (grid = page.locator('.cozinha-tv-grid')) =>
    grid.evaluate((el) => {
      const styles = window.getComputedStyle(el);
      const minCardLength = styles.getPropertyValue('--cozinha-card-min').trim();
      const minCardValue = Number.parseFloat(minCardLength);
      const rootFontSize = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
      const minCardWidth = minCardLength.endsWith('rem') ? minCardValue * rootFontSize : minCardValue;
      const gap = Number.parseFloat(styles.columnGap) || 0;
      const fit = Math.max(1, Math.floor((el.clientWidth + gap) / (minCardWidth + gap)));
      const cap = Number.parseInt(el.dataset.maxColumns || '6', 10) || 6;
      return Math.min(cap, fit);
    });

  for (const width of [900, 1024, 1100, 1280, 1366]) {
    await page.setViewportSize({ width, height: 720 });
    const grid = page.locator('.cozinha-tv-grid');
    const columns = await expectedColumns(grid);
    await expect(grid).toHaveAttribute('data-kitchen-columns', String(columns));
    await expect(grid).toHaveAttribute('data-max-columns', '6');
    const layout = await cards.evaluateAll((elements) => {
      const rects = elements.map((element) => element.getBoundingClientRect());
      const actions = [...document.querySelectorAll('.cozinha-tv-card-actions button')];
      return {
        rows: new Set(rects.map((rect) => Math.round(rect.top))).size,
        minActionHeight: Math.min(...actions.map((button) => button.getBoundingClientRect().height)),
      };
    });
    expect(layout.rows).toBe(Math.ceil(4 / columns));
    expect(layout.minActionHeight).toBeGreaterThanOrEqual(44);
  }

  // Slot estável: 1 pedido não estica a linha inteira (capacidade do viewport, não cards.length).
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/operacao/cozinha/tv?demo=1&tablet=1&pedidos=1', { waitUntil: 'networkidle' });
  const singleGrid = page.locator('.cozinha-tv-grid');
  const singleColumns = await expectedColumns(singleGrid);
  await expect(singleGrid).toHaveAttribute('data-kitchen-columns', String(singleColumns));
  await expect(singleGrid).toHaveAttribute('data-force-tablet-layout', '1');
  await expect(singleGrid.locator('article')).toHaveCount(1);
  const slotRatio = await singleGrid.evaluate((grid) => {
    const card = grid.querySelector('article');
    if (!card) return 1;
    return card.getBoundingClientRect().width / grid.getBoundingClientRect().width;
  });
  expect(slotRatio).toBeLessThan(0.4);

  // Simulação por URL: ?maxColunas=2 força no máximo 2 por linha (e liga layout tablet no PC).
  await page.goto('/operacao/cozinha/tv?demo=1&maxColunas=2&pedidos=4', { waitUntil: 'networkidle' });
  const cappedGrid = page.locator('.cozinha-tv-grid');
  await expect(cappedGrid).toHaveAttribute('data-max-columns', '2');
  await expect(cappedGrid).toHaveAttribute('data-kitchen-columns', '2');
  await expect(cappedGrid.locator('article')).toHaveCount(4);
  const cappedRows = await cappedGrid.locator('article').evaluateAll((elements) =>
    new Set(elements.map((element) => Math.round(element.getBoundingClientRect().top))).size,
  );
  expect(cappedRows).toBe(2);

  const browser = page.context().browser();
  if (!browser) throw new Error('Browser unavailable for touch tablet layout check');
  const tabletContext = await browser.newContext({ viewport: { width: 1920, height: 1200 }, hasTouch: true });
  try {
    const tabletPage = await tabletContext.newPage();
    const demoUrl = new URL('/operacao/cozinha/tv?demo=1&tablet=1', page.url());
    await tabletPage.goto(demoUrl.toString(), { waitUntil: 'networkidle' });
    const tabletGrid = tabletPage.locator('.cozinha-tv-grid');
    const tabletColumnCount = await tabletGrid.evaluate((el) => {
      const styles = window.getComputedStyle(el);
      const minCardLength = styles.getPropertyValue('--cozinha-card-min').trim();
      const minCardValue = Number.parseFloat(minCardLength);
      const rootFontSize = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
      const minCardWidth = minCardLength.endsWith('rem') ? minCardValue * rootFontSize : minCardValue;
      const gap = Number.parseFloat(styles.columnGap) || 0;
      const fit = Math.max(1, Math.floor((el.clientWidth + gap) / (minCardWidth + gap)));
      const cap = Number.parseInt(el.dataset.maxColumns || '6', 10) || 6;
      return Math.min(cap, fit);
    });
    await expect(tabletGrid).toHaveAttribute('data-kitchen-columns', String(tabletColumnCount));
    const columns = tabletGrid.locator('.cozinha-tv-grid-column');
    await expect(columns).toHaveCount(tabletColumnCount);
    await expect(tabletGrid.locator('article')).toHaveCount(4);
    const firstCardTops = await columns.locator('> article:first-child').evaluateAll((elements) =>
      elements.map((element) => Math.round(element.getBoundingClientRect().top)),
    );
    expect(new Set(firstCardTops).size).toBe(1);
  } finally {
    await tabletContext.close();
  }

  await evidence.screenshot('tv-tablet-four-cards');
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
