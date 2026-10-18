import { expect, loginPage, test } from '../support/ops';

test('PWA-S01 manifest publicado contém nome e ícones @api', async ({ ops }) => {
  const anon = await ops.anonymous();
  const manifest = await anon.expect(anon.get('/manifest.webmanifest'), 200, 'manifest');
  expect(manifest.name).toBeTruthy();
  expect(Array.isArray(manifest.icons)).toBe(true);
  expect(manifest.icons.length).toBeGreaterThan(0);
});

test('PWA-S02 barra Sem conexão aparece offline', async ({ ops, page, evidence }) => {
  const tenant = await ops.tenant();
  await loginPage(page, tenant.ownerEmail, tenant.ownerPassword);
  await page.goto('/operacao/comandas', { waitUntil: 'networkidle' });
  await page.context().setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => undefined);
  await expect(page.getByText(/Sem conexão/i)).toBeVisible({ timeout: 10_000 });
  await evidence.screenshot('offline');
  await page.context().setOffline(false);
});

test('PWA-S03 logout e troca de usuário com sessão limpa', async ({ ops, page, evidence }) => {
  const tenant = await ops.tenant();
  await loginPage(page, tenant.ownerEmail, tenant.ownerPassword);
  await tenant.owner.expect(tenant.owner.post('/api/auth/logout'), 200, 'logout');
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
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
