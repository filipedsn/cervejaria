import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FechadoEmCaixaInvalidoError, resolverFechadoEmInformado } from './fechado-em-caixa.js';

describe('resolverFechadoEmInformado', () => {
  const abertoEm = new Date('2026-10-28T18:00:00.000Z');
  const ultima = new Date('2026-10-28T23:40:00.000Z');
  const agora = new Date('2026-10-29T11:00:00.000Z');

  it('usa agora quando não informado', () => {
    const result = resolverFechadoEmInformado({
      abertoEm,
      ultimaComandaFechadaEm: ultima,
      agora,
    });
    assert.equal(result.toISOString(), agora.toISOString());
  });

  it('aceita horário entre última comanda e agora', () => {
    const informado = new Date('2026-10-28T23:50:00.000Z');
    const result = resolverFechadoEmInformado({
      informado,
      abertoEm,
      ultimaComandaFechadaEm: ultima,
      agora,
    });
    assert.equal(result.toISOString(), informado.toISOString());
  });

  it('rejeita antes da última comanda', () => {
    assert.throws(
      () => resolverFechadoEmInformado({
        informado: new Date('2026-10-28T23:00:00.000Z'),
        abertoEm,
        ultimaComandaFechadaEm: ultima,
        agora,
      }),
      (err: unknown) => err instanceof FechadoEmCaixaInvalidoError
        && /última comanda/.test(err.message),
    );
  });

  it('rejeita futuro', () => {
    assert.throws(
      () => resolverFechadoEmInformado({
        informado: new Date('2026-10-29T12:00:00.000Z'),
        abertoEm,
        ultimaComandaFechadaEm: ultima,
        agora,
      }),
      FechadoEmCaixaInvalidoError,
    );
  });
});
