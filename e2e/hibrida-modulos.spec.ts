import { expect, test } from '@playwright/test';
import path from 'node:path';

const hibridaAuth = path.join(process.cwd(), 'e2e/.auth/hibrida.json');

test.use({ storageState: hibridaAuth });

test.describe('Empresa híbrida', () => {
  test('dono alterna Cervejaria ↔ Quiosque no mesmo login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/quiosque\/comandas/);
    await expect(page.getByRole('heading', { name: 'Caixa aberto' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Quiosque' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Comandas' })).toBeVisible();
    await expect(page.getByRole('link', { name: '+ Comanda', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Venda avulsa' })).toBeVisible();

    await page.goto('/quiosque/configuracoes/operacao');
    await expect(page).toHaveURL(/\/quiosque\/configuracoes\/operacao/);
    // A agenda muda de forma conforme o evento do dia esteja aberto ou apenas
    // agendado; o que precisa valer sempre é o módulo cervejaria responder.
    await expect(page.getByRole('heading', { name: /Como voc/ })).toBeVisible();
    // The calendar fixture is ephemeral. The enduring rule is that this
    // composition can reach its capability settings without a company mode.
    await expect(page.getByRole('button', { name: 'Por caixa' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: /Por opera/ })).toHaveAttribute('aria-pressed', 'false');
  });
});
