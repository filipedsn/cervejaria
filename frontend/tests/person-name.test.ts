import assert from 'node:assert/strict';
import test from 'node:test';
import { formatPersonName, formatPersonNameInput } from '../src/lib/person-name.ts';

test('formatPersonName capitaliza cada palavra', () => {
  assert.equal(formatPersonName('  joão   silva '), 'João Silva');
  assert.equal(formatPersonName('fIlIpE iGaRaPé'), 'Filipe Igarapé');
  assert.equal(formatPersonName('ana-paula'), 'Ana-Paula');
});

test('formatPersonNameInput preserva espaço final', () => {
  assert.equal(formatPersonNameInput('joão '), 'João ');
  assert.equal(formatPersonNameInput('joão s'), 'João S');
});
