import { expect, test } from '@playwright/test';
import path from 'node:path';
import { apiLogin, apiRequest } from './helpers/api';
import { CREDENTIALS } from './helpers/auth';

const cozinhaAuth = path.join(process.cwd(), 'e2e/.auth/operacao-cozinha.json');

interface ProdutoQuiosque {
  id: string;
  nome: string;
  exigePreparo: boolean;
}

interface ComandaCriada {
  id: string;
  pedidos?: Array<{ id: string; numero: number }>;
}

test.use({ storageState: cozinhaAuth });
test.describe.configure({ mode: 'serial' });

test.describe('Quiosque — fila da cozinha e cancelamento', () => {
  const stamp = Date.now();
  const identificador = `E2E-${stamp}`;
  let donoCookie = '';
  let pedidoId = '';

  test.beforeAll(async () => {
    donoCookie = await apiLogin(CREDENTIALS.quiosqueCozinha.email, CREDENTIALS.quiosqueCozinha.password);

    const ponto = await apiRequest<{ id: string }>('POST', '/api/operacao/pontos-venda', {
      cookie: donoCookie,
      body: { nome: `E2E Cozinha ${stamp}` },
    });
    expect(ponto.status).toBe(201);

    const caixa = await apiRequest('POST', '/api/operacao/caixa/abrir', {
      cookie: donoCookie,
      body: { pontoVendaId: ponto.data.id, trocoInicial: 100 },
    });
    expect(caixa.status).toBe(201);

    const produtos = await apiRequest<ProdutoQuiosque[]>('GET', '/api/operacao/produtos', { cookie: donoCookie });
    const preparo = produtos.data?.find((p) => p.exigePreparo);
    expect(preparo, 'seed precisa de um produto que exige preparo').toBeTruthy();

    const comanda = await apiRequest<ComandaCriada>('POST', '/api/operacao/comandas', {
      cookie: donoCookie,
      body: {
        pontoVendaId: ponto.data.id,
        tipo: 'MESA',
        identificador,
        itens: [{ produtoId: preparo!.id, quantidade: 2 }],
      },
    });
    expect(comanda.status).toBe(201);
    pedidoId = comanda.data.pedidos?.[0]?.id ?? '';
    expect(pedidoId, 'item de preparo deve gerar pedido na cozinha').toBeTruthy();
  });

  test('pedido aparece na fila e avança para preparo', async ({ page }) => {
    await page.goto('/operacao/cozinha');

    const card = page.locator('article').filter({ hasText: `Mesa ${identificador}` });
    await expect(card).toBeVisible();
    await expect(card.getByText('Na fila')).toBeVisible();

    await card.getByRole('button', { name: 'Iniciar preparo' }).click();
    await expect(card.getByText('Preparando')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Pronto' })).toBeVisible();
  });

  test('ATENDENTE não consegue cancelar pedido em preparo', async () => {
    const slug = CREDENTIALS.quiosqueCozinha.email.replace('-dono@qa.test', '');
    const atendenteCookie = await apiLogin(`${slug}-a1@qa.test`, CREDENTIALS.quiosqueCozinha.password);

    const r = await apiRequest('PATCH', `/api/operacao/cozinha/${pedidoId}/status`, {
      cookie: atendenteCookie,
      body: { status: 'CANCELAMENTO_PENDENTE' },
    });
    expect(r.status, 'cancelamento é exclusivo do DONO').toBe(403);
  });

  test('DONO solicita cancelamento, pedido fica destacado e sai após confirmação da cozinha', async ({ page }) => {
    await page.goto('/operacao/cozinha');
    const card = page.locator('article').filter({ hasText: `Mesa ${identificador}` });
    await card.getByRole('button', { name: 'Cancelar pedido' }).click();

    const dialog = page.getByRole('dialog', { name: 'Solicitar cancelamento do pedido' });
    await expect(dialog).toContainText(`Mesa ${identificador}`);
    await expect(dialog).toContainText('atualmente em preparo');
    await dialog.getByRole('button', { name: 'Solicitar cancelamento' }).click();

    const card = page.locator('article').filter({ hasText: `Mesa ${identificador}` });
    await expect(page.getByText('Cancelamento solicitado. O pedido permanecerá destacado até a confirmação da cozinha.')).toBeVisible();
    await expect(card).toBeVisible();
    await expect(card.getByText('Cancelamento solicitado')).toBeVisible();
    await card.getByRole('button', { name: 'Confirmar cancelamento' }).click();
    await expect(page.getByText('Cancelamento confirmado e pedido removido da fila.')).toBeVisible();
    await expect(card).toHaveCount(0);

    await page.getByRole('button', { name: 'Entregues' }).click();
    await expect(page.locator('article').filter({ hasText: `Mesa ${identificador}` })).toHaveCount(0);
  });
});
