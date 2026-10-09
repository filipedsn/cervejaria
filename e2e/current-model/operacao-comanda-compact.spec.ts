import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const tenantId = 'tenant-tap78-layout-qa';

function comandaFixture() {
  const item = (id: string, nome: string, overrides: Record<string, unknown> = {}) => ({
    id,
    produtoId: `product-${id}`,
    nome,
    quantidade: 1,
    volumeMl: 0,
    precoUnit: 18.5,
    subtotal: 18.5,
    exigePreparo: false,
    paraViagem: false,
    observacao: null,
    opcionais: [],
    cancelamentoPendenteEm: null,
    canceladoEm: null,
    ...overrides,
  });
  return {
    id: 'command-tap78-layout-qa',
    tipo: 'MESA',
    identificador: '12',
    numero: 12,
    status: 'ABERTA',
    pontoVendaId: 'pdv-tap78-layout-qa',
    createdAt: '2026-10-09T10:00:00.000Z',
    fechadaEm: null,
    subtotal: 83.5,
    desconto: 0,
    total: 83.5,
    valorEmAberto: 18.5,
    cliente: null,
    pedidos: [
      {
        id: 'order-101', numero: 101, status: 'RECEBIDO', observacao: 'Separar na bancada azul; entregar junto com a bebida.', createdAt: '2026-10-09T10:01:00.000Z',
        itens: [
          item('short', 'Água', { quantidade: 2, precoUnit: 5, subtotal: 10 }),
          item('long', 'Hambúrguer artesanal da casa com queijo maturado, cebola caramelizada e molho especial', {
            produtoId: 'product-kitchen', exigePreparo: true, paraViagem: true, observacao: 'Sem pimenta, molho à parte.',
            opcionais: [{ id: 'optional-1', nome: 'Bacon crocante extra', quantidade: 1, precoAdicional: 4 }],
            subtotal: 22.5,
          }),
        ],
      },
      {
        id: 'order-102', numero: 102, status: 'PRONTO', observacao: null, createdAt: '2026-10-09T10:02:00.000Z',
        itens: [item('delivered', 'Porção grande de batata com alecrim e páprica', { produtoId: 'product-kitchen', exigePreparo: true, subtotal: 51 })],
      },
    ],
    pagamentos: [],
  };
}

