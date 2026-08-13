import { api, uniqueStaffComandaBody } from './http.js';
import { ensureTenantEventoAberto } from './tenant-evento.js';
import type { TenantFixture } from './types.js';

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

/** CRUD de cardápios template + bloqueio de chope + aplicação no evento. */
export async function runCardapioTemplateTests(tenant: TenantFixture, test: TestFn) {
  const stamp = Date.now();
  let lataId = '';
  let cardapioId = '';

  await test(
    { id: 'CARD-00', category: 'Cardápios template', name: 'Ativar usaCardapio na cervejaria', requirement: 'CARD-00' },
    async () => {
      const r = await api('PATCH', '/api/cervejaria/operacao', {
        token: tenant.donoToken,
        body: { usaCardapio: true },
      });
      if (r.status !== 200) {
        return { status: 'failed', message: 'Ativar cardápio', expected: '200', actual: String(r.status) };
      }
      return { message: 'usaCardapio=true', expected: '200', actual: '200' };
    },
  );

  await test(
    { id: 'CARD-01', category: 'Cardápios template', name: 'ATENDENTE bloqueado em POST /cardapios', requirement: 'CARD-01' },
    async () => {
      const r = await api('POST', '/api/cardapios', {
        token: tenant.atendenteTokens[0],
        body: { nome: 'Hack', produtoIds: [] },
      });
      return rbacOutcome(r.status, 'ATENDENTE');
    },
  );

  await test(
    { id: 'CARD-02', category: 'Cardápios template', name: 'Setup produto unitário (lata)', requirement: 'CARD-02' },
    async () => {
      const r = await api<{ id: string }>('POST', '/api/produtos', {
        token: tenant.donoToken,
        body: {
          nome: `Lata QA ${stamp}`,
          tipo: 'BEBIDA',
          formato: 'LATA',
          precos: [{ volumeMl: 350, preco: 9 }],
        },
      });
      if (r.status !== 201 || !r.data?.id) {
        return { status: 'failed', message: 'Produto lata', expected: '201', actual: String(r.status) };
      }
      lataId = r.data.id;
      return { message: lataId, expected: '201', actual: '201' };
    },
  );

  await test(
    { id: 'CARD-03', category: 'Cardápios template', name: 'Chope bloqueado no template → 400', requirement: 'CARD-03' },
    async () => {
      const r = await api<{ error?: string }>('POST', '/api/cardapios', {
        token: tenant.donoToken,
        body: { nome: `Chope inválido ${stamp}`, produtoIds: [tenant.produtoId] },
      });
      if (r.status !== 400) {
        return { status: 'failed', message: 'Chope no template', expected: '400', actual: String(r.status) };
      }
      if (!r.data?.error?.includes('Chope não entra')) {
        return {
          status: 'failed',
          message: 'Mensagem de bloqueio',
          expected: 'Chope não entra no cardápio',
          actual: r.data?.error ?? r.raw.slice(0, 120),
        };
      }
      return { message: 'Chope rejeitado', expected: '400', actual: '400' };
    },
  );

  await test(
    { id: 'CARD-04', category: 'Cardápios template', name: 'DONO cria template com lata → 201', requirement: 'CARD-04' },
    async () => {
      if (!lataId) return { status: 'failed', message: 'CARD-02 não rodou' };
      const r = await api<{ id: string; produtoIds?: string[] }>('POST', '/api/cardapios', {
        token: tenant.donoToken,
        body: { nome: `Template QA ${stamp}`, produtoIds: [lataId] },
      });
      if (r.status !== 201 || !r.data?.id) {
        return { status: 'failed', message: 'Criar template', expected: '201', actual: String(r.status) };
      }
      cardapioId = r.data.id;
      if (!r.data.produtoIds?.includes(lataId)) {
        return { status: 'failed', message: 'produtoIds', expected: lataId, actual: r.data.produtoIds?.join(',') ?? '' };
      }
      return { message: cardapioId, expected: lataId, actual: 'OK' };
    },
  );

  await test(
    { id: 'CARD-05', category: 'Cardápios template', name: 'PUT atualiza nome do template', requirement: 'CARD-05' },
    async () => {
      if (!cardapioId || !lataId) return { status: 'failed', message: 'CARD-04 incompleto' };
      const novoNome = `Template QA edit ${stamp}`;
      const r = await api<{ nome?: string }>('PUT', `/api/cardapios/${cardapioId}`, {
        token: tenant.donoToken,
        body: { nome: novoNome, produtoIds: [lataId] },
      });
      if (r.status !== 200 || r.data?.nome !== novoNome) {
        return { status: 'failed', message: 'Update template', expected: novoNome, actual: r.data?.nome ?? String(r.status) };
      }
      return { message: 'Nome atualizado', expected: novoNome, actual: r.data.nome };
    },
  );

  await test(
    { id: 'CARD-06', category: 'Cardápios template', name: 'Aplicar template no evento aberto', requirement: 'CARD-06' },
    async () => {
      if (!cardapioId || !lataId) return { status: 'failed', message: 'CARD-04 incompleto' };
      await ensureTenantEventoAberto(tenant);

      const r = await api<{ produtoIds?: string[] }>('PUT', `/api/eventos/${tenant.eventoId}/cardapio`, {
        token: tenant.donoToken,
        body: { cardapioId },
      });
      if (r.status !== 200) {
        return { status: 'failed', message: 'Aplicar template', expected: '200', actual: String(r.status) };
      }
      if (!r.data?.produtoIds?.includes(lataId)) {
        return {
          status: 'failed',
          message: 'Produto do template no evento',
          expected: lataId,
          actual: r.data?.produtoIds?.join(',') ?? '[]',
        };
      }
      return { message: 'Template aplicado', expected: lataId, actual: 'presente' };
    },
  );

  await test(
    { id: 'CARD-07', category: 'Cardápios template', name: 'GET /eventos/:id/cardapio reflete template', requirement: 'CARD-07' },
    async () => {
      if (!lataId) return { status: 'failed', message: 'Setup incompleto' };
      const r = await api<{ produtoIds?: string[] }>('GET', `/api/eventos/${tenant.eventoId}/cardapio`, {
        token: tenant.donoToken,
      });
      if (r.status !== 200 || !r.data?.produtoIds?.includes(lataId)) {
        return {
          status: 'failed',
          message: 'GET cardapio evento',
          expected: lataId,
          actual: `${r.status} ${r.data?.produtoIds?.join(',') ?? ''}`,
        };
      }
      return { message: 'Cardápio do evento OK', expected: lataId, actual: 'OK' };
    },
  );

  let cardapioPrecoA = '';
  let cardapioPrecoB = '';
  const PRECO_CATALOGO = 9;
  const PRECO_TEMPLATE_A = 5;
  const PRECO_TEMPLATE_B = 8;

  await test(
    { id: 'CARD-09', category: 'Cardápios template', name: 'Templates com preços distintos (R$5 e R$8)', requirement: 'CARD-09' },
    async () => {
      if (!lataId) return { status: 'failed', message: 'CARD-02 incompleto' };
      const a = await api<{ id: string }>('POST', '/api/cardapios', {
        token: tenant.donoToken,
        body: {
          nome: `Preço A ${stamp}`,
          itens: [{ produtoId: lataId, precoUnit: PRECO_TEMPLATE_A }],
        },
      });
      const b = await api<{ id: string }>('POST', '/api/cardapios', {
        token: tenant.donoToken,
        body: {
          nome: `Preço B ${stamp}`,
          itens: [{ produtoId: lataId, precoUnit: PRECO_TEMPLATE_B }],
        },
      });
      if (a.status !== 201 || !a.data?.id || b.status !== 201 || !b.data?.id) {
        return { status: 'failed', message: 'Criar templates com preço', expected: '201/201', actual: `${a.status}/${b.status}` };
      }
      cardapioPrecoA = a.data.id;
      cardapioPrecoB = b.data.id;
      return { message: 'Templates A e B', expected: '201', actual: '201' };
    },
  );

  await test(
    { id: 'CARD-10', category: 'Cardápios template', name: 'Venda com template A → preço R$5', requirement: 'CARD-10' },
    async () => {
      if (!lataId || !cardapioPrecoA) return { status: 'failed', message: 'CARD-09 incompleto' };
      await ensureTenantEventoAberto(tenant);

      const aplicar = await api('PUT', `/api/eventos/${tenant.eventoId}/cardapio`, {
        token: tenant.donoToken,
        body: { cardapioId: cardapioPrecoA },
      });
      if (aplicar.status !== 200) {
        return { status: 'failed', message: 'Aplicar template A', expected: '200', actual: String(aplicar.status) };
      }

      const comanda = await api<{ id: string }>('POST', '/api/comandas', {
        token: tenant.donoToken,
        body: uniqueStaffComandaBody(tenant.eventoId, `QA preço A ${stamp}`, 901),
      });
      if (comanda.status !== 201 || !comanda.data?.id) {
        return { status: 'failed', message: 'Criar comanda', expected: '201', actual: String(comanda.status) };
      }

      const item = await api<{ error?: string }>('POST', `/api/comandas/${comanda.data.id}/itens`, {
        token: tenant.donoToken,
        body: { produtoId: lataId, volumeMl: 1, quantidade: 1 },
      });
      if (item.status !== 201) {
        const detail = item.data?.error ?? item.raw.slice(0, 120);
        return {
          status: 'failed',
          message: `Adicionar item: ${item.status} ${detail}`,
          expected: '201',
          actual: `${item.status} ${detail}`,
        };
      }

      const atual = await api<{ total: string | number }>('GET', `/api/comandas/${comanda.data.id}`, {
        token: tenant.donoToken,
      });
      const total = Number(atual.data?.total ?? 0);
      if (total !== PRECO_TEMPLATE_A) {
        return { status: 'failed', message: 'Total com template A', expected: String(PRECO_TEMPLATE_A), actual: String(total) };
      }
      return { message: `R$ ${total}`, expected: String(PRECO_TEMPLATE_A), actual: String(total) };
    },
  );

  await test(
    { id: 'CARD-11', category: 'Cardápios template', name: 'Venda com template B → preço R$8', requirement: 'CARD-11' },
    async () => {
      if (!lataId || !cardapioPrecoB) return { status: 'failed', message: 'CARD-09 incompleto' };

      const aplicar = await api('PUT', `/api/eventos/${tenant.eventoId}/cardapio`, {
        token: tenant.donoToken,
        body: { cardapioId: cardapioPrecoB },
      });
      if (aplicar.status !== 200) {
        return { status: 'failed', message: 'Aplicar template B', expected: '200', actual: String(aplicar.status) };
      }

      const comanda = await api<{ id: string }>('POST', '/api/comandas', {
        token: tenant.donoToken,
        body: uniqueStaffComandaBody(tenant.eventoId, `QA preço B ${stamp}`, 902),
      });
      if (comanda.status !== 201 || !comanda.data?.id) {
        return { status: 'failed', message: 'Criar comanda', expected: '201', actual: String(comanda.status) };
      }

      const item = await api<{ error?: string }>('POST', `/api/comandas/${comanda.data.id}/itens`, {
        token: tenant.donoToken,
        body: { produtoId: lataId, volumeMl: 1, quantidade: 1 },
      });
      if (item.status !== 201) {
        const detail = item.data?.error ?? item.raw.slice(0, 120);
        return {
          status: 'failed',
          message: `Adicionar item: ${item.status} ${detail}`,
          expected: '201',
          actual: `${item.status} ${detail}`,
        };
      }

      const atual = await api<{ total: string | number }>('GET', `/api/comandas/${comanda.data.id}`, {
        token: tenant.donoToken,
      });
      const total = Number(atual.data?.total ?? 0);
      if (total !== PRECO_TEMPLATE_B) {
        return { status: 'failed', message: 'Total com template B', expected: String(PRECO_TEMPLATE_B), actual: String(total) };
      }
      return { message: `R$ ${total}`, expected: String(PRECO_TEMPLATE_B), actual: String(total) };
    },
  );

  await test(
    { id: 'CARD-12', category: 'Cardápios template', name: 'Montagem manual → preço do catálogo (R$9)', requirement: 'CARD-12' },
    async () => {
      if (!lataId) return { status: 'failed', message: 'CARD-02 incompleto' };

      const aplicar = await api('PUT', `/api/eventos/${tenant.eventoId}/cardapio`, {
        token: tenant.donoToken,
        body: { produtoIds: [lataId] },
      });
      if (aplicar.status !== 200) {
        return { status: 'failed', message: 'Montagem manual', expected: '200', actual: String(aplicar.status) };
      }

      const comanda = await api<{ id: string }>('POST', '/api/comandas', {
        token: tenant.donoToken,
        body: uniqueStaffComandaBody(tenant.eventoId, `QA manual ${stamp}`, 903),
      });
      if (comanda.status !== 201 || !comanda.data?.id) {
        return { status: 'failed', message: 'Criar comanda', expected: '201', actual: String(comanda.status) };
      }

      const item = await api<{ error?: string }>('POST', `/api/comandas/${comanda.data.id}/itens`, {
        token: tenant.donoToken,
        body: { produtoId: lataId, volumeMl: 1, quantidade: 1 },
      });
      if (item.status !== 201) {
        const detail = item.data?.error ?? item.raw.slice(0, 120);
        return {
          status: 'failed',
          message: `Adicionar item: ${item.status} ${detail}`,
          expected: '201',
          actual: `${item.status} ${detail}`,
        };
      }

      const atual = await api<{ total: string | number }>('GET', `/api/comandas/${comanda.data.id}`, {
        token: tenant.donoToken,
      });
      const total = Number(atual.data?.total ?? 0);
      if (total !== PRECO_CATALOGO) {
        return { status: 'failed', message: 'Total montagem manual', expected: String(PRECO_CATALOGO), actual: String(total) };
      }
      return { message: `R$ ${total}`, expected: String(PRECO_CATALOGO), actual: String(total) };
    },
  );

  await test(
    {
      id: 'CARD-13',
      category: 'Cardápios template',
      name: 'usaCardapio desligado → preço do catálogo mesmo com template',
      requirement: 'CARD-13',
    },
    async () => {
      if (!lataId || !cardapioPrecoA) return { status: 'failed', message: 'CARD-09 incompleto' };

      const off = await api('PATCH', '/api/cervejaria/operacao', {
        token: tenant.donoToken,
        body: { usaCardapio: false },
      });
      if (off.status !== 200) {
        return { status: 'failed', message: 'Desligar cardápio', expected: '200', actual: String(off.status) };
      }

      const aplicar = await api('PUT', `/api/eventos/${tenant.eventoId}/cardapio`, {
        token: tenant.donoToken,
        body: { cardapioId: cardapioPrecoA },
      });
      if (aplicar.status !== 403) {
        return {
          status: 'failed',
          message: 'PUT cardápio com toggle off',
          expected: '403',
          actual: String(aplicar.status),
        };
      }

      const comanda = await api<{ id: string }>('POST', '/api/comandas', {
        token: tenant.donoToken,
        body: uniqueStaffComandaBody(tenant.eventoId, `QA toggle off ${stamp}`, 904),
      });
      if (comanda.status !== 201 || !comanda.data?.id) {
        return { status: 'failed', message: 'Criar comanda', expected: '201', actual: String(comanda.status) };
      }

      const item = await api('POST', `/api/comandas/${comanda.data.id}/itens`, {
        token: tenant.donoToken,
        body: { produtoId: lataId, volumeMl: 1, quantidade: 1 },
      });
      if (item.status !== 201) {
        return { status: 'failed', message: 'Adicionar item', expected: '201', actual: String(item.status) };
      }

      const atual = await api<{ total: string | number }>('GET', `/api/comandas/${comanda.data.id}`, {
        token: tenant.donoToken,
      });
      const total = Number(atual.data?.total ?? 0);
      if (total !== PRECO_CATALOGO) {
        return {
          status: 'failed',
          message: 'Toggle off deve usar catálogo',
          expected: String(PRECO_CATALOGO),
          actual: String(total),
        };
      }

      await api('PATCH', '/api/cervejaria/operacao', {
        token: tenant.donoToken,
        body: { usaCardapio: true },
      });

      return { message: `R$ ${total}`, expected: String(PRECO_CATALOGO), actual: String(total) };
    },
  );

  await test(
    { id: 'CARD-08', category: 'Cardápios template', name: 'DELETE template → 204', requirement: 'CARD-08' },
    async () => {
      if (!cardapioId) return { status: 'failed', message: 'CARD-04 incompleto' };
      const r = await api('DELETE', `/api/cardapios/${cardapioId}`, { token: tenant.donoToken });
      if (r.status !== 204) {
        return { status: 'failed', message: 'Delete template', expected: '204', actual: String(r.status) };
      }
      const get = await api('GET', `/api/cardapios/${cardapioId}`, { token: tenant.donoToken });
      if (get.status !== 404) {
        return { status: 'failed', message: 'Template removido', expected: '404', actual: String(get.status) };
      }
      cardapioId = '';
      return { message: 'Template excluído', expected: '204', actual: '204' };
    },
  );
}
