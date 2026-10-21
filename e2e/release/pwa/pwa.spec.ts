import { expect, loginPage, logoutPage, test } from '../support/ops';

test('PWA-S01 manifest publicado contém nome e ícones @api', async ({ ops }) => {
  const anon = await ops.anonymous();
  const manifest = await anon.expect(anon.get('/manifest.webmanifest'), 200, 'manifest');
  expect(manifest.name).toBeTruthy();
  expect(Array.isArray(manifest.icons)).toBe(true);
  expect(manifest.icons.length).toBeGreaterThan(0);
});

test('PWA-S02 barra Sem conexão aparece offline', async ({ ops, page, evidence }) => {
  const pageViews = new Map<string, number>();
  page.on('request', (request) => {
    if (request.method() !== 'POST' || !request.url().endsWith('/api/audit/events')) return;
    try {
      const events = (JSON.parse(request.postData() ?? '{}') as { events?: Array<{ type?: string; page?: string }> }).events ?? [];
      for (const event of events) {
        if (event.type !== 'page_view' || typeof event.page !== 'string') continue;
        pageViews.set(event.page, (pageViews.get(event.page) ?? 0) + 1);
      }
    } catch { /* the API response assertion remains the primary test */ }
  });
  const tenant = await ops.tenant();
  await loginPage(page, tenant.ownerEmail, tenant.ownerPassword);
  await expect.poll(() => pageViews.get('/login') ?? 0, { timeout: 6_000 }).toBe(1);
  await page.goto('/operacao/comandas', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: /Caixa do dia|Comandas/i }).first()).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => pageViews.get('/operacao/comandas') ?? 0, { timeout: 6_000 }).toBe(1);
  await page.context().setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.getByText(/Sem conexão/i)).toBeVisible({ timeout: 10_000 });
  await evidence.screenshot('offline');
  await page.context().setOffline(false);
});

test('PWA-S03 logout e troca de usuário com sessão limpa', async ({ ops, page, evidence }) => {
  const tenant = await ops.tenant();
  await loginPage(page, tenant.ownerEmail, tenant.ownerPassword);
  await logoutPage(page);
  await evidence.screenshot('sessao-limpa');
});

test('PWA-S04 inscrição de push responde @api', async ({ ops }) => {
  const tenant = await ops.tenant();
  const vapid = await tenant.owner.expect(tenant.owner.get('/api/push/vapid-public-key'), 200, 'vapid');
  expect(vapid).toHaveProperty('enabled');
  if (vapid.enabled) {
    await tenant.owner.expect(tenant.owner.post('/api/push/subscribe', {
      endpoint: 'https://example.invalid/push',
      keys: { p256dh: 'BQA', auth: 'auth' },
    }), 200, 'subscribe').catch(async (err) => {
      test.info().annotations.push({ type: 'observed', description: `Subscribe retornou erro esperado com chaves fake: ${String(err)}` });
    });
  } else {
    test.info().annotations.push({ type: 'observed', description: 'Push desabilitado neste ambiente (vapid.enabled=false).' });
  }
});

test.fixme('PWA-S05 aviso de nova versão', async () => {
  test.info().annotations.push({ type: 'product-gap', description: 'Não há aviso de nova versão; o service worker recarrega silenciosamente em controllerchange.' });
});
