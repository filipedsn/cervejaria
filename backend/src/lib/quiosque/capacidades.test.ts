import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Prisma } from '@prisma/client';
import type { RegistrarTransacaoInput } from '../transacao-log.js';
import {
  atualizarCapacidadesQuiosque,
  CozinhaComPedidosAtivosError,
  ConfirmacaoEstoqueObrigatoriaError,
  QuiosqueInativoError,
  updateCapacidadesQuiosqueSchema,
} from './capacidades.js';

type Configuracao = {
  cervejariaId: string;
  ativo: boolean;
  exclusivo: boolean;
  controlaEstoque: boolean;
  temCozinha: boolean;
  usaCardapio: boolean;
  quantidadeMesas: number;
};

function criarCenario(
  overrides: Partial<Configuracao> = {},
  options: { pedidoAtivo?: boolean } = {},
) {
  let configuracao: Configuracao = {
    cervejariaId: 'tenant-a',
    ativo: true,
    exclusivo: false,
    controlaEstoque: false,
    temCozinha: false,
    usaCardapio: false,
    quantidadeMesas: 0,
    ...overrides,
  };
  let configuracaoOperacional = configuracao.ativo
    ? {
        cervejariaId: configuracao.cervejariaId,
        inventoryEnabled: configuracao.controlaEstoque,
        kitchenEnabled: configuracao.temCozinha,
      }
    : null;
  const auditorias: RegistrarTransacaoInput[] = [];
  let consultaPedido: unknown;
  let movimentosRetroativos = 0;

  const tx = {
    configuracaoQuiosque: {
      findUnique: async ({ where }: { where: { cervejariaId: string } }) =>
        where.cervejariaId === configuracao.cervejariaId ? configuracao : null,
      update: async ({ data }: { data: Partial<Configuracao> }) => {
        configuracao = { ...configuracao, ...data };
        return configuracao;
      },
    },
    configuracaoOperacional: {
      findUnique: async ({ where }: { where: { cervejariaId: string } }) =>
        where.cervejariaId === configuracao.cervejariaId ? configuracaoOperacional : null,
      upsert: async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        configuracaoOperacional = {
          ...(configuracaoOperacional ?? create),
          ...update,
        } as typeof configuracaoOperacional;
        return configuracaoOperacional;
      },
    },
    pedidoQuiosque: {
      findFirst: async (args: unknown) => {
        consultaPedido = args;
        return options.pedidoAtivo ? { id: 'pedido-ativo' } : null;
      },
    },
    movimentoEstoqueQuiosque: {
      create: async () => {
        movimentosRetroativos += 1;
      },
    },
  } as unknown as Prisma.TransactionClient;

  const audit = async (input: RegistrarTransacaoInput) => {
    auditorias.push(input);
    return null;
  };

  return {
    tx,
    audit,
    auditorias,
    configuracao: () => configuracao,
    configuracaoOperacional: () => configuracaoOperacional,
    consultaPedido: () => consultaPedido,
    movimentosRetroativos: () => movimentosRetroativos,
  };
}

const ator = {
  cervejariaId: 'tenant-a',
  usuarioId: 'user-a',
  papel: 'DONO' as const,
  origem: 'DONO' as const,
};

