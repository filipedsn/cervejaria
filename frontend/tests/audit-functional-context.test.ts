import assert from 'node:assert/strict';
import test from 'node:test';
import {
  comandaAuditContext,
  compactIntent,
  currentAuditContext,
  pushAuditContext,
  resetAuditContext,
} from '../src/lib/audit-context.ts';
import {
  intentAlterarQuantidadeItem,
  intentFecharComanda,
  intentLancarItens,
  intentRemoverItem,
} from '../src/lib/audit-intents-comanda.ts';
import { flushAuditEvents, trackAction, trackPageView, trackUiError } from '../src/lib/audit-tracker.ts';

const comanda = {
  id: 'cmd1',
  numero: 42,
  tipo: 'MESA',
  identificador: '3',
  status: 'ABERTA',
  pontoVendaId: 'pv1',
  subtotal: 87.5,
  desconto: 0,
  total: 87.5,
  valorEmAberto: 0,
  cliente: { id: 'cli1', nome: 'Ana' },
  pedidos: [
    { numero: 7, itens: [{ id: 'it1', produtoId: 'p1', nome: 'Chopp Pilsen', quantidade: 2, volumeMl: 300 }] },
  ],
};

test('contexto de comanda resume numero, mesa e cliente e descarta vazios', () => {
  const ctx = comandaAuditContext(comanda);
  assert.equal(ctx.resumo, 'Comanda #42 · Mesa 3 · cliente Ana');
  assert.equal(ctx.comandaNumero, 42);
  assert.equal(ctx.clienteNome, 'Ana');
  assert.deepEqual(comandaAuditContext(null, 'cmd9'), { comandaId: 'cmd9' });
});

test('pilha de contexto mescla telas e remove ao desmontar', () => {
  resetAuditContext();
  const removeLayout = pushAuditContext({ pontoVendaId: 'pv1', vazio: '' });
  const removeScreen = pushAuditContext({ tela: 'operacao.comanda.detail', comandaNumero: 42 });
  assert.deepEqual(currentAuditContext(), { pontoVendaId: 'pv1', tela: 'operacao.comanda.detail', comandaNumero: 42 });
  removeScreen();
  assert.deepEqual(currentAuditContext(), { pontoVendaId: 'pv1' });
  removeLayout();
  assert.equal(currentAuditContext(), undefined);
});

test('incluir itens descreve produto, quantidade, volume e nunca o texto da observacao', () => {
  const intent = intentLancarItens([
    { produto: { id: 'p1', nome: 'Chopp Pilsen', precoUnit: '12.00' }, quantidade: 2, volumeMl: 300 },
    {
      produto: { id: 'p2', nome: 'Batata frita', precoUnit: '25.00' },
      quantidade: 1,
      observacao: 'cliente alérgico a amendoim',
      opcionais: [{ opcionalId: 'o1', nome: 'Cheddar', precoAdicional: 4, quantidade: 1 }],
    },
  ]);
  assert.equal(intent.summary, 'Incluir 2x Chopp Pilsen 300ml; 1x Batata frita (+ Cheddar, com observação)');
  assert.equal(intent.itensQuantidade, 3);
  const itens = intent.itens as Array<Record<string, unknown>>;
  assert.equal(itens[0]?.precoUnit, 12);
  assert.equal(itens[1]?.temObservacao, true);
  assert.equal(JSON.stringify(intent).includes('amendoim'), false);
});

test('remover e alterar quantidade resolvem o nome do item pela comanda', () => {
  assert.equal(intentRemoverItem(comanda, { itemId: 'it1', quantidade: 1 }).summary, 'Remover 1x Chopp Pilsen 300ml da senha 7');
  assert.equal(
    intentAlterarQuantidadeItem(comanda, { itemId: 'it1', quantidade: 3 }).summary,
    'Alterar quantidade de Chopp Pilsen 300ml de 2 para 3',
  );
});

test('fechar conta descreve formas, valores, desconto e pendencia', () => {
  const intent = intentFecharComanda({
    pagamentos: [{ forma: 'PIX', valor: 50 }, { forma: 'CARTAO_CREDITO', valor: 27.5 }],
    desconto: 10,
    descontoAnterior: 0,
    aplicarDesconto: true,
    deixarPendente: false,
  });
  assert.equal(intent.summary, 'Fechar a conta recebendo Pix R$ 50,00 + Crédito R$ 27,50 com desconto de R$ 10,00');
  assert.equal(intent.totalPago, 77.5);
  assert.equal(intent.formasPagamento, 'PIX,CARTAO_CREDITO');
});

test('compactIntent exige resumo', () => {
  assert.equal(compactIntent({ summary: '  ' }), undefined);
});

test('todo evento leva o contexto da tela; acao e erro levam intencao e retrato do contexto', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const events: Array<Record<string, unknown>> = [];
  globalThis.window = { location: { pathname: '/operacao/comandas/cmd1' } } as unknown as Window & typeof globalThis;
  globalThis.fetch = (async (_input, init) => {
    events.push(...JSON.parse(String(init?.body)).events);
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  resetAuditContext();
  const remove = pushAuditContext({ tela: 'operacao.comanda.detail', ...comandaAuditContext(comanda) });
  try {
    trackPageView('/operacao/comandas/cmd1');
    trackAction({
      operation: 'comanda.fechar',
      outcome: 'success',
      intent: { summary: 'Fechar a conta recebendo Pix R$ 87,50' },
    });
    trackUiError('Servidor indisponível', undefined, { handled: true }, 'ApiError', 'comanda.itens.incluir', {
      context: { resumo: 'Comanda #41' },
      intent: { summary: 'Incluir 1x Água' },
    });
    await flushAuditEvents();
    const [pageView, action, error] = events;
    assert.equal((pageView?.context as Record<string, unknown>).resumo, 'Comanda #42 · Mesa 3 · cliente Ana');
    assert.equal(pageView?.intent, undefined);
    assert.equal((action?.meta as Record<string, unknown>).actionOutcome, 'success');
    assert.equal((action?.intent as Record<string, unknown>).summary, 'Fechar a conta recebendo Pix R$ 87,50');
    assert.equal((error?.context as Record<string, unknown>).resumo, 'Comanda #41');
    assert.equal((error?.intent as Record<string, unknown>).summary, 'Incluir 1x Água');
  } finally {
    remove();
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
});
