import { expect, test } from '@playwright/test';
import path from 'node:path';
import { CREDENTIALS, logoutViaAccountMenu } from './helpers/auth';

const donoAuth = path.join(process.cwd(), 'e2e/.auth/dono.json');

test.use({ storageState: donoAuth });

test.describe('Troca de usuário offline', () => {
  test('logout offline limpa sessão e login de outro perfil fica disponível', async ({ page, context }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), undefined, { timeout: 15_000 });
    await expect(page.getByRole('navigation').first()).toBeVisible();

    await logoutViaAccountMenu(page);

    const storageLimpo = await page.evaluate(() => ({
      evento: localStorage.getItem('eventoAtivo'),
      trailer: localStorage.getItem('trailerAtivo'),
    }));
    expect(storageLimpo.evento).toBeNull();
    expect(storageLimpo.trailer).toBeNull();

    await context.setOffline(true);

    await page.locator('#email').fill(CREDENTIALS.atendente.email);
    await page.locator('#password').fill(CREDENTIALS.atendente.password);
    await page.getByRole('button', { name: 'Entrar' }).click();

    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
    await expect(page.locator('#email')).toHaveValue(CREDENTIALS.atendente.email);
    await expect(page.getByRole('alert')).toBeVisible();
  });
});
