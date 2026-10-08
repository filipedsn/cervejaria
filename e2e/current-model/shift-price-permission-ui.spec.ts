import { expect, test, type Page } from '@playwright/test';

const point = { id: 'price-point', nome: 'Principal', ativo: true };
const cardapioId = 'price-template';
const product = {
  id: 'price-product', nome: 'Produto de turno', categoria: 'Comidas', tipo: 'COMIDA', formato: 'OUTRO',
  precoUnit: '10.00', precoEfetivo: 10, volumeMl: 0, precoOverrideTurno: false,
  exigePreparo: false, controlarEstoque: false, ativo: true, ordem: 0,
  precos: [{ volumeMl: 1, preco: 10 }], gruposOpcionais: [],
};
const cardapioTurno = {
  pontoVendaId: point.id, cardapioId, cardapioNome: 'Template atual', produtoIds: [product.id],
  produtos: [product], catalogo: [product], editavel: true,
};

async function setup(page: Page, permissions: string[]) {
  const writes: Array<Record<string, unknown>> = [];
  const unexpected: string[] = [];
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const { pathname, searchParams } = new URL(req.url());
    const method = req.method();
    if (method === 'GET' && pathname === '/api/auth/me') return route.fulfill({ json: {
      usuario: { id: 'price-staff', nome: 'Funcionário QA', email: 'staff@example.invalid', papel: 'ATENDENTE', permissoesOperacao: permissions },
      cervejaria: { id: 'price-company', nome: 'Empresa QA', slug: 'shift-price-ui' },
    } });
    if (method === 'GET' && pathname === '/api/operacao/contexto') return route.fulfill({ json: {
      ativo: true, operationMode: 'CAIXA', plannedOperationsEnabled: true, cashRegisterEnabled: true,
      operationalSettingsSource: 'CANONICAL_PDV', inventoryEnabled: false, kitchenEnabled: false,
      controlaEstoque: false, temCozinha: false, tapsEnabled: false, usaCardapio: true,
      quantidadeMesas: 0, whatsappPedidoProntoEnabled: false, whatsappPedidoProntoNaCozinha: false, pontosVenda: [point],
    } });
    if (method === 'GET' && pathname === '/api/onboarding/readiness') return route.fulfill({ json: {
      mode: 'CAIXA', capacities: { controlaEstoque: false, temCozinha: false }, hasHistoricalSale: true,
      firstSaleCompleted: true, operationReady: true, canConfigure: false,
      modules: { operacao: { enabled: true, ready: true, missingSteps: [] }, cervejaria: { enabled: false, ready: true, missingSteps: [] } },
    } });
    if (method === 'GET' && pathname === '/api/cervejaria/configuracao-operacional') return route.fulfill({ json: { configuration: { setupCompletedAt: '2026-10-07T12:00:00.000Z' } } });
    if (method === 'GET' && pathname === '/api/operacao/caixa') return route.fulfill({ json: {
      diaOperacional: '2026-10-07', comandasAbertas: 0,
      sessao: { id: 'price-session', status: 'ABERTO', abertoEm: '2026-10-07T10:00:00.000Z', trailerId: null,
        gaveta: { trocoInicial: 100, entradasDinheiro: 0, suprimentos: 0, sangrias: 0, esperadoDinheiro: 100 },
        esperado: { totalVendas: 0 }, movimentos: [], pagamentosPorForma: [] },
    } });
    if (method === 'GET' && pathname === '/api/operacao/caixa/cardapio') return route.fulfill({ json: {
      ...cardapioTurno, editavel: permissions.includes('catalog.shift.manage'),
    } });
    if (method === 'GET' && pathname === '/api/operacao/cardapios') return route.fulfill({ json: [{ id: cardapioId, nome: 'Template atual', ativo: true, produtoIds: [product.id], produtos: [product] }] });
    if (method === 'PATCH' && pathname === '/api/operacao/caixa/cardapio/preco' && searchParams.get('pontoVendaId') === point.id) {
      writes.push(req.postDataJSON() as Record<string, unknown>);
      return route.fulfill({ json: cardapioTurno });
    }
    if (method === 'GET' && pathname === '/api/operacao/contas-pendentes') return route.fulfill({ json: [] });
    if (method === 'GET' && pathname === '/api/operacao/agenda/ocorrencias') return route.fulfill({ json: { ocorrencias: [] } });
    if (method === 'GET' && pathname === '/api/trailers') return route.fulfill({ json: [] });
    if (method === 'GET' && pathname === '/api/eventos/ativos') return route.fulfill({ json: [] });
    if (method === 'GET' && pathname === '/api/public/dev/app-origin') return route.fulfill({ json: { appOrigin: 'http://localhost:5202' } });
    if (method === 'POST' && pathname === '/api/audit/events') return route.fulfill({ status: 204, body: '' });
    unexpected.push(`${method} ${pathname}${new URL(req.url()).search}`);
    return route.abort();
  });
  await page.routeWebSocket('**/socket.io/**', (socket) => socket.close());
  return { writes, unexpected };
}

async function openPriceChoice(page: Page, expectedDialog: string) {
  await page.goto('/operacao/caixa?pontoVendaId=price-point');
  await expect(page.getByText('Preços neste turno')).toBeVisible();
  // CurrencyInput is exposed as a textbox; choose its current item by value.
  const input = page.getByRole('textbox').last();
  await input.fill('15,00');
  await input.blur();
  await expect(page.getByRole('heading', { name: expectedDialog })).toBeVisible();
}

test('catalog.shift.manage edita somente TURNO e envia o escopo escolhido', async ({ page }) => {
  const { writes, unexpected } = await setup(page, ['cash.values.read', 'catalog.shift.manage']);
  await openPriceChoice(page, 'Onde aplicar o novo preço?');
  await expect(page.getByRole('button', { name: 'Só neste turno' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Salvar no cardápio/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Só neste turno' }).click();
  await expect.poll(() => writes).toHaveLength(1);
  expect(writes[0]).toEqual({ produtoId: product.id, volumeMl: 0, precoUnit: 15, escopo: 'TURNO' });
  expect(unexpected).toEqual([]);
});

test('catalog.manage junto à permissão de turno oferece TEMPLATE e envia esse escopo', async ({ page }) => {
  const { writes, unexpected } = await setup(page, ['cash.values.read', 'catalog.shift.manage', 'catalog.manage']);
  await openPriceChoice(page, 'Onde aplicar o novo preço?');
  await expect(page.getByRole('button', { name: 'Só neste turno' })).toBeVisible();
  const template = page.getByRole('button', { name: /Salvar no cardápio/ });
  await expect(template).toBeVisible();
  await template.click();
  await expect.poll(() => writes).toHaveLength(1);
  expect(writes[0]).toEqual({ produtoId: product.id, volumeMl: 0, precoUnit: 15, escopo: 'TEMPLATE' });
  expect(unexpected).toEqual([]);
});

test('consulta sem concessões de catálogo não oferece edição de preço', async ({ page }) => {
  const { writes, unexpected } = await setup(page, ['cash.values.read']);
  await page.goto('/operacao/caixa?pontoVendaId=price-point');
  await expect(page.getByRole('button', { name: 'Editar cardápio do turno' })).toHaveCount(0);
  await expect(page.getByRole('textbox')).toHaveCount(0);
  expect(writes).toEqual([]);
  expect(unexpected).toEqual([]);
});