describe('atualizarCapacidadesQuiosque', () => {
  it('rejeita cervejariaId arbitrário no payload do DONO', () => {
    assert.throws(() =>
      updateCapacidadesQuiosqueSchema.parse({
        cervejariaId: 'tenant-b',
        temCozinha: true,
      }),
    );
  });

  it('ativa cozinha sem criar dados artificiais', async () => {
    const cenario = criarCenario();
    const result = await atualizarCapacidadesQuiosque(
      cenario.tx,
      { ...ator, temCozinha: true },
      cenario.audit,
    );

    assert.equal(result.temCozinha, true);
    assert.equal(cenario.consultaPedido(), undefined);
    assert.equal(cenario.auditorias.length, 1);
  });

  it('desativa cozinha sem pedidos ativos', async () => {
    const cenario = criarCenario({ temCozinha: true });
    const result = await atualizarCapacidadesQuiosque(
      cenario.tx,
      { ...ator, temCozinha: false },
      cenario.audit,
    );
    assert.equal(result.temCozinha, false);
  });

  for (const status of ['RECEBIDO', 'EM_PREPARO', 'PRONTO'] as const) {
    it(`bloqueia desativação da cozinha com pedido ${status}`, async () => {
      const cenario = criarCenario({ temCozinha: true }, { pedidoAtivo: true });

      await assert.rejects(
        atualizarCapacidadesQuiosque(
          cenario.tx,
          { ...ator, temCozinha: false },
          cenario.audit,
        ),
        CozinhaComPedidosAtivosError,
      );
      const consulta = cenario.consultaPedido() as {
        where: { status: { in: string[] }; cervejariaId: string };
      };
      assert.ok(consulta.where.status.in.includes(status));
      assert.equal(consulta.where.cervejariaId, 'tenant-a');
      assert.equal(cenario.configuracao().temCozinha, true);
    });
  }

  it('exige confirmação explícita para desligar estoque', async () => {
    const cenario = criarCenario({ controlaEstoque: true });
    await assert.rejects(
      atualizarCapacidadesQuiosque(
        cenario.tx,
        { ...ator, controlaEstoque: false },
        cenario.audit,
      ),
      ConfirmacaoEstoqueObrigatoriaError,
    );
    assert.equal(cenario.configuracao().controlaEstoque, true);
  });

  it('desativa estoque com confirmação e audita before/after', async () => {
    const cenario = criarCenario({ controlaEstoque: true });
    await atualizarCapacidadesQuiosque(
      cenario.tx,
      { ...ator, controlaEstoque: false, confirmacaoEstoque: true },
      cenario.audit,
    );

    assert.equal(cenario.configuracao().controlaEstoque, false);
    assert.equal(cenario.auditorias[0]?.metadata?.valorAnterior, true);
    assert.equal(cenario.auditorias[0]?.metadata?.valorNovo, false);
    assert.equal(cenario.auditorias[0]?.metadata?.origem, 'DONO');
  });

  it('reativa estoque somente com confirmação e sem reconstruir movimentos', async () => {
    const cenario = criarCenario({ controlaEstoque: false });
    await assert.rejects(
      atualizarCapacidadesQuiosque(
        cenario.tx,
        { ...ator, controlaEstoque: true },
        cenario.audit,
      ),
      ConfirmacaoEstoqueObrigatoriaError,
    );

    await atualizarCapacidadesQuiosque(
      cenario.tx,
      { ...ator, controlaEstoque: true, confirmacaoEstoque: true },
      cenario.audit,
    );
    assert.equal(cenario.configuracao().controlaEstoque, true);
    assert.equal(cenario.movimentosRetroativos(), 0);
    assert.equal(cenario.auditorias[0]?.metadata?.avisoDivergenciaSaldoConfirmado, true);
  });

  it('bloqueia empresa sem Quiosque ativo', async () => {
    const cenario = criarCenario({ ativo: false });
    await assert.rejects(
      atualizarCapacidadesQuiosque(
        cenario.tx,
        { ...ator, temCozinha: true },
        cenario.audit,
      ),
      QuiosqueInativoError,
    );
  });

  it('mantém a operação limitada ao tenant informado', async () => {
    const cenario = criarCenario();
    await assert.rejects(
      atualizarCapacidadesQuiosque(
        cenario.tx,
        { ...ator, cervejariaId: 'tenant-b', temCozinha: true },
        cenario.audit,
      ),
      QuiosqueInativoError,
    );
    assert.equal(cenario.configuracao().temCozinha, false);
  });

  it('registra origem ADMIN sem permitir alteração do modo principal', async () => {
    const cenario = criarCenario({ exclusivo: true });
    await atualizarCapacidadesQuiosque(
      cenario.tx,
      {
        cervejariaId: 'tenant-a',
        usuarioId: 'admin-a',
        papel: 'ADMIN',
        origem: 'ADMIN',
        temCozinha: true,
      },
      cenario.audit,
    );
    assert.equal(cenario.configuracao().exclusivo, true);
    assert.equal(cenario.auditorias[0]?.metadata?.papel, 'ADMIN');
  });
});
