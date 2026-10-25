import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safeJourneyPayload } from './journey-evidence.mjs';

test('safe payload supports OTLP JSON strings and strips historical PII and credentials', () => {
  const metadata = JSON.stringify({ requestBody: { cervejariaId: 'tenant-a', usuarioId: 'operator-a', senha: 'private',
    nome: 'private-person', observacao: 'private-note', email: 'private@example.test',
    itens: [{ produtoId: 'product-a', quantidade: 2, opcionais: [{ opcionalId: 'o1', quantidade: 1 }] }],
    pagamentos: [{ forma: 'PIX', valor: 12.5, token: 'private' }] } });
  const result = safeJourneyPayload(metadata);
  assert.equal(result.cervejariaId, 'tenant-a');
  assert.equal(result.itens[0].opcionais[0].quantidade, 1);
  assert.equal(result.pagamentos[0].valor, 12.5);
  assert.doesNotMatch(JSON.stringify(result), /private/);
  assert.equal(safeJourneyPayload('not-json'), undefined);
});

test('bounds malicious historical nested payloads before returning to browser', () => {
  const payload = { itens: Array.from({ length: 10000 }, () => ({ produtoId: 'p1', quantidade: 2 })) };
  assert.ok(JSON.stringify(safeJourneyPayload({ payload })).length < 5000);
});
