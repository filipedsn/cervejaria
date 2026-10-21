import { createRequire } from 'node:module';
import path from 'node:path';
import { prismaClient } from '../support/fixtures';
import { baseURL, expect, loginPage, PERSONA_PERMISSIONS, randomUUID, test, uniquePhone, uniqueSuffix, type Ops, type Tenant } from '../support/ops';

const requireBackend = createRequire(path.join(process.cwd(), 'backend', 'package.json'));
const { io: socketIo } = requireBackend('socket.io-client') as typeof import('socket.io-client');

function socketEvent(socket: ReturnType<typeof socketIo>, name: string, timeoutMs = 5000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Socket event timed out: ${name}`)), timeoutMs);
    socket.once(name, (payload: unknown) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function socketConnected(socket: ReturnType<typeof socketIo>, timeoutMs = 5000): Promise<void> {
  if (socket.connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Socket connection timed out')), timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (error: Error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

type Item = { id: string; produtoId: string; quantidade: number; precoUnit: number; canceladoEm: string | null; observacao: string | null; opcionais: Array<{ nome: string; precoAdicional: number; quantidade: number }> };
const itens = (comanda: { pedidos: Array<{ itens: Item[] }> }) => comanda.pedidos.flatMap((pedido) => pedido.itens);
const itemDe = (comanda: { pedidos: Array<{ itens: Item[] }> }, produtoId: string) => itens(comanda).find((item) => item.produtoId === produtoId && !item.canceladoEm)!;

async function vendaPronta(ops: Ops, settings?: Record<string, unknown>) {
  const tenant = await ops.tenant(undefined, settings);
  await tenant.openCash(tenant.owner, 100);
  return tenant;
}

async function entregarPorcao(tenant: Tenant, comandaId: string) {
  const comanda = await tenant.comanda(tenant.owner, comandaId);
  const pedido = comanda.pedidos.find((p: { itens: Item[] }) => p.itens.some((item) => item.produtoId === tenant.catalog!.porcao.id));
  await tenant.advanceKitchen(tenant.owner, pedido.id, ['EM_PREPARO', 'PRONTO', 'ENTREGUE']);
  return tenant.comanda(tenant.owner, comandaId);
}

test('CMD-S01 abre comanda de mesa com cliente, chope por volume e porção com opcional @api', async ({ ops }) => {
  const tenant = await vendaPronta(ops);
  const salao = await tenant.staff('Salao', PERSONA_PERMISSIONS.salao);
  const telefone = uniquePhone();
  const comanda = await tenant.openComanda(salao, [
    tenant.chopeItem(300), tenant.chopeItem(500), tenant.chopeItem(700),
    tenant.porcaoItem(1, { observacao: 'Sem cebola', opcionais: [{ opcionalId: tenant.catalog!.opcional.id, quantidade: 1 }] }),
  ], { tipo: 'MESA', identificador: '7', clienteNome: 'Cliente Mesa QA', clienteTelefone: telefone });
  expect(comanda).toMatchObject({ tipo: 'MESA', identificador: '7', status: 'ABERTA', subtotal: 89, total: 89 });
  expect(comanda.cliente).toMatchObject({ nome: 'Cliente Mesa QA' });
  const porcao = itemDe(comanda, tenant.catalog!.porcao.id);
  expect(porcao).toMatchObject({ observacao: 'Sem cebola', opcionais: [{ nome: 'Bacon QA', precoAdicional: 5, quantidade: 1 }] });
  expect(itens(comanda).filter((item) => item.produtoId === tenant.catalog!.chope.id).map((item) => item.precoUnit).sort((a, b) => a - b)).toEqual([12, 18, 24]);
});

test('CMD-S02 altera a quantidade de item não enviado à cozinha @api', async ({ ops }) => {
  const tenant = await vendaPronta(ops);
  const comanda = await tenant.openComanda(tenant.owner, [tenant.item('lata')]);
  const lata = itemDe(comanda, tenant.catalog!.lata.id);
  const atualizada = await tenant.owner.expect(tenant.owner.patch(`/api/operacao/comandas/${comanda.id}/itens/${lata.id}`, { quantidade: 3 }), 200, 'alterar quantidade');
  expect(itemDe(atualizada, tenant.catalog!.lata.id).quantidade).toBe(3);
  expect(atualizada.total).toBe(24);
  expect((await tenant.stock())(tenant.catalog!.lata.id)).toBe(7);
});

test('CMD-S03 cancela item não entregue e devolve ao estoque @api', async ({ ops }) => {
  const tenant = await vendaPronta(ops);
  const comanda = await tenant.openComanda(tenant.owner, [tenant.item('lata', 2), tenant.item('agua')]);
  expect((await tenant.stock())(tenant.catalog!.lata.id)).toBe(8);
  const lata = itemDe(comanda, tenant.catalog!.lata.id);
  const atualizada = await tenant.owner.expect(tenant.owner.delete(`/api/operacao/comandas/${comanda.id}/itens/${lata.id}`, { motivo: 'Lançado por engano' }), 200, 'cancelar item');
  expect(itemDe(atualizada, tenant.catalog!.lata.id)).toBeUndefined();
  expect(atualizada.total).toBe(5);
  expect((await tenant.stock())(tenant.catalog!.lata.id)).toBe(10);
});

test('CMD-S04 dono cancela item já entregue com motivo e tratamento de estoque @api', async ({ ops }) => {
  const tenant = await vendaPronta(ops);
  const aberta = await tenant.openComanda(tenant.owner, [tenant.porcaoItem(2)]);
  const entregue = await entregarPorcao(tenant, aberta.id);
  const porcao = itemDe(entregue, tenant.catalog!.porcao.id);
  const atualizada = await tenant.owner.expect(tenant.owner.delete(`/api/operacao/comandas/${aberta.id}/itens/${porcao.id}`, {
    quantidade: 1, quantidadeEsperada: 2, motivo: 'Cliente devolveu', tratamentoEstoque: 'ERRO_LANCAMENTO', idempotencyKey: randomUUID(),
  }), 200, 'cancelar entregue');
  expect(atualizada.total).toBe(30);
  expect((await tenant.stock())(tenant.catalog!.porcao.id)).toBe(19);
});

test('CMD-S16 atendente cancela parcialmente e totalmente item entregue pela comanda autenticada', async ({ ops, page, evidence }) => {
  const tenant = await ops.tenant();
  const catalog = await tenant.seedCatalog();
  const atendente = await tenant.staff('AtendenteEntrega', ['command.read', 'command.operate', 'command.item.cancel', 'inventory.read']);
  const suco = await tenant.owner.expect(tenant.owner.post('/api/operacao/produtos', {
    nome: 'Suco errado QA', categoriaPdvId: tenant.catalog!.categoriaId, tipo: 'BEBIDA', formato: 'OUTRO', precoUnit: 12,
    exigePreparo: true, controlaEstoque: true,
  }), 201, 'criar produto sintético do relato');
  await tenant.owner.expect(tenant.owner.post('/api/operacao/estoque/entrada', {
    pontoVendaId: tenant.pointId, produtoId: suco.id, quantidade: 10,
  }), 201, 'estoque sintético inicial');
  const cardapio = await tenant.owner.expect(tenant.owner.post('/api/operacao/cardapios', {
    nome: `Cardápio P7 QA ${uniqueSuffix()}`, produtoIds: [catalog.chope.id, catalog.porcao.id, catalog.lata.id, catalog.agua.id, suco.id],
  }), 201, 'incluir o suco errado no cardápio sintético');
  catalog.cardapioId = cardapio.id;
  await tenant.openCash(tenant.owner, 100);
  const aberta = await tenant.openComanda(tenant.owner, [{ produtoId: suco.id, quantidade: 2 }]);
  const pedido = aberta.pedidos.find((p: { itens: Array<{ produtoId: string }> }) => p.itens.some((i) => i.produtoId === suco.id));
  await tenant.advanceKitchen(tenant.owner, pedido.id, ['EM_PREPARO', 'PRONTO', 'ENTREGUE']);
  const entregue = await tenant.comanda(tenant.owner, aberta.id);
  const itemSuco = itemDe(entregue, suco.id);
  const remover = 'Remover Suco errado QA';

  await loginPage(page, atendente.email, atendente.senha);
  await page.goto(`/operacao/comandas/${aberta.id}`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('button', { name: remover })).toHaveCount(0);
  await atendente.expect(atendente.delete(`/api/operacao/comandas/${aberta.id}/itens/${itemSuco.id}`, {
    quantidade: 1, quantidadeEsperada: 2, motivo: 'Sem autorização especial', tratamentoEstoque: 'PREPARADO_ENTREGUE_OU_PERDIDO', idempotencyKey: randomUUID(),
  }), 403, 'sem permissão especial');

  await tenant.owner.expect(tenant.owner.patch(`/api/usuarios/${atendente.userId}/permissoes-operacao`, {
    permissoesOperacao: ['command.read', 'command.operate', 'command.item.cancel', 'command.item.cancel.delivered', 'inventory.read'],
  }), 200, 'conceder na sessão existente');
  await page.reload({ waitUntil: 'networkidle' });
  const botaoRemover = page.getByRole('button', { name: remover });
  await expect(botaoRemover).toBeVisible();

  await botaoRemover.click();
  await expect(page.getByRole('heading', { name: 'Cancelar item já entregue' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmar cancelamento' })).toBeDisabled();
  await page.getByLabel('Quantidade a cancelar').fill('1');
  await page.getByLabel('Preparado, entregue ou perdido. O item sai da cobrança e o estoque não retorna.').check();
  await page.getByLabel('Motivo obrigatório').fill('Cliente recusou uma unidade');
  const respostaParcial = page.waitForResponse((response) => response.request().method() === 'DELETE' && response.url().includes(`/api/operacao/comandas/${aberta.id}/itens/${itemSuco.id}`));
  await page.getByRole('button', { name: 'Confirmar cancelamento' }).click();
  const cancelamentoParcial = await respostaParcial;
  expect(cancelamentoParcial.status()).toBe(200);
  expect((await cancelamentoParcial.json()).total).toBe(12);
  await expect(page.getByText('Cliente recusou uma unidade')).toBeVisible();
  expect((await tenant.stock())(suco.id)).toBe(8);

  // The UI suppresses duplicate submits for 400 ms after a successful mutation.
  await page.waitForTimeout(450);
  await page.getByRole('button', { name: remover }).click();
  await expect(page.getByRole('heading', { name: 'Cancelar item já entregue' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmar cancelamento' })).toBeDisabled();
  await page.getByLabel('Motivo obrigatório').fill('Cancelamento da última unidade');
  const respostaTotal = page.waitForResponse((response) => response.request().method() === 'DELETE' && response.url().includes(`/api/operacao/comandas/${aberta.id}/itens/${itemSuco.id}`));
  await page.getByRole('button', { name: 'Confirmar cancelamento' }).click();
  const totalCancelado = await respostaTotal;
  expect(totalCancelado.status()).toBe(200);
  const totalCanceladoBody = await totalCancelado.json();
  expect(totalCanceladoBody.total).toBe(0);
  expect(totalCanceladoBody.pedidos[0].status).toBe('ENTREGUE');
  expect(totalCanceladoBody.pedidos[0].itens[0].cancelamentosEntregue.map((item: { motivo: string }) => item.motivo)).toEqual([
    'Cliente recusou uma unidade', 'Cancelamento da última unidade',
  ]);
  await expect(page.getByText('Cancelamento da última unidade')).toBeVisible();
  const final = await tenant.comanda(tenant.owner, aberta.id);
  expect(final.pedidos.find((pedido: { id: string }) => pedido.id === entregue.pedidos[0].id)?.status).toBe('ENTREGUE');
  const historico = final.pedidos.flatMap((pedido: { itens: Item[] }) => pedido.itens)
    .flatMap((item: Item & { cancelamentosEntregue?: Array<{ motivo: string; quantidade: number }> }) => item.cancelamentosEntregue ?? []);
  expect(historico).toEqual(expect.arrayContaining([
    expect.objectContaining({ motivo: 'Cliente recusou uma unidade', quantidade: 1 }),
    expect.objectContaining({ motivo: 'Cancelamento da última unidade', quantidade: 1 }),
  ]));
  const auditoria = await prismaClient().itemComandaCancelamentoEntregue.findMany({ where: { itemComandaId: itemSuco.id, cervejariaId: tenant.id }, orderBy: { createdAt: 'asc' } });
  expect(auditoria.map((registro: { usuarioId: string; motivo: string; quantidade: number; valorRetirado: unknown; tratamentoEstoque: string }) => ({
    usuarioId: registro.usuarioId, motivo: registro.motivo, quantidade: registro.quantidade,
    valorRetirado: Number(registro.valorRetirado), tratamentoEstoque: registro.tratamentoEstoque,
  }))).toEqual([
    { usuarioId: atendente.userId, motivo: 'Cliente recusou uma unidade', quantidade: 1, valorRetirado: 12, tratamentoEstoque: 'SEM_RETORNO_PRODUTO_PREPARADO_ENTREGUE_OU_PERDIDO' },
    { usuarioId: atendente.userId, motivo: 'Cancelamento da última unidade', quantidade: 1, valorRetirado: 12, tratamentoEstoque: 'SEM_RETORNO_PRODUTO_PREPARADO_ENTREGUE_OU_PERDIDO' },
  ]);
  expect((await tenant.stock())(suco.id)).toBe(8);
  await evidence.screenshot('cancelamento-entregue-interface', page);
});

test('CMD-S05 aplica desconto na comanda @api', async ({ ops }) => {
  const tenant = await vendaPronta(ops);
  const caixa = await tenant.staff('Caixa', PERSONA_PERMISSIONS.caixa);
  const comanda = await tenant.openComanda(caixa, [tenant.item('lata', 3)]);
  const comDesconto = await caixa.expect(caixa.patch(`/api/operacao/comandas/${comanda.id}/desconto`, { desconto: 4 }), 200, 'desconto');
  expect(comDesconto).toMatchObject({ subtotal: 24, desconto: 4, total: 20 });
});

test('CMD-S06 pagamento dividido em dinheiro com troco, PIX, débito e crédito @api', async ({ ops }) => {
  const tenant = await vendaPronta(ops);
  const caixa = await tenant.staff('Caixa', PERSONA_PERMISSIONS.caixa);
  const comanda = await tenant.openComanda(caixa, [tenant.chopeItem(700), tenant.chopeItem(500), tenant.item('lata', 2)]);
  expect(comanda.total).toBe(58);
  const fechada = await caixa.expect(tenant.pay(caixa, comanda.id, [
    { forma: 'DINHEIRO', valor: 10, valorRecebido: 20 }, { forma: 'PIX', valor: 20 }, { forma: 'CARTAO_DEBITO', valor: 18 }, { forma: 'CARTAO_CREDITO', valor: 10 },
  ]), 200, 'pagar dividido');
  expect(fechada.status).toBe('FECHADA');
  expect(fechada.pagamentos.find((p: { forma: string }) => p.forma === 'DINHEIRO')).toMatchObject({ valor: 10, valorRecebido: 20, troco: 10 });
  const estado = await tenant.cashState(caixa);
  expect(estado.sessao.esperado).toMatchObject({ dinheiro: 10, pix: 20, cartaoDebito: 18, cartaoCredito: 10, totalVendas: 58 });
});

test('CMD-S07 fecha comandas em grupo com um pagamento @api', async ({ ops }) => {
  const tenant = await vendaPronta(ops);
  const a = await tenant.openComanda(tenant.owner, [tenant.item('lata')]);
  const b = await tenant.openComanda(tenant.owner, [tenant.item('agua', 2)]);
  await tenant.owner.expect(tenant.owner.post('/api/operacao/comandas/fechar-grupo', { comandaIds: [a.id, b.id], pagamentos: [{ forma: 'PIX', valor: 18 }] }), 200, 'fechar grupo');
  for (const id of [a.id, b.id]) expect((await tenant.comanda(tenant.owner, id)).status).toBe('FECHADA');
  expect((await tenant.cashState()).sessao.esperado.pix).toBe(18);
});

test('CMD-S08 deixa conta pendente e recebe depois em parcelas @api', async ({ ops }) => {
  const tenant = await vendaPronta(ops);
  const caixa = await tenant.staff('Caixa', PERSONA_PERMISSIONS.caixa);
  const comanda = await tenant.openComanda(caixa, [tenant.item('lata', 5)], { clienteNome: 'Cliente Fiado QA', clienteTelefone: uniquePhone() });
  const pendente = await caixa.expect(tenant.pay(caixa, comanda.id, [], true), 200, 'deixar pendente');
  expect(pendente.contaPendente).toMatchObject({ valorOriginal: 40, recebido: 0, saldo: 40 });
  const contaId = pendente.contaPendente.id;
  await caixa.expect(caixa.post(`/api/operacao/contas-pendentes/${contaId}/pagamentos`, { pontoVendaId: tenant.pointId, pagamentos: [{ forma: 'PIX', valor: 15 }] }), 200, 'recebimento parcial');
  const lista = await caixa.expect(caixa.get('/api/operacao/contas-pendentes'), 200, 'listar pendentes');
  expect(JSON.stringify(lista)).toContain(contaId);
  await caixa.expect(caixa.post(`/api/operacao/contas-pendentes/${contaId}/pagamentos`, { pontoVendaId: tenant.pointId, pagamentos: [{ forma: 'DINHEIRO', valor: 25 }] }), 200, 'quitar');
  const quitada = await tenant.comanda(caixa, comanda.id);
  expect(quitada.contaPendente).toMatchObject({ valorOriginal: 40, recebido: 40, saldo: 0 });
});

test('CMD-S09 venda avulsa e estorno pela cozinha @api', async ({ ops }) => {
  const tenant = await vendaPronta(ops);
  const venda = await tenant.owner.expect(tenant.owner.post('/api/operacao/vendas', { pontoVendaId: tenant.pointId, itens: [tenant.porcaoItem(1)], pagamentos: [{ forma: 'PIX', valor: 30 }] }), 201, 'venda avulsa');
  expect(venda.total).toBe(30);
  expect((await tenant.cashState()).sessao.esperado.pix).toBe(30);
  const pedido = venda.pedidos.find((p: { itens: Item[] }) => p.itens.some((item) => item.produtoId === tenant.catalog!.porcao.id));
  const fila = await tenant.kitchenOrders(tenant.owner);
  expect(fila.map((p: { id: string }) => p.id)).toContain(pedido.id);
  await tenant.owner.expect(tenant.owner.patch(`/api/operacao/cozinha/${pedido.id}/status`, { status: 'CANCELAMENTO_PENDENTE', expectedStatus: 'RECEBIDO' }), 200, 'solicitar estorno');
  await tenant.owner.expect(tenant.owner.patch(`/api/operacao/cozinha/${pedido.id}/status`, { status: 'CANCELADO', expectedStatus: 'CANCELAMENTO_PENDENTE' }), 200, 'confirmar estorno');
  expect((await tenant.cashState()).sessao.esperado.pix).toBe(0);
  expect((await tenant.stock())(tenant.catalog!.porcao.id)).toBe(20);
});

test('CMD-S10 links de WhatsApp da comanda abrem wa.me com número e resumo', async ({ ops, page, evidence }) => {
  const tenant = await vendaPronta(ops);
  const telefone = uniquePhone();
  const comanda = await tenant.openComanda(tenant.owner, [tenant.item('lata', 2)], { clienteNome: 'Cliente Zap QA', clienteTelefone: telefone });
  await page.addInitScript(() => {
    (window as unknown as { __opened: string[] }).__opened = [];
    window.open = ((url?: string | URL) => { (window as unknown as { __opened: string[] }).__opened.push(String(url)); return null; }) as typeof window.open;
  });
  await loginPage(page, tenant.ownerEmail, tenant.ownerPassword);
  await page.goto(`/operacao/comandas/${comanda.id}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Enviar número sequencial da comanda pelo WhatsApp' }).click();
  await page.getByRole('button', { name: 'Enviar resumo da conta pelo WhatsApp' }).click();
  await evidence.screenshot('comanda-whatsapp');
  const opened = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);
  expect(opened).toHaveLength(2);
  for (const url of opened) expect(url.startsWith(`https://wa.me/55${telefone}?text=`)).toBe(true);
  expect(decodeURIComponent(opened[0]!)).toContain(`O número da sua comanda no QA Release`);
  expect(decodeURIComponent(opened[1]!)).toContain('2x Lata QA');
});

