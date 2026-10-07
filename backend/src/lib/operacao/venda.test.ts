import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calcularFinanceiroComanda, itemVaiParaCozinha, particionarItensParaPedidos, resolverItens, resolverPagamentos, resumoComanda, subtotalComandaEmCentavos, validarChopeDoTurno, VendaInvalidaError, type ItemResolvido } from './venda.js';

const linha = (nome: string, exigePreparo: boolean, prepararEmPedidoSeparado = false, quantidade = 1) => ({
  produtoId: nome, tapId: null, volumeMl: 0, nome, precoUnit: 10, quantidade, exigePreparo,
  prepararEmPedidoSeparado, controlaEstoque: true, paraViagem: false, observacao: null, opcionais: [],
}) satisfies ItemResolvido;

describe('particionarItensParaPedidos', () => {
  it('mantém o agrupamento antigo quando todas as linhas estão desmarcadas', () => {
    const itens = [linha('churrasquinho', true), linha('batata', true)];
    assert.deepEqual(particionarItensParaPedidos(itens, true), [itens]);
  });
  it('separa uma linha marcada das linhas comuns e deixa bebidas fora da cozinha', () => {
    const marcado = linha('churrasquinho', true, true);
    const comum = linha('batata', true);
    const bebida = linha('refrigerante', false);
    assert.deepEqual(particionarItensParaPedidos([marcado, comum, bebida], true), [[comum, bebida], [marcado]]);
  });
  it('cria um pedido para cada linha marcada e preserva quantidade na linha', () => {
    const um = linha('churrasquinho', true, true, 3);
    const dois = linha('milho', true, true);
    const comum = linha('batata', true);
    assert.deepEqual(particionarItensParaPedidos([um, comum, dois], true), [[comum], [um], [dois]]);
    assert.equal(particionarItensParaPedidos([um], true)[0]?.[0]?.quantidade, 3);
  });
  it('não divide um único item de preparo nem cria pedidos de cozinha quando desabilitada', () => {
    const marcado = linha('churrasquinho', true, true);
    const semPreparo = linha('refrigerante', false);
    assert.deepEqual(particionarItensParaPedidos([marcado], true), [[marcado]]);
    assert.deepEqual(particionarItensParaPedidos([marcado, semPreparo], false), [[marcado, semPreparo]]);
  });
});

