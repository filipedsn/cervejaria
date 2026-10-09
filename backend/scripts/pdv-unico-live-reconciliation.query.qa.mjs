import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';
import { verifyMigratorRunIdentity } from './pdv-unico-migrator-evidence.mjs';
import { expectedMigratedPaymentSessionReferences } from './pdv-unico-payment-session-evidence.mjs';

validateIsolatedQaEnvironment(process.env);
const clientDir = path.resolve(process.env.PDV_QA_PRISMA_CLIENT ?? '');
const { PrismaClient } = await import(pathToFileURL(path.join(clientDir, 'index.js')).href);
const db = new PrismaClient({ datasources: { db: { url: process.env.QA_DATABASE_URL } } });
const suffix = `recon-${process.env.PDV_QA_RUN_ID ?? Date.now()}`;
const created = [];
try {
  const selected = await db.cervejaria.create({ data: { nome: 'Recon QA selected', slug: `${suffix}-selected` } }); created.push(selected.id);
  const other = await db.cervejaria.create({ data: { nome: 'Recon QA other', slug: `${suffix}-other` } }); created.push(other.id);
  const trailer = await db.trailer.create({ data: { nome: 'Recon QA trailer', cervejariaId: selected.id } });
  const event = await db.evento.create({ data: { nome: 'Recon EVENTO without original PDV', local: 'QA', cervejariaId: selected.id, trailerId: trailer.id } });
  const point = await db.pontoVenda.create({ data: { nome: 'Recon CAIXA', cervejariaId: selected.id } });
  const foreignPoint = await db.pontoVenda.create({ data: { nome: 'Recon foreign', cervejariaId: other.id } });
  const eventCommand = await db.comanda.create({ data: { origem: 'EVENTO', eventoId: event.id } });
  const cashCommand = await db.comanda.create({ data: { origem: 'CAIXA', pontoVendaId: point.id } });
  const foreignCommand = await db.comanda.create({ data: { origem: 'CAIXA', pontoVendaId: foreignPoint.id } });
  const paymentRows = await Promise.all([eventCommand, cashCommand, foreignCommand].map((comanda) => db.pagamento.create({ data: { comandaId: comanda.id, forma: 'DINHEIRO', valor: '1.00' } })));
  const tenantIds = [selected.id];
  const result = await db.pagamento.findMany({
    where: { OR: [
      { comanda: { evento: { is: { cervejariaId: { in: tenantIds } } } } },
      { comanda: { pontoVenda: { is: { cervejariaId: { in: tenantIds } } } } },
      { comanda: { cliente: { is: { cervejariaId: { in: tenantIds } } } } },
    ] },
    include: { comanda: { select: { id: true, origem: true, eventoId: true, pontoVendaId: true, clienteId: true,
      evento: { select: { cervejariaId: true } }, pontoVenda: { select: { cervejariaId: true } }, cliente: { select: { cervejariaId: true } } } } },
    orderBy: { id: 'asc' },
  });
  assert.deepEqual(new Set(result.map(({ id }) => id)), new Set(paymentRows.slice(0, 2).map(({ id }) => id)), 'real Prisma tenant query includes selected EVENTO with null PDV and selected CAIXA, while isolating other tenant');
  const eventResult = result.find(({ id }) => id === paymentRows[0].id);
  const cashResult = result.find(({ id }) => id === paymentRows[1].id);
  assert.equal(eventResult.comanda.evento.cervejariaId, selected.id);
  assert.equal(eventResult.comanda.pontoVenda, null, 'EVENTO case has no original PDV');
  assert.equal(cashResult.comanda.pontoVenda.cervejariaId, selected.id);
  assert.equal(result.some(({ id }) => id === paymentRows[2].id), false, 'foreign tenant payment is excluded');
  const checkpointBackedBusinessRun = { id: 'run-business', scope: null, cervejariaId: null, pontoVendaId: null, status: 'COMPLETED', checkpoint: { scope: 'PDV_AGENDA_OCORRENCIA_V1', companyId: selected.id } };
  assert.equal(verifyMigratorRunIdentity(checkpointBackedBusinessRun, { runId: 'run-business', scope: 'PDV_AGENDA_OCORRENCIA_V1', tenantId: selected.id }, [selected.id, other.id]).status, 'PASS');
  const contradictoryRun = { ...checkpointBackedBusinessRun, cervejariaId: other.id };
  assert.equal(verifyMigratorRunIdentity(contradictoryRun, { runId: 'run-business', scope: 'PDV_AGENDA_OCORRENCIA_V1', tenantId: selected.id }, [selected.id, other.id]).code, 'MIGRATOR_EVIDENCE_CONTRADICTORY');
  const tapRun = { id: 'run-tap', scope: `PDV_TAP_OWNERSHIP_V2:${selected.id}:${point.id}`, cervejariaId: selected.id, pontoVendaId: point.id, status: 'COMPLETED', checkpoint: { scope: `PDV_TAP_OWNERSHIP_V2:${selected.id}:${point.id}`, companyId: selected.id, pointId: point.id } };
  assert.equal(verifyMigratorRunIdentity(tapRun, { runId: 'run-tap', scope: 'PDV_TAP_OWNERSHIP_V2', tenantId: selected.id }, [selected.id, other.id]).status, 'PASS');
  assert.equal(verifyMigratorRunIdentity({ ...tapRun, scope: `PDV_TAP_OWNERSHIP_V2:${selected.id}:${foreignPoint.id}` }, { runId: 'run-tap', scope: 'PDV_TAP_OWNERSHIP_V2', tenantId: selected.id }, [selected.id, other.id]).code, 'MIGRATOR_EVIDENCE_CONTRADICTORY');
  assert.deepEqual(expectedMigratedPaymentSessionReferences({ sessionRefs: { operationalId: null, eventId: 'event-session-source' } }), { operationalId: 'event-session-source', eventId: 'event-session-source' });
  assert.deepEqual(expectedMigratedPaymentSessionReferences({ classification: 'C_NO_SESSION_PROVENANCE_INSUFFICIENT', sessionRefs: { operationalId: null, eventId: null } }), { operationalId: null, eventId: null });
  process.stdout.write(`${JSON.stringify({ status: 'PASS', schemaClient: clientDir, cases: ['EVENTO sem PDV original', 'CAIXA por PontoVenda', 'isolamento de tenant', 'business run tenant/scope from checkpoint', 'contradictory direct and checkpoint ownership blocked', 'scoped tap run exact tenant and point', 'contradictory tap scope and point blocked', 'EVENTO session maps exact source ID to operational ID', 'unproven class-C payment sessions remain null'], rowsSelected: result.length, rowsForeign: 1 })}\n`);
} finally {
  await db.$disconnect();
  // The enclosing database is disposable tmpfs; no cross-run fixture survives.
}