test('CMD-S11 dois navegadores veem a comanda atualizar em tempo real', async ({ ops, page, browser, evidence }) => {
  const tenant = await vendaPronta(ops);
  const comanda = await tenant.openComanda(tenant.owner, [tenant.item('agua'), tenant.porcaoItem(1)]);
  const entregue = await entregarPorcao(tenant, comanda.id);
  const porcao = itemDe(entregue, tenant.catalog!.porcao.id);
  await loginPage(page, tenant.ownerEmail, tenant.ownerPassword);
  await page.goto(`/operacao/comandas/${comanda.id}`, { waitUntil: 'networkidle' });
  const outro = await browser.newContext();
  try {
    const segunda = await outro.newPage();
    const salao = await tenant.staff('Salao', PERSONA_PERMISSIONS.salao);
    await loginPage(segunda, salao.email, salao.senha);
    await segunda.goto(`/operacao/comandas/${comanda.id}`, { waitUntil: 'networkidle' });
    await expect(page.getByText('Lata QA')).toHaveCount(0);
    await salao.expect(salao.post(`/api/operacao/comandas/${comanda.id}/pedidos`, { itens: [tenant.item('lata')] }), 201, 'novo pedido');
    await expect(page.getByText('Lata QA').first()).toBeVisible({ timeout: 10_000 });
    await expect(segunda.getByText('Lata QA').first()).toBeVisible({ timeout: 10_000 });
    await segunda.context().setOffline(true);
    await tenant.owner.expect(tenant.owner.delete(`/api/operacao/comandas/${comanda.id}/itens/${porcao.id}`, {
      quantidade: 1, quantidadeEsperada: 1, motivo: 'Cancelamento de reconexão QA', tratamentoEstoque: 'PREPARADO_ENTREGUE_OU_PERDIDO', idempotencyKey: randomUUID(),
    }), 200, 'cancelar enquanto segundo aparelho está offline');
    await expect(page.getByText('Cancelamento de reconexão QA')).toBeVisible({ timeout: 10_000 });
    await segunda.context().setOffline(false);
    await segunda.reload({ waitUntil: 'networkidle' });
    await expect(segunda.getByText('Cancelamento de reconexão QA')).toBeVisible({ timeout: 10_000 });
    expect((await tenant.comanda(tenant.owner, comanda.id)).pedidos[0].status).toBe('ENTREGUE');
    await evidence.screenshot('tempo-real');
  } finally {
    await outro.close();
  }
});

