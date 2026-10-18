import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '../support/fixtures';
import { personaContext, personaStorageState } from '../support/personas';

const baseURL = process.env.RELEASE_QA_BASE_URL!;
const context = JSON.parse(readFileSync(process.env.RELEASE_QA_CONTEXT!, 'utf8'));

test('SEC-X02 atendente sem permissão não pode fechar evento canônico', async ({ browser, evidence }) => {
  const staff = await personaContext(browser, baseURL, 'cashier');
  try {
    const response = await staff.request.patch(`/api/eventos/${context.events.legacy}/fechar`, { data: {} });
    evidence.recordApi({ method: 'PATCH', path: '/api/eventos/:id/fechar', status: response.status(), body: await response.json().catch(() => null) });
    expect([403, 404]).toContain(response.status());
  } finally { await staff.close(); }
});

test('SEC-X05 cookie da sessão é HttpOnly', async ({ browser }) => {
  const state = JSON.parse(readFileSync(personaStorageState('owner'), 'utf8'));
  const cookie = state.cookies.find((item: { name: string }) => item.name === 'token');
  if (!cookie) throw new Error('Generated owner storageState is missing token cookie.');
  expect(cookie.httpOnly).toBe(true);
});

test('SEC-X06 não há senha administrativa real fixa no código E2E', async () => {
  const authHelper = readFileSync(path.join(process.cwd(), 'e2e/helpers/auth.ts'), 'utf8');
  expect(authHelper).not.toMatch(/admin\s*:\s*\{\s*email\s*:\s*['"][^'"]+['"],\s*password\s*:\s*['"][^'"]+['"]\s*\}/i);
});
