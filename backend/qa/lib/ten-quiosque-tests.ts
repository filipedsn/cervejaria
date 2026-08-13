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

function expectStatus(actual: number, expected: number | number[], ctx: string): Outcome {
  const ok = Array.isArray(expected) ? expected.includes(actual) : actual === expected;
  if (ok) return { message: ctx, expected: String(expected), actual: String(actual) };
  return {
    status: 'failed',
    message: ctx,
    expected: Array.isArray(expected) ? expected.join('|') : String(expected),
    actual: String(actual),
  };
}

async function abrirCaixa(token: string, pontoVendaId: string) {
  const atual = await api<{ sessao?: { status: string } }>('GET', `/api/quiosque/caixa?pontoVendaId=${pontoVendaId}`, { token });
  if (atual.data?.sessao?.status === 'ABERTO') return;
  const abrir = await api('POST', '/api/quiosque/caixa/abrir', {
    token,
    body: { pontoVendaId, trocoInicial: 50 },
  });
  if (abrir.status !== 201) {
    throw new Error(`TEN-Q setup: falha ao abrir caixa (${abrir.status})`);
  }
}

interface RecursosTenantB {
  comandaId: string;
  pedidoId: string | null;
}

async function prepararRecursosB(b: ConfigTenantFixture): Promise<RecursosTenantB> {
  if (!b.pontoVendaId || !b.produtoId || !b.produtoPreparoId) {
    throw new Error('TEN-Q setup: tenant B sem ponto/produtos');
  }
  await abrirCaixa(b.donoToken, b.pontoVendaId);

  const comanda = await api<{ id: string; pedidos?: Array<{ id: string }> }>('POST', '/api/quiosque/comandas', {
    token: b.donoToken,
    body: {
      pontoVendaId: b.pontoVendaId,
      tipo: 'APELIDO',
      identificador: `TEN-Q-${Date.now()}`,
      itens: [{ produtoId: b.produtoPreparoId, quantidade: 1 }],
    },
  });
  if (comanda.status !== 201 || !comanda.data?.id) {
    throw new Error(`TEN-Q setup: comanda B nao criada (${comanda.status})`);
  }

  const pedidoId = comanda.data.pedidos?.[0]?.id ?? null;
  return { comandaId: comanda.data.id, pedidoId };
}

