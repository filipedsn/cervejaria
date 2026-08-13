import { api } from './http.js';
import type { QaContext } from './types.js';

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

async function abrirCaixa(token: string, pontoVendaId: string) {
  const atual = await api<{ sessao?: { status: string } }>('GET', `/api/quiosque/caixa?pontoVendaId=${pontoVendaId}`, { token });
  if (atual.data?.sessao?.status === 'ABERTO') return;
  const abrir = await api('POST', '/api/quiosque/caixa/abrir', { token, body: { pontoVendaId, trocoInicial: 50 } });
  if (abrir.status !== 201) throw new Error(`Caixa não abriu: HTTP ${abrir.status}`);
}

function cfgQuiosque11(ctx: QaContext) {
  return ctx.configTenants?.find((c) => c.code === 'QUIOSQUE-11');
}

/** Happy path cozinha + estoque no tenant QUIOSQUE-11 (CFG). */
export async function runQuiosqueSmokeTests(ctx: QaContext, test: TestFn) {
  const cfg = cfgQuiosque11(ctx);
  if (!cfg?.pontoVendaId || !cfg.produtoPreparoId || !cfg.produtoId) {
    await test(
      { id: 'QSM-00', category: 'Quiosque smoke', name: 'Seed QUIOSQUE-11', requirement: 'QSM' },
      async () => ({ status: 'failed', message: 'QUIOSQUE-11 ausente ou incompleto no contexto' }),
    );
    return;
  }

  let pedidoId: string | null = null;
  let saldoInicial = 0;

  await test(
    { id: 'QSM-COZ-01', category: 'Quiosque smoke', name: 'Comanda com preparo entra na fila da cozinha', requirement: 'QSM-COZ' },
    async () => {
      try {
        await abrirCaixa(cfg.donoToken, cfg.pontoVendaId!);
      } catch (err) {
        return { status: 'failed', message: err instanceof Error ? err.message : String(err) };
      }

      const comanda = await api<{ id: string; pedidos?: Array<{ id: string }> }>('POST', '/api/quiosque/comandas', {
        token: cfg.donoToken,
        body: {
          pontoVendaId: cfg.pontoVendaId,
          tipo: 'APELIDO',
          identificador: `QSM-COZ-${Date.now()}`,
          itens: [{ produtoId: cfg.produtoPreparoId, quantidade: 1 }],
        },
      });
      if (comanda.status !== 201 || !comanda.data?.id) {
        return { status: 'failed', message: 'Comanda cozinha', expected: '201', actual: String(comanda.status) };
      }
      pedidoId = comanda.data.pedidos?.[0]?.id ?? null;
      if (!pedidoId) {
        return { status: 'failed', message: 'Pedido de preparo não criado' };
      }

      const fila = await api<Array<{ id: string; status: string }>>('GET', '/api/quiosque/cozinha', {
        token: cfg.donoToken,
      });
      if (fila.status !== 200) {
        return { status: 'failed', message: 'GET cozinha', expected: '200', actual: String(fila.status) };
      }
      const naFila = fila.data?.some((p) => p.id === pedidoId);
      if (!naFila) {
        return {
          status: 'failed',
          message: 'Pedido não apareceu na cozinha',
          expected: pedidoId,
          actual: fila.data?.map((p) => p.id).join(', ') ?? '[]',
        };
      }
      return { message: 'Pedido na fila RECEBIDO', expected: pedidoId, actual: 'visível' };
    },
  );

  await test(
    { id: 'QSM-COZ-02', category: 'Quiosque smoke', name: 'Fluxo cozinha RECEBIDO → ENTREGUE', requirement: 'QSM-COZ' },
    async () => {
      if (!pedidoId) return { status: 'failed', message: 'QSM-COZ-01 não rodou' };

      const steps: Array<'EM_PREPARO' | 'PRONTO' | 'ENTREGUE'> = ['EM_PREPARO', 'PRONTO', 'ENTREGUE'];
      for (const status of steps) {
        const r = await api<{ status: string }>('PATCH', `/api/quiosque/cozinha/${pedidoId}/status`, {
          token: cfg.donoToken,
          body: { status },
        });
        if (r.status !== 200 || r.data?.status !== status) {
          return {
            status: 'failed',
            message: `Transição para ${status}`,
            expected: status,
            actual: `${r.status} ${r.data?.status ?? r.raw.slice(0, 80)}`,
          };
        }
      }
      return { message: 'Cozinha RECEBIDO→ENTREGUE', expected: 'ENTREGUE', actual: 'ENTREGUE' };
    },
  );

  await test(
    { id: 'QSM-COZ-03', category: 'Quiosque smoke', name: 'Transição inválida → 409', requirement: 'QSM-COZ' },
    async () => {
      if (!pedidoId) return { status: 'failed', message: 'QSM-COZ-01 não rodou' };
      const r = await api('PATCH', `/api/quiosque/cozinha/${pedidoId}/status`, {
        token: cfg.donoToken,
        body: { status: 'RECEBIDO' },
      });
      if (r.status !== 409) {
        return { status: 'failed', message: 'ENTREGUE→RECEBIDO deve falhar', expected: '409', actual: String(r.status) };
      }
      return { message: '409 em transição inválida', expected: '409', actual: '409' };
    },
  );

  await test(
    { id: 'QSM-EST-01', category: 'Quiosque smoke', name: 'Listagem de saldos', requirement: 'QSM-EST' },
    async () => {
      const r = await api<Array<{ produtoId: string; quantidade: number }>>(
        'GET',
        `/api/quiosque/estoque?pontoVendaId=${cfg.pontoVendaId}`,
        { token: cfg.donoToken },
      );
      if (r.status !== 200 || !Array.isArray(r.data) || r.data.length === 0) {
        return { status: 'failed', message: 'Saldos iniciais', expected: '200 array', actual: String(r.status) };
      }
      const bebida = r.data.find((s) => s.produtoId === cfg.produtoId);
      saldoInicial = bebida?.quantidade ?? 0;
      return { message: `${r.data.length} produto(s) · bebida=${saldoInicial}`, expected: '≥0', actual: String(saldoInicial) };
    },
  );

  await test(
    { id: 'QSM-EST-02', category: 'Quiosque smoke', name: 'Entrada manual incrementa saldo', requirement: 'QSM-EST' },
    async () => {
      const r = await api<Array<{ produtoId: string; quantidade: number }>>('POST', '/api/quiosque/estoque/entrada', {
        token: cfg.donoToken,
        body: {
          pontoVendaId: cfg.pontoVendaId,
          produtoId: cfg.produtoId,
          quantidade: 5,
          observacao: 'QA entrada',
        },
      });
      if (r.status !== 201) {
        return { status: 'failed', message: 'Entrada estoque', expected: '201', actual: String(r.status) };
      }
      const bebida = r.data?.find((s) => s.produtoId === cfg.produtoId);
      const esperado = saldoInicial + 5;
      if ((bebida?.quantidade ?? 0) !== esperado) {
        return {
          status: 'failed',
          message: 'Saldo após entrada',
          expected: String(esperado),
          actual: String(bebida?.quantidade),
        };
      }
      saldoInicial = bebida!.quantidade;
      return { message: `Saldo ${saldoInicial}`, expected: String(esperado), actual: String(bebida?.quantidade) };
    },
  );

  await test(
    { id: 'QSM-EST-03', category: 'Quiosque smoke', name: 'Saída PERDA decrementa saldo', requirement: 'QSM-EST' },
    async () => {
      const r = await api<Array<{ produtoId: string; quantidade: number }>>('POST', '/api/quiosque/estoque/saida', {
        token: cfg.donoToken,
        body: {
          pontoVendaId: cfg.pontoVendaId,
          produtoId: cfg.produtoId,
          tipo: 'PERDA',
          quantidade: 2,
          observacao: 'QA perda',
        },
      });
      if (r.status !== 201) {
        return { status: 'failed', message: 'Saída estoque', expected: '201', actual: String(r.status) };
      }
      const bebida = r.data?.find((s) => s.produtoId === cfg.produtoId);
      const esperado = saldoInicial - 2;
      if ((bebida?.quantidade ?? 0) !== esperado) {
        return {
          status: 'failed',
          message: 'Saldo após perda',
          expected: String(esperado),
          actual: String(bebida?.quantidade),
        };
      }
      saldoInicial = bebida!.quantidade;
      return { message: `Saldo ${saldoInicial}`, expected: String(esperado), actual: String(bebida?.quantidade) };
    },
  );

  await test(
    { id: 'QSM-EST-04', category: 'Quiosque smoke', name: 'Ajuste define saldo absoluto', requirement: 'QSM-EST' },
    async () => {
      const alvo = saldoInicial + 10;
      const r = await api<Array<{ produtoId: string; quantidade: number }>>('POST', '/api/quiosque/estoque/ajuste', {
        token: cfg.donoToken,
        body: {
          pontoVendaId: cfg.pontoVendaId,
          produtoId: cfg.produtoId,
          quantidadeNova: alvo,
          observacao: 'QA ajuste',
        },
      });
      if (r.status !== 201) {
        return { status: 'failed', message: 'Ajuste estoque', expected: '201', actual: String(r.status) };
      }
      const bebida = r.data?.find((s) => s.produtoId === cfg.produtoId);
      if ((bebida?.quantidade ?? 0) !== alvo) {
        return { status: 'failed', message: 'Saldo após ajuste', expected: String(alvo), actual: String(bebida?.quantidade) };
      }
      return { message: `Ajuste OK → ${alvo}`, expected: String(alvo), actual: String(bebida?.quantidade) };
    },
  );
}
