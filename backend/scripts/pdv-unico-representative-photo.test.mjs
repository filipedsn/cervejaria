import assert from 'node:assert/strict';
import test from 'node:test';
import { captureRepresentativeTenantPhoto, parentLookupWhere } from './pdv-unico-representative-photo.ts';

const tenantId = 'tenant-a';

function model(name, fields, primaryKey = ['id']) {
  return { name, schema: 'public', dbName: name, primaryKey: { fields: primaryKey }, fields: [
    ...primaryKey.map((field) => ({ name: field, kind: 'scalar', type: 'String', isId: true })),
    ...fields,
  ] };
}

const scalar = (name) => ({ name, kind: 'scalar', type: 'String', isRequired: true });
const relation = (name, type, from, to) => ({ name, kind: 'object', type, relationFromFields: from, relationToFields: to });

function fixture({ composite = false, parentRows = [], parentTenantOwned = false } = {}) {
  const contractFields = [scalar('cervejariaId'), scalar('planoId'), relation('cervejaria', 'Cervejaria', ['cervejariaId'], ['id'])];
  const planFields = [scalar('tenantId'), scalar('code'), ...(parentTenantOwned ? [relation('cervejaria', 'Cervejaria', ['tenantId'], ['id'])] : [])];
  if (composite) {
    contractFields.splice(1, 1, scalar('planoTenantId'), scalar('planoCode'));
    contractFields.push(relation('plano', 'Plano', ['planoTenantId', 'planoCode'], ['tenantId', 'code']));
  } else contractFields.push(relation('plano', 'Plano', ['planoId'], ['id']));
  const models = [
    model('Cervejaria', [scalar('nome'), scalar('slug')]),
    model('Contrato', contractFields),
    model('Plano', planFields),
  ];
  const data = {
    Cervejaria: [{ id: tenantId, nome: 'Tenant', slug: 'tenant' }],
    Contrato: [composite
      ? { id: 'contract-1', cervejariaId: tenantId, planoTenantId: tenantId, planoCode: 'gold' }
      : { id: 'contract-1', cervejariaId: tenantId, planoId: 'plan-1' }],
    Plano: parentRows,
  };
  const queries = [];
  const tx = { _runtimeDataModel: { models: Object.fromEntries(models.map((entry) => [entry.name, entry])) } };
  for (const entry of models) {
    tx[entry.name[0].toLowerCase() + entry.name.slice(1)] = {
      findMany: async (args = {}) => {
        queries.push({ model: entry.name, args });
        const rows = data[entry.name] ?? [];
        const where = args.where ?? {};
        if (where.id && Array.isArray(where.id.in)) return rows.filter((row) => where.id.in.includes(row.id));
        if (where.cervejariaId?.in) return rows.filter((row) => where.cervejariaId.in.includes(row.cervejariaId));
        if (where.tenantId?.in) return rows.filter((row) => where.tenantId.in.includes(row.tenantId));
        if (where.id !== undefined) return rows.filter((row) => row.id === where.id);
        if (where.AND) return rows.filter((row) => where.AND.every((part) => Object.entries(part).every(([key, value]) => row[key] === value)));
        return rows;
      },
    };
  }
  return { tx, queries };
}

test('simple FK with different child and parent field names queries the parent reference field', () => {
  assert.deepEqual(parentLookupWhere(['planoId'], ['id'], { planoId: 'plan-1' }), { id: 'plan-1' });
});

test('composite FK maps child fields to the corresponding parent relationToFields', () => {
  assert.deepEqual(parentLookupWhere(['planoTenantId', 'planoCode'], ['tenantId', 'code'], { planoTenantId: tenantId, planoCode: 'gold' }), {
    AND: [{ tenantId }, { code: 'gold' }],
  });
});

test('missing parent is reported as an incomplete FK closure', async () => {
  const { tx, queries } = fixture();
  const photo = await captureRepresentativeTenantPhoto(tx, [{ id: tenantId, label: 'QA Tenant' }], 'test');
  assert.deepEqual(photo.crossTenantEdges.map((edge) => edge.kind), ['MISSING_PARENT']);
  assert.deepEqual(queries.find((query) => query.model === 'Plano' && query.args.where.id !== undefined)?.args.where, { id: 'plan-1' });
});

test('a parent owned by another tenant is rejected instead of entering the photo', async () => {
  const { tx } = fixture({ parentRows: [{ id: 'plan-1', tenantId: 'tenant-b', code: 'gold' }], parentTenantOwned: true });
  const photo = await captureRepresentativeTenantPhoto(tx, [{ id: tenantId, label: 'QA Tenant' }], 'test');
  assert.deepEqual(photo.crossTenantEdges.map((edge) => edge.kind), ['CROSS_TENANT_PARENT']);
  assert.equal(photo.tableRows.find((table) => table.model === 'Plano'), undefined);
});

test('composite parent FK is extracted by reference fields', async () => {
  const { tx, queries } = fixture({ composite: true, parentRows: [{ id: 'other-id', tenantId, code: 'gold' }] });
  const photo = await captureRepresentativeTenantPhoto(tx, [{ id: tenantId, label: 'QA Tenant' }], 'test');
  assert.deepEqual(photo.crossTenantEdges, []);
  assert.deepEqual(queries.find((query) => query.model === 'Plano' && query.args.where.AND)?.args.where, { AND: [{ tenantId }, { code: 'gold' }] });
  assert.equal(photo.tableRows.find((table) => table.model === 'Plano')?.rows[0].id, 'other-id');
});
