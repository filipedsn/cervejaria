import { api, uniqueStaffComandaBody, chopeItemBody } from './http.js';
import { ensureTenantEventoAberto } from './tenant-evento.js';
import type { QaContext, TenantFixture } from './types.js';

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

type Forma = 'DINHEIRO' | 'PIX' | 'CARTAO' | 'CARTAO_DEBITO' | 'CARTAO_CREDITO';

/** As 5 formas do enum PaymentMethod na comanda de cervejaria e na venda avulsa. */
export async function runPagamentoFormasTests(ctx: QaContext, test: TestFn) {
  const tenant: TenantFixture | undefined = ctx.tenants[8] ?? ctx.tenants[2];
  if (!tenant) {
    await test(
      { id: 'PAG-01', category: 'Formas de pagamento', name: 'Seed PAG', requirement: 'PAG' },
      async () => ({ status: 'failed', message: 'Tenant indisponível' }),
    );
    return;
  }

  await ensureTenantEventoAberto(tenant);

  let salt = 800;

  /** Abre uma comanda com um item e devolve id e total. */
  async function comandaComItem(rotulo: string): Promise<{ id: string; total: number } | string> {
    const criada = await api<{ id: string }>('POST', '/api/comandas', {
      token: tenant.atendenteTokens[0],
      body: uniqueStaffComandaBody(tenant.eventoId, rotulo, salt++),
    });
    if (criada.status !== 201 || !criada.data?.id) {
      return `comanda HTTP ${criada.status} ${criada.raw.slice(0, 100)}`;
    }
    const item = await api('POST', `/api/comandas/${criada.data.id}/itens`, {
      token: tenant.atendenteTokens[0],
      body: chopeItemBody(tenant.produtoId, tenant.tapId, tenant.volumeMl),
    });
    if (item.status !== 201) return `item HTTP ${item.status} ${item.raw.slice(0, 100)}`;

    const atual = await api<{ total: string | number }>('GET', `/api/comandas/${criada.data.id}`, {
      token: tenant.donoToken,
    });
    return { id: criada.data.id, total: Number(atual.data?.total ?? 0) };
  }

  async function fechaCom(rotulo: string, pagamentos: Array<{ forma: Forma; valor: number }> | null, forma?: Forma) {
    const comanda = await comandaComItem(rotulo);
    if (typeof comanda === 'string') return { erro: comanda };
    const corpo = pagamentos ?? [{ forma: forma!, valor: comanda.total }];
    const r = await api<{ status?: string; pagamentos?: Array<{ forma: string; valor: number }> }>(
      'POST',
      `/api/pagamentos/comandas/${comanda.id}/fechar`,
      { token: tenant.atendenteTokens[0], body: { pagamentos: corpo } },
    );
    return { comandaId: comanda.id, total: comanda.total, resposta: r };
  }

  for (const [indice, forma] of (['CARTAO', 'CARTAO_DEBITO', 'CARTAO_CREDITO'] as Forma[]).entries()) {
    await test(
      {
        id: `PAG-0${indice + 1}`,
        category: 'Formas de pagamento',
        name: `Fechar comanda com ${forma}`,
        requirement: `PAG-0${indice + 1}`,
      },
      async () => {
        const resultado = await fechaCom(`PAG ${forma}`, null, forma);
        if ('erro' in resultado) return { status: 'failed', message: resultado.erro };
        const { resposta } = resultado;
        if (resposta.status !== 200) {
          return { status: 'failed', message: `Fechar com ${forma}`, expected: '200', actual: `${resposta.status} ${resposta.raw.slice(0, 100)}` };
        }
        const registrada = resposta.data?.pagamentos?.[0]?.forma;
        if (registrada !== forma) {
          return { status: 'failed', message: 'Forma registrada', expected: forma, actual: String(registrada) };
        }
        return { message: `${forma} aceita e persistida`, expected: forma, actual: forma };
      },
    );
  }

  await test(
    { id: 'PAG-04', category: 'Formas de pagamento', name: 'Split misto de 3 formas quita a comanda', requirement: 'PAG-04' },
    async () => {
      const comanda = await comandaComItem('PAG Split');
      if (typeof comanda === 'string') return { status: 'failed', message: comanda };

      const centavos = Math.round(comanda.total * 100);
      const parte = Math.floor(centavos / 3);
      const pagamentos: Array<{ forma: Forma; valor: number }> = [
        { forma: 'DINHEIRO', valor: parte / 100 },
        { forma: 'CARTAO_DEBITO', valor: parte / 100 },
        { forma: 'PIX', valor: (centavos - 2 * parte) / 100 },
      ];

      const r = await api<{ status?: string; pagamentos?: Array<{ forma: string }> }>(
        'POST',
        `/api/pagamentos/comandas/${comanda.id}/fechar`,
        { token: tenant.atendenteTokens[0], body: { pagamentos } },
      );
      if (r.status !== 200) {
        return { status: 'failed', message: 'Split', expected: '200', actual: `${r.status} ${r.raw.slice(0, 120)}` };
      }
      if (r.data?.pagamentos?.length !== 3) {
        return { status: 'failed', message: 'Pagamentos registrados', expected: '3', actual: String(r.data?.pagamentos?.length) };
      }
      return { message: 'Split de 3 formas quitou a conta', expected: '3 pagamentos', actual: '3' };
    },
  );

  await test(
    { id: 'PAG-05', category: 'Formas de pagamento', name: 'Forma inexistente → 400', requirement: 'PAG-05' },
    async () => {
      const comanda = await comandaComItem('PAG Inválida');
      if (typeof comanda === 'string') return { status: 'failed', message: comanda };
      const r = await api('POST', `/api/pagamentos/comandas/${comanda.id}/fechar`, {
        token: tenant.atendenteTokens[0],
        body: { pagamentos: [{ forma: 'BITCOIN', valor: comanda.total }] },
      });
      if (r.status !== 400) {
        return { status: 'failed', message: 'Forma fora do enum aceita', expected: '400', actual: String(r.status) };
      }
      return { message: 'Enum de formas validado', expected: '400', actual: '400' };
    },
  );

  await test(
    { id: 'PAG-06', category: 'Formas de pagamento', name: 'Resumo executivo aloca por forma', requirement: 'PAG-06' },
    async () => {
      const r = await api<{ pagamentos?: Array<{ forma: string; valor: number }>; porPagamento?: Array<{ forma: string; valor: number }> }>(
        'GET',
        `/api/relatorios/evento/${tenant.eventoId}`,
        { token: tenant.donoToken },
      );
      if (r.status !== 200) {
        return { status: 'failed', message: 'Relatório do evento', expected: '200', actual: String(r.status) };
      }
      const porPagamento = r.data?.porPagamento ?? [];
      const formas = new Set(porPagamento.map((p) => p.forma));
      const esperadas = ['CARTAO', 'CARTAO_DEBITO', 'CARTAO_CREDITO', 'PIX', 'DINHEIRO'];
      const faltando = esperadas.filter((f) => !formas.has(f));
      if (faltando.length > 0) {
        return {
          status: 'failed',
          message: 'Formas ausentes no relatório',
          expected: esperadas.join(','),
          actual: [...formas].join(',') || 'vazio',
        };
      }
      return { message: `${porPagamento.length} formas no relatório`, expected: '5 formas', actual: String(formas.size) };
    },
  );

  await test(
    { id: 'PAG-07', category: 'Formas de pagamento', name: 'Venda avulsa aceita CARTAO', requirement: 'PAG-07' },
    async () => {
      const r = await api('POST', '/api/vendas-avulsas', {
        token: tenant.atendenteTokens[0],
        body: {
          eventoId: tenant.eventoId,
          itens: [{ produtoId: tenant.produtoId, volumeMl: tenant.volumeMl, quantidade: 1, tapId: tenant.tapId }],
          pagamentos: [{ forma: 'CARTAO', valor: tenant.preco }],
        },
      });
      if (r.status !== 201) {
        return { status: 'failed', message: 'Venda avulsa CARTAO', expected: '201', actual: `${r.status} ${r.raw.slice(0, 140)}` };
      }
      return { message: 'CARTAO aceito na venda avulsa', expected: '201', actual: '201' };
    },
  );

  await test(
    { id: 'PAG-08', category: 'Formas de pagamento', name: 'Venda avulsa com desconto parcial (DONO)', requirement: 'PAG-08' },
    async () => {
      const desconto = Math.min(2, tenant.preco);
      const totalEsperado = Number((tenant.preco - desconto).toFixed(2));
      const r = await api<{ total?: number | string; desconto?: number | string; status?: string }>(
        'POST',
        '/api/vendas-avulsas',
        {
          token: tenant.donoToken,
          body: {
            eventoId: tenant.eventoId,
            itens: [{ produtoId: tenant.produtoId, volumeMl: tenant.volumeMl, quantidade: 1, tapId: tenant.tapId }],
            desconto,
            pagamentos: [{ forma: 'PIX', valor: totalEsperado }],
          },
        },
      );
      if (r.status !== 201) {
        return {
          status: 'failed',
          message: 'Avulsa com desconto',
          expected: '201',
          actual: `${r.status} ${r.raw.slice(0, 140)}`,
        };
      }
      const total = Number(r.data?.total ?? -1);
      const desc = Number(r.data?.desconto ?? -1);
      if (Math.abs(total - totalEsperado) > 0.01 || Math.abs(desc - desconto) > 0.01) {
        return {
          status: 'failed',
          message: 'Totais líquidos',
          expected: `total=${totalEsperado} desconto=${desconto}`,
          actual: `total=${total} desconto=${desc}`,
        };
      }
      return { message: `Net R$ ${totalEsperado}`, expected: String(totalEsperado), actual: String(total) };
    },
  );

  await test(
    {
      id: 'PAG-09',
      category: 'Formas de pagamento',
      name: 'Venda avulsa desconto sem permissão → 403',
      requirement: 'PAG-09',
    },
    async () => {
      const r = await api('POST', '/api/vendas-avulsas', {
        token: tenant.atendenteTokens[0],
        body: {
          eventoId: tenant.eventoId,
          itens: [{ produtoId: tenant.produtoId, volumeMl: tenant.volumeMl, quantidade: 1, tapId: tenant.tapId }],
          desconto: 1,
          pagamentos: [{ forma: 'PIX', valor: Math.max(0.01, tenant.preco - 1) }],
        },
      });
      if (r.status !== 403) {
        return {
          status: 'failed',
          message: 'Desconto sem permissão',
          expected: '403',
          actual: `${r.status} ${r.raw.slice(0, 120)}`,
        };
      }
      return { message: 'Atendente bloqueado no desconto avulso', expected: '403', actual: '403' };
    },
  );

  await test(
    {
      id: 'PAG-10',
      category: 'Formas de pagamento',
      name: 'Venda avulsa desconto > subtotal → 400',
      requirement: 'PAG-10',
    },
    async () => {
      const r = await api('POST', '/api/vendas-avulsas', {
        token: tenant.donoToken,
        body: {
          eventoId: tenant.eventoId,
          itens: [{ produtoId: tenant.produtoId, volumeMl: tenant.volumeMl, quantidade: 1, tapId: tenant.tapId }],
          desconto: tenant.preco + 5,
          pagamentos: [],
        },
      });
      if (r.status !== 400) {
        return {
          status: 'failed',
          message: 'Desconto acima do subtotal',
          expected: '400',
          actual: `${r.status} ${r.raw.slice(0, 120)}`,
        };
      }
      return { message: 'Desconto excessivo rejeitado', expected: '400', actual: '400' };
    },
  );

  await test(
    {
      id: 'PAG-11',
      category: 'Formas de pagamento',
      name: 'Venda avulsa pagamento stale (valor antigo) → 400',
      requirement: 'PAG-11',
    },
    async () => {
      const desconto = Math.min(2, tenant.preco);
      const r = await api('POST', '/api/vendas-avulsas', {
        token: tenant.donoToken,
        body: {
          eventoId: tenant.eventoId,
          itens: [{ produtoId: tenant.produtoId, volumeMl: tenant.volumeMl, quantidade: 1, tapId: tenant.tapId }],
          desconto,
          pagamentos: [{ forma: 'PIX', valor: tenant.preco }],
        },
      });
      if (r.status !== 400) {
        return {
          status: 'failed',
          message: 'Pagamento pelo subtotal após desconto',
          expected: '400',
          actual: `${r.status} ${r.raw.slice(0, 120)}`,
        };
      }
      return { message: 'Pagamento stale rejeitado', expected: '400', actual: '400' };
    },
  );

  await test(
    {
      id: 'PAG-12',
      category: 'Formas de pagamento',
      name: 'Venda avulsa cortesia 100% com pagamentos []',
      requirement: 'PAG-12',
    },
    async () => {
      const r = await api<{ total?: number | string; status?: string; pagamentos?: unknown[] }>(
        'POST',
        '/api/vendas-avulsas',
        {
          token: tenant.donoToken,
          body: {
            eventoId: tenant.eventoId,
            itens: [{ produtoId: tenant.produtoId, volumeMl: tenant.volumeMl, quantidade: 1, tapId: tenant.tapId }],
            desconto: tenant.preco,
            pagamentos: [],
          },
        },
      );
      if (r.status !== 201) {
        return {
          status: 'failed',
          message: 'Cortesia avulsa',
          expected: '201',
          actual: `${r.status} ${r.raw.slice(0, 140)}`,
        };
      }
      const total = Number(r.data?.total ?? -1);
      if (Math.abs(total) > 0.01 || (r.data?.pagamentos?.length ?? -1) !== 0) {
        return {
          status: 'failed',
          message: 'Cortesia sem pagamento',
          expected: 'total=0 pagamentos=[]',
          actual: `total=${total} pagamentos=${r.data?.pagamentos?.length}`,
        };
      }
      return { message: 'Cortesia avulsa fechada', expected: '201', actual: '201' };
    },
  );

  await test(
    {
      id: 'PAG-13',
      category: 'Formas de pagamento',
      name: 'Fechar comanda com total positivo e pagamentos [] → 400',
      requirement: 'PAG-13',
    },
    async () => {
      const comanda = await comandaComItem('PAG vazio');
      if (typeof comanda === 'string') return { status: 'failed', message: comanda };
      const r = await api('POST', `/api/pagamentos/comandas/${comanda.id}/fechar`, {
        token: tenant.atendenteTokens[0],
        body: { pagamentos: [] },
      });
      if (r.status !== 400) {
        return {
          status: 'failed',
          message: 'Pagamento vazio com total > 0',
          expected: '400',
          actual: String(r.status),
        };
      }
      return { message: 'Pagamento vazio rejeitado', expected: '400', actual: '400' };
    },
  );

  await test(
    {
      id: 'PAG-14',
      category: 'Formas de pagamento',
      name: 'Fechar comanda cortesia 100% com pagamentos []',
      requirement: 'PAG-14',
    },
    async () => {
      const comanda = await comandaComItem('PAG cortesia');
      if (typeof comanda === 'string') return { status: 'failed', message: comanda };

      const desc = await api('PATCH', `/api/comandas/${comanda.id}/desconto`, {
        token: tenant.donoToken,
        body: { desconto: comanda.total },
      });
      if (desc.status !== 200) {
        return {
          status: 'failed',
          message: 'Aplicar desconto 100%',
          expected: '200',
          actual: `${desc.status} ${desc.raw.slice(0, 120)}`,
        };
      }

      const r = await api<{ status?: string; total?: number | string; pagamentos?: unknown[] }>(
        'POST',
        `/api/pagamentos/comandas/${comanda.id}/fechar`,
        { token: tenant.donoToken, body: { pagamentos: [] } },
      );
      if (r.status !== 200 || r.data?.status !== 'FECHADA') {
        return {
          status: 'failed',
          message: 'Fechar cortesia',
          expected: '200 FECHADA',
          actual: `${r.status} ${r.data?.status ?? r.raw.slice(0, 100)}`,
        };
      }
      if (Number(r.data?.total ?? -1) !== 0 || (r.data?.pagamentos?.length ?? -1) !== 0) {
        return {
          status: 'failed',
          message: 'Estado da cortesia',
          expected: 'total=0 pagamentos=[]',
          actual: `total=${r.data?.total} len=${r.data?.pagamentos?.length}`,
        };
      }
      return { message: 'Cortesia de comanda fechada', expected: 'FECHADA', actual: 'FECHADA' };
    },
  );
}
