import { test, expect, type Page, type Locator } from '@playwright/test';
import { createRequire } from 'node:module';
import path from 'node:path';
const sharp = createRequire(path.resolve('frontend/package.json'))('sharp');

const shapes = [
  { name: 'horizontal', width: 3200, height: 1600 },
  { name: 'vertical', width: 1600, height: 3200 },
  { name: 'quadrada', width: 2800, height: 2800 },
];
const viewports = [
  { width: 390, height: 844 }, { width: 768, height: 1024 },
  { width: 844, height: 390 }, { width: 1024, height: 768 },
];
const colors = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]];
const products = Array.from({ length: 45 }, (_, index) => ({
  id: `synthetic-${index}`, nome: `Produto sintético ${index}`, tipo: 'COMIDA',
  categoria: 'Outros', precoEfetivo: 12, precos: [{ volumeMl: 1, preco: 12 }],
}));
const comanda = { id: 'synthetic-command', numero: 17, status: 'ABERTA',
  cliente: { nome: 'Cliente sintético', telefone: '11999999999' },
  subtotal: 0, total: 0, desconto: 0, valorEmAberto: 0, pedidos: [], itens: [] };

async function syntheticImage(shape: typeof shapes[number]) {
  const { width: w, height: h } = shape;
  // Different colors and labels identify all four corners. These files exist only in memory.
  const corner = Math.min(w, h) * 0.18;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="100%" height="100%" fill="#eeeeee"/>
    ${colors.map((color, i) => {
      const x = i % 2 ? w - corner : 0, y = i > 1 ? h - corner : 0;
      return `<rect x="${x}" y="${y}" width="${corner}" height="${corner}" fill="rgb(${color})"/>
        <text x="${x + corner / 2}" y="${y + corner / 2}" font-size="64" text-anchor="middle" fill="white">${['TL', 'TR', 'BL', 'BR'][i]}</text>`;
    }).join('')}
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function mock(page: Page, image: Buffer, initialBackground: string | null = '/uploads/portal-backgrounds/synthetic.webp') {
  let background = initialBackground;
  let available = true;
  let pdvSession = false;
  let known = false;
  let version = 1;
  const writes: { method: string; body: Buffer | null }[] = [];
  const unexpected: string[] = [];
  const errors: string[] = [];
  const company = () => ({ id: 'synthetic-company', nome: 'Cervejaria sintética', slug: 'synthetic',
    portalBackgroundUrl: background, portalBackgroundVersion: String(version) });
  await page.route('**/uploads/**', route => new URL(route.request().url()).pathname.includes('missing')
    ? route.fulfill({ status: 404, body: '' })
    : route.fulfill({ contentType: 'image/png', body: image }));
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), p = url.pathname, method = request.method();
    if (p === '/api/auth/me') return route.fulfill({ json: {
      usuario: { id: 'synthetic-owner', nome: 'Owner', papel: 'DONO', email: 'owner@example.invalid' }, cervejaria: company(),
    } });
    if (p.endsWith('/info')) return route.fulfill({ json: {
      cervejaria: company(), trailer: { id: 'synthetic', nome: 'Trailer sintético' },
      pontoVenda: { nome: 'Caixa sintético' }, evento: available ? { id: 'synthetic-event', nome: 'Evento sintético', local: 'QA', data: null } : null,
      disponivel: available,
    } });
    if (p.endsWith('/cliente-por-telefone')) return route.fulfill({ json: { encontrado: known, nome: known ? 'Cliente sintético' : undefined } });
    if (p.endsWith('/sessao')) return route.fulfill({ json: { cliente: { id: 'synthetic-client', nome: 'Cliente sintético' }, comanda } });
    if (p.endsWith('/comanda')) return p.includes('/pontos-venda/') && !pdvSession
      ? route.fulfill({ status: 401, json: { error: 'Sem sessão sintética' } })
      : route.fulfill({ json: comanda });
    if (p.endsWith('/cardapio/categorias')) return route.fulfill({ json: { ordemCategorias: ['Outros'] } });
    if (p.endsWith('/cardapio')) return route.fulfill({ json: p.includes('/pontos-venda/')
      ? { produtos: products, ordemCategorias: ['Outros'] }
      : { chopes: [], bebidas: [], comidas: products } });
    if (p === '/api/cervejaria/branding/portal-background') {
      writes.push({ method, body: request.postDataBuffer() });
      background = method === 'DELETE' ? null : '/uploads/portal-backgrounds/synthetic-saved.webp';
      version++;
      return route.fulfill({ json: company() });
    }
    if (p === '/api/operacao/contexto') return route.fulfill({ json: {
      ativo: false, operationalSettingsSource: 'LEGACY', operationMode: 'LEGACY', pontosVenda: [], temCozinha: false, controlaEstoque: false,
    } });
    if (p === '/api/onboarding/readiness') return route.fulfill({ json: {
      mode: 'CAIXA', capacities: { controlaEstoque: false, temCozinha: false }, hasHistoricalSale: true,
      firstSaleCompleted: true, operationReady: true, canConfigure: false,
      modules: { operacao: { enabled: false, ready: true, missingSteps: [] }, cervejaria: { enabled: false, ready: true, missingSteps: [] } },
    } });
    if (p === '/api/cervejaria/configuracao-operacional') return route.fulfill({ json: { configuration: { setupCompletedAt: '2026-10-09' } } });
    if (['/api/trailers', '/api/eventos/ativos'].includes(p)) return route.fulfill({ json: [] });
    if (p === '/api/audit/events' || p.endsWith('/logout')) return route.fulfill({ status: 204, body: '' });
    unexpected.push(`${method} ${p}`);
    return route.abort();
  });
  await page.routeWebSocket('**/socket.io/**', socket => socket.close());
  page.on('pageerror', error => errors.push(error.message));
  return { writes, unexpected, errors, setAvailable: (value: boolean) => { available = value; },
    setPdvSession: (value: boolean) => { pdvSession = value; }, setKnown: (value: boolean) => { known = value; },
    setBackground: (value: string | null) => { background = value; } };
}

