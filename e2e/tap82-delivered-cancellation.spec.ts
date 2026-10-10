import { expect, test, type Page } from '@playwright/test';

const commandId = 'comanda-delivered-e2e';
const permission = 'command.item.cancel.delivered';

function authPayload(permissions: string[], role = 'ATENDENTE') {
  return {
    usuario: {
      id: 'user-e2e', nome: 'Operador QA', email: 'qa@example.invalid', papel: role,
      permissoesOperacao: permissions, podeDarDescontoOperacao: true,
    },
    cervejaria: { id: 'tenant-e2e', nome: 'Cervejaria QA', slug: 'cervejaria-qa' },
  };
}

function initialCommand() {
  return {
    id: commandId, tipo: 'MESA', identificador: 'A-12', numero: 12,
    status: 'ABERTA', pontoVendaId: 'pdv-e2e', createdAt: new Date().toISOString(),
    fechadaEm: null, subtotal: 20, desconto: 0, total: 20, valorEmAberto: 20,
    cliente: { id: 'cliente-e2e', nome: 'Cliente QA', telefone: null },
    pedidos: [{ id: 'pedido-e2e', numero: 42, status: 'ENTREGUE', clienteAvisadoEm: null, paraViagem: false, observacao: null, createdAt: new Date().toISOString(), itens: [
      { id: 'item-e2e', produtoId: 'produto-e2e', nome: 'Hambúrguer da casa', precoUnit: 10, quantidade: 2, volumeMl: 0, subtotal: 20, exigePreparo: true, canceladoEm: null, cancelamentoPendenteEm: null, opcionais: [{ id: 'op-e2e', nome: 'Queijo extra', precoAdicional: 2, quantidade: 1 }] },
    ] }],
    pagamentos: [], contaPendente: null,
  };
}

function kitchenSummaryCommand(kitchenItemsChargeAtLaunch: boolean) {
  const command = initialCommand();
  const stamp = new Date().toISOString();
  command.subtotal = kitchenItemsChargeAtLaunch ? 140 : 85;
  command.desconto = 15;
  command.total = command.subtotal - command.desconto;
  command.valorEmAberto = kitchenItemsChargeAtLaunch ? 0 : 55;
  command.cliente.telefone = '11987654321';
  command.pedidos = [
    { id: 'order-received', numero: 40, status: 'RECEBIDO', clienteAvisadoEm: null, paraViagem: false, observacao: null, createdAt: stamp, itens: [
      { id: 'item-received', produtoId: 'product-received', nome: 'Item recebido', precoUnit: 40, quantidade: 1, volumeMl: 0, subtotal: 40, exigePreparo: true, canceladoEm: null, cancelamentoPendenteEm: null, opcionais: [] },
    ] },
    { id: 'order-ready', numero: 41, status: 'PRONTO', clienteAvisadoEm: null, paraViagem: false, observacao: null, createdAt: stamp, itens: [
      { id: 'item-ready', produtoId: 'product-ready', nome: 'Item pronto', precoUnit: 15, quantidade: 1, volumeMl: 0, subtotal: 15, exigePreparo: true, canceladoEm: null, cancelamentoPendenteEm: null, opcionais: [] },
    ] },
    { id: 'order-delivered', numero: 42, status: 'ENTREGUE', clienteAvisadoEm: null, paraViagem: false, observacao: null, createdAt: stamp, itens: [
      { id: 'item-delivered', produtoId: 'product-delivered', nome: 'Item entregue', precoUnit: 81, quantidade: 1, volumeMl: 0, subtotal: 85, exigePreparo: true, canceladoEm: null, cancelamentoPendenteEm: null, opcionais: [{ id: 'optional-historical', nome: 'Extra histórico', precoAdicional: 4, quantidade: 1 }] },
    ] },
    { id: 'order-canceled', numero: 43, status: 'RECEBIDO', clienteAvisadoEm: null, paraViagem: false, observacao: null, createdAt: stamp, itens: [
      { id: 'item-canceled', produtoId: 'product-canceled', nome: 'Item cancelado', precoUnit: 30, quantidade: 1, volumeMl: 0, subtotal: 30, exigePreparo: true, canceladoEm: stamp, cancelamentoPendenteEm: null, opcionais: [] },
      { id: 'item-cancel-pending', produtoId: 'product-cancel-pending', nome: 'Item em cancelamento', precoUnit: 10, quantidade: 1, volumeMl: 0, subtotal: 10, exigePreparo: true, canceladoEm: null, cancelamentoPendenteEm: stamp, opcionais: [] },
    ] },
  ];
  return command;
}

