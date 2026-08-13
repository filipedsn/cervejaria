import { expect, test } from '@playwright/test';
import path from 'node:path';
import { apiLogin, apiRequest, campoPorRotulo, selectPorRotulo } from './helpers/api';
import { CREDENTIALS } from './helpers/auth';

const quiosqueAuth = path.join(process.cwd(), 'e2e/.auth/quiosque.json');

test.use({ storageState: quiosqueAuth });
test.describe.configure({ mode: 'serial' });

test.describe('Quiosque — ciclo de caixa', () => {
  const nomePonto = `E2E Caixa ${Date.now()}`;
  let pontoId = '';

  test.beforeAll(async () => {
    // Ponto dedicado para não interferir com outros testes de quiosque.
    const token = await apiLogin(CREDENTIALS.quiosque.email, CREDENTIALS.quiosque.password);
    const ponto = await apiRequest<{ id: string }>('POST', '/api/quiosque/pontos-venda', {
      token,
      body: { nome: nomePonto },
    });
    expect(ponto.status, 'ponto de venda criado por API').toBe(201);
    pontoId = ponto.data.id;
  });

  test('abre caixa, registra sangria e suprimento e fecha com divergência', async ({ page }) => {
    await page.goto('/quiosque/comandas');

    await selectPorRotulo(page, 'Ponto de venda').selectOption({ label: nomePonto });
    await expect(page.getByRole('heading', { name: 'Caixa do dia' })).toBeVisible();

    await campoPorRotulo(page, 'Troco inicial (R$)').fill('100');
    await page.getByRole('button', { name: 'Abrir caixa' }).click();
    await expect(page.getByRole('heading', { name: 'Caixa aberto' })).toBeVisible();
    await expect(page.getByText('Em operação')).toBeVisible();

    await page.getByRole('button', { name: 'Sangria' }).click();
    const modalSangria = page.getByRole('dialog');
    await expect(modalSangria.getByText('Registrar sangria')).toBeVisible();
    await campoPorRotulo(modalSangria, 'Valor (R$)').fill('30');
    await campoPorRotulo(modalSangria, 'Observação (opcional)').fill('Retirada E2E');
    await modalSangria.getByRole('button', { name: 'Confirmar' }).click();
    await expect(modalSangria).not.toBeVisible();

    await page.getByRole('button', { name: 'Suprimento' }).click();
    const modalSuprimento = page.getByRole('dialog');
    await expect(modalSuprimento.getByText('Registrar suprimento')).toBeVisible();
    await campoPorRotulo(modalSuprimento, 'Valor (R$)').fill('20');
    await campoPorRotulo(modalSuprimento, 'Observação (opcional)').fill('Reforço E2E');
    await modalSuprimento.getByRole('button', { name: 'Confirmar' }).click();
    await expect(modalSuprimento).not.toBeVisible();

    // 100 de troco - 30 de sangria + 20 de suprimento = 90 esperados na gaveta.
    await expect(page.getByText('Gaveta:').locator('..')).toContainText('90,00');

    await page.getByRole('button', { name: 'Fechar caixa' }).click();
    const modalFechar = page.getByRole('dialog');
    await expect(modalFechar.getByText('Fechar caixa')).toBeVisible();
    // Conta 10 a menos do que o esperado para provocar a divergência.
    await campoPorRotulo(modalFechar, 'Contado — Dinheiro').fill('80');
    await campoPorRotulo(modalFechar, 'Observação (opcional)').fill('Falta de troco E2E');
    await modalFechar.getByRole('button', { name: 'Confirmar fechamento' }).click();

    await expect(modalFechar).not.toBeVisible();
    await expect(page.getByRole('heading', { name: 'Caixa do dia' })).toBeVisible();
  });

  test('após fechar, abre novo turno no mesmo dia', async ({ page }) => {
    await page.goto('/quiosque/comandas');

    await selectPorRotulo(page, 'Ponto de venda').selectOption({ label: nomePonto });
    await expect(page.getByRole('heading', { name: 'Caixa do dia' })).toBeVisible();

    await campoPorRotulo(page, 'Troco inicial (R$)').fill('50');
    await page.getByRole('button', { name: 'Abrir caixa' }).click();
    await expect(page.getByRole('heading', { name: 'Caixa aberto' })).toBeVisible();

    await page.getByRole('button', { name: 'Fechar caixa' }).click();
    const modalFechar = page.getByRole('dialog');
    await campoPorRotulo(modalFechar, 'Contado — Dinheiro').fill('50');
    await modalFechar.getByRole('button', { name: 'Confirmar fechamento' }).click();
    await expect(modalFechar).not.toBeVisible();

    await expect(page.getByRole('heading', { name: 'Caixa do dia' })).toBeVisible();
    await campoPorRotulo(page, 'Troco inicial (R$)').fill('80');
    await page.getByRole('button', { name: 'Abrir caixa' }).click();
    await expect(page.getByRole('heading', { name: 'Caixa aberto' })).toBeVisible();

    const token = await apiLogin(CREDENTIALS.quiosque.email, CREDENTIALS.quiosque.password);
    const reabrir = await apiRequest('POST', '/api/quiosque/caixa/abrir', {
      token,
      body: { pontoVendaId: pontoId, trocoInicial: 10 },
    });
    expect(reabrir.status, 'API recusa segundo caixa aberto simultâneo').toBe(400);
  });
});
