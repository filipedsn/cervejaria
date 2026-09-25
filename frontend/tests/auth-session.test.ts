import assert from 'node:assert/strict';
import test from 'node:test';

import { isPublicAuthPath, isPublicPath } from '../src/lib/auth-session.ts';

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
