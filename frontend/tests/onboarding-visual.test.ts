import assert from 'node:assert/strict';
import test from 'node:test';
import { getOnboardingVisualAction } from '../src/lib/onboarding-visual.ts';

test('tutorial visual: mapeia cada próximo passo para uma ação contextual estável', () => {
  const kiosk = getOnboardingVisualAction('QUIOSQUE_CASH_REGISTER', 'QUIOSQUE');
  assert.deepEqual(kiosk, {
    code: 'QUIOSQUE_CASH_REGISTER',
    module: 'QUIOSQUE',
    title: 'Abra o caixa para registrar vendas.',
    detail: 'Escolha o troco inicial e comece o turno.',
    cta: 'Abrir caixa',
    to: '/quiosque/caixa',
    target: 'quiosque-open-cash',
  });

  const brewery = getOnboardingVisualAction('CERVEJARIA_TAP', 'CERVEJARIA');
  assert.equal(brewery?.to, '/configuracoes/trailers');
  assert.equal(brewery?.target, 'brewery-configure-tap');
});

test('tutorial visual: não mistura ações entre módulos', () => {
  assert.equal(getOnboardingVisualAction('QUIOSQUE_PRODUCT', 'CERVEJARIA'), null);
  assert.equal(getOnboardingVisualAction('CERVEJARIA_PRODUCT', 'QUIOSQUE'), null);
});
