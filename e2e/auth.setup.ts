import { expect, test as setup } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { CREDENTIALS } from './helpers/auth';

const AUTH_DIR = path.resolve(process.cwd(), 'e2e/.auth');

async function saveAuthState(
  page: import('@playwright/test').Page,
  email: string,
  password: string,
  fileName: string,
) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.locator('#password').fill(password);
  const loginResponse = page.waitForResponse((response) =>
    response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/auth/login',
  );
  await page.getByRole('button', { name: 'Entrar' }).click();
  const response = await loginResponse;
  if (response.status() >= 500) {
    throw new Error(`Login returned HTTP ${response.status()}; consulte o log protegido da API QA.`);
  }
  await expect(page).not.toHaveURL(/\/login$/, { timeout: 15_000 });
  const statePath = path.join(AUTH_DIR, fileName);
  await page.context().storageState({ path: statePath });
  // Playwright generates the state; normalize it to UTF-8 JSON without BOM.
  const generated = fs.readFileSync(statePath, 'utf8').replace(/^\uFEFF/, '');
  fs.writeFileSync(statePath, `${JSON.stringify(JSON.parse(generated), null, 2)}\n`, { encoding: 'utf8' });
}

setup('authenticate roles', async ({ page }) => {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  if (process.env.E2E_SYNTHETIC_ONLY === '1') {
    await saveAuthState(page, CREDENTIALS.quiosque.email, CREDENTIALS.quiosque.password, 'operacao.json');
    return;
  }

  const roles = [
    { file: 'dono.json', ...CREDENTIALS.dono },
    { file: 'admin.json', ...CREDENTIALS.admin },
    { file: 'atendente.json', ...CREDENTIALS.atendente },
    { file: 'operacao.json', ...CREDENTIALS.quiosque },
    { file: 'operacao-cozinha.json', ...CREDENTIALS.quiosqueCozinha },
    { file: 'caixa.json', ...CREDENTIALS.caixa },
    { file: 'arena.json', ...CREDENTIALS.arena },
  ] as const;

  for (const role of roles) {
    await saveAuthState(page, role.email, role.password, role.file);
    await page.context().clearCookies();
    await page.waitForTimeout(2500);
  }
});
