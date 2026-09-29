import { expect, test, type Page } from '@playwright/test';
import { API_BASE, apiLogin, apiRequest } from '../helpers/api';
import { CREDENTIALS } from '../helpers/auth';

type Json = Record<string, any>;
type Mode = 'CAIXA' | 'EVENTO';

const runId = `current-e2e-${Date.now()}`;
const adminEmail = CREDENTIALS.admin.email;
const ownerPassword = 'CurrentModel-qa-2026';
let adminCookie = '';

async function call<T extends Json = Json>(method: string, path: string, cookie: string, body?: unknown) {
  const result = await apiRequest<T>(method, path, { cookie, ...(body === undefined ? {} : { body }) });
  return result;
}

async function required<T extends Json = Json>(method: string, path: string, cookie: string, body?: unknown, expectedStatus?: number) {
  const result = await call<T>(method, path, cookie, body);
  expect(result.status, `${method} ${path}: ${JSON.stringify(result.data)}`).toBe(expectedStatus ?? (method === 'POST' ? 201 : 200));
  return result.data;
}

async function publicPost(path: string, body: unknown, expectedStatus: number, cookie?: string) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  const data = raw ? JSON.parse(raw) as Json : {};
  expect(response.status, `POST ${path}: ${JSON.stringify(data)}`).toBe(expectedStatus);
  const cookieHeader = response.headers.get('set-cookie');
  const sessionCookie = cookieHeader?.match(/(?:^|,\s*)(cliente_pdv_token|cliente_token)=([^;]+)/);
  return { data, cookie: sessionCookie ? `${sessionCookie[1]}=${sessionCookie[2]}` : '' };
}

async function currentTenant(mode: Mode) {
  const stamp = `${runId}-${mode.toLowerCase()}`;
  const owner = { nome: `E2E Current ${mode}`, email: `${stamp}@qa.test`, senha: ownerPassword };
  const provisioned = await required('POST', '/api/admin/cervejarias/provision', adminCookie, {
    nome: `E2E Current ${mode} ${runId}`,
    dono: owner,
    enablements: {
      plannedOperations: mode === 'EVENTO',
      taps: true,
      inventory: true,
      kitchen: true,
    },
  });
  const companyId = provisioned.cervejaria.id as string;
  const ownerCookie = await apiLogin(owner.email, ownerPassword);
  if (mode === 'CAIXA') {
    const config = await apiRequest('PATCH', `/api/admin/cervejarias/${companyId}/configuracao-operacional`, {
      cookie: adminCookie,
      body: { whatsappPedidoProntoEnabled: true, whatsappPedidoProntoNaCozinha: false },
    });
    expect(config.status).toBe(200);
  }
  const cardapioConfig = await apiRequest('PATCH', '/api/cervejaria/operacao', {
    cookie: ownerCookie,
    body: { usaCardapio: true },
  });
  expect(cardapioConfig.status).toBe(200);
  const attendant = await required('POST', '/api/usuarios', ownerCookie, {
    nome: `E2E Atendente ${mode}`, email: `${stamp}-attendant@qa.test`, senha: ownerPassword,
  });
  const attendantCookie = await apiLogin(attendant.email, ownerPassword);
  const pos = await required('POST', '/api/operacao/pontos-venda', ownerCookie, { nome: 'Ponto principal' });
  const trailer = await required('POST', '/api/trailers', ownerCookie, { nome: 'Trailer principal' });
  const food = await required('POST', '/api/operacao/produtos', ownerCookie, {
    nome: 'Porção E2E', categoria: 'Porções', tipo: 'COMIDA', precoUnit: 20,
    exigePreparo: true, controlaEstoque: true,
  });
  const beer = await required('POST', '/api/operacao/produtos', ownerCookie, {
    nome: 'Chope E2E', categoria: 'Chope', tipo: 'BEBIDA', formato: 'CHOPE',
    precos: [{ volumeMl: 300, preco: 15 }, { volumeMl: 500, preco: 20 }, { volumeMl: 700, preco: 26 }],
    exigePreparo: false, controlaEstoque: true,
  });
  const optional = await required('POST', '/api/operacao/produtos/opcionais', ownerCookie, { nome: 'Adicional E2E', preco: 3 });
  await required('PUT', `/api/operacao/produtos/${food.id}/opcionais`, ownerCookie, { opcionalIds: [optional.id] });
  const vinculados = await required<any[]>('GET', `/api/operacao/produtos/${food.id}/opcionais`, ownerCookie);
  expect(vinculados.map((row) => row.opcionalId)).toContain(optional.id);
  expect(Number(vinculados.find((row) => row.opcionalId === optional.id)?.opcional.preco)).toBe(3);
  const tap = await required('POST', '/api/taps', ownerCookie, {
    numero: 1, nome: 'Tap E2E', trailerId: trailer.id, produtoId: beer.id,
  });
  for (const [produtoId, quantidade] of [[food.id, 10], [beer.id, 12]] as const) {
    await required('POST', '/api/operacao/estoque/entrada', ownerCookie, {
      pontoVendaId: pos.id, produtoId, quantidade, observacao: `seed ${runId}`,
    });
  }
  return { companyId, slug: provisioned.cervejaria.slug as string, ownerCookie: attendantCookie, adminOwnerCookie: ownerCookie, posId: pos.id as string, trailerId: trailer.id as string,
    foodId: food.id as string, beerId: beer.id as string, optionalId: optional.id as string, tapId: tap.id as string };
}

