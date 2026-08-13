import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  isAllowedOrigin,
  isLoopbackIp,
  isTrustedLocalOperator,
  originOf,
} from './local-auth.mjs';

test('loopback cobre IPv4, IPv6 e prefixo IPv4-mapeado', () => {
  assert.equal(isLoopbackIp('127.0.0.1'), true);
  assert.equal(isLoopbackIp('::1'), true);
  assert.equal(isLoopbackIp('::ffff:127.0.0.1'), true);
  assert.equal(isLoopbackIp('10.0.0.8'), false);
  assert.equal(isLoopbackIp(''), false);
});

test('Origin ausente e permitido (curl/scripts locais)', () => {
  assert.equal(isAllowedOrigin(null, 3099), true);
  assert.equal(isAllowedOrigin(undefined, 3099), true);
});

test('so a origem do proprio painel passa', () => {
  assert.equal(isAllowedOrigin('http://127.0.0.1:3099', 3099), true);
  assert.equal(isAllowedOrigin('http://localhost:3099', 3099), true);
  assert.equal(isAllowedOrigin('http://evil.example:3099', 3099), false);
  assert.equal(isAllowedOrigin('http://127.0.0.1:3001', 3099), false);
});

test('Referer vira origin', () => {
  assert.equal(originOf({ referer: 'http://127.0.0.1:3099/' }), 'http://127.0.0.1:3099');
  assert.equal(originOf({ origin: 'http://evil.example', referer: 'http://127.0.0.1:3099/' }), 'http://evil.example');
});

test('browser local na pagina do painel e operador confiavel', () => {
  assert.equal(
    isTrustedLocalOperator(
      { ip: '127.0.0.1', headers: { origin: 'http://127.0.0.1:3099' } },
      { port: 3099 },
    ),
    true,
  );
});

test('pagina em outra origem nao opera mesmo vindo de loopback', () => {
  assert.equal(
    isTrustedLocalOperator(
      { ip: '127.0.0.1', headers: { origin: 'http://evil.example' } },
      { port: 3099 },
    ),
    false,
  );
});

test('IP remoto nao opera mesmo com Origin correto', () => {
  assert.equal(
    isTrustedLocalOperator(
      { ip: '203.0.113.9', headers: { origin: 'http://127.0.0.1:3099' } },
      { port: 3099 },
    ),
    false,
  );
});
