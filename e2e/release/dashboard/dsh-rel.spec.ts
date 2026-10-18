import { expect, test } from '../support/fixtures';
import { personaContext } from '../support/personas';

const baseURL = process.env.RELEASE_QA_BASE_URL!;

test('DSH-X01 sem dashboard.read não consulta o dashboard operacional', async ({ browser, evidence }) => {
  const staff = await personaContext(browser, baseURL, 'staffB');
  try {
    const response = await staff.request.get('/api/operacao/dashboard');
    const body = await response.json().catch(() => null);
    evidence.recordApi({ method: 'GET', path: '/api/operacao/dashboard', status: response.status(), body });
    expect(response.status()).toBe(403);
  } finally { await staff.close(); }
});

test('DSH-X02 dashboard bloqueia mês futuro', async ({ browser, evidence }) => {
  const owner = await personaContext(browser, baseURL, 'owner');
  try {
    const future = new Date();
    future.setMonth(future.getMonth() + 2);
    const response = await owner.request.get(`/api/operacao/dashboard?ano=${future.getFullYear()}&mes=${future.getMonth() + 1}`);
    const body = await response.json().catch(() => null);
    evidence.recordApi({ method: 'GET', path: '/api/operacao/dashboard?ano=<future>&mes=<future>', status: response.status(), body });
    expect(response.status()).toBe(400);
  } finally { await owner.close(); }
});

test('DSH-S04 registra acesso ao dashboard da cervejaria no canônico', async ({ browser, evidence }) => {
  const owner = await personaContext(browser, baseURL, 'owner');
  try {
    const response = await owner.request.get('/api/cervejaria/dashboard');
    const body = await response.json().catch(() => null);
    evidence.recordApi({ method: 'GET', path: '/api/cervejaria/dashboard', status: response.status(), body });
    expect([200, 403, 404]).toContain(response.status());
    test.info().annotations.push({ type: 'product-decision', description: `Em tenant canônico, GET /api/cervejaria/dashboard respondeu HTTP ${response.status()}; produto deve decidir se o dashboard legado permanece acessível.` });
  } finally { await owner.close(); }
});
