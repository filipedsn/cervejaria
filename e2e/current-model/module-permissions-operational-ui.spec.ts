import { expect, test, type Page } from '@playwright/test';

const point = { id: 'ui-point', nome: 'Principal', ativo: true };
const product = {
  id: 'ui-product', nome: 'Produto QA', categoria: 'Comidas', tipo: 'COMIDA', formato: 'OUTRO',
  precoUnit: '12.00', exigePreparo: true, prepararEmPedidoSeparado: false, controlaEstoque: true,
  ativo: true, ordem: 0, precos: [{ volumeMl: 1, preco: 12 }], gruposOpcionais: [],
};
const kitchenOrder = {
  id: 'ui-order', numero: 12, status: 'RECEBIDO', createdAt: '2026-10-07T12:00:00.000Z',
  statusDesde: '2026-10-07T12:00:00.000Z', entregueEm: null, observacao: null,
  comanda: { id: 'ui-command', tipo: 'AVULSA', identificador: null, numero: null },
  itens: [{ id: 'ui-item', nome: product.nome, quantidade: 1, precoUnit: 12, exigePreparo: true }],
};
const stockBalance = {
  produtoId: product.id, nome: product.nome, categoria: product.categoria, quantidade: 4, unidadeEstoque: 'un',
  statusEstoque: 'NORMAL', estoqueMinimo: null,
};

async function mockOperationalProfile(page: Page, permissions: string[]) {
  const agendaWrites: unknown[] = [];
  const saleWrites: unknown[] = [];
  const catalogWrites: unknown[] = [];
  let agenda: { id: string; nome: string; diaSemana: number; horaInicio: string; horaFim: null; local: null; ativa: true } | null = null;
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;
    if (method === 'GET' && path === '/api/auth/me') return route.fulfill({ json: {
      usuario: { id: 'ui-staff', nome: 'Funcionário QA', email: 'staff@example.invalid', papel: 'ATENDENTE', permissoesOperacao: permissions },
      cervejaria: { id: 'ui-company', nome: 'Empresa QA', slug: 'permissions-ui' },
    } });
    if (method === 'GET' && path === '/api/operacao/contexto') return route.fulfill({ json: {
      ativo: true, operationMode: 'CAIXA', plannedOperationsEnabled: true, cashRegisterEnabled: true,
      operationalSettingsSource: 'CANONICAL_PDV', inventoryEnabled: true, kitchenEnabled: true,
      controlaEstoque: true, temCozinha: true, tapsEnabled: false, usaCardapio: true, quantidadeMesas: 0,
      whatsappPedidoProntoEnabled: false, whatsappPedidoProntoNaCozinha: false, pontosVenda: [point],
    } });
    if (method === 'GET' && path === '/api/onboarding/readiness') return route.fulfill({ json: {
      mode: 'CAIXA', capacities: { controlaEstoque: true, temCozinha: true }, hasHistoricalSale: true,
      firstSaleCompleted: true, operationReady: true, canConfigure: false,
      modules: { operacao: { enabled: true, ready: true, missingSteps: [] }, cervejaria: { enabled: false, ready: true, missingSteps: [] } },
    } });
    if (method === 'GET' && path === '/api/cervejaria/configuracao-operacional') return route.fulfill({ json: { configuration: { setupCompletedAt: '2026-10-07T12:00:00.000Z' } } });
    if (method === 'GET' && path === '/api/operacao/agenda/ocorrencias') return route.fulfill({ json: { agendas: agenda ? [agenda] : [], ocorrencias: [] } });
    if (method === 'POST' && path === '/api/operacao/agenda/agendas') {
      const payload = request.postDataJSON() as { nome: string; diaSemana: number; horaInicio: string };
      agendaWrites.push(payload);
      agenda = { ...payload, id: 'ui-agenda', horaFim: null, local: null, ativa: true };
      return route.fulfill({ status: 201, json: agenda });
    }
    if (method === 'GET' && path === '/api/operacao/cozinha') return route.fulfill({ json: [kitchenOrder] });
    if (method === 'GET' && path === '/api/operacao/estoque') return route.fulfill({ json: [stockBalance] });
    if (method === 'GET' && path === '/api/operacao/produtos' && url.searchParams.get('incluirInativos') === 'true') return route.fulfill({ json: [product] });
    if (method === 'GET' && path === '/api/operacao/produtos') return route.fulfill({ json: [product] });
    if (method === 'GET' && path === '/api/operacao/produtos/categorias') return route.fulfill({ json: { categorias: ['Comidas'], ordem: ['Comidas'] } });
    if (method === 'GET' && path === '/api/operacao/caixa') return route.fulfill({ json: { sessao: { id: 'ui-session', status: 'ABERTO', abertoEm: '2026-10-07T10:00:00.000Z' } } });
    if (method === 'GET' && path === '/api/operacao/comandas') return route.fulfill({ json: [] });
    if (method === 'POST' && path === '/api/operacao/vendas') {
      saleWrites.push(request.postDataJSON());
      return route.fulfill({ status: 201, json: { id: 'ui-sale', status: 'FECHADA', total: 12, subtotal: 12, desconto: 0, pagamentos: [{ id: 'ui-payment', forma: 'PIX', valor: 12 }], pedidos: [{ numero: 1, itens: [{ exigePreparo: false }] }] } });
    }
    if (method === 'PUT' && path === `/api/operacao/produtos/${product.id}`) {
      catalogWrites.push(request.postDataJSON());
      return route.fulfill({ json: { ...product, ...request.postDataJSON() } });
    }
    if (method === 'POST' && path === '/api/audit/events') return route.fulfill({ status: 204, body: '' });
    if (path === '/api/trailers' || path === '/api/eventos/ativos') return route.fulfill({ json: [] });
    return route.fulfill({ json: [] });
  });
  await page.routeWebSocket('**/socket.io/**', (socket) => socket.close());
  return { agendaWrites, saleWrites, catalogWrites };
}