async function attachSession(page: Page, cookie: string) {
  const origin = new URL(API_BASE);
  await page.context().addCookies([{
    name: 'token', value: cookie.replace(/^token=/, ''), domain: origin.hostname, path: '/',
    httpOnly: true, secure: origin.protocol === 'https:', sameSite: 'Lax',
  }]);
}

async function stock(cookie: string, posId: string, productId: string) {
  const result = await required<any[]>('GET', `/api/operacao/estoque?pontoVendaId=${encodeURIComponent(posId)}`, cookie);
  return result.find((line) => line.produtoId === productId);
}

async function advanceKitchenToReady(cookie: string, orderId: string) {
  const queue = await required<any[]>('GET', '/api/operacao/cozinha', cookie);
  const order = queue.find((row) => row.id === orderId);
  expect(order, 'pedido com item preparado precisa aparecer na cozinha').toBeTruthy();
  expect(order.itens ?? order.itensComanda).toHaveLength(1);
  for (const status of ['EM_PREPARO', 'PRONTO']) {
    await required('PATCH', `/api/operacao/cozinha/${orderId}/status`, cookie, { status });
  }
}

async function deliverKitchenOrder(cookie: string, orderId: string) {
  await required('PATCH', `/api/operacao/cozinha/${orderId}/status`, cookie, { status: 'ENTREGUE' });
}

async function cleanup(companyId: string) {
  if (companyId) await call('PATCH', `/api/admin/cervejarias/${companyId}/ativo`, adminCookie, { ativo: false });
}

