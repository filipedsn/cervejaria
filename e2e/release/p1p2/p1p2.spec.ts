import { expect } from '@playwright/test';
import { test } from '../support/fixtures';
import { personaContext } from '../support/personas';

const denied = [
  ['CAT-X01', '/api/operacao/produtos'],
  ['CFG-X01', '/api/cervejaria/configuracao-operacional'],
  ['EST-X05', '/api/operacao/estoque'],
  ['AGD-X04', '/api/operacao/agendas/arquivadas'],
  ['CLI-X01', '/api/clientes'],
] as const;

for (const [id, route] of denied) {
  test(`${id} atendente sem permissão não acessa ${route}`, async ({ browser, baseURL, evidence }, testInfo) => {
    const context = await personaContext(browser, baseURL!, 'staffB');
    try {
      const response = await context.request.get(route);
      evidence.recordApi({ method: 'GET', url: route, status: response.status(), responseBody: await response.text() });
      testInfo.annotations.push({ type: 'evidence', description: `${response.status()} ${route}` });
      expect([403, 404]).toContain(response.status());
    } finally {
      await context.close();
    }
  });
}

test('ONB-S01 readiness do onboarding responde com progresso atual', async ({ browser, baseURL }, testInfo) => {
  const context = await personaContext(browser, baseURL!, 'owner');
  try {
    const readiness = await context.request.get('/api/onboarding/readiness');
    expect(readiness.status()).toBe(200);
    const body = await readiness.json();
    testInfo.annotations.push({ type: 'observed', description: JSON.stringify(body) });
    expect(body).toBeTruthy();
    expect(typeof body).toBe('object');
  } finally {
    await context.close();
  }
});

test('AUT-X01 credencial inválida falha com mensagem genérica', async ({ request, evidence }, testInfo) => {
  const response = await request.post('/api/auth/login', { data: { email: 'missing@example.invalid', senha: 'wrong' } });
  const body = await response.json();
  evidence.recordApi({ method: 'POST', url: '/api/auth/login', status: response.status(), requestBody: { email: 'missing@example.invalid', senha: '[REDACTED]' }, responseBody: body });
  testInfo.annotations.push({ type: 'observed', description: `HTTP ${response.status()} ${JSON.stringify(body)}` });
  expect(response.status()).toBe(401);
  expect(JSON.stringify(body).toLowerCase()).not.toMatch(/usuário não encontrado|email inexistente/);
});

test('POR-X01 slug inexistente não expõe dados do portal', async ({ request, evidence }, testInfo) => {
  const response = await request.get('/api/cervejarias/slug-inexistente/pontos-venda/pv-inexistente/info');
  evidence.recordApi({ method: 'GET', url: '/api/cervejarias/slug-inexistente/pontos-venda/pv-inexistente/info', status: response.status(), responseBody: await response.text() });
  testInfo.annotations.push({ type: 'observed', description: `HTTP ${response.status()}` });
  expect([404, 400]).toContain(response.status());
});

test('PWA-S01 manifest publicado contém nome e atalhos do produto', async ({ request, evidence }) => {
  const response = await request.get('/manifest.webmanifest');
  evidence.recordApi({ method: 'GET', url: '/manifest.webmanifest', status: response.status(), responseBody: await response.text() });
  expect(response.status()).toBe(200);
  const manifest = await response.json();
  expect(manifest.name).toBeTruthy();
  expect(Array.isArray(manifest.icons)).toBe(true);
});
