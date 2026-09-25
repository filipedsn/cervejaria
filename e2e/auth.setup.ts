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
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.goto('/login');
    await page.getByLabel('E-mail').fill(email);
    await page.locator('#password').fill(password);
    await page.getByRole('button', { name: 'Entrar' }).click();
    try {
      await expect(page).not.toHaveURL(/\/login$/, { timeout: 15_000 });
      await page.context().storageState({ path: path.join(AUTH_DIR, fileName) });
      return;
    } catch {
      if (attempt === 4) throw new Error(`Login falhou para ${email} após 5 tentativas`);
      await page.waitForTimeout(5000);
    }
  }
}

setup('authenticate roles', async ({ page }) => {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

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
