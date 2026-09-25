import { prisma } from '../../src/lib/prisma.js';
import { api } from './http.js';
import type { ConfigTenantFixture, QaContext } from './types.js';

type TestStatus = 'passed' | 'failed' | 'skipped' | 'warning';

interface Outcome {
  status?: TestStatus;
  message?: string;
  details?: string;
  expected?: string;
  actual?: string;
}

type TestFn = (
  meta: { id: string; category: string; name: string; requirement?: string },
  fn: () => Promise<Outcome>,
) => Promise<void>;

type Saldo = {
  produtoId: string;
  quantidade: number;
  estoqueMinimo?: number | null;
  statusEstoque?: 'NORMAL' | 'LOW' | 'OUT_OF_STOCK';
};

function saldoDe(lista: Saldo[] | undefined, produtoId: string): number {
  return lista?.find((s) => s.produtoId === produtoId)?.quantidade ?? 0;
}

/** Baixa por venda, estorno, saídas manuais e disputa pelo último item. */
export async function runQuiosqueEstoqueTests(ctx: QaContext, test: TestFn) {
  const cfg: ConfigTenantFixture | undefined = ctx.configTenants?.find((c) => c.code === 'QUIOSQUE-10');
  if (!cfg?.produtoId) {
    await test(
      { id: 'QES-00', category: 'Quiosque estoque', name: 'Seed QUIOSQUE-10', requirement: 'QES' },
      async () => ({ status: 'failed', message: 'QUIOSQUE-10 ausente ou incompleto no contexto' }),
    );
    return;
  }

  const stamp = Date.now();
  const PRECO = 8;
  let pontoId = '';
  let produtoSemControleId = '';

  async function saldoAtual(produtoId: string): Promise<number> {
    const r = await api<Saldo[]>('GET', `/api/operacao/estoque?pontoVendaId=${pontoId}`, { token: cfg.donoToken });
    return saldoDe(r.data, produtoId);
  }

  await test(
    { id: 'QES-01', category: 'Quiosque estoque', name: 'Setup ponto com caixa e estoque', requirement: 'QES-01' },
    async () => {
      const ponto = await api<{ id: string }>('POST', '/api/operacao/pontos-venda', {
        token: cfg.donoToken,
        body: { nome: `Estoque QA ${stamp}` },
      });
      if (ponto.status !== 201 || !ponto.data?.id) {
        return { status: 'failed', message: 'Criar ponto', expected: '201', actual: String(ponto.status) };
      }
      pontoId = ponto.data.id;

      const caixa = await api('POST', '/api/operacao/caixa/abrir', {
        token: cfg.donoToken,
        body: { pontoVendaId: pontoId, trocoInicial: 100 },
      });
      if (caixa.status !== 201) {
        return { status: 'failed', message: 'Abrir caixa', expected: '201', actual: String(caixa.status) };
      }

      const entrada = await api<Saldo[]>('POST', '/api/operacao/estoque/entrada', {
        token: cfg.donoToken,
        body: { pontoVendaId: pontoId, produtoId: cfg.produtoId, quantidade: 10, observacao: 'QA setup' },
      });
      if (entrada.status !== 201 || saldoDe(entrada.data, cfg.produtoId!) !== 10) {
        return {
          status: 'failed',
          message: 'Entrada inicial',
          expected: '201 / saldo 10',
          actual: `${entrada.status} / ${saldoDe(entrada.data, cfg.produtoId!)}`,
        };
      }
      return { message: 'Ponto com saldo 10', expected: '10', actual: '10' };
    },
  );

  await test(
    { id: 'QES-02', category: 'Quiosque estoque', name: 'Venda gera SAIDA_VENDA e baixa saldo', requirement: 'QES-02' },
    async () => {
      if (!pontoId) return { status: 'failed', message: 'QES-01 incompleto' };
      const venda = await api('POST', '/api/operacao/vendas', {
        token: cfg.donoToken,
        body: {
          pontoVendaId: pontoId,
          itens: [{ produtoId: cfg.produtoId, quantidade: 3 }],
          pagamentos: [{ forma: 'DINHEIRO', valor: PRECO * 3 }],
        },
      });
      if (venda.status !== 201) {
        return { status: 'failed', message: 'Venda', expected: '201', actual: `${venda.status} ${venda.raw.slice(0, 100)}` };
      }

      const saldo = await saldoAtual(cfg.produtoId!);
      if (saldo !== 7) {
        return { status: 'failed', message: 'Saldo após venda', expected: '7', actual: String(saldo) };
      }

      const mov = await prisma.inventoryMovement.findFirst({
        where: { cervejariaId: cfg.cervejariaId, pontoVendaId: pontoId, produtoId: cfg.produtoId, tipo: 'SAIDA_VENDA' },
        orderBy: { createdAt: 'desc' },
      });
      if (!mov || mov.quantidade !== 3) {
        return { status: 'failed', message: 'Movimento SAIDA_VENDA', expected: '3', actual: String(mov?.quantidade ?? 'ausente') };
      }
      return { message: 'Saldo 10→7 com SAIDA_VENDA', expected: '7', actual: '7' };
    },
  );

  await test(
    { id: 'QES-03', category: 'Quiosque estoque', name: 'Cancelar comanda estorna estoque', requirement: 'QES-03' },
    async () => {
      if (!pontoId) return { status: 'failed', message: 'QES-01 incompleto' };
      const antes = await saldoAtual(cfg.produtoId!);

      const comanda = await api<{ id: string }>('POST', '/api/operacao/comandas', {
        token: cfg.donoToken,
        body: {
          pontoVendaId: pontoId,
          tipo: 'MESA',
          identificador: `EST-${stamp}`,
          itens: [{ produtoId: cfg.produtoId, quantidade: 2 }],
        },
      });
      if (comanda.status !== 201 || !comanda.data?.id) {
        return { status: 'failed', message: 'Comanda com itens', expected: '201', actual: String(comanda.status) };
      }
      const durante = await saldoAtual(cfg.produtoId!);
      if (durante !== antes - 2) {
        return { status: 'failed', message: 'Baixa ao abrir comanda', expected: String(antes - 2), actual: String(durante) };
      }

      const cancel = await api('POST', `/api/operacao/comandas/${comanda.data.id}/cancelar`, { token: cfg.donoToken });
      if (cancel.status !== 200) {
        return { status: 'failed', message: 'Cancelar comanda', expected: '200', actual: String(cancel.status) };
      }

      const depois = await saldoAtual(cfg.produtoId!);
      if (depois !== antes) {
        return { status: 'failed', message: 'Saldo estornado', expected: String(antes), actual: String(depois) };
      }

      const mov = await prisma.inventoryMovement.findFirst({
        where: { cervejariaId: cfg.cervejariaId, pontoVendaId: pontoId, tipo: 'ESTORNO_VENDA' },
        orderBy: { createdAt: 'desc' },
      });
      if (!mov) return { status: 'failed', message: 'Movimento ESTORNO_VENDA ausente' };
      return { message: `Estorno devolveu ${mov.quantidade}`, expected: String(antes), actual: String(depois) };
    },
  );

  await test(
    { id: 'QES-04', category: 'Quiosque estoque', name: 'Saída CORTESIA e CONSUMO_INTERNO', requirement: 'QES-04' },
    async () => {
      if (!pontoId) return { status: 'failed', message: 'QES-01 incompleto' };
      const antes = await saldoAtual(cfg.produtoId!);

      const cortesia = await api<Saldo[]>('POST', '/api/operacao/estoque/saida', {
        token: cfg.donoToken,
        body: { pontoVendaId: pontoId, produtoId: cfg.produtoId, tipo: 'CORTESIA', quantidade: 1 },
      });
      const consumo = await api<Saldo[]>('POST', '/api/operacao/estoque/saida', {
        token: cfg.donoToken,
        body: { pontoVendaId: pontoId, produtoId: cfg.produtoId, tipo: 'CONSUMO_INTERNO', quantidade: 1 },
      });
      if (cortesia.status !== 201 || consumo.status !== 201) {
        return {
          status: 'failed',
          message: 'Saídas manuais',
          expected: '201/201',
          actual: `${cortesia.status}/${consumo.status}`,
        };
      }
      const depois = saldoDe(consumo.data, cfg.produtoId!);
      if (depois !== antes - 2) {
        return { status: 'failed', message: 'Saldo após saídas', expected: String(antes - 2), actual: String(depois) };
      }

      const tipos = await prisma.inventoryMovement.findMany({
        where: { pontoVendaId: pontoId, tipo: { in: ['CORTESIA', 'CONSUMO_INTERNO'] } },
        select: { tipo: true },
      });
      if (tipos.length < 2) {
        return { status: 'failed', message: 'Movimentos registrados', expected: '2', actual: String(tipos.length) };
      }
      return { message: `Saldo ${antes}→${depois}`, expected: String(antes - 2), actual: String(depois) };
    },
  );

  await test(
    { id: 'QES-05', category: 'Quiosque estoque', name: 'Venda sem saldo → 400 e rollback', requirement: 'QES-05' },
    async () => {
      if (!pontoId) return { status: 'failed', message: 'QES-01 incompleto' };
      const antes = await saldoAtual(cfg.produtoId!);

      const comandasAntes = await prisma.comanda.count({
        where: { origem: 'CAIXA', pontoVendaId: pontoId },
      });
      const r = await api<{ error?: string }>('POST', '/api/operacao/vendas', {
        token: cfg.donoToken,
        body: {
          pontoVendaId: pontoId,
          itens: [{ produtoId: cfg.produtoId, quantidade: antes + 5 }],
          pagamentos: [{ forma: 'DINHEIRO', valor: PRECO * (antes + 5) }],
        },
      });
      if (r.status !== 400) {
        return { status: 'failed', message: 'Venda sem saldo', expected: '400', actual: String(r.status) };
      }
      if (!r.data?.error?.includes('Estoque insuficiente')) {
        return { status: 'failed', message: 'Mensagem de estoque', expected: 'Estoque insuficiente...', actual: r.data?.error ?? '' };
      }

      const depois = await saldoAtual(cfg.produtoId!);
      const comandasDepois = await prisma.comanda.count({
        where: { origem: 'CAIXA', pontoVendaId: pontoId },
      });
      if (depois !== antes) {
        return { status: 'failed', message: 'Saldo alterado apesar do erro', expected: String(antes), actual: String(depois) };
      }
      if (comandasDepois !== comandasAntes) {
        return {
          status: 'failed',
          message: 'Comanda persistida apesar do rollback',
          expected: String(comandasAntes),
          actual: String(comandasDepois),
        };
      }
      return { message: 'Rollback completo da venda', expected: 'sem efeito', actual: 'sem efeito' };
    },
  );

  await test(
    { id: 'QES-06', category: 'Quiosque estoque', name: 'Disputa pelo último item: só uma venda vence', requirement: 'QES-06' },
    async () => {
      if (!pontoId) return { status: 'failed', message: 'QES-01 incompleto' };

      const ajuste = await api<Saldo[]>('POST', '/api/operacao/estoque/ajuste', {
        token: cfg.donoToken,
        body: { pontoVendaId: pontoId, produtoId: cfg.produtoId, quantidadeNova: 1, observacao: 'QA último item' },
      });
      if (ajuste.status !== 201 || saldoDe(ajuste.data, cfg.produtoId!) !== 1) {
        return { status: 'failed', message: 'Ajuste para 1', expected: '1', actual: String(saldoDe(ajuste.data, cfg.produtoId!)) };
      }

      const CONCORRENTES = 6;
      const respostas = await Promise.all(
        Array.from({ length: CONCORRENTES }, () =>
          api<{ error?: string }>('POST', '/api/operacao/vendas', {
            token: cfg.donoToken,
            body: {
              pontoVendaId: pontoId,
              itens: [{ produtoId: cfg.produtoId, quantidade: 1 }],
              pagamentos: [{ forma: 'DINHEIRO', valor: PRECO }],
            },
          }),
        ),
      );

      const ok = respostas.filter((r) => r.status === 201).length;
      const rejeitadas = respostas.filter((r) => r.status === 400).length;
      const inesperados = respostas.filter((r) => r.status !== 201 && r.status !== 400);
      const saldo = await saldoAtual(cfg.produtoId!);

      if (ok !== 1) {
        return {
          status: 'failed',
          message: 'Vendas simultâneas com 1 item em estoque',
          expected: '1 sucesso',
          actual: `${ok} sucesso(s), ${rejeitadas} rejeitada(s)`,
          details: respostas.map((r) => `${r.status}:${r.raw.slice(0, 60)}`).join(' | '),
        };
      }
      if (inesperados.length > 0) {
        return {
          status: 'failed',
          message: 'Concorrência devolveu status fora de 201/400',
          expected: `${CONCORRENTES - 1}x 400`,
          actual: inesperados.map((r) => String(r.status)).join(','),
          details: inesperados.map((r) => `${r.status}:${r.raw.slice(0, 120)}`).join(' | '),
        };
      }
      if (saldo !== 0) {
        return { status: 'failed', message: 'Saldo final', expected: '0', actual: String(saldo) };
      }
      return {
        message: `1 venda OK, ${rejeitadas} rejeitadas com 400, saldo 0`,
        expected: `1 sucesso / ${CONCORRENTES - 1}x 400 / saldo 0`,
        actual: `${ok} / ${rejeitadas} / ${saldo}`,
      };
    },
  );

  await test(
    { id: 'QES-07', category: 'Quiosque estoque', name: 'Produto sem controle não bloqueia venda', requirement: 'QES-07' },
    async () => {
      if (!pontoId) return { status: 'failed', message: 'QES-01 incompleto' };
      const produto = await api<{ id: string }>('POST', '/api/operacao/produtos', {
        token: cfg.donoToken,
        body: { nome: `Sem controle ${stamp}`, precoUnit: 5, exigePreparo: false, controlaEstoque: false },
      });
      if (produto.status !== 201 || !produto.data?.id) {
        return { status: 'failed', message: 'Criar produto sem controle', expected: '201', actual: `${produto.status} ${produto.raw.slice(0, 100)}` };
      }
      produtoSemControleId = produto.data.id;

      const venda = await api('POST', '/api/operacao/vendas', {
        token: cfg.donoToken,
        body: {
          pontoVendaId: pontoId,
          itens: [{ produtoId: produtoSemControleId, quantidade: 50 }],
          pagamentos: [{ forma: 'PIX', valor: 5 * 50 }],
        },
      });
      if (venda.status !== 201) {
        return { status: 'failed', message: 'Venda sem controle de estoque', expected: '201', actual: String(venda.status) };
      }
      return { message: 'Produto sem controle vende livremente', expected: '201', actual: '201' };
    },
  );

  await test(
    { id: 'QES-08', category: 'Quiosque estoque', name: 'Saída manual de produto sem controle → 400', requirement: 'QES-08' },
    async () => {
      if (!produtoSemControleId) return { status: 'failed', message: 'QES-07 incompleto' };
      const r = await api<{ error?: string }>('POST', '/api/operacao/estoque/saida', {
        token: cfg.donoToken,
        body: { pontoVendaId: pontoId, produtoId: produtoSemControleId, tipo: 'PERDA', quantidade: 1 },
      });
      if (r.status !== 400) {
        return { status: 'failed', message: 'Saída de produto sem controle', expected: '400', actual: String(r.status) };
      }
      return { message: 'Produto sem controle recusa movimento', expected: '400', actual: '400' };
    },
  );

  await test(
    { id: 'QES-09', category: 'Quiosque estoque', name: 'Ajuste com quantidade negativa → 400', requirement: 'QES-09' },
    async () => {
      if (!pontoId) return { status: 'failed', message: 'QES-01 incompleto' };
      const r = await api('POST', '/api/operacao/estoque/ajuste', {
        token: cfg.donoToken,
        body: { pontoVendaId: pontoId, produtoId: cfg.produtoId, quantidadeNova: -3 },
      });
      if (r.status !== 400) {
        return { status: 'failed', message: 'Ajuste negativo aceito', expected: '400', actual: String(r.status) };
      }
      return { message: 'Ajuste negativo rejeitado', expected: '400', actual: '400' };
    },
  );

  await test(
    { id: 'QES-11', category: 'Quiosque estoque', name: 'Ajuste absoluto normal preserva o valor contado', requirement: 'TQ-007-A' },
    async () => {
      if (!pontoId) return { status: 'failed', message: 'QES-01 incompleto' };
      const ajuste = await api<Saldo[]>('POST', '/api/operacao/estoque/ajuste', {
        token: cfg.donoToken,
        body: { pontoVendaId: pontoId, produtoId: cfg.produtoId, quantidadeNova: 10, observacao: 'TQ-007 ajuste normal' },
      });
      const saldo = saldoDe(ajuste.data, cfg.produtoId!);
      if (ajuste.status !== 201 || saldo !== 10) {
        return { status: 'failed', message: 'Ajuste absoluto', expected: '201 / saldo 10', actual: `${ajuste.status} / ${saldo}` };
      }
      return { message: 'Saldo ajustado para 10', expected: '10', actual: '10' };
    },
  );

  await test(
    { id: 'QES-14', category: 'Quiosque estoque', name: 'Mínimo alerta baixo e aceita limpeza', requirement: 'PROD-05' },
    async () => {
      if (!pontoId) return { status: 'failed', message: 'QES-01 incompleto' };

      const minimo = await api<Saldo[]>('PUT', '/api/operacao/estoque/minimo', {
        token: cfg.donoToken,
        body: { pontoVendaId: pontoId, produtoId: cfg.produtoId, estoqueMinimo: 10 },
      });
      if (minimo.status !== 200 || !Array.isArray(minimo.data)) {
        return { status: 'failed', message: 'Configurar mínimo', expected: '200 com saldos', actual: `${minimo.status} ${minimo.raw.slice(0, 120)}` };
      }
      const baixo = minimo.data.find((saldo) => saldo.produtoId === cfg.produtoId);
      if (baixo?.estoqueMinimo !== 10 || baixo.statusEstoque !== 'LOW') {
        return { status: 'failed', message: 'Mínimo configurado', expected: '200 / LOW / mínimo 10', actual: `${minimo.status} / ${baixo?.statusEstoque} / ${baixo?.estoqueMinimo}` };
      }

      const limpar = await api<Saldo[]>('PUT', '/api/operacao/estoque/minimo', {
        token: cfg.donoToken,
        body: { pontoVendaId: pontoId, produtoId: cfg.produtoId, estoqueMinimo: null },
      });
      if (limpar.status !== 200 || !Array.isArray(limpar.data)) {
        return { status: 'failed', message: 'Limpar mínimo', expected: '200 com saldos', actual: `${limpar.status} ${limpar.raw.slice(0, 120)}` };
      }
      const semMinimo = limpar.data.find((saldo) => saldo.produtoId === cfg.produtoId);
      if (semMinimo?.estoqueMinimo !== null || semMinimo.statusEstoque !== 'NORMAL') {
        return { status: 'failed', message: 'Limpar mínimo', expected: '200 / null / NORMAL', actual: `${limpar.status} / ${semMinimo?.estoqueMinimo} / ${semMinimo?.statusEstoque}` };
      }
      return { message: 'LOW derivado do saldo; mínimo é opcional', expected: 'LOW → NORMAL', actual: 'ok' };
    },
  );

  await test(
    { id: 'QES-12', category: 'Quiosque estoque', name: 'Ajuste absoluto concorrente com venda é serializado', requirement: 'TQ-007-B' },
    async () => {
      if (!pontoId) return { status: 'failed', message: 'QES-01 incompleto' };
      const inicio = new Date();
      const marcador = `TQ-007 concorrente ${stamp}`;
      const [ajuste, venda] = await Promise.all([
        api<Saldo[]>('POST', '/api/operacao/estoque/ajuste', {
          token: cfg.donoToken,
          body: { pontoVendaId: pontoId, produtoId: cfg.produtoId, quantidadeNova: 20, observacao: marcador },
        }),
        api('POST', '/api/operacao/vendas', {
          token: cfg.donoToken,
          body: {
            pontoVendaId: pontoId,
            itens: [{ produtoId: cfg.produtoId, quantidade: 1 }],
            pagamentos: [{ forma: 'DINHEIRO', valor: PRECO }],
          },
        }),
      ]);
      if (ajuste.status !== 201 || venda.status !== 201) {
        return { status: 'failed', message: 'Operações concorrentes', expected: '201/201', actual: `${ajuste.status}/${venda.status}` };
      }

      const [movAjuste, movVenda] = await Promise.all([
        prisma.inventoryMovement.findFirst({
          where: { pontoVendaId: pontoId, produtoId: cfg.produtoId, tipo: 'AJUSTE', observacao: marcador },
        }),
        prisma.inventoryMovement.findFirst({
          where: { pontoVendaId: pontoId, produtoId: cfg.produtoId, tipo: 'SAIDA_VENDA', createdAt: { gte: inicio } },
          orderBy: { createdAt: 'desc' },
        }),
      ]);
      if (!movAjuste || !movVenda) return { status: 'failed', message: 'Movimentos concorrentes ausentes' };

      const vendaAntesDoAjuste = movVenda.createdAt < movAjuste.createdAt;
      const esperado = vendaAntesDoAjuste ? 20 : 19;
      const saldo = await saldoAtual(cfg.produtoId!);
      if (saldo !== esperado) {
        return {
          status: 'failed',
          message: 'Saldo final não respeita a ordem serializada',
          expected: String(esperado),
          actual: String(saldo),
          details: `vendaAntesDoAjuste=${vendaAntesDoAjuste}; ajuste=${movAjuste.quantidade}`,
        };
      }
      return { message: `Ordem serializada; saldo ${saldo}`, expected: String(esperado), actual: String(saldo) };
    },
  );

  await test(
    { id: 'QES-13', category: 'Quiosque estoque', name: 'Saídas manuais concorrentes não deixam saldo negativo', requirement: 'TQ-007-C,D' },
    async () => {
      if (!pontoId) return { status: 'failed', message: 'QES-01 incompleto' };
      const ajuste = await api<Saldo[]>('POST', '/api/operacao/estoque/ajuste', {
        token: cfg.donoToken,
        body: { pontoVendaId: pontoId, produtoId: cfg.produtoId, quantidadeNova: 1, observacao: 'TQ-007 saída manual' },
      });
      if (ajuste.status !== 201) return { status: 'failed', message: 'Preparar saldo 1', actual: String(ajuste.status) };

      const respostas = await Promise.all(
        ['PERDA', 'CORTESIA'].map((tipo) =>
          api('POST', '/api/operacao/estoque/saida', {
            token: cfg.donoToken,
            body: { pontoVendaId: pontoId, produtoId: cfg.produtoId, tipo, quantidade: 1 },
          }),
        ),
      );
      const sucesso = respostas.filter((r) => r.status === 201).length;
      const insuficiente = respostas.filter((r) => r.status === 400).length;
      const saldo = await saldoAtual(cfg.produtoId!);
      if (sucesso !== 1 || insuficiente !== 1 || saldo !== 0) {
        return {
          status: 'failed',
          message: 'Concorrência de saídas manuais',
          expected: '1x 201 / 1x 400 / saldo 0',
          actual: `${sucesso}x 201 / ${insuficiente}x 400 / saldo ${saldo}`,
        };
      }
      return { message: 'Uma saída rejeitada sem saldo negativo', expected: '1/1/0', actual: '1/1/0' };
    },
  );

  await test(
    { id: 'QES-10', category: 'Quiosque estoque', name: 'Tenant sem controle não expõe /estoque → 404', requirement: 'QES-10' },
    async () => {
      const semEstoque = ctx.configTenants?.find((c) => c.code === 'QUIOSQUE-00');
      if (!semEstoque?.pontoVendaId) return { status: 'skipped', message: 'QUIOSQUE-00 ausente' };
      const r = await api('GET', `/api/operacao/estoque?pontoVendaId=${semEstoque.pontoVendaId}`, {
        token: semEstoque.donoToken,
      });
      if (r.status !== 404) {
        return { status: 'failed', message: 'Submódulo desligado', expected: '404', actual: String(r.status) };
      }
      return { message: 'Estoque indisponível sem o submódulo', expected: '404', actual: '404' };
    },
  );
}