test.describe('Current operating model — attendant sales parity', () => {
  test.setTimeout(120_000);
  test.beforeAll(async () => {
    adminCookie = await apiLogin(adminEmail, CREDENTIALS.admin.password);
    const fixtures = await required<any[]>('GET', '/api/admin/cervejarias', adminCookie);
    for (const fixture of fixtures.filter((row) => row.nome?.startsWith('E2E Current CAIXA current-e2e-'))) {
      await call('PATCH', `/api/admin/cervejarias/${fixture.id}/ativo`, adminCookie, { ativo: false });
    }
  });

  for (const mode of ['CAIXA', 'EVENTO'] as const) {
    test(`${mode}: prepared food + optional + tap beer persist inventory and reconcile payment`, async ({ page }) => {
      const tenant = await currentTenant(mode);
      try {
        const identity = await required<Json>('GET', '/api/auth/me', tenant.ownerCookie);
        expect(identity.usuario.papel).toBe('ATENDENTE');
        const context = await required<Json>('GET', '/api/operacao/contexto', tenant.ownerCookie);
        expect(context).toMatchObject({
          operationMode: mode, tapsEnabled: true, inventoryEnabled: true, kitchenEnabled: true,
        });
        await attachSession(page, tenant.ownerCookie);
        await page.goto('/operacao/comandas');
        await expect(page).not.toHaveURL(/\/login/);
        await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeVisible();

        const beforeFood = await stock(tenant.ownerCookie, tenant.posId, tenant.foodId);
        const beforeBeer = await stock(tenant.ownerCookie, tenant.posId, tenant.beerId);
        expect(beforeFood).toMatchObject({ quantidade: 10, unidadeEstoque: 'un' });
        expect(beforeBeer).toMatchObject({ quantidade: 12, unidadeEstoque: 'L' });

        if (mode === 'EVENTO') {
          await attachSession(page, tenant.adminOwnerCookie);
          await page.goto('/configuracoes/catalogo');
          await expect(page.getByRole('heading', { name: 'Cardápio' })).toBeVisible();
          await expect(page.getByRole('button', { name: 'Catálogo', exact: true })).toBeVisible();
          await expect(page.getByRole('button', { name: 'Cardápios salvos', exact: true })).toBeVisible();
          await expect(page.getByText('Porção E2E', { exact: true })).toBeVisible();
          await page.getByRole('button', { name: 'Cardápios salvos', exact: true }).click();
          await expect(page.getByRole('button', { name: '+ Novo cardápio' })).toBeVisible();
          await attachSession(page, tenant.ownerCookie);
          await page.goto('/operacao/comandas');
        }

        let comandaId = '';
        let orderId = '';
        if (mode === 'CAIXA') {
          const savedMenu = await required<Json>('POST', '/api/operacao/cardapios', tenant.adminOwnerCookie, {
            nome: `CardÃ¡pio E2E ${runId}`, produtoIds: [tenant.foodId],
          });
          const emptySession = await required<Json>('POST', '/api/operacao/caixa/abrir', tenant.ownerCookie, {
            pontoVendaId: tenant.posId, trailerId: tenant.trailerId, trocoInicial: 0, cardapioId: savedMenu.id,
          });
          await required('POST', '/api/operacao/caixa/fechar', tenant.ownerCookie, {
            pontoVendaId: tenant.posId, contadoDinheiro: 0, contadoPix: 0,
            contadoCartaoDebito: 0, contadoCartaoCredito: 0,
          }, 200);
          const dashboardSemMovimento = await required<Json>(
            'GET', `/api/operacao/dashboard?ano=${new Date().getFullYear()}&mes=${new Date().getMonth() + 1}`,
            tenant.adminOwnerCookie,
          );
          expect(dashboardSemMovimento.resumo.turnosCaixa).toBe(0);
          expect(dashboardSemMovimento.turnosRecentes).not.toEqual(
            expect.arrayContaining([expect.objectContaining({ sessaoId: emptySession.id })]),
          );
          await required('POST', '/api/operacao/caixa/abrir', tenant.ownerCookie, {
            pontoVendaId: tenant.posId, trailerId: tenant.trailerId, trocoInicial: 0, cardapioId: savedMenu.id,
          });
          const initialMenu = await required<Json>('GET', `/api/operacao/caixa/cardapio?pontoVendaId=${tenant.posId}`, tenant.ownerCookie);
          expect(initialMenu.produtoIds).toEqual([tenant.foodId]);
          await required('PATCH', `/api/operacao/caixa/cardapio/preco?pontoVendaId=${tenant.posId}`, tenant.ownerCookie, {
            produtoId: tenant.foodId, volumeMl: 0, precoUnit: 21, escopo: 'TURNO',
          });
          await required('PUT', `/api/operacao/cardapios/${savedMenu.id}`, tenant.adminOwnerCookie, {
            nome: savedMenu.nome, produtoIds: [tenant.foodId, tenant.beerId],
          });
          const refreshedMenu = await required<Json>('GET', `/api/operacao/caixa/cardapio?pontoVendaId=${tenant.posId}`, tenant.ownerCookie);
          expect(refreshedMenu.produtoIds).toEqual(expect.arrayContaining([tenant.foodId, tenant.beerId]));
          expect(refreshedMenu.produtos.find((product: Json) => product.id === tenant.foodId)?.precoEfetivo).toBe(21);
          await required('PATCH', `/api/operacao/caixa/cardapio/preco?pontoVendaId=${tenant.posId}`, tenant.ownerCookie, {
            produtoId: tenant.foodId, volumeMl: 0, precoUnit: 20, escopo: 'TURNO',
          });
          const saleProducts = await required<any[]>('GET', `/api/operacao/produtos?pontoVendaId=${tenant.posId}`, tenant.ownerCookie);
          expect(saleProducts.some((product) => product.id === tenant.beerId && product.volumeMl === 500)).toBe(true);
          const mounts = await required<Json>('GET', `/api/operacao/caixa/taps?pontoVendaId=${tenant.posId}`, tenant.ownerCookie);
          const mounted = mounts.taps.find((item: Json) => item.tapId === tenant.tapId || item.id === tenant.tapId);
          if (!mounted || (mounted.produtoId && mounted.produtoId !== tenant.beerId)) {
            await required('PUT', `/api/operacao/caixa/taps/${tenant.tapId}/chope`, tenant.ownerCookie, {
              pontoVendaId: tenant.posId, produtoId: tenant.beerId,
            });
          }

          const portalPath = `/api/public/cervejarias/${tenant.slug}/pontos-venda/${tenant.posId}/comandas`;
          const portalSession = await publicPost(portalPath, { nome: 'Cliente portal E2E', telefone: '11987654323' }, 201);
          expect(portalSession.cookie).toMatch(/^cliente_pdv_token=/);
          const portalOrder = await publicPost(
            `/api/public/cervejarias/${tenant.slug}/pontos-venda/${tenant.posId}/comanda/pedidos`,
            { itens: [{ produtoId: tenant.beerId, quantidade: 1, tapId: tenant.tapId, volumeMl: 500 }], observacao: 'Pedido do portal E2E' },
            201,
            portalSession.cookie,
          );
          expect(portalOrder.data.pedidos?.[0]?.itens?.[0]?.nome ?? portalOrder.data.pedidos?.[0]?.itens?.[0]?.produto?.nome).toContain('Chope E2E');
          const portalComandaId = portalSession.data.comanda.id as string;
          expect((await stock(tenant.ownerCookie, tenant.posId, tenant.beerId)).quantidade).toBeCloseTo(11.5, 6);
          const portalPaid = await required('POST', `/api/operacao/comandas/${portalComandaId}/pagamentos`, tenant.ownerCookie, {
            pagamentos: [{ forma: 'DINHEIRO', valor: 20 }],
          }, 200);
          expect(portalPaid).toMatchObject({ status: 'FECHADA', total: 20 });

          const comanda = await required('POST', '/api/operacao/comandas', tenant.ownerCookie, {
            pontoVendaId: tenant.posId, tipo: 'APELIDO', identificador: `E2E ${mode}`,
            clienteNome: 'Cliente E2E com aviso', clienteTelefone: '11987654324',
          });
          comandaId = comanda.id;
          const updated = await required('POST', `/api/operacao/comandas/${comandaId}/pedidos`, tenant.ownerCookie, {
            observacao: 'Sem cebola — E2E',
            itens: [
              { produtoId: tenant.foodId, quantidade: 1, observacao: 'Bem passado', opcionais: [{ opcionalId: tenant.optionalId, quantidade: 1 }] },
              { produtoId: tenant.beerId, quantidade: 1, tapId: tenant.tapId, volumeMl: 300 },
            ],
          });
          // Chope não aguarda a cozinha; apenas o alimento preparado fica fora do total até a entrega.
          expect(updated.total).toBe(15);
          expect(updated.valorEmAberto).toBe(23);
          orderId = updated.pedidos?.[0]?.id ?? updated.pedidosOperacao?.[0]?.id;
          expect(orderId, 'pedido de preparo deve estar associado à comanda').toBeTruthy();
          expect((await stock(tenant.ownerCookie, tenant.posId, tenant.foodId)).quantidade).toBe(9);
          expect((await stock(tenant.ownerCookie, tenant.posId, tenant.beerId)).quantidade).toBeCloseTo(11.2, 6);
          const premature = await call('POST', `/api/operacao/comandas/${comandaId}/pagamentos`, tenant.ownerCookie, {
            pagamentos: [{ forma: 'PIX', valor: 38 }],
          });
          expect(premature.status).toBe(409);
          await advanceKitchenToReady(tenant.ownerCookie, orderId);
          await page.goto(`/operacao/comandas/${comandaId}`);
          let interceptedWhatsAppUrl = '';
          await page.route('https://wa.me/**', async (route) => {
            interceptedWhatsAppUrl = route.request().url();
            await route.fulfill({ status: 200, contentType: 'text/html', body: '<title>WhatsApp intercepted by E2E</title>' });
          });
          await page.getByRole('button', { name: 'Pedido pronto' }).click();
          await expect(page).toHaveURL(/wa\.me/);
          expect(interceptedWhatsAppUrl).toContain('5511987654324');
          expect(decodeURIComponent(interceptedWhatsAppUrl)).toContain('Cliente E2E com aviso');
          expect(decodeURIComponent(interceptedWhatsAppUrl)).toContain('está pronto para retirada');
          await page.goto(`/operacao/comandas/${comandaId}`);
          await page.getByRole('button', { name: 'Marcar como avisado' }).click();
          await expect.poll(async () => {
            const checked = await required<Json>('GET', `/api/operacao/comandas/${comandaId}`, tenant.ownerCookie);
            return checked.pedidos?.[0]?.clienteAvisadoEm;
          }).toBeTruthy();
          await deliverKitchenOrder(tenant.ownerCookie, orderId);
          const readyToPay = await required<Json>('GET', `/api/operacao/comandas/${comandaId}`, tenant.ownerCookie);
          expect(readyToPay.total).toBe(38);
          const paid = await required('POST', `/api/operacao/comandas/${comandaId}/pagamentos`, tenant.ownerCookie, {
            pagamentos: [
              { forma: 'DINHEIRO', valor: 8 }, { forma: 'PIX', valor: 10 },
              { forma: 'CARTAO_DEBITO', valor: 10 }, { forma: 'CARTAO_CREDITO', valor: 10 },
            ],
          }, 200);
          expect(paid).toMatchObject({ status: 'FECHADA', total: 38 });
          const final = await required<Json>('GET', `/api/operacao/comandas/${comandaId}`, tenant.ownerCookie);
          expect(final.pagamentos.reduce((sum: number, item: Json) => sum + Number(item.valor), 0)).toBe(38);

          const pendingComanda = await required('POST', '/api/operacao/comandas', tenant.ownerCookie, {
            pontoVendaId: tenant.posId, tipo: 'APELIDO', identificador: `Pendente ${mode}`,
            clienteNome: 'Cliente com conta pendente', clienteTelefone: '11987654322',
          });
          await required('POST', `/api/operacao/comandas/${pendingComanda.id}/pedidos`, tenant.ownerCookie, {
            itens: [{ produtoId: tenant.beerId, quantidade: 1, tapId: tenant.tapId, volumeMl: 500 }],
          });
          const pendingClosed = await required('POST', `/api/operacao/comandas/${pendingComanda.id}/pagamentos`, tenant.ownerCookie, {
            pagamentos: [], deixarPendente: true,
          }, 200);
          expect(pendingClosed.status).toBe('FECHADA');
          const periodoAtual = new Date();
          const dashboardUrl = `/api/operacao/dashboard?ano=${periodoAtual.getFullYear()}&mes=${periodoAtual.getMonth() + 1}`;
          const dashboardComSaldo = await required<Json>('GET', dashboardUrl, tenant.adminOwnerCookie);
          expect(dashboardComSaldo.resumo).toMatchObject({ totalPendente: 20, totalRecebido: 58 });
          const pendingAccounts = await required<any[]>('GET', '/api/operacao/contas-pendentes', tenant.ownerCookie);
          const account = pendingAccounts.find((row) => row.comanda.id === pendingComanda.id);
          expect(account).toMatchObject({ valorOriginal: 20, recebido: 0, saldo: 20 });
          const settled = await required<Json>('POST', `/api/operacao/contas-pendentes/${account.id}/pagamentos`, tenant.ownerCookie, {
            pontoVendaId: tenant.posId, pagamentos: [{ forma: 'CARTAO_CREDITO', valor: 20 }],
          }, 200);
          expect(settled).toMatchObject({ valorOriginal: 20, recebido: 20, saldo: 0 });
          const dashboardQuitado = await required<Json>('GET', dashboardUrl, tenant.adminOwnerCookie);
          expect(dashboardQuitado.resumo).toMatchObject({ totalPendente: 0, totalRecebido: 78 });
          const reportPendingComanda = await required('POST', '/api/operacao/comandas', tenant.ownerCookie, {
            pontoVendaId: tenant.posId, tipo: 'APELIDO', identificador: `Pendente relatório ${mode}`,
            clienteNome: 'Cliente do relatório', clienteTelefone: '11987654325',
          });
          await required('POST', `/api/operacao/comandas/${reportPendingComanda.id}/pedidos`, tenant.ownerCookie, {
            itens: [{ produtoId: tenant.beerId, quantidade: 1, tapId: tenant.tapId, volumeMl: 300 }],
          });
          await required('POST', `/api/operacao/comandas/${reportPendingComanda.id}/pagamentos`, tenant.ownerCookie, {
            pagamentos: [], deixarPendente: true,
          }, 200);
          const closedCash = await required<Json>('POST', '/api/operacao/caixa/fechar', tenant.ownerCookie, {
            pontoVendaId: tenant.posId, contadoDinheiro: 28, contadoPix: 10,
            contadoCartaoDebito: 10, contadoCartaoCredito: 30,
          }, 200);
          expect(closedCash.status).toBe('FECHADO');
          expect(closedCash.esperado).toMatchObject({ dinheiro: 28, pix: 10, cartaoDebito: 10, cartaoCredito: 30, totalVendas: 78 });
          expect(closedCash.diferencas).toMatchObject({ dinheiro: 0, pix: 0, cartaoDebito: 0, cartaoCredito: 0 });
          const report = await required<Json>('GET', `/api/operacao/caixa/sessoes/${closedCash.id}`, tenant.adminOwnerCookie);
          expect(report.porProduto).toEqual(expect.arrayContaining([
            expect.objectContaining({ nome: expect.stringContaining('300 ml'), categoria: 'Chope', quantidade: 2, receita: 30 }),
            expect.objectContaining({ nome: expect.stringContaining('500 ml'), categoria: 'Chope', quantidade: 2, receita: 40 }),
            expect.objectContaining({ nome: 'Porção E2E', categoria: 'Porções', quantidade: 1, receita: 23 }),
          ]));
          expect(report.contasPendentes).toEqual([
            expect.objectContaining({ identificador: `Pendente relatório ${mode}`, clienteNome: 'Cliente do relatório', saldo: 15 }),
          ]);
          expect(report.totalPendente).toBe(15);
          expect(report.contasReceber).toEqual(expect.arrayContaining([
            expect.objectContaining({
              identificador: `Pendente relatório ${mode}`,
              clienteNome: 'Cliente do relatório',
              recebido: 0,
              saldo: 15,
            }),
          ]));
          expect(report.topClientes).toEqual(expect.arrayContaining([
            expect.objectContaining({ nome: 'Cliente E2E com aviso', consumo: 38 }),
            expect.objectContaining({ nome: 'Cliente portal E2E', consumo: 20 }),
          ]));
          expect(report.caixa.esperado).toMatchObject({ dinheiro: 28, pix: 10, cartaoDebito: 10, cartaoCredito: 30 });
          const dashboardComMovimento = await required<Json>('GET', dashboardUrl, tenant.adminOwnerCookie);
          expect(dashboardComMovimento.resumo.turnosCaixa).toBe(1);
          expect(dashboardComMovimento.turnosRecentes).toHaveLength(1);
          expect(dashboardComMovimento.turnosRecentes[0].sessaoId).toBe(closedCash.id);
          const pendingAccountsAfterClose = await required<any[]>('GET', '/api/operacao/contas-pendentes', tenant.ownerCookie);
          const accountPaidOutsideTurn = pendingAccountsAfterClose.find((row) => row.comanda.id === reportPendingComanda.id);
          expect(accountPaidOutsideTurn).toBeTruthy();
          await required('POST', `/api/operacao/contas-pendentes/${accountPaidOutsideTurn.id}/pagamentos`, tenant.ownerCookie, {
            pontoVendaId: tenant.posId, pagamentos: [{ forma: 'CARTAO_CREDITO', valor: 15 }],
          }, 200);
          const reportAfterOutsidePayment = await required<Json>('GET', `/api/operacao/caixa/sessoes/${closedCash.id}`, tenant.adminOwnerCookie);
          expect(reportAfterOutsidePayment).toMatchObject({ totalRecebido: 78, totalPendente: 0 });
          expect(reportAfterOutsidePayment.caixa.esperado.totalVendas).toBe(78);
          expect(reportAfterOutsidePayment.contasReceber).toEqual(expect.arrayContaining([
            expect.objectContaining({
              identificador: `Pendente relatório ${mode}`,
              recebido: 15,
              saldo: 0,
              recebimentos: [expect.objectContaining({ forma: 'CARTAO_CREDITO', valor: 15, nesteTurno: false })],
            }),
          ]));
        } else {
          const savedMenu = await required<Json>('POST', '/api/operacao/cardapios', tenant.adminOwnerCookie, {
            nome: `Cardápio evento E2E ${runId}`, produtoIds: [tenant.foodId, tenant.beerId],
          });
          const today = new Date().toISOString().slice(0, 10);
          const event = await required('POST', '/api/eventos', tenant.ownerCookie, {
            nome: `E2E evento ${runId}`, local: 'Ambiente isolado', data: today,
            horaInicio: '18:00', recorrencia: 'NENHUMA', abrirAgora: true,
            trailerId: tenant.trailerId, cardapioId: savedMenu.id,
          });
          await page.goto('/operacao/comandas');
          await expect(page).toHaveURL(/^https?:\/\/[^/]+\/comandas(?:\?.*)?$/);
          await expect(page.getByRole('heading', { name: /comandas/i }).first()).toBeVisible();
          await page.goto('/operacao/turnos/rota-invalida');
          await expect(page).toHaveURL(/^https?:\/\/[^/]+\/comandas(?:\?.*)?$/);
          const eventMenu = await required<Json>('GET', `/api/eventos/${event.id}/cardapio`, tenant.ownerCookie);
          expect(eventMenu.produtoIds).toEqual([tenant.foodId]);
          expect(eventMenu.catalogo.some((product: Json) => product.id === tenant.beerId)).toBe(false);
          expect(eventMenu.produtos.find((product: Json) => product.id === tenant.foodId)?.gruposOpcionais)
            .toEqual([expect.objectContaining({ opcoes: [expect.objectContaining({ id: tenant.optionalId })] })]);
          const extraEventProduct = await required<Json>('POST', '/api/operacao/produtos', tenant.adminOwnerCookie, {
            nome: `Refrigerante evento E2E ${runId}`, categoria: 'Bebidas', tipo: 'BEBIDA',
            precoUnit: 7, exigePreparo: false, controlaEstoque: false,
          });
          await required('PUT', `/api/operacao/cardapios/${savedMenu.id}`, tenant.adminOwnerCookie, {
            nome: savedMenu.nome, produtoIds: [tenant.foodId, tenant.beerId, extraEventProduct.id],
          });
          const refreshedEventMenu = await required<Json>('GET', `/api/eventos/${event.id}/cardapio`, tenant.ownerCookie);
          expect(refreshedEventMenu.produtoIds).toEqual(expect.arrayContaining([tenant.foodId, extraEventProduct.id]));
          expect(refreshedEventMenu.produtoIds).not.toContain(tenant.beerId);
          const eventTaps = await required<any[]>('GET', `/api/eventos/${event.id}/taps`, tenant.ownerCookie);
          const eventTap = eventTaps.find((item) => item.tapId === tenant.tapId || item.id === tenant.tapId);
          if (!eventTap || (eventTap.produtoId && eventTap.produtoId !== tenant.beerId)) {
            await required('PUT', `/api/eventos/${event.id}/taps/${tenant.tapId}/chope`, tenant.ownerCookie, { produtoId: tenant.beerId });
          }

          const sessionResponse = await publicPost(
            `/api/public/cervejarias/${tenant.slug}/trailers/${tenant.trailerId}/sessao`,
            { nome: 'Cliente portal E2E', telefone: '11987654323' },
            201,
          );
          expect(sessionResponse.cookie).toMatch(/^cliente_token=/);
          const portalMenuResponse = await fetch(`${API_BASE}/api/public/cliente/cardapio`, {
            headers: { Cookie: sessionResponse.cookie, Accept: 'application/json' },
          });
          expect(portalMenuResponse.status).toBe(200);
          const portalMenu = await portalMenuResponse.json() as Json;
          const availableTap = portalMenu.chopes.find((row: Json) => row.tapId === tenant.tapId);
          expect(availableTap?.produto?.precos).toEqual(expect.arrayContaining([
            expect.objectContaining({ volumeMl: 300, preco: 15 }),
            expect.objectContaining({ volumeMl: 500, preco: 20 }),
            expect.objectContaining({ volumeMl: 700, preco: 26 }),
          ]));
          const portalOrder = await publicPost('/api/public/cliente/pedidos', {
            observacao: 'Pedido criado pelo portal E2E',
            itens: [{ produtoId: tenant.beerId, volumeMl: 500, quantidade: 1, tapId: tenant.tapId }],
          }, 201, sessionResponse.cookie);
          expect(portalOrder.data.status).toBe('PENDENTE');
          expect(portalOrder.data.totalEstimado).toBe(20);
          expect((await stock(tenant.ownerCookie, tenant.posId, tenant.beerId)).quantidade).toBe(12);
          const eventPending = await required<any[]>('GET', `/api/pedidos/eventos/${event.id}/pedidos?status=PENDENTE`, tenant.ownerCookie);
          expect(eventPending.some((row) => row.id === portalOrder.data.id)).toBe(true);
          const confirmed = await required<Json>('POST', `/api/pedidos/${portalOrder.data.id}/confirmar`, tenant.ownerCookie, {}, 200);
          expect(confirmed.pedido.status).toBe('CONFIRMADO');
          const portalComandaId = sessionResponse.data.comanda.id as string;
          expect((await stock(tenant.ownerCookie, tenant.posId, tenant.beerId)).quantidade).toBeCloseTo(11.5, 6);
          const portalComandaPaid = await required('POST', `/api/pagamentos/comandas/${portalComandaId}/fechar`, tenant.ownerCookie, {
            pagamentos: [{ forma: 'CARTAO_CREDITO', valor: 20 }],
          }, 200);
          expect(portalComandaPaid.status).toBe('FECHADA');
          expect(Number(portalComandaPaid.total)).toBe(20);

          const comanda = await required('POST', '/api/comandas', tenant.ownerCookie, {
            eventoId: event.id, clienteNome: 'Cliente E2E', clienteTelefone: '11987654321',
          });
          comandaId = comanda.id;
          await page.goto(`/comandas/${comandaId}`);
          await page.getByRole('button', { name: '+ Itens' }).click();
          const addItemDialog = page.getByRole('dialog', { name: 'Adicionar item' });
          await expect(addItemDialog.getByRole('checkbox', { name: /Para viagem/ })).toHaveCount(0);
          await page.getByRole('button', { name: /Porção E2E/ }).click();
          await expect(addItemDialog.getByRole('checkbox', { name: /Para viagem/ })).toBeVisible();
          await expect(page.getByRole('checkbox', { name: /Adicional E2E/ })).toBeVisible();
          await page.getByRole('button', { name: 'Voltar', exact: true }).click();
          const foodItem = await required('POST', `/api/comandas/${comandaId}/itens`, tenant.ownerCookie, {
            produtoId: tenant.foodId, volumeMl: 1, quantidade: 1, observacao: 'Bem passado',
            opcionais: [{ opcionalId: tenant.optionalId, quantidade: 1 }],
          });
          expect(Number(foodItem.itens.find((item: Json) => item.produtoId === tenant.foodId)?.precoUnit)).toBe(23);
          await required('POST', `/api/comandas/${comandaId}/itens`, tenant.ownerCookie, {
            produtoId: tenant.beerId, volumeMl: 300, quantidade: 1, tapId: tenant.tapId,
          });
          const detail = await required<Json>('GET', `/api/comandas/${comandaId}`, tenant.ownerCookie);
          expect(Number(detail.total)).toBe(15);
          expect((await stock(tenant.ownerCookie, tenant.posId, tenant.foodId)).quantidade).toBe(9);
          expect((await stock(tenant.ownerCookie, tenant.posId, tenant.beerId)).quantidade).toBeCloseTo(11.2, 6);
          orderId = foodItem.itens?.find((item: Json) => item.produtoId === tenant.foodId)?.pedidoCozinhaId
            ?? foodItem.itens?.find((item: Json) => item.produtoId === tenant.foodId)?.pedidoCozinha?.id;
          expect(orderId, 'pedido preparado deve gerar ordem de cozinha também em EVENTO').toBeTruthy();
          await advanceKitchenToReady(tenant.ownerCookie, orderId);
          await deliverKitchenOrder(tenant.ownerCookie, orderId);
          const readyToPay = await required<Json>('GET', `/api/comandas/${comandaId}`, tenant.ownerCookie);
          expect(Number(readyToPay.total)).toBe(38);
          const paid = await required('POST', `/api/pagamentos/comandas/${comandaId}/fechar`, tenant.ownerCookie, {
            pagamentos: [
              { forma: 'DINHEIRO', valor: 8 }, { forma: 'PIX', valor: 10 },
              { forma: 'CARTAO_DEBITO', valor: 10 }, { forma: 'CARTAO_CREDITO', valor: 10 },
            ],
          }, 200);
          expect(paid).toMatchObject({ status: 'FECHADA' });
          expect(Number(paid.total)).toBe(38);
          expect((paid.pagamentos ?? []).reduce((sum: number, item: Json) => sum + Number(item.valor), 0)).toBe(38);
          await required('PATCH', `/api/eventos/${event.id}/fechar`, tenant.ownerCookie, {}, 200);
          const summary = await required<Json>('GET', `/api/eventos/${event.id}/resumo-executivo`, tenant.adminOwnerCookie);
          expect(Number(summary.resumo.receitaTotal)).toBe(58);
          expect(summary.porPagamento.reduce((sum: number, item: Json) => sum + Number(item.valor), 0)).toBe(58);
          const transactions = await required<any[]>('GET', `/api/eventos/${event.id}/transacoes`, tenant.adminOwnerCookie);
          for (const type of ['EVENTO_CRIADO', 'PORTAL_PEDIDO_CRIADO', 'COMANDA_ITEM_ADICIONADO', 'COMANDA_FECHADA', 'EVENTO_FECHADO']) {
            expect(transactions.some((transaction) => transaction.tipo === type), `transação observável ${type}`).toBe(true);
          }

          // Mudança de modo durante o mesmo mês: somar o evento encerrado e as vendas posteriores no CAIXA.
          await required('PATCH', `/api/admin/cervejarias/${tenant.companyId}/configuracao-operacional`, adminCookie, {
            plannedOperationsEnabled: false,
            tapsEnabled: true,
            inventoryEnabled: true,
            kitchenEnabled: true,
            confirmacaoEstoque: true,
          }, 200);
          const postSwitchSession = await required('POST', '/api/operacao/caixa/abrir', tenant.ownerCookie, {
            pontoVendaId: tenant.posId, trailerId: tenant.trailerId, trocoInicial: 0, cardapioId: savedMenu.id,
          });
          const postSwitchComanda = await required('POST', '/api/operacao/comandas', tenant.ownerCookie, {
            pontoVendaId: tenant.posId, tipo: 'APELIDO', identificador: `Após mudança ${runId}`,
            clienteNome: 'Cliente após mudança', clienteTelefone: '11987654326',
          });
          await required('POST', `/api/operacao/comandas/${postSwitchComanda.id}/pedidos`, tenant.ownerCookie, {
            itens: [{ produtoId: tenant.beerId, quantidade: 1, tapId: tenant.tapId, volumeMl: 300 }],
          });
          await required('POST', `/api/operacao/comandas/${postSwitchComanda.id}/pagamentos`, tenant.ownerCookie, {
            pagamentos: [{ forma: 'PIX', valor: 15 }],
          }, 200);

          const dashboardPeriodo = new Date();
          const dashboardParams = `ano=${dashboardPeriodo.getFullYear()}&mes=${dashboardPeriodo.getMonth() + 1}`;
          const dashboardUnificado = await required<Json>('GET', `/api/cervejaria/dashboard?${dashboardParams}`, tenant.adminOwnerCookie);
          expect(dashboardUnificado.resumo).toMatchObject({ receitaTotal: 73, comandasAtendidas: 3, chopeMl: 1100 });
          expect(dashboardUnificado.turnosCaixaRecentes).toEqual(expect.arrayContaining([
            expect.objectContaining({ sessaoId: postSwitchSession.id, status: 'ABERTO', receitaTotal: 15, comandasAtendidas: 1 }),
          ]));
          const dashboardCaixa = await required<Json>('GET', `/api/cervejaria/dashboard?${dashboardParams}&tipo=caixa`, tenant.adminOwnerCookie);
          expect(dashboardCaixa.resumo).toMatchObject({ receitaTotal: 15, comandasAtendidas: 1, chopeMl: 300 });
          expect(dashboardCaixa.turnosCaixaRecentes).toEqual(expect.arrayContaining([
            expect.objectContaining({ sessaoId: postSwitchSession.id, receitaTotal: 15 }),
          ]));
          await attachSession(page, tenant.adminOwnerCookie);
          await page.goto('/dashboard');
          const filtroCaixa = page.getByRole('button', { name: 'Caixa', exact: true });
          await expect(filtroCaixa).toBeVisible();
          const responseCaixa = page.waitForResponse((response) =>
            response.url().includes('/api/cervejaria/dashboard') && response.url().includes('tipo=caixa'),
          );
          await filtroCaixa.click();
          await responseCaixa;
          await expect(page.getByRole('heading', { name: 'Turnos de caixa com movimentação' })).toBeVisible();
          await expect(page.getByRole('link', { name: /Ponto principal/ })).toBeVisible();
        }

        const afterFood = await stock(tenant.ownerCookie, tenant.posId, tenant.foodId);
        const afterBeer = await stock(tenant.ownerCookie, tenant.posId, tenant.beerId);
        expect(afterFood).toMatchObject({ quantidade: 9, unidadeEstoque: 'un' });
        expect(afterBeer.quantidade).toBeCloseTo(mode === 'CAIXA' ? 10.4 : 10.9, 6);
        await expect(page.getByRole('link', { name: 'Estoque', exact: true })).toBeVisible();
      } finally {
        await cleanup(tenant.companyId);
      }
    });
  }
});
