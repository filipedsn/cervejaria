import { test, expect, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const sharp = createRequire(path.resolve('frontend/package.json'))('sharp');
const phase = process.env.PORTAL_PREVIEW_PHASE ?? 'after';
const evidenceDir = path.resolve('docs/testing/portal-preview-controls', phase);

async function setup(page: Page, withImage: boolean) {
  const image = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="800">
    <rect width="1600" height="800" fill="#ddd"/>
    <rect width="200" height="200" fill="red"/><rect x="1400" width="200" height="200" fill="lime"/>
    <rect y="600" width="200" height="200" fill="blue"/><rect x="1400" y="600" width="200" height="200" fill="yellow"/>
    <g fill="white" font-size="64"><text x="40" y="120">TL</text><text x="1440" y="120">TR</text>
    <text x="40" y="720">BL</text><text x="1440" y="720">BR</text></g></svg>`)).png().toBuffer();
  const requests: string[] = [], unexpected: string[] = [], errors: string[] = [];
  await page.route('**/uploads/**', route => route.fulfill({ contentType: 'image/png', body: image }));
  await page.route('**/api/**', route => {
    const p = new URL(route.request().url()).pathname;
    if (p === '/api/auth/me') return route.fulfill({ json: {
      usuario: { id: 'preview-owner', nome: 'Owner', papel: 'DONO', email: 'owner@example.invalid' },
      cervejaria: { id: 'preview-company', nome: 'Cervejaria sintética', slug: 'preview',
        portalBackgroundUrl: withImage ? '/uploads/portal-backgrounds/preview.webp' : null, portalBackgroundVersion: '1' },
    } });
    if (p === '/api/operacao/contexto') return route.fulfill({ json: { ativo: false, operationalSettingsSource: 'LEGACY', operationMode: 'LEGACY', pontosVenda: [], temCozinha: false, controlaEstoque: false } });
    if (p === '/api/onboarding/readiness') return route.fulfill({ json: {
      mode: 'CAIXA', capacities: { controlaEstoque: false, temCozinha: false }, hasHistoricalSale: true,
      firstSaleCompleted: true, operationReady: true, canConfigure: false,
      modules: { operacao: { enabled: false, ready: true, missingSteps: [] }, cervejaria: { enabled: false, ready: true, missingSteps: [] } },
    } });
    if (p === '/api/cervejaria/configuracao-operacional') return route.fulfill({ json: { configuration: { setupCompletedAt: '2026-10-09' } } });
    if (['/api/trailers', '/api/eventos/ativos'].includes(p)) return route.fulfill({ json: [] });
    if (p === '/api/audit/events') return route.fulfill({ status: 204, body: '' });
    unexpected.push(`${route.request().method()} ${p}`);
    return route.abort();
  });
  await page.routeWebSocket('**/socket.io/**', socket => socket.close());
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(`${request.method()} ${new URL(request.url()).pathname}`));
  await page.goto('/configuracoes/aparencia');
  await expect(page.getByLabel('Dispositivo da prévia', { exact: true })).toBeVisible();
  if (withImage) await expect(page.locator('.portal-background img')).toBeVisible();
  // Let initial auth/audit effects settle before measuring requests produced by controls.
  await page.waitForTimeout(300);
  requests.length = 0;
  return { requests, unexpected, errors };
}

for (const width of [390, 768]) for (const withImage of [true, false]) {
  test(`${width}px ${withImage ? 'imagem' : 'padrão'}: quatro combinações e controles`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1024 });
    const state = await setup(page, withImage);
    const group = page.getByLabel('Dispositivo da prévia', { exact: true });
    const measurements: unknown[] = [];
    mkdirSync(evidenceDir, { recursive: true });
    // Includes switching devices while horizontal, then returning to vertical.
    const combinations = [
      { device: 'Celular', landscape: false, ratio: 390 / 844 },
      { device: 'Celular', landscape: true, ratio: 844 / 390 },
      { device: 'Tablet', landscape: true, ratio: 1024 / 768 },
      { device: 'Tablet', landscape: false, ratio: 768 / 1024 },
    ];
    let previous: typeof combinations[number] | undefined;
    for (const combo of combinations) {
      await group.getByRole('button', { name: combo.device, exact: true }).tap();
      const orientation = group.getByRole('button', { name: /Orientação/ });
      if (previous && combo.device !== previous.device) {
        await expect(orientation).toHaveAttribute('aria-pressed', String(previous.landscape));
      }
      if ((await orientation.getAttribute('aria-pressed') === 'true') !== combo.landscape) await orientation.tap();
      await expect(orientation).toHaveText(combo.landscape ? 'Orientação horizontal' : 'Orientação vertical');
      await expect(group.getByRole('button', { name: combo.device, exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(group.getByRole('button', { name: combo.device === 'Celular' ? 'Tablet' : 'Celular', exact: true })).toHaveAttribute('aria-pressed', 'false');
      const host = page.getByLabel(`Prévia do portal em ${combo.device.toLowerCase()}`, { exact: true });
      // Remove incidental hover: selection must stay visible after the pointer leaves.
      await page.mouse.move(0, 0);
      await page.waitForTimeout(200); // Existing button color transition lasts 150ms.
      const data = await host.evaluate(el => {
        const rect = el.getBoundingClientRect(), css = getComputedStyle(el), parent = el.parentElement!.getBoundingClientRect();
        return { width: rect.width, height: rect.height, ratio: rect.width / rect.height,
          cssAspectRatio: css.aspectRatio, minHeight: css.minHeight, maxHeight: css.maxHeight, flexShrink: css.flexShrink,
          parentWidth: parent.width, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth,
          scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
      });
      const styles = await group.locator('button').evaluateAll(buttons => buttons.map(el => {
        const css = getComputedStyle(el);
        return { text: el.textContent, pressed: el.getAttribute('aria-pressed'), type: el.getAttribute('type'),
          background: css.backgroundColor, border: css.borderColor, color: css.color };
      }));
      measurements.push({ ...combo, expectedRatio: combo.ratio, ...data, styles });
      if (phase !== 'before') {
        expect(data.ratio).toBeCloseTo(combo.ratio, 2);
        expect(data.width).toBeLessThanOrEqual(data.parentWidth);
        expect(data.height).toBeLessThanOrEqual(Math.min(page.viewportSize()!.height * 0.5, 512) + 1);
        expect(data.scrollWidth).toBeLessThanOrEqual(data.clientWidth);
        expect(data.scrollHeight).toBeLessThanOrEqual(data.clientHeight);
        const active = styles.find(item => item.pressed === 'true' && item.text === combo.device)!;
        const inactive = styles.find(item => item.text === (combo.device === 'Celular' ? 'Tablet' : 'Celular'))!;
        expect(active.background).not.toBe(inactive.background);
        expect(active.border).not.toBe(inactive.border);
        if (combo.landscape) expect(styles[2].background).toBe(active.background);
        else expect(styles[2].background).toBe(inactive.background);
      }
      for (const style of styles) expect(style.type).toBe('button');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (withImage) {
        const frame = (await host.locator('.portal-background').boundingBox())!, img = (await host.locator('img').boundingBox())!;
        expect(img.width / img.height).toBeCloseTo(2, 2);
        expect(img.width).toBeLessThanOrEqual(frame.width + 1);
        expect(img.height).toBeLessThanOrEqual(frame.height + 1);
        expect(await host.locator('img').getAttribute('src')).toBe('/uploads/portal-backgrounds/preview.webp?v=1');
        expect(await host.locator('img').evaluate(el => getComputedStyle(el).objectFit)).toBe('contain');
      } else {
        await expect(host.getByText('Fundo padrão do portal', { exact: true })).toBeVisible();
        await expect(host.locator('.portal-background')).toHaveCount(0);
      }
      await host.scrollIntoViewIfNeeded();
      const screenshot = path.join(evidenceDir, `${width}-${withImage ? 'imagem' : 'padrao'}-${combo.device.toLowerCase()}-${combo.landscape ? 'horizontal' : 'vertical'}.png`);
      // Screenshot of the real preview card, including controls; no hidden preview content.
      await host.locator('..').screenshot({ path: screenshot, style: '.app-bottom-nav { visibility: hidden !important; }' });
      await page.waitForTimeout(100);
      expect(state.requests).toEqual([]);
      previous = combo;
    }
    writeFileSync(path.join(evidenceDir, `${width}-${withImage ? 'imagem' : 'padrao'}-dimensoes.json`), JSON.stringify(measurements, null, 2) + '\n');
    expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
  });
}
