import { prisma } from '../src/lib/prisma.js';
import { hashPassword } from '../src/lib/utils.js';

const runId = process.env.CERTIFICATION_RUN_ID;
const profile = (process.env.CERTIFICATION_DATASET_PROFILE ?? 'MEDIUM').toUpperCase();
if (!runId?.startsWith('TAP-CERT-')) throw new Error('CERTIFICATION_RUN_ID TAP-CERT-* is required');
if (!['SMALL', 'MEDIUM', 'LARGE'].includes(profile)) throw new Error('Invalid certification dataset profile');

const clientsPerTenant = profile === 'LARGE' ? 5000 : profile === 'MEDIUM' ? 2000 : 1000;
const prefix = `cert-${runId.toLowerCase()}`.replace(/[^a-z0-9-]/g, '-');
const passwordHash = await hashPassword('certification-synthetic-only');
const tenants = [];

for (const [index, name] of ['Demo Chopp Móvel', 'Certification Tenant B'].entries()) {
  const slug = `${prefix}-${index + 1}`;
  const existing = await prisma.cervejaria.findUnique({ where: { slug }, select: { id: true } });
  if (existing) throw new Error(`Refusing to overwrite existing certification tenant ${slug}`);
  const brewery = await prisma.cervejaria.create({
    data: {
      nome: `${name} — synthetic ${runId}`,
      slug,
      usuarios: { create: { nome: 'Certification Owner', email: `${slug}@cert.invalid`, senhaHash: passwordHash, papel: 'DONO' } },
      produtos: { create: { nome: 'Certification Pilsen', estilo: 'Pilsen', cor: '#D9A928', tipo: 'BEBIDA', formato: 'CHOPE', precos: { create: [{ volumeMl: 300, preco: 8 }, { volumeMl: 500, preco: 12 }] } } },
      trailers: { create: { nome: 'Certification Trailer' } },
      configuracaoOperacional: { create: { plannedOperationsEnabled: true, directSalesEnabled: false, tapsEnabled: true, inventoryEnabled: true, kitchenEnabled: true } },
    },
    include: { produtos: true, trailers: true },
  });
  await prisma.tap.create({ data: { numero: 1, nome: 'Certification Tap', cervejariaId: brewery.id, trailerId: brewery.trailers[0].id, produtoId: brewery.produtos[0].id } });
  const event = await prisma.evento.create({ data: { nome: 'Certification Event', local: 'Synthetic DEV', data: new Date(), horaInicio: '18:00', status: 'ABERTO', cervejariaId: brewery.id, trailerId: brewery.trailers[0].id } });
  const clients = Array.from({ length: clientsPerTenant }, (_, i) => ({ cervejariaId: brewery.id, nome: `Synthetic Client ${String(i + 1).padStart(5, '0')}`, telefone: `${index + 1}${String(i + 1).padStart(9, '0')}` }));
  await prisma.cliente.createMany({ data: clients });
  tenants.push({ id: brewery.id, slug, displayName: name, eventId: event.id, clients: clientsPerTenant });
}

console.log(JSON.stringify({ runId, profile, synthetic: true, tenants, clientsTotal: clientsPerTenant * tenants.length }, null, 2));