async function mockApp(
  page: Page,
  permissions: string[],
  role = 'ATENDENTE',
  options: { command?: ReturnType<typeof initialCommand>; context?: Record<string, unknown>; contextStatus?: number } = {},
) {
  let command = options.command ?? initialCommand();
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/me') return json(authPayload(permissions, role));
    if (url.pathname === '/api/operacao/contexto') return json({
      ativo: true, operationMode: 'CAIXA', plannedOperationsEnabled: true, cashRegisterEnabled: true,
      operationalSettingsSource: 'LEGACY',
      tapsEnabled: false, inventoryEnabled: false, kitchenEnabled: true, kitchenItemsChargeAtLaunch: false,
      allowCloseComandaWithPendingKitchenOrders: false, controlaEstoque: false, temCozinha: true,
      usaCardapio: false, quantidadeMesas: 0, whatsappPedidoProntoEnabled: false,
      whatsappPedidoProntoNaCozinha: false, pontosVenda: [{ id: 'pdv-e2e', nome: 'Salão', ativo: true }],
      ...options.context,
    }, options.contextStatus ?? 200);
    if (url.pathname === '/api/onboarding/readiness') return json({
      mode: 'CAIXA', capacities: { controlaEstoque: false, temCozinha: true }, hasHistoricalSale: true,
      firstSaleCompleted: true, operationReady: true, canConfigure: false,
      modules: { operacao: { enabled: true, ready: true, missingSteps: [] }, cervejaria: { enabled: true, ready: true, missingSteps: [] } },
    });
    if (url.pathname.endsWith(`/api/operacao/comandas/${commandId}`) && request.method() === 'GET') return json(command);
    if (url.pathname === `/api/operacao/comandas/${commandId}/itens/item-e2e` && request.method() === 'DELETE') {
      const body = request.postDataJSON();
      const quantity = Number(body.quantidade);
      command = {
        ...command,
        subtotal: 10, total: 10, valorEmAberto: 10,
        pedidos: [{ ...command.pedidos[0], itens: [{ ...command.pedidos[0].itens[0], quantidade: 1, subtotal: 10,
          cancelamentosEntregue: [{ id: 'cancel-e2e', quantidade: quantity, valorRetirado: 10, motivo: body.motivo,
            tratamentoEstoque: 'SEM_RETORNO_PRODUTO_PREPARADO_ENTREGUE_OU_PERDIDO', createdAt: new Date().toISOString() }],
        }] }],
      };
      return json(command);
    }
    if (url.pathname === '/api/operacao/produtos') return json([]);
    if (url.pathname === '/api/operacao/estoque') return json([]);
    if (url.pathname === '/api/trailers') return json([]);
    if (url.pathname === '/api/operacao/caixa') return json({ sessao: { id: 'sessao-e2e', status: 'ABERTO', valoresRestritos: false } });
    if (url.pathname === '/api/usuarios' && request.method() === 'GET') return json([
      { id: 'staff-e2e', nome: 'Operador QA', email: 'qa@example.invalid', papel: 'ATENDENTE', permissoesOperacao: [] },
    ]);
    if (request.method() === 'GET') return json([]);
    return json({ ok: true });
  });
}

for (const settingsSource of ['LEGACY', 'CANONICAL_PDV'] as const) {
  for (const chargeAtLaunch of [false, true]) {
    for (const viewport of ['390px', '768px']) {
      test(`resumo financeiro ${settingsSource}, chargeAtLaunch=${chargeAtLaunch} at ${viewport}`, async ({ page }) => {
        await mockApp(page, ['command.read', 'command.close', 'payment.receive', 'discount.apply'], 'ATENDENTE', {
          command: kitchenSummaryCommand(chargeAtLaunch),
          context: {
            operationalSettingsSource: settingsSource,
            kitchenItemsChargeAtLaunch: chargeAtLaunch,
            allowCloseComandaWithPendingKitchenOrders: true,
          },
        });
        await page.setViewportSize(viewport === '390px' ? { width: 390, height: 844 } : { width: 768, height: 1024 });
        await page.addInitScript(() => {
          const target = window as Window & { __tap82WhatsAppUrl?: string };
          window.open = (url) => { target.__tap82WhatsAppUrl = String(url); return null; };
        });
        await page.goto(`/operacao/comandas/${commandId}`);
        const summary = page.locator('section.card').filter({ hasText: 'Subtotal dos itens' });
        const summaryToggle = page.getByRole('button', { name: 'Resumo da conta', exact: true });
        await expect(summaryToggle).toBeVisible();
        await summaryToggle.click();
        await expect(summaryToggle).toHaveAttribute('aria-pressed', 'true');
        await expect(summary).toBeVisible();
        const lineTotals = await summary.locator('ul > li > strong').allTextContents();
        const lineSumCents = lineTotals.reduce((sum, text) => {
          const normalized = text.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
          return sum + Math.round(Number(normalized) * 100);
        }, 0);
        const subtotal = chargeAtLaunch ? 140 : 85;
        const total = subtotal - 15;
        expect(lineSumCents).toBe(subtotal * 100);
        await expect(summary).toContainText(`R$ ${subtotal},00`);
        await expect(summary).toContainText('Desconto');
        await expect(summary).toContainText(`R$ ${total},00`);
        await expect(summary).toContainText('Item entregue');
        if (chargeAtLaunch) await expect(summary).not.toContainText('Valor em aberto');
        else {
          await expect(summary).toContainText('Valor em aberto');
          await expect(summary).toContainText('R$ 55,00');
        }
        await expect(summary).not.toContainText('Item cancelado');
        await expect(summary).not.toContainText('Item em cancelamento');
        if (chargeAtLaunch) {
          await expect(summary).toContainText('Item recebido');
          await expect(summary).toContainText('R$ 140,00');
          await expect(summary).toContainText('Item pronto');
          await expect(page.getByText('Pendente na cozinha:')).toHaveCount(0);
          await expect(page.getByRole('button', { name: /Fechar Comanda/ })).toBeEnabled();
          await page.getByRole('button', { name: /Fechar Comanda/ }).click();
          const paymentDialog = page.getByRole('dialog');
          await expect(paymentDialog).toContainText('Total a pagar');
          await expect(paymentDialog).toContainText(`R$ ${total},00`);
          await page.getByRole('button', { name: 'Fechar', exact: true }).click();
        } else {
          await expect(summary).not.toContainText('Item recebido');
          await expect(summary).not.toContainText('Item pronto');
          await expect(page.getByText('Pendente na cozinha:')).toBeVisible();
          await expect(page.getByRole('button', { name: /Fechar Comanda/ })).toHaveCount(0);
          await expect(page.getByText(/Aguarde a entrega dos itens da cozinha/i)).toBeVisible();
        }

        if (settingsSource === 'LEGACY' && chargeAtLaunch && viewport === '390px') {
          await page.getByRole('button', { name: 'Enviar resumo da conta pelo WhatsApp' }).click();
          const url = await page.evaluate(() => (window as Window & { __tap82WhatsAppUrl?: string }).__tap82WhatsAppUrl);
          expect(url).toBeTruthy();
          const message = (new URL(url!).searchParams.get('text') ?? '').replaceAll('\u00a0', ' ');
          expect(message).toContain('Item recebido');
          expect(message).toContain('Item pronto');
          expect(message).toContain('Subtotal confirmado: R$ 140,00');
          expect(message).toContain('Desconto: R$ 15,00');
          expect(message).toContain('Total parcial: R$ 125,00');
          expect(message).not.toContain('Itens em preparo');
        }

        const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
        expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client);
      });
    }
  }
}

