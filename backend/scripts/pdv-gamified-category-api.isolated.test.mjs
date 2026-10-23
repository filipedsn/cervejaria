import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { buildApp } from '../src/app.ts';
import { prisma } from '../src/lib/prisma.ts';
import { hashPassword } from '../src/lib/utils.ts';

assert.equal(process.env.PDV_GAMIFIED_CATEGORY_CATALOG, '1');
assert.equal(process.env.PDV_INDIVIDUAL_PERMISSIONS_ENABLED, '1');
assert.equal(process.env.PDV_CANONICAL_CONFIG_QA, '');
const suffix = randomBytes(6).toString('hex');
const app = await buildApp();

function cookie(response) {
  const setCookie = response.headers['set-cookie'];
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  assert(value, 'login returns session cookie');
  return value.split(';', 1)[0];
}
async function login(email, password) {
  const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, senha: password } });
  assert.equal(response.statusCode, 200, response.body);
  return cookie(response);
}
async function call(method, url, authCookie, payload) {
  return app.inject({ method, url, headers: authCookie ? { cookie: authCookie } : {}, ...(payload === undefined ? {} : { payload }) });
}
function body(response) { return JSON.parse(response.body); }

try {
  const [ownerHash, managerHash, deniedHash, foreignHash] = await Promise.all([
    hashPassword(`Qa-owner-${suffix}-only!`), hashPassword(`Qa-manager-${suffix}-only!`),
    hashPassword(`Qa-denied-${suffix}-only!`), hashPassword(`Qa-foreign-${suffix}-only!`),
  ]);
  const company = await prisma.cervejaria.create({ data: { nome: `Gamified category ${suffix}`, slug: `gamified-category-${suffix}`, usaCardapio: true } });
  const foreignCompany = await prisma.cervejaria.create({ data: { nome: `Foreign category ${suffix}`, slug: `foreign-category-${suffix}` } });
  const [owner, manager, denied, foreignOwner] = await Promise.all([
    prisma.usuario.create({ data: { nome: 'Owner QA', email: `owner-${suffix}@qa.invalid`, senhaHash: ownerHash, papel: 'DONO', cervejariaId: company.id } }),
    prisma.usuario.create({ data: { nome: 'Manager QA', email: `manager-${suffix}@qa.invalid`, senhaHash: managerHash, papel: 'ATENDENTE', cervejariaId: company.id, permissoesOperacao: ['catalog.manage'] } }),
    prisma.usuario.create({ data: { nome: 'Denied QA', email: `denied-${suffix}@qa.invalid`, senhaHash: deniedHash, papel: 'ATENDENTE', cervejariaId: company.id } }),
    prisma.usuario.create({ data: { nome: 'Foreign QA', email: `foreign-${suffix}@qa.invalid`, senhaHash: foreignHash, papel: 'DONO', cervejariaId: foreignCompany.id } }),
  ]);
  await Promise.all([
    prisma.configuracaoOperacao.create({ data: { cervejariaId: company.id, ativo: true, exclusivo: true } }),
    prisma.configuracaoOperacional.create({ data: { cervejariaId: company.id, plannedOperationsEnabled: false, tapsEnabled: true, inventoryEnabled: false, kitchenEnabled: false } }),
    prisma.configuracaoOperacao.create({ data: { cervejariaId: foreignCompany.id, ativo: true, exclusivo: true } }),
    prisma.configuracaoOperacional.create({ data: { cervejariaId: foreignCompany.id, plannedOperationsEnabled: false, tapsEnabled: true, inventoryEnabled: false, kitchenEnabled: false } }),
  ]);
  const point = await prisma.pontoVenda.create({ data: { cervejariaId: company.id, nome: 'Principal QA' } });
  const foreignPoint = await prisma.pontoVenda.create({ data: { cervejariaId: foreignCompany.id, nome: 'Estrangeiro QA' } });
  const [ownerCookie, managerCookie, deniedCookie, foreignCookie] = await Promise.all([
    login(owner.email, `Qa-owner-${suffix}-only!`), login(manager.email, `Qa-manager-${suffix}-only!`),
    login(denied.email, `Qa-denied-${suffix}-only!`), login(foreignOwner.email, `Qa-foreign-${suffix}-only!`),
  ]);

  const deniedCreate = await call('POST', '/api/operacao/produtos/categorias', deniedCookie, { nome: 'Bloqueada', gamificada: false });
  assert.equal(deniedCreate.statusCode, 403, deniedCreate.body);
  assert.equal(await prisma.categoriaProdutoPdv.count({ where: { cervejariaId: company.id, nome: 'Bloqueada' } }), 0, 'permission denial writes nothing');
  const ownerCategory = await call('POST', '/api/operacao/produtos/categorias', ownerCookie, { nome: 'Bebidas da casa', gamificada: false });
  assert.equal(ownerCategory.statusCode, 201, ownerCategory.body);
  assert.equal(body(ownerCategory).gamificada, false, 'explicit false is persisted');
  const ownerCategoryId = body(ownerCategory).id;
  const deniedDelete = await call('DELETE', `/api/operacao/produtos/categorias/${encodeURIComponent(ownerCategoryId)}`, deniedCookie);
  assert.equal(deniedDelete.statusCode, 403, deniedDelete.body);
  assert.equal(await prisma.categoriaProdutoPdv.findFirst({ where: { id: ownerCategoryId, cervejariaId: company.id } }).then(Boolean), true, 'permission denial preserves category');
  const freelyNamed = await call('POST', '/api/operacao/produtos/categorias', managerCookie, { nome: 'Lanches especiais', gamificada: true });
  assert.equal(freelyNamed.statusCode, 201, freelyNamed.body);
  const chopeCategoryResponse = await call('POST', '/api/operacao/produtos/categorias', ownerCookie, { nome: 'Chope', gamificada: false });
  assert.equal(chopeCategoryResponse.statusCode, 201, chopeCategoryResponse.body);
  const chopeCategory = body(chopeCategoryResponse);
  const normalizedCollision = await call('POST', '/api/operacao/produtos/categorias', ownerCookie, { nome: '  CHOPE  ', gamificada: true });
  assert.equal(normalizedCollision.statusCode, 409, normalizedCollision.body);
  const foreignCategoryResponse = await call('POST', '/api/operacao/produtos/categorias', foreignCookie, { nome: 'Foreign', gamificada: false });
  assert.equal(foreignCategoryResponse.statusCode, 201, foreignCategoryResponse.body);
  const foreignCategoryId = body(foreignCategoryResponse).id;

  const operationChopeResponse = await call('POST', '/api/operacao/produtos', ownerCookie, {
    nome: 'Lúpulo QA', categoria: 'texto não autoritativo', categoriaPdvId: chopeCategory.id,
    tipo: 'BEBIDA', formato: 'CHOPE', precos: [{ volumeMl: 300, preco: 5 }, { volumeMl: 500, preco: 8 }],
    controlaEstoque: false, exigePreparo: false,
  });
  assert.equal(operationChopeResponse.statusCode, 201, operationChopeResponse.body);
  let chope = body(operationChopeResponse);
  assert.deepEqual([chope.categoria, chope.categoriaPdvId, chope.tipo, chope.formato], ['Chope', chopeCategory.id, 'BEBIDA', 'CHOPE']);
  assert.deepEqual(chope.precos.map((row) => [row.volumeMl, Number(row.preco)]), [[300, 5], [500, 8]]);

  const genericProductResponse = await call('POST', '/api/produtos', ownerCookie, {
    nome: 'Produto API geral', categoria: 'texto divergente', categoriaPdvId: ownerCategoryId,
    tipo: 'COMIDA', precos: [{ volumeMl: 1, preco: 11 }], controlaEstoque: false, exigePreparo: false,
  });
  assert.equal(genericProductResponse.statusCode, 201, genericProductResponse.body);
  const genericProduct = body(genericProductResponse);
  assert.deepEqual([genericProduct.categoria, genericProduct.categoriaPdvId], ['Bebidas da casa', ownerCategoryId], 'generic create derives label from category ID');

  const beforeForeign = await prisma.produto.count({ where: { cervejariaId: company.id } });
  const foreignOperationCreate = await call('POST', '/api/operacao/produtos', ownerCookie, { nome: 'foreign', categoriaPdvId: foreignCategoryId, tipo: 'COMIDA', precoUnit: 1 });
  assert.equal(foreignOperationCreate.statusCode, 404, foreignOperationCreate.body);
  const foreignGenericCreate = await call('POST', '/api/produtos', ownerCookie, { nome: 'foreign', categoriaPdvId: foreignCategoryId, tipo: 'COMIDA', precos: [{ volumeMl: 1, preco: 1 }] });
  assert.equal(foreignGenericCreate.statusCode, 404, foreignGenericCreate.body);
  const operationForeign = await call('PUT', `/api/operacao/produtos/${encodeURIComponent(chope.id)}`, ownerCookie, { categoriaPdvId: foreignCategoryId, nome: 'must not write' });
  assert.equal(operationForeign.statusCode, 404, operationForeign.body);
  const genericForeign = await call('PUT', `/api/produtos/${encodeURIComponent(genericProduct.id)}`, ownerCookie, { categoriaPdvId: foreignCategoryId, nome: 'must not write' });
  assert.equal(genericForeign.statusCode, 404, genericForeign.body);
  assert.equal(await prisma.produto.count({ where: { cervejariaId: company.id } }), beforeForeign, 'foreign category IDs are rejected without creating rows');
  const foreignCategoryEdit = await call('PUT', `/api/operacao/produtos/categorias/${encodeURIComponent(foreignCategoryId)}`, ownerCookie, { nome: 'takeover', gamificada: true });
  assert.equal(foreignCategoryEdit.statusCode, 404, foreignCategoryEdit.body);
  assert.equal((await prisma.categoriaProdutoPdv.findUniqueOrThrow({ where: { id: foreignCategoryId } })).nome, 'Foreign', 'foreign category remains unchanged');
  const foreignDelete = await call('DELETE', `/api/operacao/produtos/categorias/${encodeURIComponent(foreignCategoryId)}`, ownerCookie);
  assert.equal(foreignDelete.statusCode, 404, 'tenant-scoped category delete hides foreign categories');
  const safeDelete = await call('DELETE', `/api/operacao/produtos/categorias/${encodeURIComponent(body(freelyNamed).id)}`, managerCookie);
  assert.equal(safeDelete.statusCode, 200, safeDelete.body);
  assert.equal(await prisma.categoriaProdutoPdv.findFirst({ where: { id: body(freelyNamed).id, cervejariaId: company.id } }), null, 'unused category can be deleted');
  assert.equal((await prisma.produto.findUniqueOrThrow({ where: { id: chope.id } })).nome, 'Lúpulo QA');
  assert.equal((await prisma.produto.findUniqueOrThrow({ where: { id: genericProduct.id } })).nome, 'Produto API geral');

  const textOnlyChange = await call('PUT', `/api/operacao/produtos/${encodeURIComponent(chope.id)}`, ownerCookie, { categoria: 'tentativa divergente' });
  assert.equal(textOnlyChange.statusCode, 400, textOnlyChange.body);
  const genericTextOnlyChange = await call('PUT', `/api/produtos/${encodeURIComponent(genericProduct.id)}`, ownerCookie, { categoria: 'tentativa divergente' });
  assert.equal(genericTextOnlyChange.statusCode, 400, genericTextOnlyChange.body);
  chope = body(await call('PUT', `/api/operacao/produtos/${encodeURIComponent(chope.id)}`, managerCookie, {
    categoria: 'rótulo conflitante', categoriaPdvId: ownerCategoryId,
  }));
  assert.deepEqual([chope.categoria, chope.categoriaPdvId, chope.tipo, chope.formato], ['Bebidas da casa', ownerCategoryId, 'BEBIDA', 'CHOPE'], 'valid ID wins over conflicting client text and classification is preserved');
  const genericPartial = await call('PUT', `/api/produtos/${encodeURIComponent(genericProduct.id)}`, ownerCookie, { nome: 'Produto API geral editado' });
  assert.equal(genericPartial.statusCode, 200, genericPartial.body);
  assert.deepEqual([body(genericPartial).categoria, body(genericPartial).categoriaPdvId], ['Bebidas da casa', ownerCategoryId], 'generic partial edit preserves canonical identity/name');
  const restoreChopeCategory = await call('PUT', `/api/operacao/produtos/${encodeURIComponent(chope.id)}`, managerCookie, { categoriaPdvId: chopeCategory.id, categoria: 'conflicting label' });
  assert.equal(restoreChopeCategory.statusCode, 200, restoreChopeCategory.body);
  chope = body(restoreChopeCategory);
  assert.deepEqual([chope.categoria, chope.categoriaPdvId, chope.formato], ['Chope', chopeCategory.id, 'CHOPE']);

  const snackCategory = body(await call('POST', '/api/operacao/produtos/categorias', ownerCookie, { nome: 'Porções especiais', gamificada: true }));
  const snackResponse = await call('POST', '/api/operacao/produtos', ownerCookie, {
    nome: 'Batata QA', categoria: 'qualquer texto', categoriaPdvId: snackCategory.id,
    tipo: 'COMIDA', precoUnit: 15, controlaEstoque: true, exigePreparo: true,
  });
  assert.equal(snackResponse.statusCode, 201, snackResponse.body);
  const snack = body(snackResponse);
  const optional = await call('POST', '/api/operacao/produtos/opcionais', managerCookie, { nome: `Molho ${suffix}`, preco: 2 });
  assert.equal(optional.statusCode, 201, optional.body);
  const attachOptional = await call('PUT', `/api/operacao/produtos/${encodeURIComponent(snack.id)}/opcionais`, managerCookie, { opcionalIds: [body(optional).id] });
  assert.equal(attachOptional.statusCode, 200, attachOptional.body);
  const listedOptionals = await call('GET', `/api/operacao/produtos/${encodeURIComponent(snack.id)}/opcionais`, ownerCookie);
  assert.equal(listedOptionals.statusCode, 200, listedOptionals.body);
  assert.equal(body(listedOptionals).length, 1, 'optionals remain attached after canonical product creation');

  const menuResponse = await call('POST', '/api/operacao/cardapios', ownerCookie, { nome: `Cardápio ${suffix}`, itens: [
    { produtoId: chope.id, volumeMl: 300, precoUnit: 5 }, { produtoId: chope.id, volumeMl: 500, precoUnit: 8 },
    { produtoId: snack.id, volumeMl: 0, precoUnit: 15 },
  ] });
  assert.equal(menuResponse.statusCode, 201, menuResponse.body);
  const menu = body(menuResponse);
  const menuBefore = await prisma.cardapioProduto.findMany({ where: { cardapioId: menu.id }, orderBy: { volumeMl: 'asc' } });
  assert.deepEqual(menuBefore.map((row) => row.volumeMl), [0, 300, 500], 'menu retains unit and Chope volume rows');

  const cashOpen = await call('POST', '/api/operacao/caixa/abrir', ownerCookie, { pontoVendaId: point.id, trocoInicial: 0, cardapioId: menu.id });
  assert.equal(cashOpen.statusCode, 201, cashOpen.body);
  const cashSession = body(cashOpen);
  const tap = await prisma.tap.create({ data: { numero: 1, nome: 'Tap QA', produtoId: chope.id, cervejariaId: company.id, pontoVendaId: point.id } });
  await prisma.tapMontagem.create({ data: { tapId: tap.id, produtoId: chope.id, sessaoCaixaId: cashSession.id } });
  const openedCommand = await call('POST', '/api/operacao/comandas', ownerCookie, { pontoVendaId: point.id, tipo: 'APELIDO', identificador: `volume-${suffix}`, clienteNome: `Cliente ${suffix}` });
  assert.equal(openedCommand.statusCode, 201, openedCommand.body);
  const command = body(openedCommand);
  const launch = await call('POST', `/api/operacao/comandas/${encodeURIComponent(command.id)}/pedidos`, ownerCookie, { itens: [{ produtoId: chope.id, quantidade: 1, tapId: tap.id, volumeMl: 500 }] });
  assert.equal(launch.statusCode, 201, launch.body);
  const launchedItem = await prisma.itemComanda.findFirstOrThrow({ where: { comandaId: command.id } });
  assert.deepEqual([launchedItem.volumeMl, Number(launchedItem.precoUnit)], [500, 8], 'real Por Caixa sale snapshots the selected volume price');
  const payment = await call('POST', `/api/operacao/comandas/${encodeURIComponent(command.id)}/pagamentos`, ownerCookie, { pagamentos: [{ forma: 'PIX', valor: 8 }] });
  assert.equal(payment.statusCode, 200, payment.body);

  const trailer = await prisma.trailer.create({ data: { nome: `Ranking QA ${suffix}`, cervejariaId: company.id } });
  const event = await prisma.evento.create({ data: { nome: `Chope ranking ${suffix}`, local: 'QA', cervejariaId: company.id, trailerId: trailer.id } });
  const customer = await prisma.cliente.create({ data: { nome: `Ranking client ${suffix}`, telefone: `1197${suffix.padEnd(7, '0')}`, cervejariaId: company.id } });
  const rankingCommand = await prisma.comanda.create({ data: { eventoId: event.id, clienteId: customer.id, tipo: 'COMANDA', status: 'FECHADA', total: 8, fechadaEm: new Date() } });
  await prisma.itemComanda.create({ data: { comandaId: rankingCommand.id, produtoId: chope.id, nome: chope.nome, quantidade: 1, volumeMl: 500, precoUnit: 8 } });
  const rankingBefore = await call('GET', `/api/ranking/evento/${encodeURIComponent(event.id)}`, ownerCookie);
  assert.equal(rankingBefore.statusCode, 200, rankingBefore.body);
  const rankRowsBefore = body(rankingBefore).ranking;

  const beforeCategoryEdit = {
    product: await prisma.produto.findUniqueOrThrow({ where: { id: snack.id }, include: { precos: true } }),
    menu: await prisma.cardapioProduto.findMany({ where: { cardapioId: menu.id }, orderBy: { volumeMl: 'asc' } }),
    optionLinks: await prisma.produtoOpcionalVinculo.count({ where: { produtoId: snack.id } }),
    payments: await prisma.pagamento.count({ where: { comandaId: command.id } }),
    cashSessions: await prisma.sessaoCaixaOperacao.count({ where: { cervejariaId: company.id } }),
    orders: await prisma.pedidoOperacao.count({ where: { cervejariaId: company.id } }),
    inventoryBalances: await prisma.inventoryBalance.count({ where: { cervejariaId: company.id } }),
    inventoryMovements: await prisma.inventoryMovement.count({ where: { cervejariaId: company.id } }),
  };
  const categoryRename = await call('PUT', `/api/operacao/produtos/categorias/${encodeURIComponent(chopeCategory.id)}`, managerCookie, { nome: 'Cerveja de torneira', gamificada: false });
  assert.equal(categoryRename.statusCode, 200, categoryRename.body);
  const renamed = await prisma.produto.findUniqueOrThrow({ where: { id: chope.id }, include: { precos: { orderBy: { volumeMl: 'asc' } }, categoriaPdv: true } });
  assert.deepEqual([renamed.categoria, renamed.categoriaPdvId, renamed.categoriaPdv.nome, renamed.tipo, renamed.formato], ['Cerveja de torneira', chopeCategory.id, 'Cerveja de torneira', 'BEBIDA', 'CHOPE']);
  assert.deepEqual(renamed.precos.map((row) => [row.volumeMl, Number(row.preco)]), [[300, 5], [500, 8]], 'renaming never converts Chope to unit price');
  const partialChopeEdit = await call('PUT', `/api/operacao/produtos/${encodeURIComponent(chope.id)}`, ownerCookie, { nome: 'Lúpulo renomeado' });
  assert.equal(partialChopeEdit.statusCode, 200, partialChopeEdit.body);
  const afterChopeEdit = body(partialChopeEdit);
  assert.deepEqual([afterChopeEdit.categoria, afterChopeEdit.categoriaPdvId, afterChopeEdit.tipo, afterChopeEdit.formato], ['Cerveja de torneira', chopeCategory.id, 'BEBIDA', 'CHOPE']);
  assert.deepEqual(afterChopeEdit.precos.map((row) => [row.volumeMl, Number(row.preco)]), [[300, 5], [500, 8]]);
  const rankRowsAfter = body(await call('GET', `/api/ranking/evento/${encodeURIComponent(event.id)}`, ownerCookie)).ranking;
  assert.deepEqual(rankRowsAfter, rankRowsBefore, 'legacy Chope event ranking is unchanged by category rename/product edit');

  const snackRename = await call('PUT', `/api/operacao/produtos/categorias/${encodeURIComponent(snackCategory.id)}`, ownerCookie, { nome: 'Petiscos QA', gamificada: false });
  assert.equal(snackRename.statusCode, 200, snackRename.body);
  const blockedDelete = await call('DELETE', `/api/operacao/produtos/categorias/${encodeURIComponent(snackCategory.id)}`, managerCookie);
  assert.equal(blockedDelete.statusCode, 409, 'category with linked products is protected');
  assert.match(body(blockedDelete).error, /Categoria usada.*produto|produto.*vinculad/i);
  assert.equal((await prisma.produto.findUniqueOrThrow({ where: { id: snack.id } })).categoriaPdvId, snackCategory.id, 'blocked delete preserves product category link');
  const afterCategoryEdit = {
    product: await prisma.produto.findUniqueOrThrow({ where: { id: snack.id }, include: { precos: true } }),
    menu: await prisma.cardapioProduto.findMany({ where: { cardapioId: menu.id }, orderBy: { volumeMl: 'asc' } }),
    optionLinks: await prisma.produtoOpcionalVinculo.count({ where: { produtoId: snack.id } }),
    payments: await prisma.pagamento.count({ where: { comandaId: command.id } }),
    cashSessions: await prisma.sessaoCaixaOperacao.count({ where: { cervejariaId: company.id } }),
    orders: await prisma.pedidoOperacao.count({ where: { cervejariaId: company.id } }),
    inventoryBalances: await prisma.inventoryBalance.count({ where: { cervejariaId: company.id } }),
    inventoryMovements: await prisma.inventoryMovement.count({ where: { cervejariaId: company.id } }),
  };
  assert.deepEqual([afterCategoryEdit.product.categoria, afterCategoryEdit.product.categoriaPdvId, afterCategoryEdit.product.tipo, afterCategoryEdit.product.formato], ['Petiscos QA', snackCategory.id, 'COMIDA', null]);
  assert.deepEqual(afterCategoryEdit.menu, beforeCategoryEdit.menu, 'category edit leaves menu rows unchanged');
  assert.deepEqual(afterCategoryEdit.product.precos, beforeCategoryEdit.product.precos, 'category edit leaves prices unchanged');
  assert.equal(afterCategoryEdit.optionLinks, beforeCategoryEdit.optionLinks, 'category edit leaves optionals unchanged');
  for (const key of ['payments', 'cashSessions', 'orders', 'inventoryBalances', 'inventoryMovements']) assert.equal(afterCategoryEdit[key], beforeCategoryEdit[key], `category edit leaves ${key} unchanged`);

  await prisma.cervejaria.update({ where: { id: company.id }, data: { operacaoCategoriasOrdem: { comanda: ['comidas', 'chope', 'bebidas', 'outros'] } } });
  const initialUnifiedOrder = body(await call('GET', '/api/produtos/categorias-comanda/ordem', managerCookie));
  assert.equal(initialUnifiedOrder.catalogoCanonico, true);
  const realCatalogOrder = body(await call('GET', '/api/operacao/produtos/categorias', managerCookie)).ordem;
  assert.deepEqual(initialUnifiedOrder.ordem.filter((name) => name !== '__quiver_pdv_tap_chope__'), realCatalogOrder, 'synthetic Chopes identity is excluded from real catalog categories');
  assert.equal(initialUnifiedOrder.ordem.at(-1), '__quiver_pdv_tap_chope__', 'older category orders retain the previous end position for Chopes');
  const reorderedUnified = [...initialUnifiedOrder.ordem].reverse();
  const deniedComandaOrder = await call('PUT', '/api/produtos/categorias-comanda/ordem', deniedCookie, { ordem: reorderedUnified });
  assert.equal(deniedComandaOrder.statusCode, 403, deniedComandaOrder.body);
  const savedComandaOrder = await call('PUT', '/api/produtos/categorias-comanda/ordem', managerCookie, { ordem: reorderedUnified });
  assert.equal(savedComandaOrder.statusCode, 200, savedComandaOrder.body);
  assert.deepEqual(body(savedComandaOrder).ordem, reorderedUnified);
  const catalogOrderBefore = body(await call('GET', '/api/operacao/produtos/categorias', managerCookie)).ordem;
  const reorderedCatalog = [...reorderedUnified];
  const deniedCatalogOrder = await call('PUT', '/api/operacao/produtos/categorias/ordem', deniedCookie, { ordem: reorderedCatalog });
  assert.equal(deniedCatalogOrder.statusCode, 403, deniedCatalogOrder.body);
  const savedCatalogOrder = await call('PUT', '/api/operacao/produtos/categorias/ordem', managerCookie, { ordem: reorderedCatalog });
  assert.equal(savedCatalogOrder.statusCode, 200, savedCatalogOrder.body);
  const preferences = (await prisma.cervejaria.findUniqueOrThrow({ where: { id: company.id }, select: { operacaoCategoriasOrdem: true } })).operacaoCategoriasOrdem;
  assert.deepEqual(preferences.comanda, ['comidas', 'chope', 'bebidas', 'outros'], 'legacy comanda preference is retained without being rewritten');
  assert.deepEqual(preferences.catalogo, reorderedCatalog, 'one canonical catalog order persists in the existing preference');
  assert.deepEqual(body(await call('GET', '/api/produtos/categorias-comanda/ordem', managerCookie)).ordem, preferences.catalogo);
  assert.deepEqual(body(await call('GET', '/api/operacao/produtos/categorias', managerCookie)).ordem, reorderedCatalog.filter((name) => name !== '__quiver_pdv_tap_chope__'));
  const renamedAfterOrdering = await call('PUT', `/api/operacao/produtos/categorias/${encodeURIComponent(snackCategory.id)}`, managerCookie, { nome: 'Petiscos revisados', gamificada: false });
  assert.equal(renamedAfterOrdering.statusCode, 200, renamedAfterOrdering.body);
  assert.deepEqual(body(await call('GET', '/api/produtos/categorias-comanda/ordem', managerCookie)).ordem, reorderedCatalog.map((name) => name === 'Petiscos QA' ? 'Petiscos revisados' : name), 'category rename keeps its unified-order position');

  console.log('PDV_GAMIFIED_CATEGORY_AUTH_API=PASS; owner/catalog.manage/denied; tenant isolation; create/edit/explicit-false/safe-delete; unified category order; preserved LEGACY order; rename position; Chope rename/volume/menu/sale/ranking; optionals/snapshots/history invariants');
} finally {
  await app.close();
  await prisma.$disconnect();
}
