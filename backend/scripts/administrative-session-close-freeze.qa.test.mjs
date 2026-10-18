import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test, after } from 'node:test';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';
import { assertReceiptInsideArtifacts } from './qa-evidence-location.mjs';

const databaseUrl = validateIsolatedQaEnvironment(process.env).toString();
assert.equal(process.env.DATABASE_URL, databaseUrl);
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(process.env.PDV_ISOLATED_QA, '1');
assert.equal(process.env.QA_DATABASE_URL, databaseUrl);
assert.equal(process.env.PDV_CANONICAL_TENANTS, undefined);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const freezeFile = path.join(repoRoot, 'artifacts/rbac-permissions-ui-2026-10-10/run-admin-freeze-20261015/qa-write-freeze.marker');
process.env.QUIVER_WRITE_FREEZE_FILE = freezeFile;
const qaUploadsDir = path.join(repoRoot, 'artifacts/rbac-permissions-ui-2026-10-10/run-admin-freeze-20261015/uploads-' + randomBytes(6).toString('hex'));
process.env.UPLOADS_DIR = qaUploadsDir;
const tenantId = 'cmsry9xrn0000hvlgopjxy0oo';
const sessionIds = [
  'cmsxnry380001hvq4mr19uwnr',
  'cmuyhu2nm00akhvekroi8onoz',
  'cmv575i7c07bmhv74pf6gvbz6',
];
const approval = JSON.parse(await readFile(path.join(repoRoot, 'backend/scripts/pdv-unico-historical-no-session-approval.json'), 'utf8'));
assert.equal(approval.approvedSnapshotSha256, '87e3a8f6aca3e878a027c485ca2e15a120ba9cc0edfc27337e3f39858165ef7a');
const paymentIds = approval.entries.filter(row => row.tenantId === tenantId).map(row => row.id).sort();
assert.equal(paymentIds.length, 147);

const { PrismaClient } = await import('@prisma/client');
const appEntry = process.env.PDV_ADMIN_FREEZE_APP_ENTRY;
const { buildApp } = appEntry
  ? await import(pathToFileURL(path.resolve(appEntry)).href)
  : await import('../src/app.ts');
const { prisma } = await import('../src/lib/prisma.ts');
const { tenantPdvActivation } = await import('../src/lib/pdv-tenant-activation.ts');
const app = await buildApp();
const suffix = randomBytes(6).toString('hex');
const ownerId = `qa-admin-close-${suffix}-owner`;
const operatorId = `qa-admin-close-${suffix}-operator`;
const passwordChangedAt = new Date();
let testServerStarted = false;

function token(userId, role) {
  return app.jwt.sign({
    sub: userId,
    email: `${userId}@example.invalid`,
    nome: 'QA session operator',
    papel: role,
    cervejariaId: tenantId,
    pwdAt: passwordChangedAt.getTime(),
  });
}

function auth(userId, role) {
  return { authorization: `Bearer ${token(userId, role)}` };
}

async function payloadDigest() {
  const rows = await prisma.pagamento.findMany({
    where: { id: { in: paymentIds } },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      comandaId: true,
      contaReceberId: true,
      sessaoCaixaId: true,
      sessaoCaixaEventoId: true,
      provenienciaHistorica: true,
      forma: true,
      valor: true,
      valorRecebido: true,
      troco: true,
      registradoPorId: true,
      pagoEm: true,
    },
  });
  assert.equal(rows.length, 147, 'all approved Thiago payments are present');
  const stable = rows.map(row => ({
    ...row,
    valor: String(row.valor),
    valorRecebido: row.valorRecebido === null ? null : String(row.valorRecebido),
    troco: row.troco === null ? null : String(row.troco),
    pagoEm: row.pagoEm.toISOString(),
  }));
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

async function stateDigest() {
  const rows = await prisma.sessaoCaixaOperacao.findMany({
    where: { id: { in: sessionIds }, cervejariaId: tenantId },
    orderBy: { id: 'asc' },
    select: {
      id: true, status: true, pontoVendaId: true, trocoInicial: true,
      fechadoPorId: true, fechadoEm: true, tipoEncerramento: true,
      contadoDinheiro: true, contadoPix: true, contadoCartaoDebito: true,
      contadoCartaoCredito: true, observacaoFechamento: true,
    },
  });
  assert.equal(rows.length, 3, 'exactly the three inventoried sessions exist');
  return rows.map(row => ({ ...row, trocoInicial: String(row.trocoInicial), fechadoEm: row.fechadoEm?.toISOString() ?? null }));
}

