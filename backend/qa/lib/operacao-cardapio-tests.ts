import { api, login } from './http.js';
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

function rbacOutcome(status: number, who: string): Outcome {
  if (status === 403) return { message: `${who} bloqueado (403)`, expected: '403', actual: '403' };
  if (status === 500) {
    return {
      status: 'failed',
      message: `${who} bloqueado, mas HTTP 500 (esperado 403)`,
      expected: '403',
      actual: '500',
    };
  }
  return { status: 'failed', message: `${who} NÃO bloqueado`, expected: '403', actual: String(status) };
}

/** CRUD de cardápios template quiosque + cardápio por turno de caixa. */
export async function runQuiosqueCardapioTests(ctx: QaContext, test: TestFn) {
  const cfg: ConfigTenantFixture | undefined = ctx.configTenants?.find((c) => c.code === 'QUIOSQUE-00');
  if (!cfg?.produtoId) {
    await test(
      { id: 'QCD-00', category: 'Quiosque cardápio', name: 'Seed QUIOSQUE-00', requirement: 'QCD' },
      async () => ({ status: 'failed', message: 'QUIOSQUE-00 ausente ou incompleto no contexto' }),
    );
    return;
  }

  const stamp = Date.now();
  let pontoId = '';
  let produtoExtraId = '';
  let cardapioId = '';
  const PRECO = 12;

  await test(
    { id: 'QCD-00', category: 'Quiosque cardápio', name: 'Toggle legado de cardápio é rejeitado', requirement: 'QCD-00' },
    async () => {
      const r = await api('PATCH', '/api/operacao/config', {
        token: cfg.donoToken,
        body: { usaCardapio: true },
      });
      if (r.status !== 400) {
        return { status: 'failed', message: 'Toggle legado ainda aceito', expected: '400', actual: `${r.status} ${r.raw.slice(0, 100)}` };
      }
      return { message: 'Endpoint legado não altera o cardápio atual', expected: '400', actual: '400' };
    },
  );

  await test(
    { id: 'QCD-01', category: 'Quiosque cardápio', name: 'ATENDENTE bloqueado em POST /operacao/cardapios', requirement: 'QCD-01' },
    async () => {
      const atendenteCookie = await login(`${cfg.slug}-a1@qa.test`, 'qa123456');
      const r = await api('POST', '/api/operacao/cardapios', {
        cookie: atendenteCookie,
        body: { nome: 'Hack', produtoIds: [] },
      });
      return rbacOutcome(r.status, 'ATENDENTE');
    },
  );

  await test(
    { id: 'QCD-02', category: 'Quiosque cardápio', name: 'DONO cria produto extra para template', requirement: 'QCD-02' },
    async () => {
      const r = await api<{ id: string }>('POST', '/api/operacao/produtos', {
        token: cfg.donoToken,
        body: {
          nome: `Extra QA ${stamp}`,
          categoria: 'Bebidas',
          precoUnit: PRECO,
          exigePreparo: false,
          controlaEstoque: false,
        },
      });
      if (r.status !== 201 || !r.data?.id) {
        return { status: 'failed', message: 'Produto extra', expected: '201', actual: String(r.status) };
      }
      produtoExtraId = r.data.id;
      return { message: produtoExtraId, expected: '201', actual: '201' };
    },
  );

  await test(
    { id: 'QCD-03', category: 'Quiosque cardápio', name: 'DONO cria template com produto extra → 201', requirement: 'QCD-03' },
    async () => {
      if (!produtoExtraId) return { status: 'failed', message: 'QCD-02 não rodou' };
      const r = await api<{ id: string; produtoIds?: string[] }>('POST', '/api/operacao/cardapios', {
        token: cfg.donoToken,
        body: { nome: `Template QA ${stamp}`, produtoIds: [produtoExtraId] },
      });
      if (r.status !== 201 || !r.data?.id) {
        return { status: 'failed', message: 'Template', expected: '201', actual: String(r.status) };
      }
      cardapioId = r.data.id;
      if (!r.data.produtoIds?.includes(produtoExtraId)) {
        return { status: 'failed', message: 'produtoIds no template', expected: produtoExtraId, actual: String(r.data.produtoIds) };
      }
      return { message: cardapioId, expected: '201', actual: '201' };
    },
  );

  let cardapioPrecoA = '';
  let cardapioPrecoB = '';
  let pontoPrecoId = '';
  const PRECO_TEMPLATE_A = 5;
  const PRECO_TEMPLATE_B = 8;

  await test(
    { id: 'QCD-09', category: 'Quiosque cardápio', name: 'Templates com preços distintos (R$5 e R$8)', requirement: 'QCD-09' },
    async () => {
      if (!produtoExtraId) return { status: 'failed', message: 'QCD-02 não rodou' };
      const a = await api<{ id: string }>('POST', '/api/operacao/cardapios', {
        token: cfg.donoToken,
        body: {
          nome: `Preço A ${stamp}`,
          itens: [{ produtoId: produtoExtraId, precoUnit: PRECO_TEMPLATE_A }],
        },
      });
      const b = await api<{ id: string }>('POST', '/api/operacao/cardapios', {
        token: cfg.donoToken,
        body: {
          nome: `Preço B ${stamp}`,
          itens: [{ produtoId: produtoExtraId, precoUnit: PRECO_TEMPLATE_B }],
        },
      });
      if (a.status !== 201 || !a.data?.id || b.status !== 201 || !b.data?.id) {
        return { status: 'failed', message: 'Templates com preço', expected: '201/201', actual: `${a.status}/${b.status}` };
      }
      cardapioPrecoA = a.data.id;
      cardapioPrecoB = b.data.id;
      return { message: 'Templates A e B', expected: '201', actual: '201' };
    },
  );

  await test(
    { id: 'QCD-10', category: 'Quiosque cardápio', name: 'PDV com template A → venda R$5', requirement: 'QCD-10' },
    async () => {
      if (!produtoExtraId || !cardapioPrecoA) return { status: 'failed', message: 'QCD-09 incompleto' };

      const ponto = await api<{ id: string }>('POST', '/api/operacao/pontos-venda', {
        token: cfg.donoToken,
        body: { nome: `Preço QA A ${stamp}` },
      });
      if (ponto.status !== 201 || !ponto.data?.id) {
        return { status: 'failed', message: 'Ponto de venda', expected: '201', actual: String(ponto.status) };
      }
      pontoPrecoId = ponto.data.id;

      const abrir = await api('POST', '/api/operacao/caixa/abrir', {
        token: cfg.donoToken,
        body: { pontoVendaId: pontoPrecoId, trocoInicial: 50, cardapioId: cardapioPrecoA },
      });
      if (abrir.status !== 201) {
        return { status: 'failed', message: 'Abrir caixa A', expected: '201', actual: String(abrir.status) };
      }

      const produtos = await api<Array<{ precoEfetivo?: number; precoUnit: string }>>(
        'GET',
        `/api/operacao/produtos?pontoVendaId=${pontoPrecoId}`,
        { token: cfg.donoToken },
      );
      const preco = produtos.data?.[0]?.precoEfetivo ?? parseFloat(produtos.data?.[0]?.precoUnit ?? '0');
      if (preco !== PRECO_TEMPLATE_A) {
        return { status: 'failed', message: 'Preço efetivo no PDV', expected: String(PRECO_TEMPLATE_A), actual: String(preco) };
      }

      const venda = await api<{ total?: number }>('POST', '/api/operacao/vendas', {
        token: cfg.donoToken,
        body: {
          pontoVendaId: pontoPrecoId,
          itens: [{ produtoId: produtoExtraId, quantidade: 1 }],
          pagamentos: [{ forma: 'PIX', valor: PRECO_TEMPLATE_A }],
        },
      });
      if (venda.status !== 201) {
        return { status: 'failed', message: 'Venda template A', expected: '201', actual: String(venda.status) };
      }

      await api('POST', '/api/operacao/caixa/fechar', {
        token: cfg.donoToken,
        body: {
          pontoVendaId: pontoPrecoId,
          contadoDinheiro: 50,
          contadoPix: PRECO_TEMPLATE_A,
          contadoCartaoDebito: 0,
          contadoCartaoCredito: 0,
        },
      });
      return { message: `Venda R$ ${PRECO_TEMPLATE_A}`, expected: String(PRECO_TEMPLATE_A), actual: 'OK' };
    },
  );

  await test(
    { id: 'QCD-11', category: 'Quiosque cardápio', name: 'PDV com template B → venda R$8', requirement: 'QCD-11' },
    async () => {
      if (!produtoExtraId || !cardapioPrecoB || !pontoPrecoId) return { status: 'failed', message: 'QCD-10 incompleto' };

      const abrir = await api('POST', '/api/operacao/caixa/abrir', {
        token: cfg.donoToken,
        body: { pontoVendaId: pontoPrecoId, trocoInicial: 50, cardapioId: cardapioPrecoB },
      });
      if (abrir.status !== 201) {
        return { status: 'failed', message: 'Abrir caixa B', expected: '201', actual: String(abrir.status) };
      }

      const venda = await api('POST', '/api/operacao/vendas', {
        token: cfg.donoToken,
        body: {
          pontoVendaId: pontoPrecoId,
          itens: [{ produtoId: produtoExtraId, quantidade: 1 }],
          pagamentos: [{ forma: 'PIX', valor: PRECO_TEMPLATE_B }],
        },
      });
      if (venda.status !== 201) {
        return { status: 'failed', message: 'Venda template B', expected: '201', actual: String(venda.status) };
      }

      await api('POST', '/api/operacao/caixa/fechar', {
        token: cfg.donoToken,
        body: {
          pontoVendaId: pontoPrecoId,
          contadoDinheiro: 50,
          contadoPix: PRECO_TEMPLATE_B,
          contadoCartaoDebito: 0,
          contadoCartaoCredito: 0,
        },
      });
      return { message: `Venda R$ ${PRECO_TEMPLATE_B}`, expected: String(PRECO_TEMPLATE_B), actual: 'OK' };
    },
  );

  await test(
    { id: 'QCD-12', category: 'Quiosque cardápio', name: 'Montagem manual → preço do catálogo (R$12)', requirement: 'QCD-12' },
    async () => {
      if (!produtoExtraId || !pontoPrecoId) return { status: 'failed', message: 'QCD-10 incompleto' };

      const abrir = await api('POST', '/api/operacao/caixa/abrir', {
        token: cfg.donoToken,
        body: { pontoVendaId: pontoPrecoId, trocoInicial: 50, produtoIds: [produtoExtraId] },
      });
      if (abrir.status !== 201) {
        return { status: 'failed', message: 'Abrir caixa manual', expected: '201', actual: `${abrir.status} ${abrir.raw.slice(0, 180)}` };
      }

      const produtos = await api<Array<{ precoEfetivo?: number; precoUnit: string }>>(
        'GET',
        `/api/operacao/produtos?pontoVendaId=${pontoPrecoId}`,
        { token: cfg.donoToken },
      );
      const preco = produtos.data?.[0]?.precoEfetivo ?? parseFloat(produtos.data?.[0]?.precoUnit ?? '0');
      if (preco !== PRECO) {
        return { status: 'failed', message: 'Preço catálogo no PDV', expected: String(PRECO), actual: String(preco) };
      }

      const venda = await api('POST', '/api/operacao/vendas', {
        token: cfg.donoToken,
        body: {
          pontoVendaId: pontoPrecoId,
          itens: [{ produtoId: produtoExtraId, quantidade: 1 }],
          pagamentos: [{ forma: 'PIX', valor: PRECO }],
        },
      });
      if (venda.status !== 201) {
        return { status: 'failed', message: 'Venda manual', expected: '201', actual: String(venda.status) };
      }

      await api('POST', '/api/operacao/caixa/fechar', {
        token: cfg.donoToken,
        body: {
          pontoVendaId: pontoPrecoId,
          contadoDinheiro: 50,
          contadoPix: PRECO,
          contadoCartaoDebito: 0,
          contadoCartaoCredito: 0,
        },
      });
      return { message: `Venda R$ ${PRECO}`, expected: String(PRECO), actual: 'OK' };
    },
  );

  await test(
    {
      id: 'QCD-13',
      category: 'Quiosque cardápio',
      name: 'Alterar preço só do turno não muda o cardápio salvo',
      requirement: 'QCD-13',
    },
    async () => {
      if (!produtoExtraId || !cardapioPrecoA || !pontoPrecoId) {
        return { status: 'failed', message: 'QCD-09/10 incompleto' };
      }
      const PRECO_TURNO = 7;

      const abrir = await api('POST', '/api/operacao/caixa/abrir', {
        token: cfg.donoToken,
        body: { pontoVendaId: pontoPrecoId, trocoInicial: 50, cardapioId: cardapioPrecoA },
      });
      if (abrir.status !== 201) {
        return { status: 'failed', message: 'Abrir caixa', expected: '201', actual: `${abrir.status} ${abrir.raw.slice(0, 180)}` };
      }

      const patch = await api('PATCH', `/api/operacao/caixa/cardapio/preco?pontoVendaId=${pontoPrecoId}`, {
        token: cfg.donoToken,
        body: { produtoId: produtoExtraId, precoUnit: PRECO_TURNO, escopo: 'TURNO' },
      });
      if (patch.status !== 200) {
        return {
          status: 'failed',
          message: 'PATCH preço TURNO',
          expected: '200',
          actual: `${patch.status} ${patch.raw.slice(0, 120)}`,
        };
      }

      const produtos = await api<Array<{ precoEfetivo?: number; precoOverrideTurno?: boolean }>>(
        'GET',
        `/api/operacao/produtos?pontoVendaId=${pontoPrecoId}`,
        { token: cfg.donoToken },
      );
      const efetivo = produtos.data?.[0]?.precoEfetivo;
      if (efetivo !== PRECO_TURNO) {
        return {
          status: 'failed',
          message: 'PDV com override do turno',
          expected: String(PRECO_TURNO),
          actual: String(efetivo),
        };
      }

      const template = await api<{ itens?: Array<{ produtoId: string; precoUnit: number }> }>(
        'GET',
        `/api/operacao/cardapios/${cardapioPrecoA}`,
        { token: cfg.donoToken },
      );
      const precoSalvo = template.data?.itens?.find((i) => i.produtoId === produtoExtraId)?.precoUnit;
      if (precoSalvo !== PRECO_TEMPLATE_A) {
        return {
          status: 'failed',
          message: 'Template intacto após TURNO',
          expected: String(PRECO_TEMPLATE_A),
          actual: String(precoSalvo),
        };
      }

      const venda = await api('POST', '/api/operacao/vendas', {
        token: cfg.donoToken,
        body: {
          pontoVendaId: pontoPrecoId,
          itens: [{ produtoId: produtoExtraId, quantidade: 1 }],
          pagamentos: [{ forma: 'PIX', valor: PRECO_TURNO }],
        },
      });
      if (venda.status !== 201) {
        return { status: 'failed', message: 'Venda com preço do turno', expected: '201', actual: String(venda.status) };
      }

      await api('POST', '/api/operacao/caixa/fechar', {
        token: cfg.donoToken,
        body: {
          pontoVendaId: pontoPrecoId,
          contadoDinheiro: 50,
          contadoPix: PRECO_TURNO,
          contadoCartaoDebito: 0,
          contadoCartaoCredito: 0,
        },
      });
      return { message: `Override turno R$ ${PRECO_TURNO}`, expected: 'template intacto', actual: 'OK' };
    },
  );

  await test(
    {
      id: 'QCD-14',
      category: 'Quiosque cardápio',
      name: 'Alterar preço definitivo atualiza o cardápio salvo',
      requirement: 'QCD-14',
    },
    async () => {
      if (!produtoExtraId || !cardapioPrecoA || !pontoPrecoId) {
        return { status: 'failed', message: 'QCD-09/10 incompleto' };
      }
      const PRECO_DEF = 9;

      const abrir = await api('POST', '/api/operacao/caixa/abrir', {
        token: cfg.donoToken,
        body: { pontoVendaId: pontoPrecoId, trocoInicial: 50, cardapioId: cardapioPrecoA },
      });
      if (abrir.status !== 201) {
        return { status: 'failed', message: 'Abrir caixa', expected: '201', actual: `${abrir.status} ${abrir.raw.slice(0, 180)}` };
      }

      const patch = await api('PATCH', `/api/operacao/caixa/cardapio/preco?pontoVendaId=${pontoPrecoId}`, {
        token: cfg.donoToken,
        body: { produtoId: produtoExtraId, precoUnit: PRECO_DEF, escopo: 'TEMPLATE' },
      });
      if (patch.status !== 200) {
        return {
          status: 'failed',
          message: 'PATCH preço TEMPLATE',
          expected: '200',
          actual: `${patch.status} ${patch.raw.slice(0, 120)}`,
        };
      }

      const template = await api<{ itens?: Array<{ produtoId: string; precoUnit: number }> }>(
        'GET',
        `/api/operacao/cardapios/${cardapioPrecoA}`,
        { token: cfg.donoToken },
      );
      const precoSalvo = template.data?.itens?.find((i) => i.produtoId === produtoExtraId)?.precoUnit;
      if (precoSalvo !== PRECO_DEF) {
        return {
          status: 'failed',
          message: 'Template atualizado',
          expected: String(PRECO_DEF),
          actual: String(precoSalvo),
        };
      }

      const produtos = await api<Array<{ precoEfetivo?: number }>>(
        'GET',
        `/api/operacao/produtos?pontoVendaId=${pontoPrecoId}`,
        { token: cfg.donoToken },
      );
      const efetivo = produtos.data?.[0]?.precoEfetivo;
      if (efetivo !== PRECO_DEF) {
        return {
          status: 'failed',
          message: 'PDV herda template',
          expected: String(PRECO_DEF),
          actual: String(efetivo),
        };
      }

      await api('POST', '/api/operacao/caixa/fechar', {
        token: cfg.donoToken,
        body: {
          pontoVendaId: pontoPrecoId,
          contadoDinheiro: 50,
          contadoPix: 0,
          contadoCartaoDebito: 0,
          contadoCartaoCredito: 0,
        },
      });
      return { message: `Template R$ ${PRECO_DEF}`, expected: String(PRECO_DEF), actual: 'OK' };
    },
  );

  await test(
    { id: 'QCD-04', category: 'Quiosque cardápio', name: 'DONO cria ponto de venda dedicado', requirement: 'QCD-04' },
    async () => {
      const r = await api<{ id: string }>('POST', '/api/operacao/pontos-venda', {
        token: cfg.donoToken,
        body: { nome: `Cardápio QA ${stamp}` },
      });
      if (r.status !== 201 || !r.data?.id) {
        return { status: 'failed', message: 'Ponto de venda', expected: '201', actual: String(r.status) };
      }
      pontoId = r.data.id;
      return { message: pontoId, expected: '201', actual: '201' };
    },
  );

  await test(
    { id: 'QCD-05', category: 'Quiosque cardápio', name: 'Abrir caixa com template → produtos filtrados', requirement: 'QCD-05' },
    async () => {
      if (!pontoId || !cardapioId) return { status: 'failed', message: 'QCD-03/04 não rodaram' };

      const abrir = await api('POST', '/api/operacao/caixa/abrir', {
        token: cfg.donoToken,
        body: { pontoVendaId: pontoId, trocoInicial: 50, cardapioId },
      });
      if (abrir.status !== 201) {
        return { status: 'failed', message: 'Abrir caixa', expected: '201', actual: String(abrir.status) };
      }

      const produtos = await api<Array<{ id: string }>>('GET', `/api/operacao/produtos?pontoVendaId=${pontoId}`, {
        token: cfg.donoToken,
      });
      if (produtos.status !== 200 || !Array.isArray(produtos.data)) {
        return { status: 'failed', message: 'GET produtos operacionais', expected: '200', actual: String(produtos.status) };
      }
      const ids = produtos.data.map((p) => p.id);
      if (ids.length !== 1 || ids[0] !== produtoExtraId) {
        return {
          status: 'failed',
          message: 'PDV lista só template',
          expected: produtoExtraId,
          actual: ids.join(','),
        };
      }
      return { message: '1 item do template', expected: produtoExtraId, actual: ids[0] };
    },
  );

  await test(
    { id: 'QCD-06', category: 'Quiosque cardápio', name: 'Venda produto fora do cardápio → 400', requirement: 'QCD-06' },
    async () => {
      if (!pontoId || !cfg.produtoId) return { status: 'failed', message: 'Setup incompleto' };

      const r = await api<{ error?: string }>('POST', '/api/operacao/vendas', {
        token: cfg.donoToken,
        body: {
          pontoVendaId: pontoId,
          itens: [{ produtoId: cfg.produtoId, quantidade: 1 }],
          pagamentos: [{ forma: 'PIX', valor: 8 }],
        },
      });
      if (r.status !== 400) {
        return { status: 'failed', message: 'Venda fora do cardápio', expected: '400', actual: String(r.status) };
      }
      if (!r.data?.error?.includes('cardápio')) {
        return {
          status: 'failed',
          message: 'Mensagem de bloqueio',
          expected: 'cardápio',
          actual: r.data?.error ?? r.raw.slice(0, 120),
        };
      }
      return { message: 'Bloqueado', expected: '400', actual: '400' };
    },
  );

  await test(
    { id: 'QCD-07', category: 'Quiosque cardápio', name: 'Editar cardápio do turno → remove item do PDV', requirement: 'QCD-07' },
    async () => {
      if (!pontoId) return { status: 'failed', message: 'QCD-04 não rodou' };

      const put = await api('PUT', `/api/operacao/caixa/cardapio?pontoVendaId=${pontoId}`, {
        token: cfg.donoToken,
        body: { produtoIds: [] },
      });
      if (put.status !== 200) {
        return { status: 'failed', message: 'PUT cardápio turno', expected: '200', actual: String(put.status) };
      }

      const produtos = await api<Array<{ id: string }>>('GET', `/api/operacao/produtos?pontoVendaId=${pontoId}`, {
        token: cfg.donoToken,
      });
      if (produtos.status !== 200 || (produtos.data?.length ?? 0) !== 0) {
        return {
          status: 'failed',
          message: 'PDV vazio após limpar cardápio',
          expected: '0 itens',
          actual: String(produtos.data?.length ?? '?'),
        };
      }
      return { message: '0 itens', expected: '0', actual: '0' };
    },
  );

  await test(
    { id: 'QCD-08', category: 'Quiosque cardápio', name: 'Fechar caixa (cleanup)', requirement: 'QCD-08' },
    async () => {
      if (!pontoId) return { status: 'skipped', message: 'Sem ponto' };

      const r = await api('POST', '/api/operacao/caixa/fechar', {
        token: cfg.donoToken,
        body: {
          pontoVendaId: pontoId,
          contadoDinheiro: 50,
          contadoPix: 0,
          contadoCartaoDebito: 0,
          contadoCartaoCredito: 0,
        },
      });
      if (r.status !== 200) {
        return { status: 'failed', message: 'Fechar caixa', expected: '200', actual: String(r.status) };
      }
      return { message: 'Caixa fechado', expected: '200', actual: '200' };
    },
  );
}
