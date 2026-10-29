import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatPersonName, formatPersonNameInput } from './person-name.js';

describe('formatPersonName', () => {
  it('capitaliza cada palavra e normaliza espaços', () => {
    assert.equal(formatPersonName('  joão   silva '), 'João Silva');
    assert.equal(formatPersonName('MARIA'), 'Maria');
    assert.equal(formatPersonName('fIlIpE iGaRaPé'), 'Filipe Igarapé');
  });

  it('capitaliza partes ligadas por hífen', () => {
    assert.equal(formatPersonName('ana-paula costa'), 'Ana-Paula Costa');
  });
});

describe('formatPersonNameInput', () => {
  it('preserva espaço final durante a digitação', () => {
    assert.equal(formatPersonNameInput('joão '), 'João ');
    assert.equal(formatPersonNameInput('joão s'), 'João S');
  });
});