test('lista compacta e rodapé cabem em celular e tablet sem chamar configuração administrativa', async ({ page }) => {
  let comanda = comandaFixture();
  let administrativeConfigReads = 0;
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/api/auth/me')) {
      await route.fulfill({ json: { usuario: { id: 'employee-tap78', nome: 'Atendente QA', email: 'employee@example.test', papel: 'ATENDENTE', permissoesOperacao: ['command.read', 'command.close', 'payment.receive'] }, cervejaria: { id: tenantId, nome: 'TAP-78 QA' } } });
    } else if (url.pathname.endsWith('/api/operacao/contexto')) {
      const contextBody = {
        ativo: true, operationMode: 'CAIXA', plannedOperationsEnabled: false, cashRegisterEnabled: true,
        tapsEnabled: false, operationalSettingsSource: 'CANONICAL_PDV', inventoryEnabled: false,
        kitchenEnabled: true, kitchenItemsChargeAtLaunch: true,
        allowCloseComandaWithPendingKitchenOrders: true, controlaEstoque: false, temCozinha: true,
        usaCardapio: true, quantidadeMesas: 20, whatsappPedidoProntoEnabled: false,
        whatsappPedidoProntoNaCozinha: false, pontosVenda: [{ id: 'pdv-tap78-layout-qa', nome: 'QA', ativo: true }],
      };
      await route.fulfill({ json: contextBody });
    } else if (url.pathname.endsWith('/api/onboarding/readiness')) {
      await route.fulfill({ json: { mode: 'CAIXA', capacities: { controlaEstoque: false, temCozinha: true }, hasHistoricalSale: true, firstSaleCompleted: true, operationReady: true, canConfigure: false, modules: { operacao: { enabled: true, ready: true, missingSteps: [] }, cervejaria: { enabled: false, ready: true, missingSteps: [] } } } });
    } else if (url.pathname.endsWith('/api/cervejaria/configuracao-operacional')) {
      administrativeConfigReads += 1;
      await route.fulfill({ status: 403, json: { error: 'Dono only' } });
    } else if (url.pathname.endsWith('/api/operacao/comandas/command-tap78-layout-qa')) {
      await route.fulfill({ json: comanda });
    } else if (url.pathname.endsWith('/api/operacao/comandas/command-tap78-layout-qa/itens/short') && route.request().method() === 'PATCH') {
      const { quantidade } = route.request().postDataJSON() as { quantidade: number };
      const shortItem = comanda.pedidos[0]!.itens[0]!;
      shortItem.quantidade = quantidade;
      shortItem.subtotal = shortItem.precoUnit * quantidade;
      comanda.subtotal = 73.5 + shortItem.subtotal;
      comanda.total = comanda.subtotal;
      await route.fulfill({ json: comanda });
    } else if (url.pathname.includes('/api/operacao/produtos')) {
      await route.fulfill({ json: [] });
    } else if (url.pathname.includes('/api/operacao/cardapios') || url.pathname.endsWith('/api/trailers') || url.pathname.endsWith('/api/operacao/contas-pendentes')) {
      await route.fulfill({ json: [] });
    } else if (url.pathname.endsWith('/api/operacao/caixa/cardapio')) {
      await route.fulfill({ json: { editavel: false, catalogo: [], produtos: [], produtoIds: [], cardapioId: null, cardapioNome: null } });
    } else if (url.pathname.includes('/api/operacao/agenda/ocorrencias')) {
      await route.fulfill({ json: { agendas: [], ocorrencias: [] } });
    } else if (url.pathname.includes('/api/operacao/caixa')) {
      await route.fulfill({ json: { sessao: {
        id: 'cash-tap78-layout-qa', pontoVendaId: 'pdv-tap78-layout-qa', diaOperacional: '2026-10-09',
        status: 'ABERTO', trocoInicial: 100, abertoPorId: 'employee-tap78', abertoEm: '2026-10-09T09:00:00.000Z',
        fechadoPorId: null, fechadoEm: null, observacaoFechamento: null, pendente: 0,
        gaveta: { trocoInicial: 100, entradasDinheiro: 0, suprimentos: 0, sangrias: 0, esperadoDinheiro: 100 },
        esperado: { dinheiro: 0, pix: 0, cartaoDebito: 0, cartaoCredito: 0, totalVendas: 0 },
        contado: null, diferencas: null, movimentos: [],
      }, comandasAbertas: 1 } });
    } else if (url.pathname.endsWith('/api/audit/events')) {
      await route.fulfill({ status: 204, body: '' });
    } else {
      await route.fulfill({ json: {} });
    }
  });
  for (const width of [390, 768]) {
    comanda = comandaFixture();
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/operacao/comandas/command-tap78-layout-qa');
    await expect(page.getByText('Senha 101')).toBeVisible();
    await expect(page.getByText('Senha 102')).toBeVisible();
    await expect(page.getByText('Opcionais: Bacon crocante extra')).toBeVisible();
    await expect(page.getByText('Obs: Sem pimenta, molho à parte.')).toBeVisible();
    await expect(page.getByText('Para viagem', { exact: true })).toBeVisible();
    await expect(page.getByText('Pendente · R$ 22,50')).toBeVisible();
    await expect(page.getByRole('button', { name: /Fechar Comanda/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Voltar às comandas' })).toBeVisible();
    await page.getByRole('button', { name: 'Adicionar um Água' }).click();
    await expect(page.getByText('3', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Fechar Comanda.*R\$ 88,50/ })).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow, `horizontal overflow at ${width}px`).toBe(false);
    const footer = page.locator('.mobile-action-bar');
    const lastDetail = page.getByText('Para viagem', { exact: true });
    await lastDetail.evaluate((element) => element.scrollIntoView({ block: 'center' }));
    const [footerBox, detailBox] = await Promise.all([footer.boundingBox(), lastDetail.boundingBox()]);
    expect(footerBox).not.toBeNull();
    expect(detailBox).not.toBeNull();
    expect(detailBox!.y + detailBox!.height).toBeLessThanOrEqual(footerBox!.y + 1);
    if (width >= 640) await page.evaluate(() => window.scrollTo(0, 0));
    if (width >= 640) {
      const [closeBox, backBox] = await Promise.all([
        page.getByRole('button', { name: /Fechar Comanda/ }).boundingBox(),
        page.getByRole('button', { name: 'Voltar às comandas' }).boundingBox(),
      ]);
      expect(closeBox!.y).toBe(backBox!.y);
      expect(closeBox!.x + closeBox!.width).toBeLessThanOrEqual(backBox!.x);
    }
    const captureDir = resolve(process.cwd(), 'docs/qa/capturas');
    await mkdir(captureDir, { recursive: true });
    const connectionBanner = page.locator('div.fixed.top-0.left-0.right-0.z-50');
    if (await connectionBanner.count()) await connectionBanner.evaluate((element) => { (element as HTMLElement).style.display = 'none'; });
    await page.screenshot({ path: resolve(captureDir, `tap78-comanda-${width}px.png`) });
    expect(administrativeConfigReads).toBe(0);
  }
});