test('agenda.manage acessa e salva agenda sem abrir equipe', async ({ page }) => {
  const { agendaWrites } = await mockOperationalProfile(page, ['agenda.manage']);
  await page.goto('/operacao/agenda');
  await expect(page.getByRole('heading', { name: 'Agenda operacional' })).toBeVisible();
  await page.getByLabel('Nome').first().fill('Agenda delegada');
  await page.getByRole('button', { name: 'Cadastrar recorrência' }).click();
  await expect.poll(() => agendaWrites).toHaveLength(1);
  await expect(page.getByText('Agenda delegada', { exact: true })).toBeVisible();
  await page.goto('/operacao/configuracoes/equipe');
  await expect(page).not.toHaveURL(/configuracoes\/equipe/);
  await expect(page.getByText('Funcionário QA')).toHaveCount(0);
});

test('kitchen.read consulta a fila sem oferecer preparo ou cancelamento', async ({ page }) => {
  await mockOperationalProfile(page, ['kitchen.read']);
  await page.goto('/operacao/cozinha');
  await expect(page.getByText(product.nome)).toBeVisible();
  await expect(page.getByText(/precisa da permiss[aã]o/i)).toBeVisible();
  await expect(page.locator('[data-audit="operacao-cozinha-confirmar-cancelamento"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /iniciar preparo|marcar pronto|entregar|solicitar cancelamento/i })).toHaveCount(0);
});

test('inventory.read consulta saldos sem oferecer ajuste', async ({ page }) => {
  await mockOperationalProfile(page, ['inventory.read']);
  await page.goto('/operacao/estoque');
  await expect(page.getByText(product.nome)).toBeVisible();
  await expect(page.getByRole('button', { name: /repor|saída|ajustar/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /definir aviso de estoque baixo/i })).toHaveCount(0);
});

test('vendedor sem catalog.manage conclui venda sem editor de preço', async ({ page }) => {
  const { saleWrites } = await mockOperationalProfile(page, ['command.operate', 'payment.receive']);
  await page.goto('/operacao/comandas/venda-avulsa');
  await page.getByRole('button', { name: '+ Item' }).click();
  await page.getByRole('button', { name: /Produto QA/ }).first().click();
  await expect(page.getByPlaceholder('R$ 0,00')).toHaveCount(0);
  await page.getByRole('button', { name: /Adicionar item/ }).last().click();
  await page.getByRole('button', { name: /Adicionar à venda/ }).click();
  await page.getByRole('button', { name: /Pagar/ }).click();
  await page.getByRole('button', { name: /Revisar pagamento/ }).click();
  await page.getByRole('button', { name: /Efetuar pagamento/ }).click();
  await expect.poll(() => saleWrites).toHaveLength(1);
  expect((saleWrites[0] as { itens: unknown[] }).itens).toHaveLength(1);
  await expect(page.getByText('Venda concluída')).toBeVisible();
});

test('catalog.manage habilita edição de produto pela tela de manutenção', async ({ page }) => {
  const { catalogWrites } = await mockOperationalProfile(page, ['catalog.manage']);
  await page.goto('/operacao/catalogo');
  await expect(page.getByText(product.nome)).toBeVisible();
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await page.getByPlaceholder('R$ 0,00').fill('1500');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect.poll(() => catalogWrites).toHaveLength(1);
  expect(catalogWrites[0]).toMatchObject({ categoria: 'Outros', precoUnit: 15 });
});
