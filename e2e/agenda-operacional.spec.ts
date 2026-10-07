import { expect, test } from '@playwright/test';
import { CREDENTIALS, gotoAfterLogin, login } from './helpers/auth';

test.describe('Agenda operacional canônica', () => {
  test('navega até a gestão e submete recorrência e ocorrência avulsa', async ({ page }) => {
    await login(page, CREDENTIALS.quiosque.email, CREDENTIALS.quiosque.password);
    await page.route('**/api/operacao/agenda/ocorrencias?**', (route) => route.fulfill({ json: { agendas: [], ocorrencias: [] } }));
    const writes: Array<{ method: string; url: string; body: unknown }> = [];
    await page.route('**/api/operacao/agenda/**', async (route) => {
      const request = route.request();
      if (request.method() === 'GET') return route.fulfill({ json: { agendas: [], ocorrencias: [] } });
      writes.push({ method: request.method(), url: request.url(), body: request.postDataJSON() });
      return route.fulfill({ status: request.method() === 'POST' ? 201 : 200, json: { id: 'agenda-ui' } });
    });
    await gotoAfterLogin(page, '/operacao/configuracoes/equipe');
    await page.getByRole('link', { name: 'Operação' }).click();
    await expect(page.getByRole('heading', { name: 'Agenda operacional' })).toBeVisible();

    await page.getByLabel('Nome', { exact: true }).fill('Sábado da UI');
    await page.getByRole('button', { name: 'Cadastrar recorrência' }).click();
    await expect.poll(() => writes.some((write) => write.url.endsWith('/agendas') && write.method === 'POST')).toBe(true);
    expect(writes.find((write) => write.url.endsWith('/agendas'))?.body).toMatchObject({ nome: 'Sábado da UI', diaSemana: 6 });

    await page.getByLabel('Nome', { exact: true }).nth(1).fill('Encontro avulso');
    await page.getByRole('button', { name: 'Cadastrar ocorrência' }).click();
    await expect.poll(() => writes.some((write) => write.url.endsWith('/ocorrencias'))).toBe(true);
    expect(writes.find((write) => write.url.endsWith('/ocorrencias'))?.body).toMatchObject({ nome: 'Encontro avulso' });
  });

  test('confirma outra data e limpa a confirmação ao trocar de ocorrência', async ({ page }) => {
    await login(page, CREDENTIALS.quiosque.email, CREDENTIALS.quiosque.password);
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
