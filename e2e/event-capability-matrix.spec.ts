import { expect, test } from '@playwright/test';
import { API_BASE, apiLogin, apiRequest } from './helpers/api';
import { CREDENTIALS } from './helpers/auth';

type EventCase = {
  id: string;
  taps: boolean;
  tapState: 'none' | 'without-chope' | 'with-chope' | 'inactive-chope';
};

const baseCases: EventCase[] = [
  { id: 'E01', taps: false, tapState: 'none' },
  { id: 'E02', taps: true, tapState: 'none' },
  { id: 'E03', taps: true, tapState: 'without-chope' },
  { id: 'E04', taps: true, tapState: 'with-chope' },
  { id: 'E05', taps: false, tapState: 'without-chope' },
  { id: 'E06', taps: true, tapState: 'inactive-chope' },
];

const matrix = baseCases.flatMap((item) =>
  [false, true].flatMap((inventoryEnabled) =>
    [false, true].map((kitchenEnabled) => ({ ...item, inventoryEnabled, kitchenEnabled })),
  ),
);

const stamp = Date.now();
const owner = {
  name: 'Dono Capability EVENTO',
  email: `event-capability-${stamp}@qa.test`,
  password: 'qa123456',
};

let adminCookie = '';
let ownerCookie = '';
let companyId = '';

async function createCompany() {
  const data = new FormData();
  data.append('cervejariaNome', `EVENTO Capability Matrix ${stamp}`);
  data.append('donoNome', owner.name);
  data.append('donoEmail', owner.email);
  data.append('donoSenha', owner.password);
  data.append('moduloCervejaria', 'false');
  data.append('moduloQuiosque', 'true');
  data.append('quiosqueControlaEstoque', 'false');
  data.append('quiosqueTemCozinha', 'false');

  const response = await fetch(`${API_BASE}/api/admin/cervejarias`, {
    method: 'POST',
    headers: { Cookie: adminCookie, Accept: 'application/json' },
    body: data,
  });
  const body = (await response.json()) as { cervejaria?: { id: string }; error?: string };
  expect(response.status, body.error).toBe(201);
  companyId = body.cervejaria?.id ?? '';
  expect(companyId).not.toBe('');
  ownerCookie = await apiLogin(owner.email, owner.password);
}

async function configure(item: (typeof matrix)[number]) {
  const result = await apiRequest('PATCH', `/api/admin/cervejarias/${companyId}/configuracao-operacional`, {
    cookie: adminCookie,
    body: {
      plannedOperationsEnabled: true,
      directSalesEnabled: false,
      tapsEnabled: item.taps,
      inventoryEnabled: item.inventoryEnabled,
      kitchenEnabled: item.kitchenEnabled,
      confirmacaoEstoque: true,
    },
  });
  expect(result.status, JSON.stringify(result.data)).toBe(200);
}

async function createTrailer(index: number) {
  const result = await apiRequest<{ id: string }>('POST', '/api/trailers', {
    cookie: ownerCookie,
    body: { nome: `Trailer ${index}` },
  });
  expect(result.status, JSON.stringify(result.data)).toBe(201);
  return result.data.id;
}

async function prepareTapState(item: EventCase, trailerId: string, index: number) {
  if (item.tapState === 'none') return;

  const product = await apiRequest<{ id: string }>('POST', '/api/produtos', {
    cookie: ownerCookie,
    body: {
      nome: `Chope matrix ${index}`,
      tipo: 'BEBIDA',
      formato: 'CHOPE',
      precos: [{ volumeMl: 300, preco: 10 }],
    },
  });
  expect(product.status, JSON.stringify(product.data)).toBe(201);

  const tap = await apiRequest<{ id: string }>('POST', '/api/taps', {
    cookie: ownerCookie,
    body: { numero: 1, nome: 'Tap matrix', produtoId: product.data.id, trailerId },
  });
  expect(tap.status, JSON.stringify(tap.data)).toBe(201);

  if (item.tapState === 'without-chope') {
    const removed = await apiRequest('DELETE', `/api/produtos/${product.data.id}`, { cookie: ownerCookie });
    expect(removed.status, JSON.stringify(removed.data)).toBe(204);
  } else if (item.tapState === 'inactive-chope') {
    const inactive = await apiRequest('PATCH', `/api/taps/${tap.data.id}/ativo`, {
      cookie: ownerCookie,
      body: { ativo: false },
    });
    expect(inactive.status, JSON.stringify(inactive.data)).toBe(200);
  }
}

test.describe('EVENTO — Capability Dependency Matrix E01-E06', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(90_000);

  test.beforeAll(async () => {
    adminCookie = await apiLogin(CREDENTIALS.admin.email, CREDENTIALS.admin.password);
    await createCompany();
  });

  test.afterAll(async () => {
    if (companyId) {
      await apiRequest('PATCH', `/api/admin/cervejarias/${companyId}/ativo`, {
        cookie: adminCookie,
        body: { ativo: false },
      });
    }
  });

  for (const [index, item] of matrix.entries()) {
    test(`${item.id} inventory=${Number(item.inventoryEnabled)} kitchen=${Number(item.kitchenEnabled)}`, async () => {
      await configure(item);
      const trailerId = await createTrailer(index + 1);
      await prepareTapState(item, trailerId, index + 1);

      const date = new Date(Date.now() + (index + 1) * 86_400_000).toISOString().slice(0, 10);
      const created = await apiRequest<{ id: string; status: string }>('POST', '/api/eventos', {
        cookie: ownerCookie,
        body: {
          nome: `${item.id} Capability Event`,
          local: 'DEV matrix',
          data: date,
          horaInicio: '18:00',
          horaFim: '19:00',
          recorrencia: 'NENHUMA',
          abrirAgora: true,
          trailerId,
        },
      });
      expect(created.status, JSON.stringify(created.data)).toBe(201);
      expect(created.data.status).toBe('ABERTO');

      const closed = await apiRequest<{ status: string }>('PATCH', `/api/eventos/${created.data.id}/fechar`, { cookie: ownerCookie });
      expect(closed.status, JSON.stringify(closed.data)).toBe(200);
      expect(closed.data.status).toBe('FECHADO');

      const reopened = await apiRequest<{ status: string }>('PATCH', `/api/eventos/${created.data.id}/reabrir`, { cookie: ownerCookie });
      expect(reopened.status, JSON.stringify(reopened.data)).toBe(200);
      expect(reopened.data.status).toBe('ABERTO');

      const finallyClosed = await apiRequest<{ status: string }>('PATCH', `/api/eventos/${created.data.id}/fechar`, { cookie: ownerCookie });
      expect(finallyClosed.status, JSON.stringify(finallyClosed.data)).toBe(200);
      expect(finallyClosed.data.status).toBe('FECHADO');
    });
  }
});
