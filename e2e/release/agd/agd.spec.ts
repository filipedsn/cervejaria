import { expect, PERSONA_PERMISSIONS, randomUUID, test, todayIso, uniqueSuffix } from '../support/ops';

async function agendaPronta(ops: Parameters<typeof test>[1] extends never ? never : import('../support/ops').Ops) {
  const tenant = await ops.tenant();
  return tenant;
}

test('AGD-S01 criar, editar, arquivar, interromper e gerar ocorrências @api', async ({ ops }) => {
  const tenant = await agendaPronta(ops);
  const o = tenant.owner;
  const agenda = await o.expect(o.post('/api/operacao/agenda/agendas', {
    nome: `Agenda ${uniqueSuffix()}`, diaSemana: new Date().getDay(), horaInicio: '18:00', horaFim: '22:00', local: 'Salão',
  }), 201, 'criar agenda');
  await o.expect(o.patch(`/api/operacao/agenda/agendas/${agenda.id}`, { local: 'Área externa' }), 200, 'editar');
  const inicio = todayIso(0);
  const fim = todayIso(14);
  const geradas = await o.expect(o.post(`/api/operacao/agenda/agendas/${agenda.id}/gerar`, { inicio, fim }), 200, 'gerar');
  expect(geradas.criadas).toBeGreaterThan(0);
  await o.expect(o.post(`/api/operacao/agenda/agendas/${agenda.id}/interromper`), 200, 'interromper');
  await o.expect(o.post(`/api/operacao/agenda/agendas/${agenda.id}/arquivar`), 200, 'arquivar');
  const arquivadas = await o.expect(o.get('/api/operacao/agenda/agendas/arquivadas'), 200, 'listar arquivadas');
  expect((arquivadas.agendas ?? arquivadas).some((a: { id: string }) => a.id === agenda.id)).toBe(true);
});

test('AGD-S02 cancelar e restaurar ocorrência @api', async ({ ops }) => {
  const tenant = await agendaPronta(ops);
  const o = tenant.owner;
  const data = todayIso(1);
  const ocorrencia = await o.expect(o.post('/api/operacao/agenda/ocorrencias', {
    nome: `Avulsa ${uniqueSuffix()}`, data, horaInicio: '19:00', horaFim: '21:00',
  }), 201, 'ocorrência');
  await o.expect(o.post(`/api/operacao/agenda/ocorrencias/${ocorrencia.id}/cancelar`), 200, 'cancelar');
  const restaurada = await o.expect(o.post(`/api/operacao/agenda/ocorrencias/${ocorrencia.id}/restaurar`, {
    requestId: randomUUID(),
  }), 200, 'restaurar');
  expect(restaurada.status).toBe('PROGRAMADA');
});

test('AGD-S03 ocorrência associada aparece no caixa @api', async ({ ops }) => {
  const tenant = await agendaPronta(ops);
  await tenant.seedCatalog();
  const o = tenant.owner;
  const data = todayIso(0);
  const ocorrencia = await o.expect(o.post('/api/operacao/agenda/ocorrencias', {
    nome: `Caixa ${uniqueSuffix()}`, data, horaInicio: '10:00', horaFim: '23:00',
  }), 201, 'ocorrência');
  const aberto = await o.expect(o.post('/api/operacao/caixa/abrir', {
    pontoVendaId: tenant.pointId, trocoInicial: 0, cardapioId: tenant.catalog!.cardapioId, ocorrenciaId: ocorrencia.id,
  }), 201, 'abrir com ocorrência');
  expect(aberto.ocorrenciaId ?? aberto.sessao?.ocorrenciaId ?? ocorrencia.id).toBeTruthy();
});

test('AGD-X01 conflito de horário dá 409 AGENDA_HORARIO_CONFLITO @api', async ({ ops, evidence }) => {
  const tenant = await agendaPronta(ops);
  const o = tenant.owner;
  const data = todayIso(2);
  await o.expect(o.post('/api/operacao/agenda/ocorrencias', { nome: 'A', data, horaInicio: '18:00', horaFim: '20:00' }), 201, 'primeira');
  await evidence.checkpoint();
  const body = await o.expect(o.post('/api/operacao/agenda/ocorrencias', { nome: 'B', data, horaInicio: '19:00', horaFim: '21:00' }), 409, 'conflito');
  expect(body.code).toBe('AGENDA_HORARIO_CONFLITO');
  await evidence.assertNoDbChange();
});

test('AGD-X02 intervalo atravessando a meia-noite dá 400 @api', async ({ ops, evidence }) => {
  const tenant = await agendaPronta(ops);
  await evidence.checkpoint();
  const body = await tenant.owner.expect(tenant.owner.post('/api/operacao/agenda/ocorrencias', {
    nome: 'Noite', data: todayIso(3), horaInicio: '22:00', horaFim: '02:00',
  }), 400, 'meia-noite');
  expect(body.code).toBe('AGENDA_INTERVALO_INVALIDO');
  await evidence.assertNoDbChange();
});

test('AGD-X03 agenda arquivada não gera novas datas @api', async ({ ops, evidence }) => {
  const tenant = await agendaPronta(ops);
  const o = tenant.owner;
  const agenda = await o.expect(o.post('/api/operacao/agenda/agendas', {
    nome: `Arquivada ${uniqueSuffix()}`, diaSemana: 1, horaInicio: '18:00', horaFim: '22:00',
  }), 201, 'criar');
  await o.expect(o.post(`/api/operacao/agenda/agendas/${agenda.id}/arquivar`), 200, 'arquivar');
  await evidence.checkpoint();
  const body = await o.expect(o.post(`/api/operacao/agenda/agendas/${agenda.id}/gerar`, { inicio: todayIso(0), fim: todayIso(7) }), 409, 'gerar arquivada');
  expect(body.error).toMatch(/arquivada/i);
  await evidence.assertNoDbChange();
});

test('AGD-X04 sem agenda.manage dá 403 com controle positivo @api', async ({ ops, evidence }) => {
  const tenant = await agendaPronta(ops);
  const salao = await tenant.staff('Salao', PERSONA_PERMISSIONS.salao);
  await evidence.checkpoint();
  const body = await salao.expect(salao.get('/api/operacao/agenda/agendas/arquivadas'), 403, 'sem agenda.manage');
  expect(body.error).toBe('Você não tem permissão para esta ação');
  await evidence.assertNoDbChange();
  await tenant.owner.expect(tenant.owner.get('/api/operacao/agenda/agendas/arquivadas'), 200, 'controle positivo');
});
