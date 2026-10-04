import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPdvCatalogMigrationItems, canonicalPdvPayloadHash, PdvCatalogBlocker } from './pdv-unico-catalog-transform.js';
import { Prisma } from '@prisma/client';
import { resolveEffectivePrice } from '../src/lib/operacao/preco-efetivo.js';

const date = new Date('2026-09-01T12:00:00.000Z');
function snapshot(config: any, legacy: any) {
  const product = {
    id: 'qa-product', cervejariaId: 'qa-company', nome: 'Chope QA', categoria: 'Bebidas', descricao: 'descrição', cor: 'âmbar', estilo: null,
    tipo: 'CHOPE', formato: 'BARRIL', controlaEstoque: true, exigePreparo: false, ordem: 4, ativo: true, createdAt: date, updatedAt: date,
    precos: [{ id: 'qa-price-unit', produtoId: 'qa-product', volumeMl: 1, preco: '0.00' }, { id: 'qa-price-pint', produtoId: 'qa-product', volumeMl: 500, preco: '7.25' }],
    gruposOpcionais: [{ id: 'qa-group', produtoId: 'qa-product', nome: 'Extras', obrigatorio: false, maximo: 2, ordem: 8, ativo: true, createdAt: date, updatedAt: date,
      opcoes: [{ id: 'qa-option', grupoId: 'qa-group', nome: 'Limão', precoAdicional: '0.35', produtoEstoqueId: null, ordem: 9, ativo: true, createdAt: date, updatedAt: date }] }],
  };
  return {
    products: [product], menus: [
      { id: 'qa-menu-day', nome: 'Dia', ativo: true, chopeVolumesConfigurados: true, cervejariaId: 'qa-company', createdAt: date, updatedAt: date, produtos: [{ id: 'qa-day-item', cardapioId: 'qa-menu-day', produtoId: product.id, volumeMl: 500, precoUnit: '8.00', produto: { id: product.id, cervejariaId: 'qa-company' } }] },
      { id: 'qa-menu-night', nome: 'Noite', ativo: false, chopeVolumesConfigurados: false, cervejariaId: 'qa-company', createdAt: date, updatedAt: date, produtos: [{ id: 'qa-night-item', cardapioId: 'qa-menu-night', produtoId: product.id, volumeMl: 500, precoUnit: '9.50', produto: { id: product.id, cervejariaId: 'qa-company' } }] },
    ], optionals: [{ id: 'qa-optional', cervejariaId: 'qa-company', nome: 'Gengibre', preco: '0.45', ativo: true, createdAt: date, updatedAt: date, produtos: [{ id: 'qa-optional-link', produtoId: product.id, opcionalId: 'qa-optional', ordem: 6 }] }], moduleConfig: legacy ? { ...legacy, createdAt: date, updatedAt: date } : null, operationalConfig: config ? { ...config, createdAt: date, updatedAt: date } : null, trailers: [], pdvs: [{ id: 'qa-pdv', cervejariaId: 'qa-company', ativo: true }], taps: [], events: [], operationalSessions: [],
  };
}
const transform = (source: any) => buildPdvCatalogMigrationItems({ companyId: 'qa-company', pointId: 'qa-pdv', snapshot: source, confirmedPdvSourceKey: 'PDV:qa-pdv' });

test('hash version 2 preserves exact Decimal precision without Number conversion', () => {
  assert.notEqual(canonicalPdvPayloadHash(new Prisma.Decimal('3.125')), canonicalPdvPayloadHash(new Prisma.Decimal('3.126')));
  assert.notEqual(canonicalPdvPayloadHash(new Prisma.Decimal('3.125')), canonicalPdvPayloadHash(new Prisma.Decimal('3.12')));
  assert.equal(canonicalPdvPayloadHash(new Prisma.Decimal('18.25')), canonicalPdvPayloadHash('18.25'));
});

test('configuração efetiva preserva false explícito e usa fallback legado só quando ausente', () => {
  const legacy = { ativo: true, exclusivo: false, controlaEstoque: true, temCozinha: true, quantidadeMesas: 12 };
  const explicitFalse = transform(snapshot({ plannedOperationsEnabled: true, directSalesEnabled: true, tapsEnabled: false, inventoryEnabled: false, kitchenEnabled: false }, legacy)).find((item) => item.type === 'PDV_CONFIGURACAO')!.destinationData;
  assert.equal(explicitFalse.tapsEnabled, false);
  assert.equal(explicitFalse.inventoryEnabled, false);
  assert.equal(explicitFalse.kitchenEnabled, false);
  assert.equal('plannedOperationsEnabled' in explicitFalse, false);
  assert.equal('directSalesEnabled' in explicitFalse, false);
  assert.equal(explicitFalse.quantidadeMesas, 12);

  const fallback = transform(snapshot({ plannedOperationsEnabled: false, tapsEnabled: null, inventoryEnabled: null, kitchenEnabled: null }, legacy)).find((item) => item.type === 'PDV_CONFIGURACAO')!.destinationData;
  assert.equal(fallback.tapsEnabled, false);
  assert.equal(fallback.inventoryEnabled, true);
  assert.equal(fallback.kitchenEnabled, true);

  const eventMode = transform(snapshot({ plannedOperationsEnabled: true, tapsEnabled: true, inventoryEnabled: true, kitchenEnabled: true }, legacy)).find((item) => item.type === 'PDV_CONFIGURACAO')!.destinationData;
  const cashMode = transform(snapshot({ plannedOperationsEnabled: false, tapsEnabled: true, inventoryEnabled: true, kitchenEnabled: true }, legacy)).find((item) => item.type === 'PDV_CONFIGURACAO')!.destinationData;
  assert.deepEqual([eventMode.tapsEnabled, eventMode.inventoryEnabled, eventMode.kitchenEnabled], [cashMode.tapsEnabled, cashMode.inventoryEnabled, cashMode.kitchenEnabled]);
});

