import assert from 'node:assert/strict';
import test from 'node:test';
import { assertApprovedProductionPackage } from './pdv-unico-approved-package.mjs';

const approved = {
  applicationSha: '734f98e2f20d2bf1433c13a7260cb3667b569895',
  manifestSha256: 'b75719b842ee70f5a9e3484de61c879ce9d23b6be08568360c63ef3150167acc',
};

test('accepts only the reviewed retained production package identity', () => {
  assert.equal(assertApprovedProductionPackage(approved), true);
});

test('rejects the predecessor application package', () => {
  assert.throws(() => assertApprovedProductionPackage({ ...approved,
    applicationSha: 'a415a08a4c410c5c0db1ce57be9b19ce763706ad' }), /application SHA differs/);
});

test('rejects a changed external manifest digest', () => {
  assert.throws(() => assertApprovedProductionPackage({ ...approved,
    manifestSha256: '8e6cfdb410e430ae85e3efdc3857b6df7375f28154d8d500b0545d35a6c73238' }), /manifest digest/);
});
