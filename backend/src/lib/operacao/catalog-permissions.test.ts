import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { usuarioPode } from './permissoes.js';

test('catalog.manage authorizes category create/edit and is required by both routes', async () => {
  const previous = process.env.PDV_INDIVIDUAL_PERMISSIONS_ENABLED;
  process.env.PDV_INDIVIDUAL_PERMISSIONS_ENABLED = '1';
  const db = { usuario: { findUnique: async () => ({ papel: 'ATENDENTE', cervejariaId: 'tenant-a', permissoesOperacao: ['catalog.manage'] }) } } as never;
  try {
    assert.equal(await usuarioPode({ sub: 'staff', cervejariaId: 'tenant-a', papel: 'ATENDENTE' } as never, 'catalog.manage', {}, db), true);
    assert.equal(await usuarioPode({ sub: 'staff', cervejariaId: 'tenant-a', papel: 'ATENDENTE' } as never, 'command.operate', {}, db), false);
    const route = readFileSync(resolve(fileURLToPath(new URL('.', import.meta.url)), '../../routes/operacao/produtos.ts'), 'utf8');
    assert.match(route, /app\.post\('\/categorias',[\s\S]*?requirePermissaoOuDono\(app, 'catalog\.manage'\)/);
    assert.match(route, /app\.put\('\/categorias\/:id',[\s\S]*?requirePermissaoOuDono\(app, 'catalog\.manage'\)/);
  } finally {
    if (previous === undefined) delete process.env.PDV_INDIVIDUAL_PERMISSIONS_ENABLED;
    else process.env.PDV_INDIVIDUAL_PERMISSIONS_ENABLED = previous;
  }
});
