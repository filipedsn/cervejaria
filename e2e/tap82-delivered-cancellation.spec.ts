import { expect, test, type Page } from '@playwright/test';

const commandId = 'comanda-delivered-e2e';
const permission = 'command.item.cancel.delivered';

function authPayload(permissions: string[], role = 'ATENDENTE') {
  return {
    usuario: {
      id: 'user-e2e', nome: 'Operador QA', email: 'qa@example.invalid', papel: role,
      permissoesOperacao: permissions, podeDarDescontoOperacao: false,
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

async function mockApp(page: Page, permissions: string[], role = 'ATENDENTE') {
  let command = initialCommand();
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/me') return json(authPayload(permissions, role));
    if (url.pathname === '/api/operacao/contexto') return json({
      ativo: true, operationMode: 'CAIXA', plannedOperationsEnabled: true, cashRegisterEnabled: true,
      operationalSettingsSource: 'CANONICAL_PDV',
      tapsEnabled: false, inventoryEnabled: false, kitchenEnabled: true, kitchenItemsChargeAtLaunch: false,
      allowCloseComandaWithPendingKitchenOrders: false, controlaEstoque: false, temCozinha: true,
      usaCardapio: false, quantidadeMesas: 0, whatsappPedidoProntoEnabled: false,
      whatsappPedidoProntoNaCozinha: false, pontosVenda: [{ id: 'pdv-e2e', nome: 'Salão', ativo: true }],
    });
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
