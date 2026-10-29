import assert from 'node:assert/strict';
import test from 'node:test';
import { getDevFrontendOrigin } from './lan-url.js';

test('getDevFrontendOrigin ignora APP_URL tapdev legado e devolve IP LAN:5202', () => {
  const previous = process.env.APP_URL;
  process.env.APP_URL = 'https://tapdev.quivercloud.com.br';
  try {
    const origin = getDevFrontendOrigin();
    assert.ok(origin, 'deve achar ao menos um IP privado');
    assert.match(origin!, /^http:\/\/(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/);
    assert.match(origin!, /:5202$/);
    assert.doesNotMatch(origin!, /tapdev/i);
  } finally {
    if (previous === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previous;
  }
});

test('getDevFrontendOrigin com APP_URL localhost resolve LAN', () => {
  const previous = process.env.APP_URL;
  process.env.APP_URL = 'http://localhost:5202';
  try {
    const origin = getDevFrontendOrigin();
    assert.ok(origin);
    assert.match(origin!, /:5202$/);
    assert.doesNotMatch(origin!, /localhost|127\.0\.0\.1|tapdev/i);
  } finally {
    if (previous === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previous;
  }
});