async function checkFraming(page: Page, shape: typeof shapes[number], host?: Locator) {
  if (host) await host.scrollIntoViewIfNeeded();
  const layer = host ? host.locator('.portal-background') : page.locator('.portal-background');
  const img = layer.locator('img');
  await expect(img).toBeVisible();
  const frame = (await layer.boundingBox())!, box = (await img.boundingBox())!;
  const scale = Math.min(frame.width / shape.width, frame.height / shape.height);
  expect(box.width).toBeCloseTo(shape.width * scale, 0);
  expect(box.height).toBeCloseTo(shape.height * scale, 0);
  expect(box.x - frame.x).toBeCloseTo((frame.width - box.width) / 2, 0);
  expect(box.y - frame.y).toBeCloseTo((frame.height - box.height) / 2, 0);
  expect(await img.evaluate(el => getComputedStyle(el).objectFit)).toBe('contain');
  expect(await layer.evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (!host) {
    expect(frame.x).toBe(0); expect(frame.y).toBe(0);
    expect(frame.height).toBe(page.viewportSize()!.height);
    expect(await layer.evaluate(el => getComputedStyle(el).position)).toBe('fixed');
  }
  // Inspect actual rendered pixels, temporarily hiding foreground only in this mock browser.
  const style = await page.addStyleTag({ content: '.portal-background-host > :not(.portal-background), .app-bottom-nav { visibility: hidden !important; }' });
  const png = host ? await host.screenshot({ path: test.info().outputPath('preview.png') }) : await page.screenshot();
  if (host) {
    await test.info().attach('previa', { body: png, contentType: 'image/png' });
  }
  await style.evaluate(el => el.remove());
  const pixels = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const origin = host ? (await host.boundingBox())! : { x: 0, y: 0 };
  const offset = Math.min(box.width, box.height) * 0.04;
  const points = [[box.x + offset, box.y + offset], [box.x + box.width - offset, box.y + offset],
    [box.x + offset, box.y + box.height - offset], [box.x + box.width - offset, box.y + box.height - offset]];
  for (let i = 0; i < 4; i++) {
    const [x, y] = points[i].map((value, axis) => Math.round(value - (axis ? origin.y : origin.x)));
    const pixel = (y * pixels.info.width + x) * 3;
    const alpha = 0.76 + 0.12 * ((points[i][1] - box.y) / box.height);
    const expected = colors[i].map((value, channel) => value * (1 - alpha) + [6, 20, 38][channel] * alpha);
    for (let channel = 0; channel < 3; channel++) expect(Math.abs(pixels.data[pixel + channel] - expected[channel])).toBeLessThan(5);
  }
  // Letterbox space must retain the current portal canvas color, without the scrim.
  const gap = box.x - frame.x > 4 ? [frame.x + 2, frame.y + frame.height / 2]
    : box.y - frame.y > 4 ? [frame.x + frame.width / 2, frame.y + 2] : null;
  if (gap) {
    const canvas = await layer.evaluate(el => getComputedStyle(el).backgroundColor);
    const expected = canvas.match(/\d+/g)!.slice(0, 3).map(Number);
    const x = Math.round(gap[0] - origin.x), y = Math.round(gap[1] - origin.y);
    const pixel = (y * pixels.info.width + x) * 3;
    for (let c = 0; c < 3; c++) expect(Math.abs(pixels.data[pixel + c] - expected[c])).toBeLessThan(3);
  }
  return { box, frame, png };
}

for (const shape of shapes) for (const viewport of viewports) {
  test(`${shape.name} ${viewport.width}x${viewport.height}: portal, layouts, rolagem e rotação`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const state = await mock(page, await syntheticImage(shape));
    state.setAvailable(false);
    await page.goto('/c/synthetic/t/synthetic');
    await expect(page.getByText('Evento indisponível', { exact: true })).toBeVisible();
    await checkFraming(page, shape);
    state.setAvailable(true);
    await page.reload();
    await page.locator('#portal-telefone').fill('11999999999');
    await page.locator('#portal-nome').fill('Cliente sintético');
    await checkFraming(page, shape);
    state.setKnown(true);
    await page.getByRole('button', { name: /Abrir comanda/ }).click();
    await expect(page.getByText('Confirmar identidade', { exact: true })).toBeVisible();
    await checkFraming(page, shape);
    await page.getByRole('button', { name: 'Não sou eu', exact: true }).click();
    await expect(page.getByText('Cadastro não confere', { exact: true })).toBeVisible();
    await checkFraming(page, shape);
    await page.getByRole('button', { name: 'Usar outro telefone', exact: true }).click();
    state.setKnown(false);
    await page.locator('#portal-telefone').fill('11999999999');
    await page.locator('#portal-nome').fill('Cliente sintético');
    await page.getByRole('button', { name: /Abrir comanda/ }).click();
    await page.getByPlaceholder('Seu nome').fill('Cliente sintético');
    await checkFraming(page, shape);
    await page.getByRole('button', { name: 'Abrir comanda', exact: true }).click();
    await expect(page.getByRole('button', { name: /^(Pedir|Resumo)$/ })).toBeVisible();
    if (await page.getByRole('button', { name: /^Pedir$/ }).count()) {
      await page.getByRole('button', { name: /^Pedir$/ }).click();
    }
    await expect(page.getByText('Produto sintético 44', { exact: true })).toBeVisible();
    const before = await checkFraming(page, shape);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(viewport.height);
    const after = await checkFraming(page, shape);
    expect(after.box).toEqual(before.box);
    await page.getByRole('button', { name: /^(Resumo|Comanda)$/ }).tap();
    await checkFraming(page, shape);
    state.setAvailable(false);
    await page.goto('/c/synthetic/p/synthetic');
    await expect(page.getByText('Caixa indisponível', { exact: true })).toBeVisible();
    await checkFraming(page, shape);
    state.setAvailable(true);
    await page.reload();
    await expect(page.locator('#portal-pdv-telefone')).toBeVisible();
    await checkFraming(page, shape);
    state.setPdvSession(true);
    await page.reload();
    await expect(page.getByText('Produto sintético 44', { exact: true })).toBeVisible();
    await checkFraming(page, shape);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await checkFraming(page, shape);
    await page.getByRole('button', { name: /^(Voltar|Resumo da conta)$/ }).click();
    await checkFraming(page, shape);
    await page.setViewportSize({ width: viewport.height, height: viewport.width });
    const rotated = await checkFraming(page, shape);
    await testInfo.attach('fundo-rotacionado', { body: rotated.png, contentType: 'image/png' });
    expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
  });
}

