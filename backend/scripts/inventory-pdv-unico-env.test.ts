import test from 'node:test';
import assert from 'node:assert/strict';
import { validateInventoryEnvironment } from './inventory-pdv-unico-env.js';

test('aceita apenas URL exata do DEV local, sem conectar', () => {
  assert.doesNotThrow(() => validateInventoryEnvironment({ NODE_ENV: 'development', DATABASE_URL: 'postgresql://user:secret@127.0.0.1:5434/cervejaria_dev' }));
  for (const url of [
    'postgresql://user:secret@127.0.0.1:5434/cervejaria_dev_backup',
    'postgresql://user:secret@127.0.0.1:5434/cervejaria_dev/extra',
    'postgresql://user:secret@example.com:5434/cervejaria_dev',
    'postgresql://user:secret@127.0.0.1:5432/cervejaria_dev',
    'postgresql://user:secret@127.0.0.1:5434/cervejaria',
    'postgresql://user:secret@127.0.0.1:5434/cervejaria_dev?host=example.com',
    'not-a-url',
  ]) assert.throws(() => validateInventoryEnvironment({ NODE_ENV: 'development', DATABASE_URL: url }));
  assert.throws(() => validateInventoryEnvironment({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://user:secret@127.0.0.1:5434/cervejaria_dev' }));
});
