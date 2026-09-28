import { expect, test } from '@playwright/test';
import { apiLogin, apiRequest, selectPorRotulo } from './helpers/api';
import { login } from './helpers/auth';

const OWNER = { email: 'qa-cfg-quiosque-10-dono@qa.test', password: 'qa123456' };
const stamp = Date.now();
const productName = `E2E estoque crítico ${stamp}`;
let cookie = '';
let pontoVendaId = '';
let produtoId = '';

test.describe('Quiosque — estoque crítico', () => {
  test.setTimeout(90_000);
  test.beforeAll(async () => {
    cookie = await apiLogin(OWNER.email, OWNER.password);

    const capacidadeEstoque = await apiRequest('PATCH', '/api/cervejaria/configuracao-operacional', {
      cookie,
      body: { inventoryEnabled: true, confirmacaoEstoque: true },
    });
    expect(capacidadeEstoque.status, 'capacidade de estoque ativada para o caso E2E').toBe(200);

    const ponto = await apiRequest<{ id: string }>('POST', '/api/operacao/pontos-venda', {
      cookie,
      body: { nome: `E2E estoque ${stamp}` },
    });
    expect(ponto.status).toBe(201);
    pontoVendaId = ponto.data.id;

    const caixa = await apiRequest('POST', '/api/operacao/caixa/abrir', {
      cookie,
      body: { pontoVendaId, trocoInicial: 0 },
    });
    expect(caixa.status).toBe(201);

    const produto = await apiRequest<{ id: string }>('POST', '/api/operacao/produtos', {
      cookie,
      body: { nome: productName, precoUnit: 8, exigePreparo: false, controlaEstoque: true },
    });
    expect(produto.status).toBe(201);
    produtoId = produto.data.id;

    const entrada = await apiRequest('POST', '/api/operacao/estoque/entrada', {
      cookie,
      body: { pontoVendaId, produtoId, quantidade: 2 },
    });
    expect(entrada.status).toBe(201);

    const minimo = await apiRequest('PUT', '/api/operacao/estoque/minimo', {
      cookie,
      body: { pontoVendaId, produtoId, estoqueMinimo: 2 },
    });
    expect(minimo.status).toBe(200);
  });

  test('mostra LOW e deixa ESGOTADO visível, porém indisponível, após a última venda', async ({ page }) => {
    await login(page, OWNER.email, OWNER.password);
    await page.goto('/operacao/comandas/venda-avulsa');
    await selectPorRotulo(page, 'Ponto de venda').selectOption(pontoVendaId);
    await page.getByRole('button', { name: '+ Item' }).click();

    const dialog = page.getByRole('dialog', { name: 'Adicionar item' });
    const produto = dialog.getByRole('button', { name: new RegExp(productName) });
    await expect(produto).toContainText('Estoque baixo · 2');

    await produto.click();
    await page.getByRole('dialog').last().getByRole('button', { name: /Adicionar item/ }).click();
    await dialog.getByRole('button', { name: 'Adicionar à venda' }).click();
    await page.getByRole('button', { name: /Pagar/ }).click();
    await page.getByRole('button', { name: /Revisar pagamento/ }).click();
    await page.getByRole('button', { name: /Efetuar pagamento/ }).click();
    await page.getByRole('button', { name: 'OK' }).click();

    // O recibo retorna ao painel; abra novamente a venda no estado já persistido.
    await page.goto('/operacao/comandas/venda-avulsa');
    await selectPorRotulo(page, 'Ponto de venda').selectOption(pontoVendaId);
    await page.getByRole('button', { name: '+ Item' }).click();
    await expect(dialog.getByRole('button', { name: new RegExp(productName) })).toContainText('Estoque baixo · 1');
    await dialog.getByRole('button', { name: new RegExp(productName) }).click();
    await page.getByRole('dialog').last().getByRole('button', { name: /Adicionar item/ }).click();
    await dialog.getByRole('button', { name: 'Adicionar à venda' }).click();
    await page.getByRole('button', { name: /Pagar/ }).click();
    await page.getByRole('button', { name: /Revisar pagamento/ }).click();
    await page.getByRole('button', { name: /Efetuar pagamento/ }).click();
    await page.getByRole('button', { name: 'OK' }).click();

    await page.goto('/operacao/comandas/venda-avulsa');
    await selectPorRotulo(page, 'Ponto de venda').selectOption(pontoVendaId);
    await page.getByRole('button', { name: '+ Item' }).click();
    const esgotado = dialog.getByRole('button', { name: new RegExp(productName) });
    await expect(esgotado).toContainText('Esgotado');
    await expect(esgotado).toBeDisabled();
  });
});