describe('resolverItens independent-order authority', () => {
  it('only reads the persisted flag under the guarded activation and ignores a sale payload override', async () => {
    const previous = {
      flag: process.env.PDV_CANONICAL_CONFIG_QA, nodeEnv: process.env.NODE_ENV,
      isolated: process.env.PDV_ISOLATED_QA, db: process.env.DATABASE_URL, qa: process.env.QA_DATABASE_URL,
    };
    const qaUrl = 'postgresql://postgres:test@127.0.0.1:55439/cervejaria_qa_pdv_unico';
    Object.assign(process.env, { PDV_CANONICAL_CONFIG_QA: '1', NODE_ENV: 'test', PDV_ISOLATED_QA: '1', DATABASE_URL: qaUrl, QA_DATABASE_URL: qaUrl });
    let receivedSelect: Record<string, unknown> | undefined;
    const tx: any = { produto: { findMany: async ({ select }: { select: Record<string, unknown> }) => {
      receivedSelect = select;
      return [{ id: 'persisted-product', nome: 'Persisted', tipo: 'COMIDA', formato: null, categoria: 'Comida', pontoVendaId: 'point', exigePreparo: true, controlaEstoque: false, prepararEmPedidoSeparado: false, precos: [{ volumeMl: 1, preco: 10 }] }];
    } } };
    try {
      const resolved = await resolverItens(tx, 'tenant', [{ produtoId: 'persisted-product', quantidade: 1, prepararEmPedidoSeparado: true } as any]);
      assert.equal(receivedSelect?.prepararEmPedidoSeparado, true, 'canonical path explicitly requests the persisted scalar');
      assert.equal(resolved[0]?.prepararEmPedidoSeparado, false, 'payload cannot override the stored false value');
    } finally {
      for (const [key, value] of Object.entries({ PDV_CANONICAL_CONFIG_QA: previous.flag, NODE_ENV: previous.nodeEnv, PDV_ISOLATED_QA: previous.isolated, DATABASE_URL: previous.db, QA_DATABASE_URL: previous.qa })) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
});

describe('validarChopeDoTurno legacy schema compatibility', () => {
  it('uses the Trailer contract while activation is off and never queries Tap.pontoVendaId', async () => {
    const previous = process.env.PDV_CANONICAL_CONFIG_QA;
    delete process.env.PDV_CANONICAL_CONFIG_QA;
    const queries: any[] = [];
    const tx: any = { tapMontagem: { findFirst: async (args: any) => { queries.push(args); return { id: 'mount' }; } } };
    try {
      await validarChopeDoTurno(tx, 'session', 'legacy-trailer', 'point-present-on-session', 'company', [
        { id: 'beer', tipo: 'BEBIDA', formato: 'CHOPE', categoria: 'Chope', precos: [{ volumeMl: 500 }] },
      ], [{ produtoId: 'beer', quantidade: 1, tapId: 'legacy-tap', volumeMl: 500 }], true);
      assert.deepEqual(queries[0].where.tap, { trailerId: 'legacy-trailer', ativo: true }, 'older generated Prisma clients do not receive the newer pointVendaId field');
    } finally {
      if (previous === undefined) delete process.env.PDV_CANONICAL_CONFIG_QA;
      else process.env.PDV_CANONICAL_CONFIG_QA = previous;
    }
  });
});

describe('itemVaiParaCozinha', () => {
  it('não cria fila latente enquanto a cozinha está desligada', () => {
    assert.equal(itemVaiParaCozinha(false, true), false);
    assert.equal(itemVaiParaCozinha(true, true), true);
    assert.equal(itemVaiParaCozinha(true, false), false);
  });
});

describe('resolverPagamentos', () => {
  it('aceita lista vazia quando o devido é zero (cortesia)', () => {
    assert.deepEqual(resolverPagamentos([], 0), []);
  });

  it('rejeita lista vazia quando o devido é positivo', () => {
    assert.throws(() => resolverPagamentos([], 100), (err: unknown) => {
      assert.ok(err instanceof VendaInvalidaError);
      assert.match(err.message, /Informe como o cliente pagou/);
      return true;
    });
  });

  it('rejeita soma divergente do devido (pagamento stale)', () => {
    assert.throws(
      () => resolverPagamentos([{ forma: 'PIX', valor: 10 }], 500),
      (err: unknown) => {
        assert.ok(err instanceof VendaInvalidaError);
        assert.match(err.message, /pagamentos somam/);
        return true;
      },
    );
  });

  it('aceita pagamento que quita o devido', () => {
    const resolved = resolverPagamentos([{ forma: 'PIX', valor: 12.5 }], 1250);
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0]!.valor, 12.5);
    assert.equal(resolved[0]!.troco, null);
  });
});

describe('subtotalComandaEmCentavos', () => {
  it('conta pedidos entregues como consumo e mantém pedidos não entregues fora do total', () => {
    const comanda = {
      pedidosOperacao: [
        { id: 'batata', status: 'ENTREGUE', itensComanda: [{ precoUnit: 25, quantidade: 1, cancelamentoPendenteEm: null, canceladoEm: null }] },
        { id: 'costela', status: 'ENTREGUE', itensComanda: [{ precoUnit: 14, quantidade: 3, cancelamentoPendenteEm: null, canceladoEm: null }] },
        { id: 'boi', status: 'ENTREGUE', itensComanda: [{ precoUnit: 13, quantidade: 1, cancelamentoPendenteEm: null, canceladoEm: null }] },
        { id: 'pronto', status: 'PRONTO', itensComanda: [{ precoUnit: 17.67, quantidade: 3, exigePreparo: true, cancelamentoPendenteEm: null, canceladoEm: null }] },
      ],
      itens: [
        { pedidoCozinhaId: 'entregue', precoUnit: 14, quantidade: 1, cancelamentoPendenteEm: null, canceladoEm: null },
        { pedidoCozinhaId: 'pronto', precoUnit: 17.67, quantidade: 3, exigePreparo: true, cancelamentoPendenteEm: null, canceladoEm: null },
      ],
    } as unknown as Parameters<typeof subtotalComandaEmCentavos>[0];

    assert.equal(subtotalComandaEmCentavos(comanda), 8000);
  });

  it('includes kitchen items at launch when the preference is enabled', () => {
    const comanda = {
      pedidosOperacao: [
        { id: 'cozinha', status: 'RECEBIDO', itensComanda: [{ precoUnit: 8, quantidade: 1, exigePreparo: true, cancelamentoPendenteEm: null, canceladoEm: null }] },
      ],
      itens: [],
    } as unknown as Parameters<typeof subtotalComandaEmCentavos>[0];

    assert.equal(subtotalComandaEmCentavos(comanda, true), 800);
    assert.equal(subtotalComandaEmCentavos(comanda, false), 0);
  });
});

describe('calcularFinanceiroComanda', () => {
  it('charges kitchen items at launch when configured and removes them from pending value', () => {
    const financeiro = calcularFinanceiroComanda({
      status: 'ABERTA',
      kitchenItemsChargeAtLaunch: true,
      itensSemPedido: [],
      pedidos: [{
        status: 'RECEBIDO',
        itens: [{ precoUnit: 8, quantidade: 2, exigePreparo: true }],
      }],
    });

    assert.deepEqual(financeiro, { subtotal: 1600, valorEmAberto: 0, desconto: 0, total: 1600 });
  });
  it('inclui imediatamente item sem preparo de um pedido misto e mantém só o preparo em aberto', () => {
    const financeiro = calcularFinanceiroComanda({
      status: 'ABERTA',
      itensSemPedido: [],
      pedidos: [{
        status: 'RECEBIDO',
        itens: [
          { precoUnit: 4, quantidade: 4, exigePreparo: false },
          { precoUnit: 17, quantidade: 3, exigePreparo: true },
        ],
      }],
    });

    assert.deepEqual(financeiro, { subtotal: 1600, valorEmAberto: 5100, desconto: 0, total: 1600 });
  });

  it('mantem bebida ativa quando o ultimo item de preparo foi cancelado individualmente', () => {
    const financeiro = calcularFinanceiroComanda({
      status: 'ABERTA',
      itensSemPedido: [],
      pedidos: [{
        status: 'CANCELADO',
        itens: [
          { precoUnit: 14, quantidade: 1, exigePreparo: true, cancelamentoPendenteEm: null, canceladoEm: new Date() },
          { precoUnit: 13, quantidade: 1, exigePreparo: false, cancelamentoPendenteEm: null, canceladoEm: null },
        ],
      }],
    });

    assert.deepEqual(financeiro, { subtotal: 1300, valorEmAberto: 0, desconto: 0, total: 1300 });
  });

  it('mantem bebida ativa se o item cancelado ainda tiver a marca antiga de solicitacao', () => {
    const financeiro = calcularFinanceiroComanda({
      status: 'ABERTA',
      itensSemPedido: [],
      pedidos: [{
        status: 'CANCELADO',
        itens: [
          { precoUnit: 14, quantidade: 1, exigePreparo: true, cancelamentoPendenteEm: new Date(), canceladoEm: new Date() },
          { precoUnit: 13, quantidade: 1, exigePreparo: false, cancelamentoPendenteEm: null, canceladoEm: null },
        ],
      }],
    });

    assert.deepEqual(financeiro, { subtotal: 1300, valorEmAberto: 0, desconto: 0, total: 1300 });
  });

  it('exclui todos os itens quando o cancelamento integral do ticket esta pendente', () => {
    const financeiro = calcularFinanceiroComanda({
      status: 'ABERTA',
      itensSemPedido: [],
      pedidos: [{
        status: 'CANCELADO',
        itens: [
          { precoUnit: 14, quantidade: 1, exigePreparo: true, cancelamentoPendenteEm: new Date(), canceladoEm: null },
          { precoUnit: 13, quantidade: 1, exigePreparo: false, cancelamentoPendenteEm: null, canceladoEm: null },
        ],
      }],
    });

    assert.deepEqual(financeiro, { subtotal: 0, valorEmAberto: 0, desconto: 0, total: 0 });
  });

  it('compartilha consumido, aberto e total líquido com itens avulsos e pedidos', () => {
    const financeiro = calcularFinanceiroComanda({
      status: 'ABERTA',
      desconto: 5,
      itensSemPedido: [
        { precoUnit: 10, quantidade: 1, cancelamentoPendenteEm: null, canceladoEm: null },
        { precoUnit: 99, quantidade: 1, cancelamentoPendenteEm: null, canceladoEm: null, pedidoCozinhaId: 'pedido-pronto' },
      ],
      pedidos: [
        { status: 'ENTREGUE', itens: [{ precoUnit: 15, quantidade: 1, cancelamentoPendenteEm: null, canceladoEm: null }] },
        { status: 'PRONTO', itens: [{ precoUnit: 20, quantidade: 2, exigePreparo: true, cancelamentoPendenteEm: null, canceladoEm: null }] },
        { status: 'RECEBIDO', itens: [{ precoUnit: 13, quantidade: 1, exigePreparo: false, cancelamentoPendenteEm: null, canceladoEm: null }] },
        { status: 'CANCELADO', itens: [{ precoUnit: 50, quantidade: 1, exigePreparo: true, cancelamentoPendenteEm: null, canceladoEm: null }] },
      ],
    });

    assert.deepEqual(financeiro, { subtotal: 3800, valorEmAberto: 4000, desconto: 500, total: 3300 });
  });

  it('preserva o valor final persistido e zera valor em aberto após fechamento', () => {
    const financeiro = calcularFinanceiroComanda({
      status: 'FECHADA',
      totalPersistido: 17,
      itensSemPedido: [],
      pedidos: [{ status: 'RECEBIDO', itens: [{ precoUnit: 20, quantidade: 1 }] }],
    });

    assert.deepEqual(financeiro, { subtotal: 2000, valorEmAberto: 0, desconto: 0, total: 1700 });
  });
});

describe('resumoComanda e autoridade da cobrança de cozinha', () => {
  const comanda = {
    id: 'command-kitchen-authority', tipo: 'APELIDO', identificador: 'QA', numero: 1,
    cliente: null, status: 'ABERTA', pontoVendaId: 'point-kitchen-authority',
    createdAt: new Date('2026-10-05T12:00:00.000Z'), fechadaEm: null,
    total: 0, desconto: 0,
    pontoVenda: {
      configuracaoPdv: { kitchenItemsChargeAtLaunch: false },
      cervejaria: { configuracaoOperacional: { kitchenItemsChargeAtLaunch: true } },
    },
    evento: null,
    itens: [], pagamentos: [], contaReceber: null,
    pedidosOperacao: [{
      id: 'order-received', numero: 1, status: 'RECEBIDO', clienteAvisadoEm: null,
      paraViagem: false, observacao: null, createdAt: new Date('2026-10-05T12:01:00.000Z'),
      itensComanda: [{ id: 'item-prep', produtoId: 'product', nome: 'Prato', precoUnit: 10,
        quantidade: 1, exigePreparo: true, paraViagem: false, observacao: null,
        cancelamentoPendenteEm: null, canceladoEm: null, opcionais: [] }],
    }],
  } as unknown as Parameters<typeof resumoComanda>[0];

  it('com ativação desligada mantém o legado apesar de ConfiguracaoPontoVenda divergente', () => {
    const previous = process.env.PDV_CANONICAL_CONFIG_QA;
    delete process.env.PDV_CANONICAL_CONFIG_QA;
    try {
      // Contrato desligado: a relação aditiva não é autoridade. A chamada antiga
      // reproduz o bug retornando total=0/pendente=10 em vez do legado 10/0.
      const summary = resumoComanda(comanda);
      assert.deepEqual([summary.total, summary.valorEmAberto], [10, 0]);
    } finally {
      if (previous === undefined) delete process.env.PDV_CANONICAL_CONFIG_QA;
      else process.env.PDV_CANONICAL_CONFIG_QA = previous;
    }
  });

  it('permite que a configuração validada da requisição controle true e false', () => {
    const previous = { flag: process.env.PDV_CANONICAL_CONFIG_QA, db: process.env.DATABASE_URL, qa: process.env.QA_DATABASE_URL, isolated: process.env.PDV_ISOLATED_QA, nodeEnv: process.env.NODE_ENV };
    const target = 'postgresql://127.0.0.1:55439/cervejaria_qa_pdv_unico';
    Object.assign(process.env, { PDV_CANONICAL_CONFIG_QA: '1', DATABASE_URL: target, QA_DATABASE_URL: target, PDV_ISOLATED_QA: '1', NODE_ENV: 'test' });
    try {
      assert.throws(() => resumoComanda(comanda), (error: unknown) => (error as { code?: string }).code === 'CANONICAL_PDV_SETTINGS_CONTEXT_REQUIRED');
      assert.deepEqual([resumoComanda(comanda, true).total, resumoComanda(comanda, true).valorEmAberto], [10, 0]);
      assert.deepEqual([resumoComanda(comanda, false).total, resumoComanda(comanda, false).valorEmAberto], [0, 10]);
    } finally {
      for (const [key, value] of Object.entries({ PDV_CANONICAL_CONFIG_QA: previous.flag, DATABASE_URL: previous.db, QA_DATABASE_URL: previous.qa, PDV_ISOLATED_QA: previous.isolated, NODE_ENV: previous.nodeEnv })) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
});