test('falha ao carregar contexto mantém fechamento bloqueado com mensagem distinta da regra desligada', async ({ page }) => {
  const comanda = comandaFixture();
  comanda.pedidos = [comanda.pedidos[0]!];
  comanda.pedidos[0]!.itens = [comanda.pedidos[0]!.itens[1]!];
  let administrativeConfigReads = 0;
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/api/auth/me')) {
      await route.fulfill({ json: { usuario: { id: 'employee-tap78-error', nome: 'Atendente QA', email: 'employee-error@example.test', papel: 'ATENDENTE', permissoesOperacao: ['command.read', 'command.close', 'payment.receive'] }, cervejaria: { id: tenantId, nome: 'TAP-78 QA' } } });
    } else if (url.pathname.endsWith('/api/operacao/contexto')) {
      await route.fulfill({ status: 503, json: { error: 'Context unavailable in QA' } });
    } else if (url.pathname.endsWith('/api/cervejaria/configuracao-operacional')) {
      administrativeConfigReads += 1;
      await route.fulfill({ status: 403, json: { error: 'Dono only' } });
    } else if (url.pathname.endsWith('/api/onboarding/readiness')) {
      await route.fulfill({ json: { mode: 'CAIXA', capacities: { controlaEstoque: false, temCozinha: true }, hasHistoricalSale: true, firstSaleCompleted: true, operationReady: true, canConfigure: false, modules: { operacao: { enabled: true, ready: true, missingSteps: [] }, cervejaria: { enabled: false, ready: true, missingSteps: [] } } } });
    } else if (url.pathname.endsWith('/api/operacao/comandas/command-tap78-layout-qa')) {
      await route.fulfill({ json: comanda });
    } else if (url.pathname.includes('/api/operacao/caixa/cardapio')) {
      await route.fulfill({ json: { editavel: false, catalogo: [], produtos: [], produtoIds: [], cardapioId: null, cardapioNome: null } });
    } else if (url.pathname.includes('/api/operacao/cardapios') || url.pathname.endsWith('/api/trailers') || url.pathname.endsWith('/api/operacao/contas-pendentes') || url.pathname.includes('/api/operacao/produtos')) {
      await route.fulfill({ json: [] });
    } else if (url.pathname.includes('/api/operacao/agenda/ocorrencias')) {
      await route.fulfill({ json: { agendas: [], ocorrencias: [] } });
    } else if (url.pathname.includes('/api/operacao/caixa')) {
      await route.fulfill({ json: { sessao: null, comandasAbertas: 1 } });
    } else if (url.pathname.endsWith('/api/audit/events')) {
      await route.fulfill({ status: 204, body: '' });
    } else {
      await route.fulfill({ json: {} });
    }
  });

  await page.goto('/operacao/comandas/command-tap78-layout-qa');
  await expect(page.getByText('Não foi possível validar o contexto do PDV.')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: /Fechar Comanda/ })).toHaveCount(0);
  await expect(page.getByText('Aguarde a entrega dos itens da cozinha antes de fechar a comanda.')).toHaveCount(0);
  expect(administrativeConfigReads).toBe(0);
});