for (const viewport of ['390px', '768px']) {
  test(`kitchen setting error hides the partial summary at ${viewport}`, async ({ page }) => {
    await mockApp(page, ['command.read'], 'ATENDENTE', {
      command: kitchenSummaryCommand(true),
      contextStatus: 503,
    });
    await page.setViewportSize(viewport === '390px' ? { width: 390, height: 844 } : { width: 768, height: 1024 });
    await page.goto(`/operacao/comandas/${commandId}`);
    await expect(page.getByRole('alert')).toContainText('validar o contexto do PDV');
    await expect(page.getByText('Subtotal dos itens')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Enviar resumo da conta pelo WhatsApp' })).toHaveCount(0);
  });
}

for (const viewport of ['390px', '768px']) {
  test(`item entregue: autorização, confirmação e atualização visual em ${viewport}`, async ({ page }) => {
    await mockApp(page, ['command.read', 'command.item.cancel']);
    await page.setViewportSize(viewport === '390px' ? { width: 390, height: 844 } : { width: 768, height: 1024 });
    await page.goto(`/operacao/comandas/${commandId}`);
    await expect(page.getByText('Hambúrguer da casa')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remover Hambúrguer da casa' })).toHaveCount(0);
    const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client);
  });

  test(`cancelamento de item entregue: formulário e resultado em ${viewport}`, async ({ page }) => {
    await mockApp(page, ['command.read', 'command.item.cancel', permission]);
    await page.setViewportSize(viewport === '390px' ? { width: 390, height: 844 } : { width: 768, height: 1024 });
    await page.goto(`/operacao/comandas/${commandId}`);
    await page.getByRole('button', { name: 'Remover Hambúrguer da casa' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Valor que sai da cobrança:');
    await expect(dialog).toContainText('R$ 20,00');
    await page.getByLabel('Quantidade a cancelar').fill('1');
    await expect(dialog).toContainText('R$ 10,00');
    await page.getByLabel('Motivo obrigatório').fill('Item preparado e não recebido');
    await page.getByRole('button', { name: 'Confirmar cancelamento' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText(/R\$\s*10,00/).first()).toBeVisible();
    await expect(page.getByText(/Cancelamento de 1 un/)).toBeVisible();
    await expect(page.getByText(/Item preparado e não recebido/)).toBeVisible();
    const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client);
  });
}

test('editor da equipe exibe a permissão específica', async ({ page }) => {
  await mockApp(page, [], 'DONO');
  await page.goto('/operacao/configuracoes/equipe');
  await page.getByRole('button', { name: 'Gerenciar acessos de Operador QA' }).click();
  await page.locator('summary').filter({ hasText: 'Atendimento' }).click();
  await expect(page.getByRole('checkbox', { name: 'Cancelar item já entregue' })).toBeVisible();
});
