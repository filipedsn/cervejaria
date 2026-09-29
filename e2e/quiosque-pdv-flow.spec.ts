import { expect, test } from '@playwright/test';
import path from 'node:path';
import { apiLogin, apiRequest } from './helpers/api';
import { CREDENTIALS } from './helpers/auth';

const quiosqueAuth = path.join(process.cwd(), 'e2e/.auth/operacao.json');

test.use({ storageState: quiosqueAuth });
test.describe.configure({ mode: 'serial' });

test.describe('Quiosque — lançamento contínuo de itens', () => {
  const stamp = Date.now();
  let comandaId = '';
  let produtoNome = '';

  test.beforeAll(async () => {
    const cookie = await apiLogin(CREDENTIALS.quiosque.email, CREDENTIALS.quiosque.password);
    const ponto = await apiRequest<{ id: string }>('POST', '/api/operacao/pontos-venda', {
      cookie,
      body: { nome: `E2E PDV rápido ${stamp}` },
    });
    expect(ponto.status).toBe(201);

    const caixa = await apiRequest('POST', '/api/operacao/caixa/abrir', {
      cookie,
      body: { pontoVendaId: ponto.data.id, trocoInicial: 0 },
    });
    expect(caixa.status).toBe(201);

    produtoNome = `E2E Item ${stamp}`;
    const produto = await apiRequest<{ id: string }>('POST', '/api/operacao/produtos', {
      cookie,
      body: { nome: produtoNome, precoUnit: 7, exigePreparo: false, controlaEstoque: false },
    });
    expect(produto.status).toBe(201);
    const cardapio = await apiRequest('PUT', `/api/operacao/caixa/cardapio?pontoVendaId=${ponto.data.id}`, {
      cookie,
      body: { produtoIds: [produto.data.id] },
    });
    expect(cardapio.status).toBe(200);

    const comanda = await apiRequest<{ id: string }>('POST', '/api/operacao/comandas', {
      cookie,
      body: {
        pontoVendaId: ponto.data.id,
        tipo: 'APELIDO',
        identificador: `Rápida ${stamp}`,
        itens: [],
      },
    });
    expect(comanda.status).toBe(201);
    comandaId = comanda.data.id;
  });

  test('mantém o seletor aberto e limpa a rodada após lançar itens', async ({ page }) => {
    await page.goto(`/operacao/comandas/${comandaId}`);
    await page.getByRole('button', { name: '+ Itens' }).click();

    const dialog = page.getByRole('dialog', { name: 'Adicionar item' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: new RegExp(`^${produtoNome}`) }).click();
    await page.getByRole('dialog').last().getByRole('button', { name: 'Adicionar item' }).click();
    await dialog.getByRole('button', { name: 'Lançar na comanda' }).click();

    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Itens lançados. Selecione os próximos itens.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Lançar na comanda' })).toBeDisabled();
  });
});
