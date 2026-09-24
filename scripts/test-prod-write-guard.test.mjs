import assert from 'node:assert/strict';
import test from 'node:test';
import { assertTestProdWriteGuard } from './test-prod-write-guard.mjs';

const dev = { NODE_ENV: 'development', DATABASE_URL: 'postgresql://dev@localhost:5434/cervejaria_dev' };

test('DEV is allowed only with the isolated development database', () => {
  assert.doesNotThrow(() => assertTestProdWriteGuard({ environment: dev, requireDevDatabase: true }));
});

test('production values and production database targets are blocked', () => {
  assert.throws(() => assertTestProdWriteGuard({ environment: { ...dev, NODE_ENV: 'production' }, requireDevDatabase: true }), /NODE_ENV/);
  assert.throws(() => assertTestProdWriteGuard({ environment: { ...dev, APP_ENV: 'production' }, requireDevDatabase: true }), /APP_ENV/);
  assert.throws(() => assertTestProdWriteGuard({ environment: { ...dev, DATABASE_URL: 'postgresql://prod@host:5432/cervejaria' }, requireDevDatabase: true }), /DATABASE_URL/);
  assert.throws(() => assertTestProdWriteGuard({ environment: { ...dev, DOTENV_CONFIG_PATH: 'backend/.env.production' }, requireDevDatabase: true }), /\.env\.production/);
});

test('an explicit DEV database does not override inherited production state', () => {
  assert.throws(() => assertTestProdWriteGuard({ environment: { ...dev, ENVIRONMENT: 'production' }, requireDevDatabase: true }), /ENVIRONMENT/);
});
