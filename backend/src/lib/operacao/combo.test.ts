import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ComboInvalidoError, converterProdutoEmCombo, fatorPrecoCombo, precoBaseCombo, ratearPrecoCombo, resolverEscolhasCombo, validarGruposCombo } from './combo.js';

const produto = (id: string, extra: Record<string, unknown> = {}) => ({
  id, nome: id, ativo: true, combo: false, tipo: 'COMIDA', formato: null, categoria: 'Comidas',
  exigePreparo: true, estacaoPreparo: 'COZINHA', controlaEstoque: true, ...extra,
});

const janta = [
  {
    id: 'g-churrasco', nome: 'Churrasquinho', minimo: 1, maximo: 1, somenteCardapioTurno: false, ordem: 0,
    opcoes: [
      { id: 'o-boi', produtoId: 'boi', precoNoCombo: 10, quantidade: 1, produto: produto('boi') },
      { id: 'o-frango', produtoId: 'frango', precoNoCombo: 8, quantidade: 1, produto: produto('frango') },
    ],
  },
  {
    id: 'g-acomp', nome: 'Acompanhamento', minimo: 1, maximo: 1, somenteCardapioTurno: false, ordem: 1,
    opcoes: [{ id: 'o-arroz', produtoId: 'arroz', precoNoCombo: 5, quantidade: 1, produto: produto('arroz', { controlaEstoque: false }) }],
  },
  {
    id: 'g-bebida', nome: 'Bebida', minimo: 0, maximo: 1, somenteCardapioTurno: false, ordem: 2,
    opcoes: [{ id: 'o-refri', produtoId: 'refri', precoNoCombo: 5, quantidade: 1, produto: produto('refri', { exigePreparo: false, tipo: 'BEBIDA' }) }],
  },
];

const txCom = (grupos: unknown[]) => ({ comboGrupo: { findMany: async () => grupos } }) as any;

describe('precoBaseCombo', () => {
  it('soma as opções mais baratas exigidas por grupo e ignora grupos opcionais', () => {
    assert.equal(precoBaseCombo(janta), 13);
  });
  it('considera a quantidade da opção e o mínimo maior que 1', () => {
    assert.equal(precoBaseCombo([{ minimo: 2, opcoes: [{ precoNoCombo: 4, quantidade: 2 }, { precoNoCombo: 3 }, { precoNoCombo: 9 }] }]), 11);
  });
});

describe('ratearPrecoCombo', () => {
  it('mantém os preços do combo quando o fator é 1', () => {
    assert.deepEqual(ratearPrecoCombo([{ precoNoCombo: 10, quantidade: 1 }, { precoNoCombo: 5, quantidade: 1 }, { precoNoCombo: 5, quantidade: 1 }], 1), [10, 5, 5]);
  });
  it('aplica o fator do cardápio proporcionalmente', () => {
    assert.deepEqual(ratearPrecoCombo([{ precoNoCombo: 10, quantidade: 1 }, { precoNoCombo: 5, quantidade: 1 }, { precoNoCombo: 5, quantidade: 1 }], 1.2), [12, 6, 6]);
  });
  it('joga a diferença de centavos no último componente de quantidade 1 para o total bater', () => {
    const linhas = [{ precoNoCombo: 10, quantidade: 1 }, { precoNoCombo: 10, quantidade: 1 }, { precoNoCombo: 10, quantidade: 1 }];
    const precos = ratearPrecoCombo(linhas, 25 / 30);
    assert.equal(Math.round(precos.reduce((soma, preco) => soma + preco * 100, 0)), 2500);
    assert.deepEqual(precos, [8.33, 8.33, 8.34]);
  });
  it('não ajusta componentes vendidos em quantidade maior que 1', () => {
    const precos = ratearPrecoCombo([{ precoNoCombo: 3.33, quantidade: 1 }, { precoNoCombo: 3.33, quantidade: 3 }], 1.1);
    assert.equal(precos[1], 3.66);
  });
});

describe('fatorPrecoCombo', () => {
  it('usa 1 quando o catálogo ainda não tem preço', () => {
    assert.equal(fatorPrecoCombo(20, 0), 1);
    assert.equal(fatorPrecoCombo(24, 20), 1.2);
  });
});

describe('validarGruposCombo', () => {
  const grupo = { nome: 'Churrasquinho', minimo: 1, maximo: 1, opcoes: [{ produtoId: 'boi', precoNoCombo: 10 }] };
  it('aceita uma composição simples', () => {
    assert.doesNotThrow(() => validarGruposCombo([grupo]));
  });
  it('exige ao menos um grupo obrigatório', () => {
    assert.throws(() => validarGruposCombo([{ ...grupo, minimo: 0 }]), ComboInvalidoError);
  });
  it('recusa máximo maior que a quantidade de produtos e produto repetido', () => {
    assert.throws(() => validarGruposCombo([{ ...grupo, maximo: 2 }]), /tem só 1/);
    assert.throws(() => validarGruposCombo([{ ...grupo, maximo: 2, opcoes: [grupo.opcoes[0]!, grupo.opcoes[0]!] }]), /repetido/);
  });
  it('recusa mínimo maior que o máximo', () => {
    assert.throws(() => validarGruposCombo([{ ...grupo, minimo: 2, maximo: 1, opcoes: [grupo.opcoes[0]!, { produtoId: 'frango', precoNoCombo: 8 }] }]), /máximo/);
  });
});