test('RT-17 handshake autenticado, room tenant-bound, negação e reconexão @api', async ({ ops }) => {
  const tenant = await vendaPronta(ops);
  const foreignTenant = await vendaPronta(ops);
  const foreignComanda = await foreignTenant.openComanda(foreignTenant.owner, [foreignTenant.porcaoItem(1)]);
  const state = await tenant.owner.ctx.storageState();
  const token = state.cookies.find((cookie) => cookie.name === 'token')?.value;
  expect(token).toBeTruthy();

  const invalid = socketIo(baseURL, { transports: ['websocket'], auth: { token: 'invalid-synthetic-token' }, reconnection: false });
  try {
    await expect(socketEvent(invalid, 'connect_error')).resolves.toBeTruthy();
  } finally {
    invalid.disconnect();
  }

  const socket = socketIo(baseURL, { transports: ['websocket'], auth: { token }, reconnection: false });
  try {
    await socketConnected(socket);
    const leakedEvents: unknown[] = [];
    socket.on('operacao:comanda-atualizada', (payload: unknown) => leakedEvents.push(payload));
    socket.emit('join:cervejaria', foreignTenant.id);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await entregarPorcao(foreignTenant, foreignComanda.id);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(leakedEvents).toHaveLength(0);

    socket.emit('join:cervejaria', tenant.id);
    await new Promise((resolve) => setTimeout(resolve, 100));

    socket.disconnect();
    expect(socket.connected).toBe(false);
    const reconnected = socketConnected(socket);
    socket.connect();
    await reconnected;
    socket.emit('join:cervejaria', tenant.id);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const ownComanda = await tenant.openComanda(tenant.owner, [tenant.porcaoItem(1)]);
    const ownEvents = socketEvent(socket, 'operacao:comanda-atualizada') as Promise<{ comandaId?: string }>;
    await entregarPorcao(tenant, ownComanda.id);
    expect(await ownEvents).toMatchObject({ comandaId: ownComanda.id });
  } finally {
    socket.disconnect();
  }
});

