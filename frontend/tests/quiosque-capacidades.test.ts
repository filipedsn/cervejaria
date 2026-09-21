import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mensagemConfirmacaoEstoque,
  modoEmpresa,
  QUIOSQUE_CAPACIDADES_INVALIDATION_KEYS,
} from '../src/lib/quiosque-capacidades.ts';
import { getComplementaryNavItems, getOperationalModeNavItems, NAV_ITEMS_QUIOSQUE } from '../src/components/NavIcons.tsx';

test('TAP-42: identifica os três modos da empresa como informação', () => {
  assert.equal(modoEmpresa(true, false), 'Cervejaria');
  assert.equal(modoEmpresa(false, true), 'Quiosque');
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
  assert.deepEqual(QUIOSQUE_CAPACIDADES_INVALIDATION_KEYS, [
    ['quiosque-contexto'],
    ['quiosque-cozinha'],
    ['quiosque-estoque'],
  ]);
});

test('TAP-50: mostra abas complementares quando capabilities estao ativas', () => {
  assert.deepEqual(getComplementaryNavItems({ controlaEstoque: true, temCozinha: true }).map((item) => item.path), [
    '/quiosque/cozinha',
    '/quiosque/estoque',
  ]);
  assert.deepEqual(getComplementaryNavItems({ controlaEstoque: false, temCozinha: false }), []);
});

test('navigation exposes Caixa only for the CAIXA mode', () => {
  assert.equal(NAV_ITEMS_QUIOSQUE[0].shortLabel, 'Caixa');
  assert.deepEqual(getOperationalModeNavItems({ operationMode: 'CAIXA', cashRegisterEnabled: false }).map((item) => item.path), ['/quiosque/caixa']);
  assert.deepEqual(getOperationalModeNavItems({ operationMode: 'EVENTO', cashRegisterEnabled: true }), []);
  assert.notEqual(NAV_ITEMS_QUIOSQUE[0].shortLabel, 'Quiosque');
  assert.notEqual(NAV_ITEMS_QUIOSQUE[0].shortLabel, 'Estabelecimento');
});