describe('resolverEscolhasCombo', () => {
  const base = { comboProdutoId: 'janta', comboNome: 'Janta', quantidade: 1, precoEfetivo: 13, precoCatalogo: 13 };

  it('devolve um componente por escolha com o preço dentro do combo', async () => {
    const componentes = await resolverEscolhasCombo(txCom(janta), {
      ...base,
      escolhas: [{ grupoId: 'g-churrasco', opcaoIds: ['o-boi'] }, { grupoId: 'g-acomp', opcaoIds: ['o-arroz'] }, { grupoId: 'g-bebida', opcaoIds: ['o-refri'] }],
    });
    assert.deepEqual(componentes.map((c) => [c.produtoId, c.precoUnit, c.quantidade, c.grupoNome]), [
      ['boi', 10, 1, 'Churrasquinho'], ['arroz', 5, 1, 'Acompanhamento'], ['refri', 5, 1, 'Bebida'],
    ]);
    assert.equal(componentes[0]!.exigePreparo, true);
    assert.equal(componentes[2]!.exigePreparo, false);
    assert.equal(componentes[1]!.controlaEstoque, false);
  });

  it('aplica o preço do cardápio e multiplica pela quantidade de combos', async () => {
    const componentes = await resolverEscolhasCombo(txCom(janta), {
      ...base, quantidade: 2, precoEfetivo: 15.6,
      escolhas: [{ grupoId: 'g-churrasco', opcaoIds: ['o-frango'] }, { grupoId: 'g-acomp', opcaoIds: ['o-arroz'] }],
    });
    assert.deepEqual(componentes.map((c) => [c.produtoId, c.precoUnit, c.quantidade]), [['frango', 9.6, 2], ['arroz', 6, 2]]);
  });

  it('exige o mínimo de cada grupo', async () => {
    await assert.rejects(
      resolverEscolhasCombo(txCom(janta), { ...base, escolhas: [{ grupoId: 'g-acomp', opcaoIds: ['o-arroz'] }] }),
      /Escolha 1 opção\(ões\) em "Churrasquinho"/,
    );
  });

  it('recusa mais escolhas que o máximo', async () => {
    await assert.rejects(
      resolverEscolhasCombo(txCom(janta), { ...base, escolhas: [{ grupoId: 'g-churrasco', opcaoIds: ['o-boi', 'o-frango'] }, { grupoId: 'g-acomp', opcaoIds: ['o-arroz'] }] }),
      /em "Churrasquinho"/,
    );
  });

  it('recusa opção ou grupo que não pertencem mais à composição', async () => {
    await assert.rejects(
      resolverEscolhasCombo(txCom(janta), { ...base, escolhas: [{ grupoId: 'g-churrasco', opcaoIds: ['o-coracao'] }, { grupoId: 'g-acomp', opcaoIds: ['o-arroz'] }] }),
      /composição de Janta mudou/,
    );
    await assert.rejects(
      resolverEscolhasCombo(txCom(janta), { ...base, escolhas: [{ grupoId: 'g-antigo', opcaoIds: ['o-boi'] }] }),
      /composição de Janta mudou/,
    );
  });

  it('recusa produto inativo e combo sem composição', async () => {
    const inativo = [{ ...janta[0]!, opcoes: [{ ...janta[0]!.opcoes[0]!, produto: produto('boi', { ativo: false }) }] }];
    await assert.rejects(
      resolverEscolhasCombo(txCom(inativo), { ...base, escolhas: [{ grupoId: 'g-churrasco', opcaoIds: ['o-boi'] }] }),
      /boi está indisponível/,
    );
    await assert.rejects(resolverEscolhasCombo(txCom([]), { ...base, escolhas: [] }), /ainda não tem composição/);
  });
});

describe('converterProdutoEmCombo', () => {
  const txConversao = (opts: { produto?: Record<string, unknown> | null; opcaoEmCombo?: unknown; saldo?: unknown } = {}) => {
    const chamadas = { opcionaisRemovidos: false, update: null as unknown };
    const tx = {
      produto: {
        findFirst: async () => (opts.produto === null ? null : { ...produto('jantinha'), precos: [{ volumeMl: 1 }], ...opts.produto }),
        update: async (args: { data: unknown }) => { chamadas.update = args.data; return { id: 'jantinha' }; },
      },
      comboGrupoOpcao: { findFirst: async () => opts.opcaoEmCombo ?? null },
      inventoryBalance: { findFirst: async () => opts.saldo ?? null },
      produtoOpcionalVinculo: { deleteMany: async () => { chamadas.opcionaisRemovidos = true; } },
    } as any;
    return { tx, chamadas };
  };

  it('vira combo sem estoque nem preparo próprios e sem opcionais', async () => {
    const { tx, chamadas } = txConversao();
    await converterProdutoEmCombo(tx, 'tenant', 'jantinha');
    assert.deepEqual(chamadas.update, { combo: true, exigePreparo: false, prepararEmPedidoSeparado: false, controlaEstoque: false });
    assert.equal(chamadas.opcionaisRemovidos, true);
  });

  it('recusa chope, produto que já é combo ou item de outro combo', async () => {
    await assert.rejects(converterProdutoEmCombo(txConversao({ produto: { tipo: 'BEBIDA', formato: 'CHOPE', categoria: 'Chope' } }).tx, 't', 'p'), /vendido por Tap/);
    await assert.rejects(converterProdutoEmCombo(txConversao({ produto: { combo: true } }).tx, 't', 'p'), /já é um combo/);
    await assert.rejects(
      converterProdutoEmCombo(txConversao({ opcaoEmCombo: { grupo: { comboProduto: { nome: 'Janta' } } } }).tx, 't', 'p'),
      /faz parte do combo Janta/,
    );
  });

  it('exige estoque zerado antes de converter', async () => {
    const { tx, chamadas } = txConversao({ saldo: { quantidade: 3 } });
    await assert.rejects(converterProdutoEmCombo(tx, 't', 'p'), /tem 3 un em estoque/);
    assert.equal(chamadas.update, null);
  });
});
