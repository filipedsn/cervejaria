import assert from 'node:assert/strict';
import test from 'node:test';
import { getOnboardingVisualAction } from '../src/lib/onboarding-visual.ts';

test('tutorial visual: mapeia cada próximo passo para uma ação contextual estável', () => {
  const kiosk = getOnboardingVisualAction('CAIXA_CASH_REGISTER', 'CAIXA');
  assert.deepEqual(kiosk, {
    code: 'CAIXA_CASH_REGISTER',
    module: 'CAIXA',
    title: 'Abra o caixa para registrar vendas.',
    detail: 'Escolha o troco inicial e comece o turno.',
    cta: 'Abrir caixa',
    to: '/operacao/caixa',
    target: 'operacao-open-cash',
  });

  const brewery = getOnboardingVisualAction('CERVEJARIA_TAP', 'CERVEJARIA');
  assert.equal(brewery?.to, '/configuracoes/trailers');
  assert.equal(brewery?.target, 'brewery-configure-tap');
});

test('tutorial visual: não mistura ações entre módulos', () => {
  assert.equal(getOnboardingVisualAction('CAIXA_PRODUCT', 'CERVEJARIA'), null);
  assert.equal(getOnboardingVisualAction('CERVEJARIA_PRODUCT', 'CAIXA'), null);
});
