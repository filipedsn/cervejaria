import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { buildApp } from '../src/app.ts';
import { prisma } from '../src/lib/prisma.ts';
import { hashPassword } from '../src/lib/utils.ts';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';

const databaseUrl = validateIsolatedQaEnvironment(process.env).toString();
assert.equal(process.env.DATABASE_URL, databaseUrl);
process.env.PDV_INDIVIDUAL_PERMISSIONS_ENABLED = '1';
const suffix = randomBytes(6).toString('hex');
const companyIds = [];
const app = await buildApp();

function body(response) { return JSON.parse(response.body); }
function cookie(response) {
  const value = response.headers['set-cookie'];
  assert(value, 'login sets an authenticated cookie');
  return (Array.isArray(value) ? value[0] : value).split(';', 1)[0];
}
async function login(email, senha) {
  const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, senha } });
  assert.equal(response.statusCode, 200, response.body);
  return cookie(response);
}
async function list(authCookie, query = '') {
  return app.inject({ method: 'GET', url: `/api/clientes?${query}`, headers: { cookie: authCookie } });
}

try {
  const password = `Qa-search-${suffix}-only!`;
  const hash = await hashPassword(password);
  const company = await prisma.cervejaria.create({ data: { nome: `Search QA ${suffix}`, slug: `search-qa-${suffix}` } });
  const foreignCompany = await prisma.cervejaria.create({ data: { nome: `Foreign Search QA ${suffix}`, slug: `foreign-search-qa-${suffix}` } });
  companyIds.push(company.id, foreignCompany.id);
  const [owner, denied] = await Promise.all([
    prisma.usuario.create({ data: { nome: 'Search Owner', email: `owner-${suffix}@qa.invalid`, senhaHash: hash, papel: 'DONO', cervejariaId: company.id } }),
    prisma.usuario.create({ data: { nome: 'Search Denied', email: `denied-${suffix}@qa.invalid`, senhaHash: hash, papel: 'ATENDENTE', cervejariaId: company.id, permissoesOperacao: [] } }),
  ]);
  await prisma.cliente.createMany({
    data: Array.from({ length: 23 }, (_, index) => ({
      nome: `Page Probe ${suffix} ${String(index + 1).padStart(2, '0')}`,
      telefone: `551198${suffix.slice(0, 7)}${String(index).padStart(2, '0')}`,
      email: `probe-${index}-${suffix}@qa.invalid`, cervejariaId: company.id,
    })),
  });
  const searchable = await prisma.cliente.create({ data: {
    nome: `Zelda Search ${suffix}`, telefone: '5511991234567', email: `needle-${suffix}@qa.invalid`, cervejariaId: company.id,
  } });
  await prisma.cliente.create({ data: {
    nome: `Zelda Search Foreign ${suffix}`, telefone: '5511997654321', email: `foreign-${suffix}@qa.invalid`, cervejariaId: foreignCompany.id,
  } });

  const ownerCookie = await login(owner.email, password);
  const deniedCookie = await login(denied.email, password);
  const allPageOne = await list(ownerCookie, `q=Page%20Probe%20${suffix}&ordenar=nome&page=1&limit=20`);
  assert.equal(allPageOne.statusCode, 200, allPageOne.body);
  assert.equal(body(allPageOne).pagination.page, 1);
  assert.equal(body(allPageOne).pagination.pages, 2);
  assert.equal(body(allPageOne).items.length, 20);
  const allPageTwo = await list(ownerCookie, `q=Page%20Probe%20${suffix}&ordenar=nome&page=2&limit=20`);
  assert.equal(allPageTwo.statusCode, 200, allPageTwo.body);
  assert.equal(body(allPageTwo).items.length, 3);
  const nameMatch = await list(ownerCookie, `q=Zelda%20Search%20${suffix}&ordenar=nome&page=1&limit=20`);
  assert.deepEqual(body(nameMatch).items.map(({ id }) => id), [searchable.id]);
  const phoneMatch = await list(ownerCookie, `q=991234&page=1&limit=20`);
  assert.deepEqual(body(phoneMatch).items.map(({ id }) => id), [searchable.id]);
  const emailMatch = await list(ownerCookie, `q=needle-${suffix}%40qa.invalid&page=1&limit=20`);
  assert.deepEqual(body(emailMatch).items.map(({ id }) => id), [searchable.id]);
  const sorted = await list(ownerCookie, `q=Page%20Probe%20${suffix}&ordenar=nome&page=1&limit=20`);
  assert.equal(body(sorted).items[0].nome, `Page Probe ${suffix} 01`);
  const deniedRead = await list(deniedCookie, `q=Zelda%20Search%20${suffix}`);
  assert.equal(deniedRead.statusCode, 403, deniedRead.body);
  assert.equal(body(nameMatch).items.some(({ cervejariaId }) => cervejariaId === foreignCompany.id), false);
  console.log('CLIENTES_SEARCH_API_QA=PASS; name/phone/email/global-filter/page/sort/tenant/RBAC; synthetic-data=disposable-tmpfs');
} finally {
  if (companyIds.length) await prisma.cervejaria.deleteMany({ where: { id: { in: companyIds } } });
  await app.close();
  await prisma.$disconnect();
}
