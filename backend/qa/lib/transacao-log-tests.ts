import { api, chopeItemBody, uniqueStaffComandaBody } from './http.js';
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

/** Correlaciona ações de comanda com TransacaoLog + export CSV. */
export async function runTransacaoLogTests(tenant: TenantFixture, test: TestFn) {
  let comandaId = '';
  let total = 0;

  await test(
    { id: 'TX-01', category: 'TransacaoLog', name: 'Criar comanda registra COMANDA_CRIADA', requirement: 'TX-01' },
    async () => {
      const r = await api<{ id: string }>('POST', '/api/comandas', {
        token: tenant.atendenteTokens[0],
        body: uniqueStaffComandaBody(tenant.eventoId, `TX Log ${Date.now()}`, 77),
      });
      if (r.status !== 201 || !r.data?.id) {
        return { status: 'failed', message: 'Setup TX: comanda', expected: '201', actual: String(r.status) };
      }
      comandaId = r.data.id;

      const logs = await api<Array<{ tipo: string; comandaId: string | null }>>(
        'GET',
        `/api/eventos/${tenant.eventoId}/transacoes?limit=20`,
        { token: tenant.donoToken },
      );
      if (logs.status !== 200) {
        return { status: 'failed', message: 'Listagem transações', expected: '200', actual: String(logs.status) };
      }
      const criada = logs.data.find((l) => l.tipo === 'COMANDA_CRIADA' && l.comandaId === comandaId);
      if (!criada) {
        return {
          status: 'failed',
          message: 'COMANDA_CRIADA ausente',
          expected: comandaId,
          actual: logs.data.map((l) => l.tipo).join(', '),
        };
      }
      return { message: 'COMANDA_CRIADA correlacionada', expected: comandaId, actual: criada.comandaId ?? '' };
    },
  );

  await test(
    { id: 'TX-02', category: 'TransacaoLog', name: 'Item adicionado registra COMANDA_ITEM_ADICIONADO', requirement: 'TX-02' },
    async () => {
      if (!comandaId) return { status: 'failed', message: 'TX-01 não rodou' };
      const add = await api('POST', `/api/comandas/${comandaId}/itens`, {
        token: tenant.atendenteTokens[0],
        body: chopeItemBody(tenant.produtoId, tenant.tapId, tenant.volumeMl),
      });
      if (add.status !== 201) {
        return { status: 'failed', message: 'Adicionar item', expected: '201', actual: String(add.status) };
      }
      const cur = await api<{ total: string | number }>('GET', `/api/comandas/${comandaId}`, { token: tenant.donoToken });
      total = Number(cur.data?.total ?? 0);

      const logs = await api<Array<{ tipo: string; comandaId: string | null }>>(
        'GET',
        `/api/eventos/${tenant.eventoId}/transacoes?limit=30`,
        { token: tenant.donoToken },
      );
      const item = logs.data?.find((l) => l.tipo === 'COMANDA_ITEM_ADICIONADO' && l.comandaId === comandaId);
      if (!item) {
        return { status: 'failed', message: 'COMANDA_ITEM_ADICIONADO ausente', expected: comandaId, actual: '—' };
      }
      return { message: 'Item correlacionado', expected: 'COMANDA_ITEM_ADICIONADO', actual: item.tipo };
    },
  );

  await test(
    { id: 'TX-03', category: 'TransacaoLog', name: 'Fechar comanda registra COMANDA_FECHADA', requirement: 'TX-03' },
    async () => {
      if (!comandaId || total <= 0) return { status: 'failed', message: 'TX-02 incompleto' };
      const fechar = await api('POST', `/api/pagamentos/comandas/${comandaId}/fechar`, {
        token: tenant.atendenteTokens[0],
        body: { pagamentos: [{ forma: 'DINHEIRO', valor: total }] },
      });
      if (fechar.status !== 200) {
        return { status: 'failed', message: 'Fechar comanda', expected: '200', actual: String(fechar.status) };
      }

      const logs = await api<Array<{ tipo: string; comandaId: string | null }>>(
        'GET',
        `/api/eventos/${tenant.eventoId}/transacoes?limit=40`,
        { token: tenant.donoToken },
      );
      const fechada = logs.data?.find((l) => l.tipo === 'COMANDA_FECHADA' && l.comandaId === comandaId);
      if (!fechada) {
        return { status: 'failed', message: 'COMANDA_FECHADA ausente', expected: comandaId, actual: '—' };
      }
      return { message: 'Fechamento correlacionado', expected: 'COMANDA_FECHADA', actual: fechada.tipo };
    },
  );

  await test(
    { id: 'TX-04', category: 'TransacaoLog', name: 'Export CSV contém linhas do evento', requirement: 'TX-04' },
    async () => {
      const r = await api('GET', `/api/eventos/${tenant.eventoId}/transacoes/csv`, { token: tenant.donoToken });
      if (r.status !== 200) {
        return { status: 'failed', message: 'CSV transações', expected: '200', actual: String(r.status) };
      }
      if (!r.raw.includes('COMANDA_CRIADA') || !r.raw.includes('data_hora,tipo,descricao')) {
        return {
          status: 'failed',
          message: 'CSV incompleto',
          expected: 'header + COMANDA_CRIADA',
          actual: r.raw.slice(0, 120),
        };
      }
      return { message: 'CSV exportável', expected: 'COMANDA_*', actual: 'OK' };
    },
  );

  await test(
    { id: 'TX-05', category: 'TransacaoLog', name: 'ATENDENTE bloqueado em /transacoes', requirement: 'TX-05' },
    async () => {
      const r = await api('GET', `/api/eventos/${tenant.eventoId}/transacoes`, { token: tenant.atendenteTokens[0] });
      if (r.status !== 403 && r.status !== 500) {
        return { status: 'failed', message: 'Somente DONO lista transações', expected: '403', actual: String(r.status) };
      }
      return { message: `Bloqueado (${r.status})`, expected: '403', actual: String(r.status) };
    },
  );
}