for (const shape of shapes) test(`${shape.name}: prévia celular/tablet, upload, salvamento e remoção`, async ({ page }) => {
  const png = await syntheticImage(shape);
  const state = await mock(page, png, null);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/configuracoes/aparencia');
  await expect(page.getByText('Fundo padrão do portal', { exact: true })).toBeVisible();
  await expect(page.getByText('A imagem será exibida inteira. Espaços restantes usarão a cor de fundo do portal.', { exact: true })).toBeVisible();
  const input = page.locator('input[type=file][accept="image/png,image/jpeg,image/webp"]');
  await input.setInputFiles({ name: `${shape.name}.png`, mimeType: 'image/png', buffer: png });
  await expect(page.getByText('Fundo do portal atualizado com sucesso.', { exact: true })).toBeVisible();
  expect(state.writes[0].body!.includes(png)).toBe(true);
  for (const device of ['Celular', 'Tablet']) {
    await page.getByRole('button', { name: device, exact: true }).click();
    const host = page.getByLabel(`Prévia do portal em ${device.toLowerCase()}`, { exact: true });
    await host.scrollIntoViewIfNeeded();
    await checkFraming(page, shape, host);
    await page.getByRole('button', { name: 'Orientação vertical', exact: true }).click();
    await checkFraming(page, shape, host);
    await page.getByRole('button', { name: 'Orientação horizontal', exact: true }).click();
  }
  await page.reload();
  await checkFraming(page, shape, page.getByLabel('Prévia do portal em celular', { exact: true }));
  await page.getByRole('button', { name: 'Remover fundo', exact: true }).click();
  await expect(page.getByText('Fundo padrão do portal', { exact: true })).toBeVisible();
  expect(state.writes.map(write => write.method)).toEqual(['POST', 'DELETE']);
  expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});

test('fundo padrão, arquivo indisponível e troca de empresa não reutilizam imagem', async ({ page }) => {
  const state = await mock(page, await syntheticImage(shapes[0]), null);
  for (const src of [null, '/uploads/missing.webp']) {
    state.setBackground(src);
    for (const path of ['/c/synthetic/t/synthetic', '/c/synthetic/p/synthetic', '/configuracoes/aparencia']) {
      await page.goto(path);
      await expect(page.getByText('Abrir comanda', { exact: true }).first()).toBeVisible();
      await expect(page.locator('.portal-background')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
  state.setBackground('/uploads/company-a.webp');
  await page.goto('/c/synthetic/t/synthetic');
  await expect(page.locator('.portal-background img')).toBeVisible();
  state.setBackground(null);
  await page.goto('/c/other-company/t/synthetic');
  await expect(page.locator('.portal-login-card')).toBeVisible();
  await expect(page.locator('.portal-background')).toHaveCount(0);
  expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});
