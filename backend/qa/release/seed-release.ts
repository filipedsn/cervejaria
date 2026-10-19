import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../../src/lib/utils.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || databaseUrl !== process.env.QA_DATABASE_URL || process.env.PDV_ISOLATED_QA !== '1') {
  throw new Error('Release seed requires identical isolated QA database URLs.');
}
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const runId = process.env.PDV_QA_RUN_ID;
const outputPath = process.env.RELEASE_QA_CONTEXT;
if (!runId || !outputPath) throw new Error('Release seed requires PDV_QA_RUN_ID and RELEASE_QA_CONTEXT.');

const tenants = [
  { id: 'cmr9yis3c0000hvu00q9fe7y1', slug: `release-a-${runId}`, nome: 'Release QA Empresa A' },
  { id: 'cmsry9xrn0000hvlgopjxy0oo', slug: `release-b-${runId}`, nome: 'Release QA Empresa B' },
];
const eventIds: Record<string, string> = {};
const pointIds: Record<string, string> = {};
const trailerIds: Record<string, string> = {};
const password = `Qa-${randomBytes(24).toString('base64url')}-!`;
const users = [
  { key: 'owner', nome: 'Dono QA', email: `owner-${runId}@example.invalid`, papel: 'DONO' as const, cervejariaIndex: 0, permissions: [] },
  { key: 'ownerB', nome: 'Dono QA B', email: `owner-b-${runId}@example.invalid`, papel: 'DONO' as const, cervejariaIndex: 1, permissions: [] },
  { key: 'cashier', nome: 'Caixa QA', email: `cashier-${runId}@example.invalid`, papel: 'ATENDENTE' as const, cervejariaIndex: 0, permissions: ['cash.open', 'cash.close', 'command.read', 'command.operate', 'command.close', 'payment.receive', 'debt.receive', 'discount.apply'] },
  { key: 'kitchen', nome: 'Cozinha QA', email: `kitchen-${runId}@example.invalid`, papel: 'ATENDENTE' as const, cervejariaIndex: 0, permissions: ['kitchen.read', 'kitchen.operate'] },
  { key: 'staffB', nome: 'Atendente QA B', email: `staff-b-${runId}@example.invalid`, papel: 'ATENDENTE' as const, cervejariaIndex: 1, permissions: [] },
];

try {
  for (const tenant of tenants) {
    await prisma.cervejaria.create({ data: { id: tenant.id, slug: tenant.slug, nome: tenant.nome, ativo: true, usaCardapio: true } });
    await prisma.configuracaoOperacional.create({ data: {
      cervejariaId: tenant.id, setupCompletedAt: new Date(), plannedOperationsEnabled: true,
      directSalesEnabled: true, tapsEnabled: true, inventoryEnabled: true, kitchenEnabled: true,
      kitchenItemsChargeAtLaunch: true, allowCloseComandaWithPendingKitchenOrders: false,
      whatsappPedidoProntoEnabled: false, whatsappPedidoProntoNaCozinha: false,
    } });
    const point = await prisma.pontoVenda.create({ data: { cervejariaId: tenant.id, nome: 'Principal', ativo: true, usaCaixa: true } });
    pointIds[tenant.id] = point.id;
    if (tenant.id === tenants[0].id) {
      const trailer = await prisma.trailer.create({ data: { cervejariaId: tenant.id, nome: 'Agenda QA' } });
      trailerIds[tenant.id] = trailer.id;
      const event = await prisma.evento.create({ data: { cervejariaId: tenant.id, trailerId: trailer.id, nome: 'Ocorrência QA', local: 'QA' } });
      eventIds.legacy = event.id;
    }
    await prisma.configuracaoPontoVenda.create({ data: {
      cervejariaId: tenant.id, pontoVendaId: point.id, tapsEnabled: true, inventoryEnabled: true,
      kitchenEnabled: true, kitchenItemsChargeAtLaunch: true, allowCloseComandaWithPendingKitchenOrders: false,
      whatsappPedidoProntoEnabled: false, whatsappPedidoProntoNaCozinha: false,
    } });
  }

  const senhaHash = await hashPassword(password);
  const userIds: Record<string, string> = {};
  for (const user of users) {
    const created = await prisma.usuario.create({ data: {
      nome: user.nome, email: user.email, senhaHash, papel: user.papel,
      cervejariaId: tenants[user.cervejariaIndex].id, permissoesOperacao: user.permissions,
    } });
    userIds[user.key] = created.id;
  }
  const adminEmail = `admin-${runId}@example.invalid`;
  const admin = await prisma.usuario.create({ data: { nome: 'Admin QA', email: adminEmail, senhaHash, papel: 'ADMIN' } });
  const context = {
    releaseSha: process.env.RELEASE_SHA,
    runId,
    tenants: tenants.map((tenant) => ({ id: tenant.id, slug: tenant.slug })),
    events: eventIds,
    points: pointIds,
    trailers: trailerIds,
    users: Object.fromEntries(users.map((user) => [user.key, { id: userIds[user.key], email: user.email, password }])),
    admin: { id: admin.id, email: adminEmail, password },
  };
  const { writeFile } = await import('node:fs/promises');
  await writeFile(outputPath, JSON.stringify(context, null, 2), { mode: 0o600 });
  console.log(`RELEASE_QA_SEED=PASS; tenants=${tenants.length}; users=${users.length + 1}; credentials=random-per-run`);
} finally {
  await prisma.$disconnect();
}
