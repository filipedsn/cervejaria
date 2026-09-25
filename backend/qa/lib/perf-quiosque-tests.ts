import type { Socket } from 'socket.io-client';
import { API_BASE, api, percentile } from './http.js';
import type { ConfigTenantFixture, PerfMetric, QaContext } from './types.js';

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

type BenchFn = (
  label: string,
  samples: number,
  target: number,
  fn: () => Promise<number>,
) => Promise<PerfMetric>;

const PRECO = 8;
const SOCKET_TARGET_MS = 500;

async function connectStaff(token: string): Promise<Socket> {
  const { io: ioClient } = await import('socket.io-client');
  const socket = ioClient(API_BASE, {
    transports: ['websocket'],
    timeout: 5000,
    reconnection: false,
    auth: { token },
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout no handshake')), 8000);
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  return socket;
}

function settle(ms = 350) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Performance do quiosque: PDV, fila da cozinha, disputa de estoque e a
 * latência entre o POST HTTP e a chegada do evento na room do Socket.IO.
 */
export async function runPerfQuiosqueTests(ctx: QaContext, bench: BenchFn, test: TestFn) {
  const pdv: ConfigTenantFixture | undefined = ctx.configTenants?.find((c) => c.code === 'QUIOSQUE-10');
  const cozinha: ConfigTenantFixture | undefined = ctx.configTenants?.find((c) => c.code === 'QUIOSQUE-11');

  if (!pdv?.produtoId || !cozinha?.produtoPreparoId) {
    await test(
      { id: 'RNF-Q00', category: 'Não-funcional', name: 'Seed de performance do quiosque', requirement: 'RNF-Q' },
      async () => ({ status: 'failed', message: 'Fixtures QUIOSQUE-10/11 ausentes no contexto' }),
    );
    return;
  }

  const stamp = Date.now();

  /** Ponto de venda dedicado com caixa aberto e, se houver controle, estoque. */
  async function abrirPonto(cfg: ConfigTenantFixture, nome: string, estoque?: { produtoId: string; quantidade: number }) {
    const ponto = await api<{ id: string }>('POST', '/api/operacao/pontos-venda', {
      token: cfg.donoToken,
      body: { nome },
    });
    if (ponto.status !== 201 || !ponto.data?.id) return null;

    const caixa = await api('POST', '/api/operacao/caixa/abrir', {
      token: cfg.donoToken,
      body: { pontoVendaId: ponto.data.id, trocoInicial: 200 },
    });
    if (caixa.status !== 201) return null;

    if (estoque) {
      const entrada = await api('POST', '/api/operacao/estoque/entrada', {
        token: cfg.donoToken,
        body: { pontoVendaId: ponto.data.id, produtoId: estoque.produtoId, quantidade: estoque.quantidade, observacao: 'QA perf' },
      });
      if (entrada.status !== 201) return null;
    }

    return ponto.data.id;
  }

  const pontoPdv = await abrirPonto(pdv, `Perf PDV ${stamp}`, { produtoId: pdv.produtoId, quantidade: 400 });
  const pontoCozinha = await abrirPonto(cozinha, `Perf Cozinha ${stamp}`, {
    produtoId: cozinha.produtoPreparoId,
    quantidade: 400,
  });

  await test(
    { id: 'RNF-Q01', category: 'Não-funcional', name: 'Setup dos pontos de performance', requirement: 'RNF-Q01' },
    async () => {
      if (!pontoPdv || !pontoCozinha) {
        return {
          status: 'failed',
          message: 'Ponto de venda com caixa e estoque',
          expected: 'dois pontos prontos',
          actual: `pdv=${pontoPdv ?? 'falhou'} cozinha=${pontoCozinha ?? 'falhou'}`,
        };
      }
      return { message: 'Pontos com caixa aberto e 400 unidades', expected: '2 pontos', actual: '2' };
    },
  );

  if (!pontoPdv || !pontoCozinha) return;

  await bench('POST /api/operacao/vendas (PDV)', 30, 800, async () => {
    const r = await api('POST', '/api/operacao/vendas', {
      token: pdv.donoToken,
      body: {
        pontoVendaId: pontoPdv,
        itens: [{ produtoId: pdv.produtoId, quantidade: 1 }],
        pagamentos: [{ forma: 'DINHEIRO', valor: PRECO }],
      },
    });
    if (r.status !== 201) throw new Error(`HTTP ${r.status}`);
    return r.durationMs;
  });

  await bench('POST /api/operacao/comandas (preparo)', 20, 900, async () => {
    const r = await api('POST', '/api/operacao/comandas', {
      token: cozinha.donoToken,
      body: {
        pontoVendaId: pontoCozinha,
        tipo: 'FICHA',
        identificador: `PERF-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        itens: [{ produtoId: cozinha.produtoPreparoId, quantidade: 1 }],
      },
    });
    if (r.status !== 201) throw new Error(`HTTP ${r.status}`);
    return r.durationMs;
  });

  await bench('GET /api/operacao/cozinha', 30, 600, async () => {
    const r = await api('GET', '/api/operacao/cozinha', { token: cozinha.donoToken });
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    return r.durationMs;
  });

  await test(
    {
      id: 'RNF-Q02',
      category: 'Não-funcional',
      name: 'Carga concorrente de baixa de estoque (20 vendas)',
      requirement: 'RNF-Q02',
    },
    async () => {
      const ponto = await abrirPonto(pdv, `Perf Carga ${Date.now()}`, { produtoId: pdv.produtoId!, quantidade: 20 });
      if (!ponto) return { status: 'failed', message: 'Setup do ponto de carga' };

      const inicio = performance.now();
      const respostas = await Promise.all(
        Array.from({ length: 20 }, () =>
          api('POST', '/api/operacao/vendas', {
            token: pdv.donoToken,
            body: {
              pontoVendaId: ponto,
              itens: [{ produtoId: pdv.produtoId, quantidade: 1 }],
              pagamentos: [{ forma: 'PIX', valor: PRECO }],
            },
          }),
        ),
      );
      const totalMs = performance.now() - inicio;

      const ok = respostas.filter((r) => r.status === 201).length;
      const erros5xx = respostas.filter((r) => r.status >= 500);
      if (erros5xx.length > 0) {
        return {
          status: 'failed',
          message: 'Falha interna sob concorrência',
          expected: '0 respostas 5xx',
          actual: `${erros5xx.length} (${erros5xx[0]!.raw.slice(0, 120)})`,
        };
      }
      if (ok !== 20) {
        return { status: 'failed', message: 'Vendas confirmadas', expected: '20', actual: String(ok) };
      }

      const saldo = await api<Array<{ produtoId: string; quantidade: number }>>(
        'GET',
        `/api/operacao/estoque?pontoVendaId=${ponto}`,
        { token: pdv.donoToken },
      );
      const restante = saldo.data?.find((s) => s.produtoId === pdv.produtoId)?.quantidade ?? -1;
      if (restante !== 0) {
        return { status: 'failed', message: 'Saldo final', expected: '0', actual: String(restante) };
      }

      const latencias = respostas.map((r) => r.durationMs);
      const p95 = Math.round(percentile(latencias, 95));
      return {
        message: `20/20 vendas em ${Math.round(totalMs)} ms (p95 ${p95} ms), estoque zerado sem 5xx`,
        expected: '20 vendas / saldo 0',
        actual: `20 / 0`,
      };
    },
  );

  await test(
    {
      id: 'RNF-Q03',
      category: 'Não-funcional',
      name: 'Latência de entrega do evento Socket.IO',
      requirement: 'RNF-Q03',
    },
    async () => {
      let socket: Socket;
      try {
        socket = await connectStaff(cozinha.donoToken);
      } catch (err) {
        return { status: 'failed', message: `Conexão falhou: ${err instanceof Error ? err.message : String(err)}` };
      }

      try {
        socket.emit('join:cervejaria', cozinha.cervejariaId);
        await settle();

        const amostras: number[] = [];
        for (let i = 0; i < 10; i += 1) {
          const chegada = new Promise<number | null>((resolve) => {
            const timer = setTimeout(() => {
              socket.off('operacao:pedido-novo', handler);
              resolve(null);
            }, 4000);
            const handler = () => {
              clearTimeout(timer);
              socket.off('operacao:pedido-novo', handler);
              resolve(performance.now());
            };
            socket.on('operacao:pedido-novo', handler);
          });

          const t0 = performance.now();
          const venda = await api('POST', '/api/operacao/comandas', {
            token: cozinha.donoToken,
            body: {
              pontoVendaId: pontoCozinha,
              tipo: 'FICHA',
              identificador: `RT-${Date.now()}-${i}`,
              itens: [{ produtoId: cozinha.produtoPreparoId, quantidade: 1 }],
            },
          });
          if (venda.status !== 201) {
            return { status: 'failed', message: 'Criar pedido de preparo', expected: '201', actual: String(venda.status) };
          }

          const recebido = await chegada;
          if (recebido === null) {
            return {
              status: 'failed',
              message: 'Evento operacao:pedido-novo não chegou em 4 s',
              expected: '10 eventos',
              actual: `${amostras.length} recebidos`,
            };
          }
          amostras.push(recebido - t0);
        }

        const p50 = Math.round(percentile(amostras, 50));
        const p95 = Math.round(percentile(amostras, 95));
        if (p95 > SOCKET_TARGET_MS) {
          return {
            status: 'failed',
            message: 'Latência de entrega acima do alvo',
            expected: `p95 ≤ ${SOCKET_TARGET_MS} ms`,
            actual: `p95 ${p95} ms`,
          };
        }
        return {
          message: `Evento entregue em p50 ${p50} ms / p95 ${p95} ms (POST → room)`,
          expected: `p95 ≤ ${SOCKET_TARGET_MS} ms`,
          actual: `${p95} ms`,
        };
      } finally {
        socket.disconnect();
      }
    },
  );
}