async function post(sessionId, userId, role, motivo = 'Regularização administrativa QA') {
  return app.inject({
    method: 'POST',
    url: `/api/operacao/caixa/sessoes/${sessionId}/encerramento-administrativo`,
    headers: auth(userId, role),
    payload: { motivo },
  });
}

async function postWithoutAuth(sessionId) {
  return app.inject({ method: 'POST', url: `/api/operacao/caixa/sessoes/${sessionId}/encerramento-administrativo`, payload: { motivo: 'Tentativa sem autorização' } });
}

after(async () => {
  if (testServerStarted) await app.close().catch(() => {});
  await rm(freezeFile, { force: true }).catch(() => {});
  await prisma.usuario.deleteMany({ where: { id: { in: [ownerId, operatorId] } } }).catch(() => {});
  await prisma.$disconnect().catch(() => {});
});

test('freeze QA + encerramento administrativo mantém pagamentos, auditoria e turno operacional', async (t) => {
  const startState = await stateDigest();
  assert.ok(startState.every(row => row.status === 'ABERTO'));
  assert.ok(startState.every(row => row.contadoDinheiro === null && row.contadoPix === null && row.contadoCartaoDebito === null && row.contadoCartaoCredito === null));
  const paymentDigestBefore = await payloadDigest();
  const movementCountBefore = await prisma.movimentoCaixaOperacao.count({ where: { sessaoId: { in: sessionIds } } });
  const owner = await prisma.usuario.create({ data: { id: ownerId, cervejariaId: tenantId, nome: 'QA owner', email: `${ownerId}@example.invalid`, senhaHash: 'unused', papel: 'DONO', passwordChangedAt } });
  await prisma.usuario.create({ data: { id: operatorId, cervejariaId: tenantId, nome: 'QA operator', email: `${operatorId}@example.invalid`, senhaHash: 'unused', papel: 'ATENDENTE', passwordChangedAt } });

  const missingAuth = await postWithoutAuth(sessionIds[0]);
  assert.equal(missingAuth.statusCode, 401, 'missing administrative authorization is refused');
  const unauthorized = await post(sessionIds[0], operatorId, 'ATENDENTE');
  assert.equal(unauthorized.statusCode, 403, 'non-owner cannot perform the operation');
  const missingReason = await post(sessionIds[0], ownerId, 'DONO', 'curto');
  assert.equal(missingReason.statusCode, 400, 'a meaningful reason is required');

  const performed = [];
  for (const sessionId of sessionIds) {
    const response = await post(sessionId, owner.id, 'DONO');
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().idempotente, false);
    performed.push(sessionId);
  }
  const auditAfterFirstPass = await prisma.transacaoLog.count({ where: { cervejariaId: tenantId, entidadeTipo: 'SessaoCaixaOperacao', entidadeId: { in: sessionIds }, tipo: 'CASH_REGISTER_ADMINISTRATIVE_CLOSED' } });
  assert.equal(auditAfterFirstPass, 3);
  const auditRows = await prisma.transacaoLog.findMany({
    where: { cervejariaId: tenantId, entidadeTipo: 'SessaoCaixaOperacao', entidadeId: { in: sessionIds }, tipo: 'CASH_REGISTER_ADMINISTRATIVE_CLOSED' },
    select: { entidadeId: true, usuarioId: true, metadata: true, createdAt: true },
  });
  assert.ok(auditRows.every(row => row.usuarioId === ownerId));
  assert.ok(auditRows.every(row => row.metadata.motivo === 'Regularização administrativa QA' && row.metadata.operadorId === ownerId && row.metadata.fechadoEm));
  assert.ok(auditRows.every(row => row.createdAt.getTime() >= Date.now() - 60_000));
  for (const sessionId of sessionIds) {
    const response = await post(sessionId, owner.id, 'DONO');
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().idempotente, true);
  }
  const auditAfterReplay = await prisma.transacaoLog.count({ where: { cervejariaId: tenantId, entidadeTipo: 'SessaoCaixaOperacao', entidadeId: { in: sessionIds }, tipo: 'CASH_REGISTER_ADMINISTRATIVE_CLOSED' } });
  assert.equal(auditAfterReplay, 3, 'idempotent replay does not duplicate audit rows');

  const finalState = await stateDigest();
  assert.ok(finalState.every(row => row.status === 'FECHADO' && row.tipoEncerramento === 'ADMINISTRATIVO'));
  assert.ok(finalState.every(row => row.fechadoPorId === ownerId && row.fechadoEm && row.observacaoFechamento === 'Regularização administrativa QA'));
  assert.ok(finalState.every(row => row.contadoDinheiro === null && row.contadoPix === null && row.contadoCartaoDebito === null && row.contadoCartaoCredito === null));
  assert.deepEqual(finalState.map(row => row.trocoInicial), startState.map(row => row.trocoInicial));
  assert.equal(await payloadDigest(), paymentDigestBefore, 'all 147 payment values and links are unchanged');
  assert.equal(await prisma.movimentoCaixaOperacao.count({ where: { sessaoId: { in: sessionIds } } }), movementCountBefore, 'no cash movement was created');

  const report = await app.inject({ method: 'GET', url: `/api/operacao/caixa/sessoes/${sessionIds[0]}`, headers: auth(ownerId, 'DONO') });
  assert.equal(report.statusCode, 200, report.body);
  assert.equal(report.json().dadosFinanceirosDisponiveis, false);
  assert.equal(report.json().vendasTotal, null, 'no sales are associated by time');
  assert.equal(report.json().caixa.tipoEncerramento, 'ADMINISTRATIVO');

  const pointId = startState[0].pontoVendaId;
  const product = await prisma.produto.findFirst({ where: { cervejariaId: tenantId, ativo: true }, select: { id: true } });
  assert.ok(product, 'a valid catalog item exists for a subsequent operational shift');
  const newShift = await app.inject({
    method: 'POST', url: '/api/operacao/caixa/abrir', headers: auth(ownerId, 'DONO'),
    payload: { pontoVendaId: pointId, trocoInicial: 100, produtoIds: [product.id] },
  });
  assert.equal(newShift.statusCode, 201, newShift.body);
  assert.equal(newShift.json().status, 'ABERTO');

  process.env.PDV_CANONICAL_TENANTS = 'cmr9yis3c0000hvu00q9fe7y1,cmsry9xrn0000hvlgopjxy0oo';
  assert.equal(tenantPdvActivation('cmr9yis3c0000hvu00q9fe7y1'), true);
  assert.equal(tenantPdvActivation(tenantId), true);
  assert.equal(tenantPdvActivation('qa-legacy-tenant'), false);
  delete process.env.PDV_CANONICAL_TENANTS;

  const beforeFreezeMovementCount = await prisma.movimentoCaixaOperacao.count({ where: { sessao: { cervejariaId: tenantId } } });
  await mkdir(path.dirname(freezeFile), { recursive: true });
  await writeFile(freezeFile, 'QA-only write freeze\n', 'utf8');
  await app.listen({ host: '127.0.0.1', port: 3107 });
  testServerStarted = true;
  const health = await fetch('http://127.0.0.1:3107/api/health');
  assert.equal(health.status, 200);
  const freezeStatus = await app.inject({ method: 'GET', url: '/api/operacao/write-freeze-status', headers: auth(ownerId, 'DONO') });
  assert.equal(freezeStatus.statusCode, 200, freezeStatus.body);
  assert.equal(freezeStatus.json().blocked, true);
  assert.equal(freezeStatus.json().inFlightWrites, 0, 'checkpoint begins only after accepted writes drain');
  const maintenanceClosure = await fetch(`http://127.0.0.1:3107/api/operacao/caixa/sessoes/${newShift.json().id}/encerramento-administrativo`, {
    method: 'POST', headers: { authorization: `Bearer ${token(ownerId, 'DONO')}`, 'content-type': 'application/json' },
    body: JSON.stringify({ motivo: 'Fechamento administrativo controlado durante freeze QA' }),
  });
  assert.equal(maintenanceClosure.status, 200, await maintenanceClosure.text());
  assert.equal((await prisma.sessaoCaixaOperacao.findUnique({ where: { id: newShift.json().id }, select: { tipoEncerramento: true, contadoDinheiro: true } })).tipoEncerramento, 'ADMINISTRATIVO');
  assert.equal((await prisma.transacaoLog.count({ where: { entidadeTipo: 'SessaoCaixaOperacao', entidadeId: newShift.json().id, tipo: 'CASH_REGISTER_ADMINISTRATIVE_CLOSED' } })), 1);
  const drainedFreezeStatus = await app.inject({ method: 'GET', url: '/api/operacao/write-freeze-status', headers: auth(ownerId, 'DONO') });
  assert.equal(drainedFreezeStatus.json().inFlightWrites, 0, 'the controlled administrative write also drains before checkpoint');
  const rejectedWrite = await fetch('http://127.0.0.1:3107/api/operacao/caixa/movimentos', {
    method: 'POST', headers: { authorization: `Bearer ${token(ownerId, 'DONO')}`, 'content-type': 'application/json' },
    body: JSON.stringify({ pontoVendaId: pointId, tipo: 'SUPRIMENTO', valor: 1 }),
  });
  assert.equal(rejectedWrite.status, 503, 'a write is refused while the API remains in read-only maintenance');
  assert.equal((await rejectedWrite.json()).code, 'WRITE_FREEZE_ACTIVE');
  assert.equal(await prisma.movimentoCaixaOperacao.count({ where: { sessao: { cervejariaId: tenantId } } }), beforeFreezeMovementCount);
  await rm(freezeFile, { force: true });
  const reopenedShift = await fetch('http://127.0.0.1:3107/api/operacao/caixa/abrir', {
    method: 'POST', headers: { authorization: `Bearer ${token(ownerId, 'DONO')}`, 'content-type': 'application/json' },
    body: JSON.stringify({ pontoVendaId: pointId, trocoInicial: 100, produtoIds: [product.id] }),
  });
  assert.equal(reopenedShift.status, 201, await reopenedShift.text());
  const resumedWrite = await fetch('http://127.0.0.1:3107/api/operacao/caixa/movimentos', {
    method: 'POST', headers: { authorization: `Bearer ${token(ownerId, 'DONO')}`, 'content-type': 'application/json' },
    body: JSON.stringify({ pontoVendaId: pointId, tipo: 'SUPRIMENTO', valor: 1 }),
  });
  assert.equal(resumedWrite.status, 201, await resumedWrite.text());
  assert.equal(await prisma.movimentoCaixaOperacao.count({ where: { sessao: { cervejariaId: tenantId } } }), beforeFreezeMovementCount + 1);
  await app.close();
  testServerStarted = false;
  await rm(qaUploadsDir, { recursive: true, force: true });

  const evidencePath = process.env.PDV_ADMIN_FREEZE_EVIDENCE;
  if (evidencePath) {
    const artifactsRoot = process.env.PDV_ADMIN_FREEZE_ARTIFACTS_ROOT ?? path.join(repoRoot, 'artifacts');
    const resolved = assertReceiptInsideArtifacts(evidencePath, artifactsRoot);
    await mkdir(path.dirname(resolved), { recursive: true });
    await writeFile(resolved, JSON.stringify({
      status: 'PASS', qaOnly: true, candidateBase: '08c1eddf0a9b15246b4d8802b2f330919ae4972f',
      backupSha256: '3ba54e26d9d5b7042e65695217eae396d1c7d291c87aed48f024d5963386cd3e',
      paymentCount: 147, paymentDigestSha256: paymentDigestBefore,
      sessionIds, sessionsBefore: startState, sessionsAfter: finalState,
      authorization: 'non-owner denied; reason required', idempotency: 'PASS',
      financialSideEffects: { paymentValuesAndLinksUnchanged: true, movementCountUnchanged: true, countFieldsRemainNull: true, reportsDoNotInferByTime: true },
      nextOperationalShift: 'PASS before and after the controlled maintenance closure',
      activation: { thiago: true, ciaMaritima: true, otherTenants: 'LEGACY' },
      writeFreeze: { frozenWriteHttp: 503, administrativeClosureDuringFreeze: maintenanceClosure.status, inFlightAtCheckpoint: drainedFreezeStatus.json().inFlightWrites, resumeWriteHttp: resumedWrite.status },
      completedAt: new Date().toISOString(),
    }, null, 2) + '\n', 'utf8');
  }
  t.diagnostic(`paymentDigestSha256=${paymentDigestBefore}; sessions=${performed.join(',')}; freeze=write-refused`);
});
