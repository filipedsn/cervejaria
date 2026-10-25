import { prismaClient } from '../support/fixtures';
import { expect, loginPage, randomUUID, test, todayIso, uniquePhone } from '../support/ops';

const brl = (value: number) => `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

test('DSH-S10 espelho de comanda preserva histórico, pagamentos e contexto do turno', async ({ ops, page, evidence }, testInfo) => {
  const tenant = await ops.tenant();
  const catalog = await tenant.seedCatalog();
  const agenda = await tenant.owner.expect(tenant.owner.post('/api/operacao/agenda/agendamentos', {
    requestId: randomUUID(), nome: 'Agendamento Espelho QA', data: todayIso(), horaInicio: '18:00', horaFim: '23:00', repetirSemanalmente: false,
  }), 200, 'agendamento sintético do turno');
  const session = await tenant.owner.expect(tenant.owner.post('/api/operacao/caixa/abrir', {
    pontoVendaId: tenant.pointId, trocoInicial: 0, cardapioId: catalog.cardapioId, ocorrenciaId: agenda.ocorrenciaId,
  }), 201, 'abrir turno com agendamento sintético');

  const split = await tenant.openComanda(tenant.owner, [
    tenant.chopeItem(500),
    tenant.porcaoItem(2, { opcionais: [{ opcionalId: catalog.opcional.id, quantidade: 1 }] }),
  ], { identificador: 'Mesa Espelho Dividida' });
  const cozinha = split.pedidos.find((pedido: { itens: Array<{ produtoId: string }> }) => pedido.itens.some((item) => item.produtoId === catalog.porcao.id));
  expect(cozinha).toBeTruthy();
  const porcao = cozinha.itens.find((item: { produtoId: string }) => item.produtoId === catalog.porcao.id);
  await tenant.advanceKitchen(tenant.owner, cozinha.id, ['EM_PREPARO', 'PRONTO', 'ENTREGUE']);
  await tenant.owner.expect(tenant.owner.delete(`/api/operacao/comandas/${split.id}/itens/${porcao.id}`, {
    quantidade: 1,
    quantidadeEsperada: 2,
    motivo: 'Cancelamento parcial sintético para espelho',
    tratamentoEstoque: 'PREPARADO_ENTREGUE_OU_PERDIDO',
    idempotencyKey: randomUUID(),
  }), 200, 'cancelar uma porção entregue');
  await tenant.owner.expect(tenant.owner.patch(`/api/operacao/comandas/${split.id}/desconto`, { desconto: 3 }), 200, 'desconto sintético');
  const splitTotal = await tenant.pay(tenant.owner, split.id, [
    { forma: 'PIX', valor: 30 },
    { forma: 'CARTAO_DEBITO', valor: 20 },
  ]);
  expect(splitTotal.status).toBe(200);

  const pending = await tenant.openComanda(tenant.owner, [tenant.item('agua', 2)], {
    identificador: 'Mesa Sem Pagamento', clienteNome: 'Cliente Saldo QA', clienteTelefone: uniquePhone(),
  });
  expect((await tenant.pay(tenant.owner, pending.id, [], true)).status).toBe(200);
  const later = await tenant.openComanda(tenant.owner, Array.from({ length: 20 }, () => tenant.item('agua')), {
    identificador: 'Mesa Quitada Depois', clienteNome: 'Cliente Espelho QA', clienteTelefone: uniquePhone(),
  });
  expect((await tenant.pay(tenant.owner, later.id, [], true)).status).toBe(200);
  await tenant.closeCash();

  const conta = await tenant.owner.expect(tenant.owner.get('/api/operacao/contas-pendentes'), 200, 'contas pendentes após fechamento');
  const contaQuitadaDepois = conta.find((row: { comanda: { id: string } }) => row.comanda.id === later.id);
  expect(contaQuitadaDepois).toBeTruthy();
  await tenant.owner.expect(tenant.owner.post(`/api/operacao/contas-pendentes/${contaQuitadaDepois.id}/pagamentos`, {
    pontoVendaId: tenant.pointId,
    pagamentos: [{ forma: 'DINHEIRO', valor: 100 }],
  }), 200, 'quitar depois do turno');

  const mirrorUrl = (id: string, pointId = tenant.pointId, sessionId = session.id) =>
    `/api/operacao/comandas/${id}/espelho-turno?${new URLSearchParams({ pontoVendaId: pointId, sessaoCaixaId: sessionId })}`;
  const apiEspelho = await tenant.owner.expect(tenant.owner.get(mirrorUrl(split.id)), 200, 'API do espelho');
  expect(apiEspelho).toMatchObject({ subtotal: 53, desconto: 3, total: 50, valorEmAberto: 0, pontoVenda: { id: tenant.pointId } });
  expect(apiEspelho.agendamento).toMatchObject({ nome: 'Agendamento Espelho QA' });
  expect(apiEspelho.pagamentos.map((payment: { forma: string; valor: number; classificacaoTurno: string }) => [payment.forma, payment.valor, payment.classificacaoTurno])).toEqual([
    ['PIX', 30, 'NESTE_TURNO'], ['CARTAO_DEBITO', 20, 'NESTE_TURNO'],
  ]);
  expect(apiEspelho.pedidos.flatMap((pedido: { itens: Array<{ cancelamentosEntregue: unknown[] }> }) => pedido.itens.flatMap((item) => item.cancelamentosEntregue))).toHaveLength(1);
  expect((await tenant.owner.expect(tenant.owner.get(mirrorUrl(pending.id)), 200, 'comanda sem pagamento'))).toMatchObject({ total: 10, valorEmAberto: 10, pagamentos: [] });
  const apiQuitadaDepois = await tenant.owner.expect(tenant.owner.get(mirrorUrl(later.id)), 200, 'quitação posterior');
  expect(apiQuitadaDepois.pagamentos).toMatchObject([{ forma: 'DINHEIRO', valor: 100, classificacaoTurno: 'DEPOIS_DO_TURNO' }]);

  const db = prismaClient();
  const [dbComanda, dbPayments] = await Promise.all([
    db.comanda.findUniqueOrThrow({ where: { id: split.id }, select: { total: true, desconto: true, sessaoCaixaRealizacaoId: true, itens: { select: { precoUnit: true, quantidade: true, nome: true, volumeMl: true, tapId: true, opcionais: { select: { nome: true, precoAdicional: true } }, cancelamentosEntregue: { select: { quantidade: true, valorRetirado: true } } } } } }),
    db.pagamento.findMany({ where: { comandaId: { in: [split.id, pending.id, later.id] } }, orderBy: { pagoEm: 'asc' }, select: { comandaId: true, valor: true, forma: true, sessaoCaixaId: true, pagoEm: true } }),
  ]);
  expect(Number(dbComanda.total) + Number(dbComanda.desconto)).toBe(apiEspelho.subtotal);
  expect(dbComanda.sessaoCaixaRealizacaoId).toBe(session.id);
  expect(dbComanda.itens.some((item) => item.volumeMl === 500 && item.tapId === catalog.tapId && item.nome === 'Pilsen QA')).toBe(true);
  expect(dbComanda.itens.flatMap((item) => item.cancelamentosEntregue).map((item) => Number(item.valorRetirado))).toEqual([35]);
  expect(dbPayments).toHaveLength(3);
  expect(apiEspelho.pagamentos.map((payment: { valor: number }) => payment.valor)).toEqual(dbPayments.filter((row) => row.comandaId === split.id).map((row) => Number(row.valor)));
  await evidence.checkpoint();

  const denied = await tenant.staff('Espelho', []);
  expect((await denied.get(mirrorUrl(split.id))).status).toBe(403);
  const foreign = await ops.tenant();
  await foreign.seedCatalog();
  const foreignSession = await foreign.openCash(foreign.owner, 0);
  const foreignComanda = await foreign.openComanda(foreign.owner, [foreign.item('agua')], { identificador: 'Empresa externa QA' });
  await foreign.pay(foreign.owner, foreignComanda.id, [{ forma: 'PIX', valor: 5 }]);
  await foreign.closeCash();
  expect((await tenant.owner.get(mirrorUrl(foreignComanda.id, foreign.pointId, foreignSession.id))).status).toBe(404);
  expect((await tenant.owner.get(mirrorUrl(split.id, tenant.pointId, session.id + '-alterado'))).status).toBe(404);
  const otherShift = await tenant.openCash(tenant.owner, 0);
  const otherShiftComanda = await tenant.openComanda(tenant.owner, [tenant.item('agua')], { identificador: 'Outro turno QA' });
  await tenant.pay(tenant.owner, otherShiftComanda.id, [{ forma: 'PIX', valor: 5 }]);
  await tenant.closeCash();
  expect((await tenant.owner.get(mirrorUrl(otherShiftComanda.id, tenant.pointId, session.id))).status).toBe(404);
  expect((await tenant.owner.get(mirrorUrl(split.id, tenant.pointId, otherShift.id))).status).toBe(404);
  await evidence.checkpoint();

  const viewport = testInfo.project.name === 'mobile'
    ? { width: 390, height: 844 }
    : testInfo.project.name === 'desktop'
      ? { width: 1440, height: 960 }
      : testInfo.project.name === 'tablet'
        ? { width: 1180, height: 820 }
        : { width: 1920, height: 1080 };
  await page.setViewportSize(viewport);
  await loginPage(page, tenant.ownerEmail, tenant.ownerPassword);
  await page.goto(`/operacao/turnos/${session.id}`, { waitUntil: 'networkidle' });
  const urlBefore = page.url();
  const trigger = page.getByRole('button', { name: 'Ver detalhes' }).nth(0);
  await expect(trigger).toBeVisible();
  const requestMethods: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) requestMethods.push(request.method());
  });
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Pilsen QA')).toBeVisible();
  await expect(dialog.getByText('Porção QA', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Bacon QA')).toBeVisible();
  await expect(dialog.getByText('Itens cancelados (fora do total líquido)')).toBeVisible();
  await expect(dialog.getByText('Recebido neste turno').first()).toBeVisible();
  await expect(dialog.getByText(brl(53))).toBeVisible();
  await expect(dialog.getByText(brl(3))).toBeVisible();
  await expect(dialog.getByText(/Agendamento Espelho QA/)).toBeVisible();
  await expect(dialog.getByRole('button')).toHaveCount(1);
  await expect(page).toHaveURL(urlBefore);
  await evidence.screenshot(`espelho-pagamentos-divididos-${viewport.width}px`);
  const boundsBefore = await trigger.boundingBox();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent?.trim())).toBe('Ver detalhes');
  expect(page.url()).toBe(urlBefore);
  const boundsAfter = await trigger.boundingBox();
  expect(boundsAfter).toEqual(boundsBefore);

  const pendingTrigger = page.getByRole('button', { name: 'Ver detalhes' }).nth(1);
  await pendingTrigger.click();
  const pendingDialog = page.getByRole('dialog');
  await expect(pendingDialog.getByText('Sem pagamento registrado')).toBeVisible();
  await expect(pendingDialog.getByText(brl(10), { exact: true })).toHaveCount(4);
  await expect(pendingDialog.getByText('Mesa Espelho Dividida')).toHaveCount(0);
  await pendingDialog.getByRole('button', { name: 'Fechar' }).click();
  await expect(pendingDialog).not.toBeVisible();
  const manyTrigger = page.getByRole('button', { name: 'Ver detalhes' }).nth(2);
  await manyTrigger.click();
  const manyDialog = page.getByRole('dialog');
  await expect(manyDialog.getByText('Mesa Quitada Depois')).toBeVisible();
  const scrollBody = manyDialog.locator('.overflow-y-auto');
  await expect.poll(() => scrollBody.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await expect(manyDialog.getByRole('button', { name: 'Fechar' })).toBeVisible();
  await evidence.screenshot(`espelho-itens-longos-${viewport.width}px`);
  await manyDialog.getByRole('button', { name: 'Fechar' }).click();
  await expect(manyDialog).not.toBeVisible();
  expect(requestMethods.every((method) => method === 'GET')).toBe(true);
  await evidence.assertNoDbChange();
});