test('mantém menus independentes, preço zero, volume unitário, volumes e opcionais ordenados', () => {
  const items = transform(snapshot({ tapsEnabled: true, inventoryEnabled: true, kitchenEnabled: true }, { ativo: true, controlaEstoque: false, temCozinha: false }));
  assert.deepEqual(items.filter((item) => item.type === 'CATALOGO_CARDAPIO').map((item) => item.id), ['qa-menu-day', 'qa-menu-night']);
  const menuEntries = items.filter((item) => item.type === 'CATALOGO_CARDAPIO_ITEM');
  assert.deepEqual(menuEntries.map((item) => item.destinationId), ['qa-day-item', 'qa-night-item']);
  assert.ok(menuEntries.every((item) => item.destinationData.cervejariaId === 'qa-company' && item.destinationData.pontoVendaId === 'qa-pdv'));
  const payloads = items.filter((item) => item.type === 'CATALOGO_CARDAPIO_ITEM').map((item) => item.sourcePayload as any);
  assert.deepEqual(payloads.map((item) => item.precoUnit), ['8.00', '9.50']);
  const prices = Object.fromEntries(items.filter((item) => item.type === 'CATALOGO_PRECO').map((item) => [item.destinationId, (item.sourcePayload as any).preco]));
  assert.deepEqual(prices, { 'qa-price-pint': '7.25', 'qa-price-unit': '0.00' });
  const option = items.find((item) => item.type === 'CATALOGO_OPCAO')!.sourcePayload as any;
  assert.equal(option.ordem, 9);
  assert.equal(option.precoAdicional, '0.35');
  const linkedOptional = items.find((item) => item.type === 'CATALOGO_VINCULO_OPCIONAL')!;
  assert.equal(linkedOptional.destinationId, 'qa-optional-link');
  assert.equal((linkedOptional.destinationData as any).ordem, 6);
  assert.equal((items.find((item) => item.type === 'CATALOGO_OPCIONAL')!.sourcePayload as any).preco, '0.45');
});

test('precedência exercida pelo consumidor de turno mantém override zero e herda override nulo', () => {
  assert.deepEqual(resolveEffectivePrice(0, 8, 7), { value: 0, source: 'TURNO' });
  assert.deepEqual(resolveEffectivePrice(null, 8, 7), { value: 8, source: 'CARDAPIO' });
  assert.deepEqual(resolveEffectivePrice(undefined, null, 7), { value: 7, source: 'CATALOGO' });
});

test('ambiguidade de PDV, tenant incompatível e timestamps ausentes ficam bloqueados', () => {
  const source = snapshot({ tapsEnabled: true, inventoryEnabled: true, kitchenEnabled: true }, { ativo: true, controlaEstoque: true, temCozinha: true });
  assert.throws(() => buildPdvCatalogMigrationItems({ companyId: 'qa-company', pointId: 'other-pdv', snapshot: { ...source, pdvs: [...source.pdvs, { id: 'second-pdv', cervejariaId: 'qa-company' }] }, confirmedPdvSourceKey: 'PDV:other-pdv' }), (error) => error instanceof PdvCatalogBlocker && error.code === 'CANONICAL_PDV_AMBIGUOUS');
  assert.throws(() => buildPdvCatalogMigrationItems({ companyId: 'qa-company', pointId: 'qa-pdv', snapshot: { ...source, menus: [{ ...source.menus[0], produtos: [{ ...source.menus[0].produtos[0], produto: { id: 'qa-product', cervejariaId: 'other-company' } }] }] }, confirmedPdvSourceKey: 'PDV:qa-pdv' }), (error) => error instanceof PdvCatalogBlocker && error.code === 'MENU_PRODUCT_TENANT_MISMATCH');
  assert.throws(() => buildPdvCatalogMigrationItems({ companyId: 'qa-company', pointId: 'qa-pdv', snapshot: { ...source, operationalConfig: null, moduleConfig: null }, confirmedPdvSourceKey: 'PDV:qa-pdv' }), (error) => error instanceof PdvCatalogBlocker && error.code === 'CONFIGURATION_SOURCE_MISSING');
});
