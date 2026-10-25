import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { logs } from '@opentelemetry/api-logs';
import { LoggerProvider, SimpleLogRecordProcessor, InMemoryLogRecordExporter } from '@opentelemetry/sdk-logs';
import { observePrismaClient } from '../src/lib/observed-prisma.js';
import { runWithTelemetryContext } from '../src/lib/telemetry-context.js';
import { emitAuditEvent } from '../src/lib/audit/emit-audit-event.js';
import { registrarTransacao } from '../src/lib/transacao-log.js';

test('real PostgreSQL commits, rollback, batch PrismaPromises and tenant isolation', async () => {
  assert.equal(process.env.PDV_ISOLATED_QA, '1');
  const url = new URL(process.env.QA_DATABASE_URL!);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.pathname, '/cervejaria_qa_pdv_unico');
  assert.ok(Number(url.port) >= 55439 && Number(url.port) <= 55449);
  const exporter = new InMemoryLogRecordExporter();
  const provider = new LoggerProvider({ processors: [new SimpleLogRecordProcessor({ exporter })] });
  logs.setGlobalLoggerProvider(provider);
  const base = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const db = observePrismaClient(base);
  const records = () => exporter.getFinishedLogRecords().map(record => record.attributes);
  const context = (tenant: string) => ({
    slug: tenant, cervejariaId: tenant, env: 'dev' as const,
    actor: { type: 'usuario' as const, id: `operator-${tenant}`, role: 'DONO' },
    correlationId: tenant, interactionId: '123e4567-e89b-42d3-a456-426614174010',
  });
  try {
    await runWithTelemetryContext(context('tenant-a'), () => db.$transaction(async tx => {
      await tx.cervejaria.create({ data: { id: 'tenant-a', nome: 'Synthetic', slug: 'tenant-a' } });
      emitAuditEvent({ action: 'test.business.saved', message: 'Synthetic save' });
      await registrarTransacao({ cervejariaId: 'tenant-a', tipo: 'EVENTO_ATUALIZADO', entidadeTipo: 'synthetic', entidadeId: 'entity-a', metadata: { clienteNome: 'private-person' } }, tx);
      assert.equal(records().length, 0, 'no write or business success before commit');
    }));
    assert.equal(await base.cervejaria.count(), 1);
    assert.ok(records().some(r => r['event.action'] === 'db.write.completed' && r['db.transaction.state'] === 'committed'));
    assert.ok(records().some(r => r['event.action'] === 'test.business.saved'));
    assert.ok(records().some(r => r['event.action'] === 'transacao.evento_atualizado' && r['db.transaction.state'] === 'committed'));
    assert.equal(await base.transacaoLog.count(), 1);
    exporter.reset();
    await assert.rejects(runWithTelemetryContext(context('tenant-b'), () => db.$transaction(async tx => {
      await tx.cervejaria.create({ data: { id: 'tenant-b', nome: 'Synthetic', slug: 'tenant-b' } });
      emitAuditEvent({ action: 'test.false.success', message: 'Must never be published' });
      await registrarTransacao({ cervejariaId: 'tenant-b', tipo: 'EVENTO_ATUALIZADO' }, tx);
      throw new Error('intentional rollback');
    })), /intentional rollback/);
    assert.equal(await base.cervejaria.count(), 1);
    assert.equal(await base.transacaoLog.count(), 1);
    assert.equal(records().some(r => r['event.action'] === 'db.write.completed' || r['event.action'] === 'test.false.success' || r['event.action'] === 'transacao.evento_atualizado'), false);
    assert.ok(records().some(r => r['event.action'] === 'db.transaction.rolled_back'));
    exporter.reset();
    await runWithTelemetryContext(context('tenant-a'), () => db.$transaction([
      db.cervejaria.update({ where: { id: 'tenant-a' }, data: { ativo: false } }),
      db.cervejaria.update({ where: { id: 'tenant-a' }, data: { ativo: true } }),
    ]));
    assert.equal(records().filter(r => r['event.action'] === 'db.write.completed').length, 2);
    exporter.reset();
    await assert.rejects(runWithTelemetryContext(context('tenant-a'), () => db.$transaction([
      db.cervejaria.update({ where: { id: 'tenant-a' }, data: { ativo: false } }),
      db.cervejaria.update({ where: { id: 'missing' }, data: { ativo: true } }),
    ])));
    assert.equal((await base.cervejaria.findUniqueOrThrow({ where: { id: 'tenant-a' } })).ativo, true);
    assert.equal(records().some(r => r['event.action'] === 'db.write.completed'), false);
    exporter.reset();
    await Promise.all(['tenant-a', 'tenant-c'].map(tenant => runWithTelemetryContext(context(tenant), () => db.$transaction(async tx => {
      await tx.cervejaria.upsert({ where: { id: tenant }, create: { id: tenant, nome: 'Synthetic', slug: tenant }, update: { ativo: true } });
    }))));
    const receipts = records().filter(r => r['event.action'] === 'db.write.completed');
    assert.equal(receipts.length, 2);
    for (const receipt of receipts) {
      assert.equal(receipt['actor.id'], `operator-${receipt['cervejaria.id']}`);
      assert.equal(receipt['entity.id'], receipt['cervejaria.id']);
      assert.equal(receipt['db.transaction.state'], 'committed');
      assert.ok(receipt['event.id']);
    }
    assert.doesNotMatch(JSON.stringify(records()), /postgresql:|Synthetic|senha|password/);
  } finally {
    await base.$disconnect();
    logs.disable();
    await provider.shutdown();
  }
});
