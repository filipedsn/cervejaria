import { expect, test } from '@playwright/test';

async function authenticateAsOwner(page: import('@playwright/test').Page) {
  await page.route('**/api/**', (route) => route.abort());
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: {
    usuario: { id: 'agenda-ui-owner', nome: 'QA Agenda', email: 'agenda-ui@qa.test', papel: 'DONO', cervejariaId: 'agenda-ui-tenant' },
    cervejaria: { id: 'agenda-ui-tenant', nome: 'QA Agenda', slug: 'qa-agenda-ui' },
  } }));
  await page.route('**/api/operacao/contexto', (route) => route.fulfill({ json: {
    ativo: true, operationMode: 'CAIXA', plannedOperationsEnabled: false, cashRegisterEnabled: true,
    tapsEnabled: false, operationalSettingsSource: 'CANONICAL_PDV', inventoryEnabled: false,
    kitchenEnabled: false, controlaEstoque: false, temCozinha: false, usaCardapio: false,
    quantidadeMesas: 0, whatsappPedidoProntoEnabled: false, whatsappPedidoProntoNaCozinha: false,
    pontosVenda: [{ id: 'agenda-ui-pdv', nome: 'Balcão', ativo: true }],
  } }));
}

test.describe('Agenda operacional canônica', () => {
  test.use({ serviceWorkers: 'block' });

  test('navega até a gestão e submete recorrência e ocorrência avulsa', async ({ page }) => {
    await authenticateAsOwner(page);
    await page.goto('/operacao/configuracoes/equipe');
    await page.route('**/api/operacao/agenda/ocorrencias?**', (route) => route.fulfill({ json: { agendas: [], ocorrencias: [] } }));
    const writes: Array<{ method: string; url: string; body: unknown }> = [];
    await page.route('**/api/operacao/agenda/**', async (route) => {
      const request = route.request();
      if (request.method() === 'GET') return route.fulfill({ json: { agendas: [], ocorrencias: [] } });
      writes.push({ method: request.method(), url: request.url(), body: request.postDataJSON() });
      return route.fulfill({ status: request.method() === 'POST' ? 201 : 200, json: { id: 'agenda-ui' } });
    });
    await page.getByRole('link', { name: 'Operação' }).click();
    await expect(page.getByRole('heading', { name: 'Agenda operacional' })).toBeVisible();

    await page.locator('form').filter({ hasText: 'Nova recorrência' }).getByLabel('Nome').fill('Sábado da UI');
    await page.getByRole('button', { name: 'Cadastrar recorrência' }).click();
    await expect.poll(() => writes.some((write) => write.url.endsWith('/agendas') && write.method === 'POST')).toBe(true);
    expect(writes.find((write) => write.url.endsWith('/agendas'))?.body).toMatchObject({ nome: 'Sábado da UI', diaSemana: 6 });

    await page.locator('form').filter({ hasText: 'Ocorrência avulsa' }).getByLabel('Nome').fill('Encontro avulso');
    await page.getByRole('button', { name: 'Cadastrar ocorrência' }).click();
    await expect.poll(() => writes.some((write) => write.url.endsWith('/ocorrencias'))).toBe(true);
    expect(writes.find((write) => write.url.endsWith('/ocorrencias'))?.body).toMatchObject({ nome: 'Encontro avulso' });
  });

  test('confirma outra data e limpa a confirmação ao trocar de ocorrência', async ({ page }) => {
    await authenticateAsOwner(page);
    await page.route('**/api/operacao/caixa?pontoVendaId=*', (route) => route.fulfill({ json: { sessao: null, comandasAbertas: 0, diaOperacional: '2026-10-07' } }));
    await page.route('**/api/operacao/agenda/ocorrencias?**', (route) => route.fulfill({ json: { agendas: [], ocorrencias: [
      { id: 'today', nome: 'Hoje', data: '2026-10-07', status: 'PROGRAMADA', agenda: { nome: 'Sábado', frequencia: 'SEMANAL', diaSemana: 6 } },
      { id: 'other-day', nome: 'Outro dia', data: '2026-10-10', status: 'ABERTA', agenda: null },
      { id: 'closed', nome: 'Fechada', data: '2026-10-07', status: 'FECHADA', agenda: null },
    ] } }));
    await page.goto('/operacao/comandas');
    const pointSelect = page.getByLabel('Ponto de venda');
    if (await pointSelect.count()) await pointSelect.selectOption({ index: 1 });
    const occurrenceSelect = page.getByLabel('Ocorrência do caixa (opcional)');
    await expect(occurrenceSelect).toBeVisible();
    await expect(occurrenceSelect.locator('option')).toHaveCount(3);
    await expect(occurrenceSelect.locator('option').nth(1)).toContainText('Hoje');
    await expect(occurrenceSelect.locator('option').nth(1)).toContainText('semanal');
    await occurrenceSelect.selectOption('other-day');
    const confirmation = page.getByRole('checkbox');
    await expect(confirmation).toBeVisible();
    await confirmation.check();
    await occurrenceSelect.selectOption('today');
    await expect(confirmation).not.toBeVisible();
    await expect(page.getByRole('option', { name: /Fechada/ })).toHaveCount(0);
  });
});
