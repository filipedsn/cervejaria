import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiError } from './api';
import { classifyUserFacingError } from './report-user-facing-error';

describe('classifyUserFacingError', () => {
  it('classifies network ApiError (status 0)', () => {
    const classified = classifyUserFacingError(
      new ApiError('Não foi possível falar com o servidor. Tente de novo.', 0, undefined, 'corr-1'),
    );
    assert.equal(classified.kind, 'network');
    assert.equal(classified.scenario, 'network_unreachable');
    assert.equal(classified.httpStatus, 0);
    assert.equal(classified.correlationId, 'corr-1');
  });

  it('classifies 503 as api_server / server_unavailable', () => {
    const classified = classifyUserFacingError(
      new ApiError('Servidor temporariamente indisponível. Tente de novo em instantes.', 503),
    );
    assert.equal(classified.kind, 'api_server');
    assert.equal(classified.scenario, 'server_unavailable');
    assert.equal(classified.httpStatus, 503);
  });

  it('classifies validation with api code', () => {
    const classified = classifyUserFacingError(
      new ApiError('Horário conflita', 400, { code: 'AGENDA_HORARIO_CONFLITO' }),
    );
    assert.equal(classified.kind, 'validation');
    assert.equal(classified.apiCode, 'AGENDA_HORARIO_CONFLITO');
    assert.match(classified.scenario, /agenda_horario_conflito/i);
  });

  it('classifies TypeError as ui_bug', () => {
    const err = new TypeError('Cannot read properties of undefined');
    const classified = classifyUserFacingError(err);
    assert.equal(classified.kind, 'ui_bug');
    assert.equal(classified.scenario, 'ui_exception');
  });
});
