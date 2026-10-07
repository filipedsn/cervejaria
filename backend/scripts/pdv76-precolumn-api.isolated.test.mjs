import assert from 'node:assert/strict';
import { buildApp } from '../src/app.ts';
import { prisma } from '../src/lib/prisma.ts';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';

const databaseUrl = validateIsolatedQaEnvironment(process.env).toString();
assert.equal(process.env.DATABASE_URL, databaseUrl, 'real application singleton uses the validated disposable QA database');
assert.notEqual(process.env.PDV_CANONICAL_CONFIG_QA, '1', 'canonical activation is disabled before importing the real application singleton');
const fixture = JSON.parse(process.env.PDV_PRECOLUMN_API_FIXTURE ?? 'null');
assert(fixture?.email && fixture.password && fixture.productIds?.length === 2, 'isolated pre-column API fixture is present');

const app = await buildApp();
const failures = [];
try {
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: fixture.email, senha: fixture.password } });
  assert.equal(login.statusCode, 200, `real login succeeds: ${login.body}`);
  const cookieHeader = Array.isArray(login.headers['set-cookie']) ? login.headers['set-cookie'][0] : login.headers['set-cookie'];
  const cookie = String(cookieHeader ?? '').split(';')[0];
  assert.match(cookie, /=.+/, 'real login returns authenticated session cookie');

  const catalogRead = await app.inject({ method: 'GET', url: '/api/operacao/produtos?incluirInativos=true', headers: { cookie } });
  assert.equal(catalogRead.statusCode, 200, `product query succeeds against schema without the new column: ${catalogRead.body}`);
  const catalog = JSON.parse(catalogRead.body);
  assert.equal(catalog.filter((product) => fixture.productIds.includes(product.id)).length, 2, 'both old-schema products are returned');

  const edit = await app.inject({ method: 'PUT', url: `/api/operacao/produtos/${encodeURIComponent(fixture.productIds[0])}`, headers: { cookie }, payload: { nome: 'Legacy API edited product' } });
  assert.equal(edit.statusCode, 200, `product edit succeeds without reading/writing the absent column: ${edit.body}`);
  assert.equal((await prisma.produto.findUniqueOrThrow({ where: { id: fixture.productIds[0] }, select: { nome: true } })).nome, 'Legacy API edited product');

  const launch = await app.inject({ method: 'POST', url: '/api/operacao/comandas', headers: { cookie }, payload: {
    pontoVendaId: fixture.pointId, tipo: 'APELIDO', identificador: `pre-column-${fixture.sessionId}`,
    itens: fixture.productIds.map((produtoId) => ({ produtoId, volumeMl: 1, quantidade: 1 })),
  } });
  assert.equal(launch.statusCode, 201, `Por Caixa launch and legacy grouping succeed on old schema: ${launch.body}`);
  const command = JSON.parse(launch.body);
  assert.equal(command.pedidos.length, 1, 'legacy grouping keeps both kitchen lines in one order with canonical activation disabled');
  const order = await prisma.pedidoOperacao.findFirstOrThrow({ where: { comandaId: command.id }, include: { itensComanda: true } });
  assert.equal(order.itensComanda.length, 2, 'grouped legacy order has exactly the two launched lines');

  for (const status of ['EM_PREPARO', 'PRONTO', 'ENTREGUE']) {
    const transition = await app.inject({ method: 'PATCH', url: `/api/operacao/cozinha/${encodeURIComponent(order.id)}/status`, headers: { cookie }, payload: { status } });
    assert.equal(transition.statusCode, 200, `legacy kitchen order transitions to ${status}: ${transition.body}`);
  }
  const payment = await app.inject({ method: 'POST', url: `/api/operacao/comandas/${encodeURIComponent(command.id)}/pagamentos`, headers: { cookie }, payload: { pagamentos: [{ forma: 'PIX', valor: 20 }] } });
  assert.equal(payment.statusCode, 200, `payment succeeds on old schema: ${payment.body}`);
  const close = await app.inject({ method: 'POST', url: '/api/operacao/caixa/fechar', headers: { cookie }, payload: {
    pontoVendaId: fixture.pointId, contadoDinheiro: 0, contadoPix: 20, contadoCartaoDebito: 0, contadoCartaoCredito: 0,
  } });
  assert.equal(close.statusCode, 200, `cash close succeeds on old schema: ${close.body}`);

  for (const response of [catalogRead, edit, launch, payment, close]) {
    assert.doesNotMatch(response.body, /P2022|prepararEmPedidoSeparado/, 'API responses contain no missing-column error or new-column field');
    failures.push(response.statusCode);
  }
  console.log(`PDV76_PRECOLUMN_API=PASS; canonical=OFF; singleton=application; authenticatedLogin=200; productReadEdit=200/200; cashSale=201; legacyGroupedOrders=${command.pedidos.length}; paymentClose=200/200; responses=${failures.join(',')}; P2022=NONE`);
} finally {
  await app.close();
  await prisma.$disconnect();
}
