import assert from 'node:assert/strict';
import test from 'node:test';

import { clearLoginNotice, isPublicAuthPath, isPublicPath, readLoginNotice, saveLoginNotice } from '../src/lib/auth-session.ts';
import { clearSessionQueryCache, queryClient } from '../src/lib/query-client.ts';

test('public auth routes remain available after an unauthenticated bootstrap', () => {
  assert.equal(isPublicAuthPath('/login'), true);
  assert.equal(isPublicAuthPath('/forgot-password'), true);
  assert.equal(isPublicAuthPath('/reset-password'), true);
});

test('reset query strings are evaluated by pathname only', () => {
  assert.equal(isPublicAuthPath(new URL('/reset-password?token=abc', 'https://tapdev.quivercloud.com.br').pathname), true);
});

test('private routes continue to redirect after an unauthenticated bootstrap', () => {
  assert.equal(isPublicAuthPath('/dashboard'), false);
  assert.equal(isPublicAuthPath('/admin/cervejarias'), false);
});

test('customer portal and public TV routes never trigger the staff-login redirect', () => {
  assert.equal(isPublicPath('/c/arena/t/trailer-123'), true);
  assert.equal(isPublicPath('/ranking/tv/evento-123'), true);
  assert.equal(isPublicPath('/operacao/comandas'), false);
});

test('deactivated-company notice survives the forced reload until the login screen clears it', () => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    },
  });
  try {
    saveLoginNotice('Cervejaria desativada.');
    assert.equal(readLoginNotice(), 'Cervejaria desativada.');
    assert.equal(readLoginNotice(), 'Cervejaria desativada.');
    clearLoginNotice();
    assert.equal(readLoginNotice(), '');
  } finally {
    Reflect.deleteProperty(globalThis, 'sessionStorage');
  }
});

test('login notice degrades to empty when storage is unavailable', () => {
  assert.equal(readLoginNotice(), '');
  assert.doesNotThrow(() => saveLoginNotice('x'));
});

test('session changes clear cached products and saved menus from the previous tenant', () => {
  queryClient.setQueryData(['operacao-produtos'], [{ nome: 'Produto da empresa anterior' }]);
  queryClient.setQueryData(['operacao-cardapios'], [{ nome: 'Cardápio da empresa anterior' }]);

  clearSessionQueryCache();

  assert.equal(queryClient.getQueryData(['operacao-produtos']), undefined);
  assert.equal(queryClient.getQueryData(['operacao-cardapios']), undefined);
});
