import { prismaClient } from '../support/fixtures';
import { expect, loginPage, randomUUID, test, uniquePhone } from '../support/ops';

test('DSH-S11 lista paginada reconcilia 99 vendas e separa dívidas anteriores', async ({ ops, page, evidence }, testInfo) => {
  const tenant = await ops.tenant();
  await tenant.seedCatalog();
  const db = prismaClient();

  const sessionA = await tenant.openCash(tenant.owner, 0);
  const previousDebt = await tenant.openComanda(tenant.owner, [tenant.item('agua')], {
    identificador: 'Dívida de turno anterior QA',
    clienteNome: 'Cliente dívida anterior QA',
    clienteTelefone: uniquePhone(),
  });
  expect((await tenant.pay(tenant.owner, previousDebt.id, [], true)).status).toBe(200);
  await tenant.closeCash();
  const sessionARecord = await db.sessaoCaixaOperacao.findUniqueOrThrow({ where: { id: sessionA.id } });

  const sessionB = await tenant.openCash(tenant.owner, 0);
  const contas = await tenant.owner.expect(tenant.owner.get('/api/operacao/contas-pendentes'), 200, 'dívida do turno anterior');
  const contaAnterior = contas.find((conta: { comanda: { id: string } }) => conta.comanda.id === previousDebt.id);
  expect(contaAnterior).toBeTruthy();
  await tenant.owner.expect(tenant.owner.post(`/api/operacao/contas-pendentes/${contaAnterior.id}/pagamentos`, {
    pontoVendaId: tenant.pointId,
    pagamentos: [{ forma: 'PIX', valor: 5 }],
  }), 200, 'receber dívida anterior no segundo turno');
  await tenant.closeCash();
  const sessionBRecord = await db.sessaoCaixaOperacao.findUniqueOrThrow({ where: { id: sessionB.id } });
  if (sessionARecord.diaOperacional.getTime() !== sessionBRecord.diaOperacional.getTime()) {
    await db.sessaoCaixaOperacao.update({ where: { id: sessionA.id }, data: { diaOperacional: sessionBRecord.diaOperacional } });
  }

  const closedAt = new Date(sessionBRecord.fechadoEm!.getTime() - 500);
  const openAt = sessionBRecord.abertoEm;
  const duration = Math.max(1, closedAt.getTime() - openAt.getTime());
  const historicalRows = Array.from({ length: 99 }, (_, index) => {
    const type = index < 70 ? 'APELIDO' as const : 'AVULSA' as const;
    const total = index < 70 ? (index === 0 ? 64 : 63) : 67;
    const createdAt = new Date(openAt.getTime() + Math.floor(duration * (index + 1) / 100));
    const fechadaEm = new Date(openAt.getTime() + Math.floor(duration * (index + 1) / 100));
    return {
      id: randomUUID(),
      origem: 'CAIXA' as const,
      pontoVendaId: tenant.pointId,
      sessaoCaixaRealizacaoId: index < 5 ? sessionB.id : null,
      diaOperacional: sessionBRecord.diaOperacional,
      tipo: type,
      identificador: `Histórico paginado ${String(index + 1).padStart(3, '0')}`,
      status: 'FECHADA' as const,
      total,
      desconto: 0,
      createdAt,
      fechadaEm,
    };
  });
  await db.comanda.createMany({ data: historicalRows });
  const migrationRun = await db.pdvMigrationRun.create({
    data: { cervejariaId: tenant.id, pontoVendaId: tenant.pointId, status: 'COMPLETED', transformVersion: 1, sourceSnapshotHash: 'TAP122_DISPOSABLE_FIXTURE' },
  });
  await db.pdvMigrationMap.createMany({
    data: historicalRows.map((row, index) => ({
      sourceType: 'COMANDA', sourceId: `TAP122-${row.id}`, destinationType: 'COMANDA', destinationId: row.id,
      cervejariaId: tenant.id, pontoVendaId: tenant.pointId, transformVersion: 1, payloadHash: 'TAP122_DISPOSABLE_FIXTURE',
      lastRunId: migrationRun.id,
      sourcePayload: { tipo: row.tipo, diaOperacional: row.diaOperacional.toISOString(), fechadaEm: row.fechadaEm.toISOString(), ...(index < 5 ? { sessaoCaixaRealizacaoId: sessionB.id } : {}) },
    })),
  });
  const cancelledCommand = await db.comanda.create({
    data: {
      origem: 'CAIXA', pontoVendaId: tenant.pointId, sessaoCaixaRealizacaoId: sessionB.id,
      diaOperacional: sessionBRecord.diaOperacional, tipo: 'APELIDO', identificador: 'Comanda cancelada com vínculo QA',
      status: 'CANCELADA', total: 0, desconto: 0, createdAt: new Date(closedAt.getTime() - 100),
    },
  });
  const expectedIds = await db.comanda.findMany({
    where: {
      origem: 'CAIXA', pontoVendaId: tenant.pointId, status: 'FECHADA',
      OR: [
        { sessaoCaixaRealizacaoId: sessionB.id },
        { AND: [{ sessaoCaixaRealizacaoId: null }, { diaOperacional: sessionBRecord.diaOperacional }, { fechadaEm: { gte: sessionBRecord.abertoEm, lte: sessionBRecord.fechadoEm! } }] },
      ],
    },
    select: { id: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  expect(expectedIds).toHaveLength(99);
  expect(new Set(expectedIds.map((row) => row.id)).size).toBe(99);
  const migrationMaps = await db.pdvMigrationMap.findMany({ where: { destinationType: 'COMANDA', destinationId: { in: expectedIds.map((row) => row.id) } }, select: { destinationId: true, sourcePayload: true } });
  expect(migrationMaps).toHaveLength(99);
  expect(migrationMaps.filter((row) => Boolean((row.sourcePayload as Record<string, unknown>)?.sessaoCaixaRealizacaoId))).toHaveLength(5);

  const pageUrl = (sessionId: string, pageNumber: number, tipo = 'TODOS') =>
    `/api/operacao/caixa/sessoes/${sessionId}/comandas?${new URLSearchParams({ page: String(pageNumber), pageSize: '25', tipo })}`;
  const report = await tenant.owner.expect(tenant.owner.get(`/api/operacao/caixa/sessoes/${sessionB.id}`), 200, 'resumo do segundo turno');
  expect(report).toMatchObject({ comandasAtendidas: 70, vendasAvulsas: 29, registrosVenda: 99, comandasComVinculoSessao: 5, historicasSemVinculo: 94, comandasCanceladas: 1 });
  expect(report.ticketMedio).toBeCloseTo(report.vendasTotal / 99, 2);
  const pages = [];
  for (let pageNumber = 1; pageNumber <= 4; pageNumber += 1) {
    pages.push(await tenant.owner.expect(tenant.owner.get(pageUrl(sessionB.id, pageNumber)), 200, `página ${pageNumber}`));
  }
  expect(pages.map((entry: { dados: unknown[] }) => entry.dados.length)).toEqual([25, 25, 25, 25]);
  expect(pages[0].escopo).toMatchObject({ totalRegistros: 100, registrosDeVenda: 99, comandas: 70, vendasAvulsas: 29, comandasCanceladas: 1, vinculoConfirmado: 6, semVinculoConfiavel: 94 });
  const apiIds = pages.flatMap((entry: { dados: Array<{ id: string }> }) => entry.dados.map((row) => row.id));
  expect(apiIds).toHaveLength(100);
  expect(new Set(apiIds).size).toBe(100);
  expect(new Set(apiIds)).toEqual(new Set([...expectedIds.map((row) => row.id), cancelledCommand.id]));
  expect((await tenant.owner.expect(tenant.owner.get(pageUrl(sessionB.id, 1, 'COMANDAS')), 200, 'filtro comandas')).paginacao.totalFiltrado).toBe(70);
  expect((await tenant.owner.expect(tenant.owner.get(pageUrl(sessionB.id, 1, 'AVULSAS')), 200, 'filtro avulsas')).paginacao.totalFiltrado).toBe(29);
  const canceladas = await tenant.owner.expect(tenant.owner.get(pageUrl(sessionB.id, 1, 'CANCELADAS')), 200, 'filtro canceladas');
  expect(canceladas.paginacao.totalFiltrado).toBe(1);
  expect(canceladas.dados.map((row: { id: string }) => row.id)).toEqual([cancelledCommand.id]);

  const oldReceipts = await tenant.owner.expect(tenant.owner.get(`/api/operacao/caixa/sessoes/${sessionB.id}/recebimentos-anteriores`), 200, 'recebimento de dívida anterior');
  expect(oldReceipts).toHaveLength(1);
  expect(oldReceipts[0]).toMatchObject({ comanda: { id: previousDebt.id, sessaoOrigemId: sessionA.id }, recebidoNesteTurno: 5 });
  expect(new Set(apiIds).has(previousDebt.id)).toBe(false);
  const dbPayment = await db.pagamento.findFirstOrThrow({ where: { comandaId: previousDebt.id, sessaoCaixaId: sessionB.id }, select: { forma: true, valor: true, contaReceberId: true } });
  expect(dbPayment).toMatchObject({ forma: 'PIX', contaReceberId: expect.any(String) });
  expect(Number(dbPayment.valor)).toBe(5);

  const sessionAList = await tenant.owner.expect(tenant.owner.get(pageUrl(sessionA.id, 1)), 200, 'primeiro turno do mesmo dia');
  expect(sessionAList.dados.some((row: { id: string }) => apiIds.includes(row.id))).toBe(false);
  const noReadPermission = await tenant.staff('SemLeituraTurno', []);
  expect((await noReadPermission.get(pageUrl(sessionB.id, 1))).status).toBe(403);
  const foreign = await ops.tenant();
  await foreign.seedCatalog();
  expect((await foreign.owner.get(pageUrl(sessionB.id, 1))).status).toBe(404);
  expect((await tenant.owner.get(pageUrl(sessionB.id + '-alterado', 1))).status).toBe(404);

  await evidence.checkpoint();
  const viewport = testInfo.project.name === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 960 };
  await page.setViewportSize(viewport);
  await loginPage(page, tenant.ownerEmail, tenant.ownerPassword);
  await page.goto(`/operacao/turnos/${sessionB.id}`, { waitUntil: 'networkidle' });
  await expect(page.getByText('99 registros de venda no escopo histórico: 70 comandas + 29 vendas avulsas; 1 comanda(s) cancelada(s).')).toBeVisible();
  await expect(page.getByTestId('turno-comandas-lista').locator('[data-command-id]', {})).toHaveCount(25);
  const renderedIds: string[] = [];
  const unchangedUrl = page.url();
  for (let pageNumber = 1; pageNumber <= 4; pageNumber += 1) {
    await expect(page.getByTestId('turno-comandas-paginacao')).toContainText(`Exibindo ${(pageNumber - 1) * 25 + 1}–${Math.min(pageNumber * 25, 100)} de 100`);
    renderedIds.push(...await page.getByTestId('turno-comandas-lista').locator('[data-command-id]', {}).evaluateAll((elements) => elements.map((element) => element.getAttribute('data-command-id')!)));
    if (pageNumber < 4) await page.getByRole('button', { name: 'Próxima' }).click();
  }
  expect(renderedIds).toHaveLength(100);
  expect(new Set(renderedIds).size).toBe(100);
  expect(new Set(renderedIds)).toEqual(new Set([...expectedIds.map((row) => row.id), cancelledCommand.id]));
  await expect(page.getByRole('button', { name: 'Próxima' })).toBeDisabled();
  await page.getByRole('button', { name: /Vendas avulsas \(29\)/ }).click();
  await expect(page.getByTestId('turno-comandas-paginacao')).toContainText('Exibindo 1–25 de 29');
  await expect(page.getByTestId('turno-comandas-lista').locator('[data-command-id]', {})).toHaveCount(25);
  await page.getByRole('button', { name: 'Próxima' }).click();
  await expect(page.getByTestId('turno-comandas-lista').locator('[data-command-id]', {})).toHaveCount(4);
  await expect(page.getByTestId('turno-comandas-paginacao')).toContainText('Filtro ativo: vendas avulsas');

  const lastAvulsa = page.getByTestId('turno-comandas-lista').locator('[data-command-id]', {}).last();
  await lastAvulsa.scrollIntoViewIfNeeded();
  const selectedId = await lastAvulsa.getAttribute('data-command-id');
  const selectedLabel = await lastAvulsa.locator('p').first().innerText();
  const closeTrigger = lastAvulsa.getByRole('button', { name: 'Ver detalhes' });
  const scrollBefore = await page.evaluate(() => window.scrollY);
  const boundsBefore = await closeTrigger.boundingBox();
  const requestMethods: string[] = [];
  page.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/api/')) requestMethods.push(request.method()); });
  await closeTrigger.click();
  const mirror = page.getByRole('dialog');
  await expect(mirror).toBeVisible();
  await expect(mirror.getByRole('heading', { name: selectedLabel })).toBeVisible();
  await expect(mirror.getByRole('button')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(mirror).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent?.trim())).toBe('Ver detalhes');
  expect(page.url()).toBe(unchangedUrl);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  expect(await page.getByTestId('turno-comandas-paginacao').innerText()).toContain('Filtro ativo: vendas avulsas');
  const boundsAfter = await page.getByTestId('turno-comandas-lista').locator(`[data-command-id="${selectedId}"]`, {}).getByRole('button', { name: 'Ver detalhes' }).boundingBox();
  expect(boundsAfter).toEqual(boundsBefore);

  await page.getByRole('button', { name: /Canceladas \(1\)/ }).click();
  const cancelledRow = page.getByTestId('turno-comandas-lista').locator(`[data-command-id="${cancelledCommand.id}"]`, {});
  await cancelledRow.getByRole('button', { name: 'Ver detalhes' }).click();
  const cancelledMirror = page.getByRole('dialog');
  await expect(cancelledMirror.getByText(/Comanda cancelada com vínculo explícito/)).toBeVisible();
  await expect(cancelledMirror.getByRole('button')).toHaveCount(1);
  await cancelledMirror.getByRole('button', { name: 'Fechar' }).click();
  await expect(cancelledMirror).not.toBeVisible();

  const olderRow = page.getByTestId('turno-recebimentos-anteriores').locator(`[data-command-id="${previousDebt.id}"]`, {});
  await expect(olderRow).toBeVisible();
  await olderRow.getByRole('button', { name: 'Ver detalhes' }).click();
  const oldMirror = page.getByRole('dialog');
  await expect(oldMirror.getByText(/não a transforma em venda originada neste caixa/)).toBeVisible();
  await expect(oldMirror.getByText('Recebido neste turno').first()).toBeVisible();
  await oldMirror.getByRole('button', { name: 'Fechar' }).click();
  await expect(oldMirror).not.toBeVisible();
  expect(requestMethods.every((method) => method === 'GET')).toBe(true);
  await evidence.assertNoDbChange();
  await evidence.screenshot(`lista-paginada-${viewport.width}px`);
});
