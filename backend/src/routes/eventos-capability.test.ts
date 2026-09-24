import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const routeSource = readFileSync(
  resolve(fileURLToPath(new URL('.', import.meta.url)), 'eventos.ts'),
  'utf8',
);
const tapSource = readFileSync(
  resolve(fileURLToPath(new URL('.', import.meta.url)), '../lib/tap-montagem.ts'),
  'utf8',
);
const comandaSource = readFileSync(
  resolve(fileURLToPath(new URL('.', import.meta.url)), '../lib/comanda-service.ts'),
  'utf8',
);

test('criação e abertura de evento não dependem de chope ou taps', () => {
  assert.doesNotMatch(routeSource, /assertTrailerChopeDisponivel/);
  assert.match(routeSource, /app\.post\('\/'/);
  assert.match(routeSource, /app\.post\('\/:id\/iniciar'/);
  assert.match(routeSource, /app\.patch\('\/:id\/reabrir'/);
});

test('montagem de taps continua explicitamente separada do fluxo de evento', () => {
  assert.match(routeSource, /ensureMontagemEvento/);
  assert.match(routeSource, /posicionarChopeNoTap/);
  assert.match(routeSource, /setTapAtivoNoEvento/);
});

test('operações específicas de tap continuam protegidas', () => {
  assert.match(tapSource, /trailerId, cervejariaId, ativo: true/);
  assert.match(tapSource, /Apenas chope pode ser posicionado no tap/);
  assert.match(comandaSource, /assertChopeAtivoNoTap/);
});