test('CMD-S12 tela de comandas não transborda horizontalmente', async ({ ops, page, evidence }) => {
  const tenant = await vendaPronta(ops);
  for (let i = 0; i < 6; i++) await tenant.openComanda(tenant.owner, [tenant.item('agua')], { identificador: `Comanda com nome longo ${i} QA` });
  await loginPage(page, tenant.ownerEmail, tenant.ownerPassword);
  await page.goto('/operacao/comandas', { waitUntil: 'networkidle' });
  await expect(page.getByText('Comanda com nome longo 5 QA')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await evidence.screenshot('comandas-compacto');
  expect(overflow).toBeLessThanOrEqual(1);
});

test('CMD-X01 cobrar comanda sem itens é recusado @api', async ({ ops, evidence }) => {
  const tenant = await vendaPronta(ops);
  const vazia = await tenant.openComanda(tenant.owner, []);
  await evidence.checkpoint();
  const body = await tenant.owner.expect(tenant.pay(tenant.owner, vazia.id, [{ forma: 'PIX', valor: 1 }]), 409, 'cobrar vazia');
  expect(body.error).toBe('Lance ao menos um item antes de cobrar');
  await evidence.assertNoDbChange();
});

test('CMD-X02 soma dos pagamentos diferente do total é recusada @api', async ({ ops, evidence }) => {
  const tenant = await vendaPronta(ops);
  const comanda = await tenant.openComanda(tenant.owner, [tenant.item('lata')]);
  await evidence.checkpoint();
  const body = await tenant.owner.expect(tenant.pay(tenant.owner, comanda.id, [{ forma: 'PIX', valor: 5 }]), 400, 'soma errada');
  expect(body.error).toBe('Os pagamentos somam 5.00 e a conta é 8.00');
  await evidence.assertNoDbChange();
  await tenant.owner.expect(tenant.pay(tenant.owner, comanda.id, [{ forma: 'PIX', valor: 8 }]), 200, 'controle positivo');
});

test('CMD-X03 valor recebido menor que o devido é recusado @api', async ({ ops, evidence }) => {
  const tenant = await vendaPronta(ops);
  const comanda = await tenant.openComanda(tenant.owner, [tenant.item('lata')]);
  await evidence.checkpoint();
  const body = await tenant.owner.expect(tenant.pay(tenant.owner, comanda.id, [{ forma: 'DINHEIRO', valor: 8, valorRecebido: 5 }]), 400, 'recebido menor');
  expect(body.error).toBe('O valor recebido é menor que o valor a pagar');
  await evidence.assertNoDbChange();
});

test('CMD-X04 troco fora do dinheiro é recusado @api', async ({ ops, evidence }) => {
  const tenant = await vendaPronta(ops);
  const comanda = await tenant.openComanda(tenant.owner, [tenant.item('lata')]);
  await evidence.checkpoint();
  const body = await tenant.owner.expect(tenant.pay(tenant.owner, comanda.id, [{ forma: 'PIX', valor: 8, valorRecebido: 10 }]), 400, 'troco no PIX');
  expect(body.error).toBe('Troco só existe em pagamento com dinheiro');
  await evidence.assertNoDbChange();
});

test('CMD-X05 desconto maior que o subtotal é recusado @api', async ({ ops, evidence }) => {
  const tenant = await vendaPronta(ops);
  const comanda = await tenant.openComanda(tenant.owner, [tenant.item('lata')]);
  await evidence.checkpoint();
  const body = await tenant.owner.expect(tenant.owner.patch(`/api/operacao/comandas/${comanda.id}/desconto`, { desconto: 9 }), 400, 'desconto alto');
  expect(body.error).toBe('O desconto não pode ser maior que o subtotal da comanda');
  await evidence.assertNoDbChange();
  await tenant.owner.expect(tenant.owner.patch(`/api/operacao/comandas/${comanda.id}/desconto`, { desconto: 8 }), 200, 'controle positivo');
});

test('CMD-X06 venda avulsa não aceita desconto posterior @api', async ({ ops, evidence }) => {
  const tenant = await vendaPronta(ops);
  const venda = await tenant.owner.expect(tenant.owner.post('/api/operacao/vendas', { pontoVendaId: tenant.pointId, itens: [tenant.item('agua')], pagamentos: [{ forma: 'PIX', valor: 5 }] }), 201, 'venda avulsa');
  await evidence.checkpoint();
  const body = await tenant.owner.expect(tenant.owner.patch(`/api/operacao/comandas/${venda.id}/desconto`, { desconto: 1 }), 409, 'desconto em avulsa');
  expect(body.error).toBe('Só é possível alterar desconto em comanda aberta');
  await evidence.assertNoDbChange();
});

test('CMD-X07 desconto sem permissão é recusado @api', async ({ ops, evidence }) => {
  const tenant = await vendaPronta(ops);
  const salao = await tenant.staff('Salao', PERSONA_PERMISSIONS.salao);
  const comanda = await tenant.openComanda(salao, [tenant.item('lata')]);
  await evidence.checkpoint();
  await salao.expect(salao.patch(`/api/operacao/comandas/${comanda.id}/desconto`, { desconto: 1 }), 403, 'desconto sem permissão');
  await evidence.assertNoDbChange();
  await tenant.owner.expect(tenant.owner.patch(`/api/operacao/comandas/${comanda.id}/desconto`, { desconto: 1 }), 200, 'controle positivo');
});

test('CMD-X08 fechar com cozinha pendente é bloqueado e passa com as duas flags @api', async ({ ops, evidence }) => {
  const tenant = await vendaPronta(ops);
  const comanda = await tenant.openComanda(tenant.owner, [tenant.porcaoItem(1)]);
  await evidence.checkpoint();
  const body = await tenant.owner.expect(tenant.pay(tenant.owner, comanda.id, [{ forma: 'PIX', valor: 30 }]), 409, 'cozinha pendente');
  expect(body.error).toBe('Aguarde a entrega dos itens da cozinha antes de fechar a comanda');
  await evidence.assertNoDbChange();
  await tenant.configure({ kitchenItemsChargeAtLaunch: true, allowCloseComandaWithPendingKitchenOrders: true });
  await tenant.owner.expect(tenant.pay(tenant.owner, comanda.id, [{ forma: 'PIX', valor: 30 }]), 200, 'com as duas flags');
});

test('CMD-X09 cancelar item entregue em comanda com pagamento é recusado @api', async ({ ops, evidence }) => {
  const tenant = await vendaPronta(ops);
  const aberta = await tenant.openComanda(tenant.owner, [tenant.porcaoItem(1), tenant.item('agua')]);
  const entregue = await entregarPorcao(tenant, aberta.id);
  await prismaClient().pagamento.create({ data: { comandaId: aberta.id, forma: 'PIX', valor: 5 } });
  await evidence.checkpoint();
  const porcao = itemDe(entregue, tenant.catalog!.porcao.id);
  const body = await tenant.owner.expect(tenant.owner.delete(`/api/operacao/comandas/${aberta.id}/itens/${porcao.id}`, {
    quantidade: 1, quantidadeEsperada: 1, motivo: 'Cliente devolveu', tratamentoEstoque: 'ERRO_LANCAMENTO', idempotencyKey: randomUUID(),
  }), 409, 'cancelar com pagamento');
  expect(body.error).toBe('Esta comanda possui pagamentos. Use o fluxo próprio de correção ou estorno.');
  await evidence.assertNoDbChange();
});

test('CMD-X16 cancelamento entregue recusa comanda fechada e acesso de outro tenant @api', async ({ ops, evidence }) => {
  const tenant = await vendaPronta(ops);
  const fechada = await tenant.openComanda(tenant.owner, [tenant.porcaoItem(1)]);
  const entregue = await entregarPorcao(tenant, fechada.id);
  const itemFechado = itemDe(entregue, tenant.catalog!.porcao.id);
  await tenant.pay(tenant.owner, fechada.id, [{ forma: 'PIX', valor: 30 }]);
  await evidence.checkpoint();
  const payload = { quantidade: 1, quantidadeEsperada: 1, motivo: 'Recusado após fechamento QA', tratamentoEstoque: 'PREPARADO_ENTREGUE_OU_PERDIDO', idempotencyKey: randomUUID() };
  const fechado = await tenant.owner.expect(tenant.owner.delete(`/api/operacao/comandas/${fechada.id}/itens/${itemFechado.id}`, payload), 409, 'comanda paga e fechada');
  expect(fechado.error).toMatch(/fechada/i);

  const outroTenant = await vendaPronta(ops);
  const estrangeira = await tenant.openComanda(tenant.owner, [tenant.porcaoItem(1)]);
  const entregueEstrangeira = await entregarPorcao(tenant, estrangeira.id);
  const itemEstrangeiro = itemDe(entregueEstrangeira, tenant.catalog!.porcao.id);
  await evidence.checkpoint();
  await outroTenant.owner.expect(outroTenant.owner.delete(`/api/operacao/comandas/${estrangeira.id}/itens/${itemEstrangeiro.id}`, payload), 404, 'comanda de outro tenant');
  await evidence.assertNoDbChange();
  expect(itemDe(await tenant.comanda(tenant.owner, estrangeira.id), tenant.catalog!.porcao.id).quantidade).toBe(1);
});

test('CMD-X10 chave de idempotência reutilizada em outro item é recusada @api', async ({ ops, evidence }) => {
  const tenant = await vendaPronta(ops);
  const aberta = await tenant.openComanda(tenant.owner, [tenant.porcaoItem(2)]);
  const segunda = await tenant.openComanda(tenant.owner, [tenant.porcaoItem(1)]);
  const primeira = await entregarPorcao(tenant, aberta.id);
  const outra = await entregarPorcao(tenant, segunda.id);
  const chave = randomUUID();
  await tenant.owner.expect(tenant.owner.delete(`/api/operacao/comandas/${aberta.id}/itens/${itemDe(primeira, tenant.catalog!.porcao.id).id}`, {
    quantidade: 1, quantidadeEsperada: 2, motivo: 'Cliente devolveu', tratamentoEstoque: 'ERRO_LANCAMENTO', idempotencyKey: chave,
  }), 200, 'primeiro uso');
  await evidence.checkpoint();
  const body = await tenant.owner.expect(tenant.owner.delete(`/api/operacao/comandas/${segunda.id}/itens/${itemDe(outra, tenant.catalog!.porcao.id).id}`, {
    quantidade: 1, quantidadeEsperada: 1, motivo: 'Cliente devolveu', tratamentoEstoque: 'ERRO_LANCAMENTO', idempotencyKey: chave,
  }), 409, 'chave reutilizada');
  expect(body.error).toBe('Identificador já utilizado em outra operação');
  await evidence.assertNoDbChange();
});

test('CMD-X11 comanda com pagamento não pode ser cancelada @api', async ({ ops, evidence }) => {
  const tenant = await vendaPronta(ops);
  const aberta = await tenant.openComanda(tenant.owner, [tenant.item('lata')]);
  await prismaClient().pagamento.create({ data: { comandaId: aberta.id, forma: 'PIX', valor: 3 } });
  await evidence.checkpoint();
  const body = await tenant.owner.expect(tenant.owner.post(`/api/operacao/comandas/${aberta.id}/cancelar`), 409, 'cancelar com pagamento');
  expect(body.error).toBe('Comanda com pagamento registrado não pode ser cancelada');
  await evidence.assertNoDbChange();
  const semPagamento = await tenant.openComanda(tenant.owner, [tenant.item('agua')]);
  await tenant.owner.expect(tenant.owner.post(`/api/operacao/comandas/${semPagamento.id}/cancelar`), 200, 'controle positivo');
});

test('CMD-X12 conta pendente exige cliente com telefone @api', async ({ ops, evidence }) => {
  const tenant = await vendaPronta(ops);
  const comanda = await tenant.openComanda(tenant.owner, [tenant.item('lata')]);
  await evidence.checkpoint();
  const body = await tenant.owner.expect(tenant.pay(tenant.owner, comanda.id, [], true), 400, 'pendente sem telefone');
  expect(body.error).toBe('Para deixar a conta pendente, associe um cliente cadastrado com telefone válido.');
  await evidence.assertNoDbChange();
});

test('CMD-X13 fechamento em grupo com IDs duplicados é recusado @api', async ({ ops, evidence }) => {
  const tenant = await vendaPronta(ops);
  const comanda = await tenant.openComanda(tenant.owner, [tenant.item('lata')]);
  await evidence.checkpoint();
  const body = await tenant.owner.expect(tenant.owner.post('/api/operacao/comandas/fechar-grupo', { comandaIds: [comanda.id, comanda.id], pagamentos: [{ forma: 'PIX', valor: 16 }] }), 400, 'IDs duplicados');
  expect(body.error).toBe('Lista de comandas contém IDs duplicados');
  await evidence.assertNoDbChange();
});

test('CMD-X14 dois atendentes cancelando o mesmo item entregue: só um vence @api', async ({ ops, evidence }) => {
  const tenant = await vendaPronta(ops);
  const aberta = await tenant.openComanda(tenant.owner, [tenant.porcaoItem(2)]);
  const entregue = await entregarPorcao(tenant, aberta.id);
  const porcao = itemDe(entregue, tenant.catalog!.porcao.id);
  const grants = ['command.read', 'command.operate', 'command.item.cancel', 'command.item.cancel.delivered'];
  const atendenteA = await tenant.staff('ConcorrenciaA', grants);
  const atendenteB = await tenant.staff('ConcorrenciaB', grants);
  const url = `/api/operacao/comandas/${aberta.id}/itens/${porcao.id}`;
  const payload = () => ({ quantidade: 1, quantidadeEsperada: 2, motivo: 'Cliente devolveu', tratamentoEstoque: 'ERRO_LANCAMENTO', idempotencyKey: randomUUID() });
  const [a, b] = await Promise.all([atendenteA.delete(url, payload()), atendenteB.delete(url, payload())]);
  expect([a.status, b.status].sort()).toEqual([200, 409]);
  const perdedor = a.status === 409 ? a : b;
  expect(perdedor.body.error).toBe('A quantidade disponível mudou em outra sessão. Atualize a comanda e tente novamente.');
  const final = await tenant.comanda(tenant.owner, aberta.id);
  expect(itemDe(final, tenant.catalog!.porcao.id).quantidade).toBe(1);
  await evidence.checkpoint();
});

test('CMD-X17 quantidade esperada obsoleta recusa cancelamento entregue sem efeitos @api', async ({ ops, evidence }) => {
  const tenant = await vendaPronta(ops);
  const aberta = await tenant.openComanda(tenant.owner, [tenant.porcaoItem(2)]);
  const entregue = await entregarPorcao(tenant, aberta.id);
  const porcao = itemDe(entregue, tenant.catalog!.porcao.id);
  await evidence.checkpoint();
  const semMotivo = await tenant.owner.delete(`/api/operacao/comandas/${aberta.id}/itens/${porcao.id}`, {
    quantidade: 1, quantidadeEsperada: 2, tratamentoEstoque: 'ERRO_LANCAMENTO', idempotencyKey: randomUUID(),
  });
  expect(semMotivo.status).toBe(400);
  await evidence.assertNoDbChange();
  await evidence.checkpoint();
  const body = await tenant.owner.expect(tenant.owner.delete(`/api/operacao/comandas/${aberta.id}/itens/${porcao.id}`, {
    quantidade: 1, quantidadeEsperada: 1, motivo: 'Tentativa com quantidade antiga QA', tratamentoEstoque: 'ERRO_LANCAMENTO', idempotencyKey: randomUUID(),
  }), 409, 'quantidade esperada obsoleta');
  expect(body.error).toMatch(/quantidade disponível mudou/i);
  await evidence.assertNoDbChange();
  const final = await tenant.comanda(tenant.owner, aberta.id);
  expect(itemDe(final, tenant.catalog!.porcao.id).quantidade).toBe(2);
  expect(final.pedidos[0].itens[0].cancelamentosEntregue).toHaveLength(0);
  expect((await tenant.stock())(tenant.catalog!.porcao.id)).toBe(18);
});

test('CMD-X18 operação deixa de cancelar ao existir PDV concorrente fora do canônico @api', async ({ ops, evidence }) => {
  const tenant = await vendaPronta(ops);
  const aberta = await tenant.openComanda(tenant.owner, [tenant.porcaoItem(1)]);
  const entregue = await entregarPorcao(tenant, aberta.id);
  const porcao = itemDe(entregue, tenant.catalog!.porcao.id);
  await prismaClient().pontoVenda.create({ data: { cervejariaId: tenant.id, nome: 'Outro PDV QA' } });
  await evidence.checkpoint();
  const resposta = await tenant.owner.delete(`/api/operacao/comandas/${aberta.id}/itens/${porcao.id}`, {
    quantidade: 1, quantidadeEsperada: 1, motivo: 'Não operar fora do PDV canônico QA', tratamentoEstoque: 'PREPARADO_ENTREGUE_OU_PERDIDO', idempotencyKey: randomUUID(),
  });
  expect(resposta.status).toBe(409);
  expect(resposta.body.code).toBe('CANONICAL_PDV_AMBIGUOUS');
  await evidence.assertNoDbChange();
});

test('CMD-X19 repetição com a mesma chave idempotente não duplica cancelamento nem estoque @api', async ({ ops, evidence }) => {
  const tenant = await vendaPronta(ops);
  const aberta = await tenant.openComanda(tenant.owner, [tenant.porcaoItem(2)]);
  const entregue = await entregarPorcao(tenant, aberta.id);
  const porcao = itemDe(entregue, tenant.catalog!.porcao.id);
  const key = randomUUID();
  const payload = { quantidade: 1, quantidadeEsperada: 2, motivo: 'Correção já enviada QA', tratamentoEstoque: 'ERRO_LANCAMENTO', idempotencyKey: key };
  const primeira = await tenant.owner.expect(tenant.owner.delete(`/api/operacao/comandas/${aberta.id}/itens/${porcao.id}`, payload), 200, 'primeira chamada');
  expect(primeira.total).toBe(30);
  await evidence.checkpoint();
  const repetida = await tenant.owner.expect(tenant.owner.delete(`/api/operacao/comandas/${aberta.id}/itens/${porcao.id}`, payload), 200, 'repetição da mesma chamada');
  expect(repetida.total).toBe(30);
  await evidence.assertNoDbChange();
  const final = await tenant.comanda(tenant.owner, aberta.id);
  expect(itemDe(final, tenant.catalog!.porcao.id).quantidade).toBe(1);
  expect(final.pedidos[0].itens[0].cancelamentosEntregue).toHaveLength(1);
  expect((await tenant.stock())(tenant.catalog!.porcao.id)).toBe(19);
});

test('CMD-X20 troca autenticada de tenant não conserva a comanda anterior no navegador', async ({ ops, page, evidence }) => {
  const tenant = await vendaPronta(ops);
  const comanda = await tenant.openComanda(tenant.owner, [tenant.item('agua')], { identificador: 'Comanda tenant A QA' });
  await loginPage(page, tenant.ownerEmail, tenant.ownerPassword);
  await page.goto(`/operacao/comandas/${comanda.id}`, { waitUntil: 'networkidle' });
  await expect(page.getByText('Água QA')).toBeVisible();

  const outroTenant = await ops.tenant();
  await evidence.checkpoint();
  await loginPage(page, outroTenant.ownerEmail, outroTenant.ownerPassword);
  await page.goto(`/operacao/comandas/${comanda.id}`, { waitUntil: 'networkidle' });
  await expect(page.getByText('Comanda não encontrada.')).toBeVisible();
  await expect(page.getByText('Água QA')).toHaveCount(0);
  await evidence.assertNoDbChange();
});

test('CMD-X15 produto fora do cardápio do turno não pode ser lançado @api', async ({ ops, evidence }) => {
  const tenant = await vendaPronta(ops);
  const fora = await tenant.owner.expect(tenant.owner.post('/api/operacao/produtos', { nome: 'Fora do turno QA', categoriaPdvId: tenant.catalog!.categoriaId, tipo: 'BEBIDA', formato: 'OUTRO', precoUnit: 7, controlaEstoque: false }), 201, 'produto novo');
  await evidence.checkpoint();
  const body = await tenant.owner.expect(tenant.owner.post('/api/operacao/comandas', { pontoVendaId: tenant.pointId, tipo: 'APELIDO', identificador: 'Fora QA', itens: [{ produtoId: fora.id, quantidade: 1 }] }), 400, 'fora do cardápio');
  expect(body.error).toBe('Este item não está no cardápio deste turno');
  await evidence.assertNoDbChange();
});
