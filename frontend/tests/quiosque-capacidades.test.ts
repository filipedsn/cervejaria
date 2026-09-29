import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mensagemConfirmacaoEstoque,
  modoEmpresa,
  CAIXA_CAPACIDADES_INVALIDATION_KEYS,
} from '../src/lib/operacao-capacidades.ts';
import { getCervejariaNavItems, getComplementaryNavItems, getOperacaoNavItems, getOperationalModeNavItems, NAV_ITEMS_OPERACAO } from '../src/components/NavIcons.tsx';

test('TAP-42: identifica os três modos da empresa como informação', () => {
  assert.equal(modoEmpresa(true, false), 'Cervejaria');
  assert.equal(modoEmpresa(false, true), 'Operacao');
  assert.equal(modoEmpresa(true, true), 'Híbrida');
});

test('TAP-42: confirma desligamento preservando saldo e histórico', () => {
  const mensagem = mensagemConfirmacaoEstoque(false);
  assert.match(mensagem, /novas vendas não movimentarão o estoque/i);
  assert.match(mensagem, /saldos e históricos existentes serão preservados/i);
});

test('TAP-42: confirma reativação orientando revisão sem reconstrução implícita', () => {
  const mensagem = mensagemConfirmacaoEstoque(true);
  assert.match(mensagem, /não foram refletidas no saldo/i);
  assert.match(mensagem, /revise as quantidades/i);
});

test('TAP-42: invalida contexto, cozinha e estoque após salvar', () => {
  assert.deepEqual(CAIXA_CAPACIDADES_INVALIDATION_KEYS, [
    ['operacao-contexto'],
    ['operacao-cozinha'],
    ['operacao-estoque'],
  ]);
});

test('TAP-50: mostra abas complementares quando capabilities estao ativas', () => {
  assert.deepEqual(getComplementaryNavItems({ controlaEstoque: true, temCozinha: true }).map((item) => item.path), [
    '/operacao/cozinha',
    '/operacao/estoque',
  ]);
  assert.deepEqual(getComplementaryNavItems({ controlaEstoque: false, temCozinha: false }), []);
});

test('navigation exposes Comandas and the traditional product catalog by operating mode', () => {
  assert.equal(NAV_ITEMS_OPERACAO[0].shortLabel, 'Comandas');
  assert.deepEqual(getOperationalModeNavItems({ operationMode: 'CAIXA', cashRegisterEnabled: false }).map((item) => item.path), ['/operacao/comandas', '/operacao/catalogo']);
  assert.deepEqual(getOperationalModeNavItems({ operationMode: 'EVENTO', cashRegisterEnabled: true }).map((item) => item.path), ['/operacao/catalogo']);
});

test('cash-register mode does not duplicate the brewery Comandas entry', () => {
  const navItems = getCervejariaNavItems({ isDono: true, operationMode: 'CAIXA' });
  assert.equal(navItems.some((item) => item.path === '/comandas'), false);
  assert.deepEqual(getOperationalModeNavItems({ operationMode: 'CAIXA', cashRegisterEnabled: true }).map((item) => item.path), ['/operacao/comandas', '/operacao/catalogo']);
});

test('EVENTO navigation opens event commands and keeps CAIXA navigation unchanged', () => {
  const capabilities = { temCozinha: true, controlaEstoque: true, isDono: true };
  assert.equal(getOperacaoNavItems({ ...capabilities, operationMode: 'EVENTO' })[0].path, '/comandas');
  assert.equal(getOperacaoNavItems({ ...capabilities, operationMode: 'CAIXA' })[0].path, '/operacao/comandas');
});