/** IDOR nas rotas /api/quiosque/* — token do tenant A acessando recursos do tenant B. */
export async function runTenQuiosqueTests(ctx: QaContext, test: TestFn) {
  const configs = ctx.configTenants ?? [];
  const a = configs.find((c) => c.code === 'QUIOSQUE-11');
  const b = configs.find((c) => c.code === 'QUIOSQUE-10');

  if (!a || !b || !a.pontoVendaId || !b.pontoVendaId || !b.produtoId) {
    await test(
      { id: 'TEN-Q-00', category: 'Multi-tenant Quiosque', name: 'Seed TEN-Q', requirement: 'TEN-Q' },
      async () => ({ status: 'failed', message: 'Configs QUIOSQUE-11/10 ausentes no contexto' }),
    );
    return;
  }

  let recursosB: RecursosTenantB;
  try {
    recursosB = await prepararRecursosB(b);
  } catch (err) {
    await test(
      { id: 'TEN-Q-00', category: 'Multi-tenant Quiosque', name: 'Setup recursos tenant B', requirement: 'TEN-Q' },
      async () => ({
        status: 'failed',
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return;
  }

  const idor: Array<[string, string, () => Promise<number>, number[]]> = [
    [
      'TEN-Q-01',
      'GET /quiosque/comandas/:id',
      async () => (await api('GET', `/api/quiosque/comandas/${recursosB.comandaId}`, { token: a.donoToken })).status,
      [404],
    ],
    [
      'TEN-Q-02',
      'PUT /quiosque/produtos/:id',
      async () =>
        (await api('PUT', `/api/quiosque/produtos/${b.produtoId}`, {
          token: a.donoToken,
          body: { nome: 'Hack TEN-Q' },
        })).status,
      [404],
    ],
    [
      'TEN-Q-03',
      'DELETE /quiosque/produtos/:id',
      async () => (await api('DELETE', `/api/quiosque/produtos/${b.produtoId}`, { token: a.donoToken })).status,
      [404],
    ],
    [
      'TEN-Q-04',
      'POST /quiosque/comandas (ponto de B)',
      async () =>
        (await api('POST', '/api/quiosque/comandas', {
          token: a.donoToken,
          body: {
            pontoVendaId: b.pontoVendaId,
            tipo: 'MESA',
            identificador: '99',
            itens: [{ produtoId: a.produtoId!, quantidade: 1 }],
          },
        })).status,
      [404],
    ],
    [
      'TEN-Q-05',
      'POST /quiosque/vendas (ponto de B)',
      async () =>
        (await api('POST', '/api/quiosque/vendas', {
          token: a.donoToken,
          body: {
            pontoVendaId: b.pontoVendaId,
            itens: [{ produtoId: b.produtoId!, quantidade: 1 }],
            pagamentos: [{ forma: 'PIX', valor: 8 }],
          },
        })).status,
      [400, 404],
    ],
    [
      'TEN-Q-06',
      'POST /quiosque/caixa/abrir (ponto de B)',
      async () =>
        (await api('POST', '/api/quiosque/caixa/abrir', {
          token: a.donoToken,
          body: { pontoVendaId: b.pontoVendaId, trocoInicial: 10 },
        })).status,
      [400, 404],
    ],
  ];

  if (recursosB.pedidoId) {
    idor.push([
      'TEN-Q-07',
      'PATCH /quiosque/cozinha/:id/status',
      async () =>
        (await api('PATCH', `/api/quiosque/cozinha/${recursosB.pedidoId}/status`, {
          token: a.donoToken,
          body: { status: 'EM_PREPARO' },
        })).status,
      [404],
    ]);
  }

  for (const [id, endpoint, call, expected] of idor) {
    await test(
      { id, category: 'Multi-tenant Quiosque', name: `${endpoint} — tenant B`, requirement: 'TEN-Q' },
      async () => expectStatus(await call(), expected, 'Cross-tenant bloqueado'),
    );
  }

  await test(
    { id: 'TEN-Q-08', category: 'Multi-tenant Quiosque', name: 'GET /quiosque/caixa?pontoVendaId=B', requirement: 'TEN-Q' },
    async () => {
      const r = await api<{ sessao?: { id: string; pontoVendaId: string } | null }>(
        'GET',
        `/api/quiosque/caixa?pontoVendaId=${b.pontoVendaId}`,
        { token: a.donoToken },
      );
      if (r.status === 404) return { message: 'Ponto de B nao visivel (404)' };
      if (r.data?.sessao?.pontoVendaId === b.pontoVendaId) {
        return {
          status: 'failed',
          message: 'Vazamento: sessao de caixa do tenant B exposta',
          expected: 'sessao null ou 404',
          actual: `sessao ponto=${r.data.sessao.pontoVendaId}`,
        };
      }
      return { message: 'Caixa de B nao exposto', actual: r.data?.sessao ? 'sessao parcial' : 'null' };
    },
  );

  await test(
    { id: 'TEN-Q-09', category: 'Multi-tenant Quiosque', name: 'GET /quiosque/estoque?pontoVendaId=B', requirement: 'TEN-Q' },
    async () => {
      const r = await api<Array<{ produtoId: string; quantidade: number }>>(
        'GET',
        `/api/quiosque/estoque?pontoVendaId=${b.pontoVendaId}`,
        { token: a.donoToken },
      );
      if (r.status === 404) return { message: 'Estoque de B bloqueado (404)' };
      const comSaldoB = (r.data ?? []).filter((s) => s.quantidade > 0);
      if (comSaldoB.length > 0) {
        return {
          status: 'failed',
          message: 'Vazamento: saldos do tenant B visiveis',
          expected: 'lista vazia ou 404',
          actual: `${comSaldoB.length} saldo(s)`,
        };
      }
      return { message: 'Sem saldos de B expostos' };
    },
  );

  await test(
    { id: 'TEN-Q-10', category: 'Multi-tenant Quiosque', name: 'Listagem produtos escopada', requirement: 'TEN-Q' },
    async () => {
      const r = await api<Array<{ id: string }>>('GET', '/api/quiosque/produtos', { token: a.donoToken });
      if (r.status !== 200) return expectStatus(r.status, 200, 'Produtos tenant A');
      const vazou = (r.data ?? []).some((p) => p.id === b.produtoId);
      if (vazou) {
        return { status: 'failed', message: 'Produto de B apareceu na listagem de A' };
      }
      return { message: 'Listagem isolada' };
    },
  );
}
