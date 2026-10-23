import { expect, test } from '@playwright/test';

const pontoVendaId = 'pdv-tap121-synthetic';
const sessaoCaixaId = 'shift-tap121-synthetic';
const tapNames = ['Vinho', 'IPA', 'Pilsen', 'Stout', 'Blend'];
const produtoIds = ['beer-vinho', 'beer-ipa', 'beer-pilsen', 'beer-stout', 'beer-blend'];

function fixtureData() {
  const products = tapNames.map((nome, index) => ({
    id: produtoIds[index], nome: `Chope ${nome}`, categoria: 'Chope', tipo: 'BEBIDA', formato: 'CHOPE',
    precos: [{ volumeMl: 300, preco: 15 + index }, { volumeMl: 473, preco: 22 + index }],
    volumeMl: 0, precoUnit: '0', precoEfetivo: 0, exigePreparo: false,
    controlaEstoque: false, ativo: true, ordem: index,
  }));
  const taps = tapNames.map((nome, index) => ({
    id: `tap-${index + 1}`, numero: index + 1, nome: `Tap ${nome}`, ativo: true,
    chopeAtual: { id: produtoIds[index], nome: `Chope ${nome}`, tipo: 'BEBIDA', formato: 'CHOPE', precos: products[index]!.precos },
    chopeCadastro: null, temMontagemAtiva: true,
  }));
  return { products, taps };
}

async function routeSyntheticApi(page: import('@playwright/test').Page, options: {
  products: ReturnType<typeof fixtureData>['products'];
  taps: ReturnType<typeof fixtureData>['taps'];
  papel?: string;
  permissoesOperacao?: string[];
  tapsHandler?: (route: import('@playwright/test').Route, url: URL) => Promise<void>;
}) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/api/auth/me')) {
      await route.fulfill({ json: { usuario: { id: 'user-tap121-fixture', nome: 'QA', email: 'qa@tap121.test', papel: options.papel ?? 'DONO', permissoesOperacao: options.permissoesOperacao ?? [] }, cervejaria: { id: 'tenant-tap121-synthetic', nome: 'TAP-121 sintético' } } });
    } else if (url.pathname.endsWith('/api/operacao/caixa/taps')) {
      if (options.tapsHandler) return options.tapsHandler(route, url);
      await route.fulfill({ json: { pontoVendaId, sessaoCaixaId, taps: options.taps } });
    } else if (url.pathname.endsWith('/api/produtos/categorias-comanda/ordem')) {
      await route.fulfill({ json: { ordem: ['chope', 'comidas', 'bebidas', 'outros'], catalogoCanonico: true } });
    } else if (url.pathname.endsWith('/api/audit/events')) {
      await route.fulfill({ status: 204, body: '' });
    } else {
      await route.fulfill({ json: [] });
    }
  });
}

async function openModal(page: import('@playwright/test').Page) {
  await page.goto('http://127.0.0.1:5219/tests/tap-modal-fixture.html');
  await expect(page.getByRole('dialog', { name: 'Adicionar item' })).toBeVisible();
  await page.getByRole('button', { name: 'Chopes (Tap)' }).click();
}

test('mostra taps canônicas sem trailer e mantém produto, volume, preço e quantidade vinculados à seleção', async ({ page }) => {
  const { products, taps } = fixtureData();
  const requestedTapUrls: string[] = [];
  await routeSyntheticApi(page, { products, taps, tapsHandler: async (route, url) => {
    requestedTapUrls.push(url.toString());
    await route.fulfill({ json: { pontoVendaId, sessaoCaixaId, taps } });
  } });

  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await openModal(page);
    await expect(page.getByText('Este turno está sem trailer vinculado.')).toHaveCount(0);
    await expect(page.getByText('300 ml', { exact: true })).toHaveCount(0);

    for (let index = 0; index < tapNames.length; index += 1) {
      const tapButton = page.getByRole('button', { name: new RegExp(`Selecionar Tap ${index + 1}, Tap ${tapNames[index]}`) });
      if (index === 0) {
        await tapButton.focus();
        await tapButton.press('Enter');
      } else {
        await tapButton.click();
      }
      await expect(tapButton).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('button', { name: /473 ml/ })).toBeVisible();
      await page.getByRole('button', { name: /473 ml/ }).click();
      await page.getByRole('button', { name: 'Aumentar quantidade' }).click();
      await expect(page.getByText(`Chope ${tapNames[index]} (473 ml)`)).toBeVisible();
      await page.getByRole('button', { name: 'Adicionar chope à lista' }).click();
      await expect(page.locator('#selection-result')).toHaveText(JSON.stringify({
        productId: produtoIds[index], quantidade: 2, tapId: `tap-${index + 1}`, volumeMl: 473, precoUnit: 22 + index,
      }));
      await expect(page.getByRole('button', { name: /473 ml/ })).toHaveAttribute('aria-pressed', 'false');
    }

    expect(requestedTapUrls.some((value) => new URL(value).searchParams.get('sessaoCaixaId') === sessaoCaixaId)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('distingue ausência de taps e montagens e oculta acesso de configuração sem permissão', async ({ page }) => {
  const { products, taps } = fixtureData();
  const responseTaps: typeof taps = [];
  await routeSyntheticApi(page, { products, taps: responseTaps, papel: 'ATENDENTE', permissoesOperacao: [] });
  await openModal(page);
  await expect(page.getByText('Nenhuma tap ativa está configurada neste ponto de venda.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Abrir montagem de taps' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /300 ml/ })).toHaveCount(0);

  responseTaps.push(...taps.map((tap) => ({ ...tap, chopeAtual: null, temMontagemAtiva: false })));
  await page.reload();
  await page.getByRole('button', { name: 'Chopes (Tap)' }).click();
  await expect(page.getByText(/5 taps configuradas, mas nenhuma tem chope montado/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Abrir montagem de taps' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /473 ml/ })).toHaveCount(0);
});

test('erro de API oferece nova tentativa e não mostra dados antigos', async ({ page }) => {
  const { products, taps } = fixtureData();
  let attempts = 0;
  await routeSyntheticApi(page, { products, taps, tapsHandler: async (route) => {
    attempts += 1;
    if (attempts === 1) await route.fulfill({ status: 503, json: { error: 'Fixture indisponível' } });
    else await route.fulfill({ json: { pontoVendaId, sessaoCaixaId, taps } });
  } });
  await openModal(page);
  await expect(page.getByRole('alert')).toContainText('Fixture indisponível');
  await expect(page.getByRole('button', { name: 'Tentar novamente' })).toBeVisible();
  await expect(page.getByRole('button', { name: /300 ml/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(page.getByRole('button', { name: /Selecionar Tap 1, Tap Vinho/ })).toBeVisible();
  expect(attempts).toBe(2);
});

test('produto inativo e chope sem preço elegível não oferecem volumes para lançamento', async ({ page }) => {
  const { products, taps } = fixtureData();
  await routeSyntheticApi(page, { products, taps });
  await openModal(page);
  await page.evaluate(() => (window as Window & { setTapFixtureProducts?: (products: unknown[]) => void }).setTapFixtureProducts?.([
    { id: 'beer-vinho', nome: 'Chope Vinho', categoria: 'Chope', tipo: 'BEBIDA', formato: 'CHOPE', precos: [{ volumeMl: 300, preco: 15 }], volumeMl: 300, precoUnit: '15', precoEfetivo: 15, exigePreparo: false, controlaEstoque: false, ativo: false, ordem: 0 },
    ...['ipa', 'pilsen', 'stout', 'blend'].map((id, index) => ({ id: `beer-${id}`, nome: `Chope ${id}`, categoria: 'Chope', tipo: 'BEBIDA', formato: 'CHOPE', precos: [{ volumeMl: 300, preco: 16 + index }, { volumeMl: 473, preco: 23 + index }], volumeMl: 0, precoUnit: '0', precoEfetivo: 0, exigePreparo: false, controlaEstoque: false, ativo: true, ordem: index + 1 })),
  ]));
  await page.getByRole('button', { name: /Selecionar Tap 1, Tap Vinho/ }).click();
  await expect(page.getByText('Chope Vinho está inativo ou não está disponível no cardápio efetivo deste turno.')).toBeVisible();
  await expect(page.getByRole('button', { name: /300 ml/ })).toHaveCount(0);

  await page.evaluate(() => (window as Window & { setTapFixtureProducts?: (products: unknown[]) => void }).setTapFixtureProducts?.([
    { id: 'beer-vinho', nome: 'Chope Vinho', categoria: 'Chope', tipo: 'BEBIDA', formato: 'CHOPE', precos: [], volumeMl: 0, precoUnit: '0', precoEfetivo: 0, exigePreparo: false, controlaEstoque: false, ativo: true, ordem: 0 },
  ]));
  await page.getByRole('button', { name: /Selecionar Tap 1, Tap Vinho/ }).click();
  await expect(page.getByText('Este chope não tem volume com preço elegível no cardápio deste turno.')).toBeVisible();
  await expect(page.getByRole('button', { name: /300 ml/ })).toHaveCount(0);
});

test('mesmo chope em taps distintas preserva a tap escolhida e limpa volume ao trocar de tap', async ({ page }) => {
  const { products, taps } = fixtureData();
  taps[4]!.chopeAtual = { ...taps[0]!.chopeAtual! };
  await routeSyntheticApi(page, { products, taps });
  await openModal(page);

  await page.getByRole('button', { name: /Selecionar Tap 1, Tap Vinho/ }).click();
  await page.getByRole('button', { name: /300 ml/ }).click();
  await expect(page.getByRole('button', { name: /300 ml/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /Selecionar Tap 5, Tap Blend/ }).click();
  await expect(page.getByRole('button', { name: /300 ml/ })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: /Selecionar Tap 5, Tap Blend/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /473 ml/ }).click();
  await page.getByRole('button', { name: 'Adicionar chope à lista' }).click();
  await expect(page.locator('#selection-result')).toHaveText(JSON.stringify({
    productId: produtoIds[0], quantidade: 1, tapId: 'tap-5', volumeMl: 473, precoUnit: 22,
  }));
});

test('mudança de montagem durante o modal invalida seleção e preço anteriores', async ({ page }) => {
  const { products, taps } = fixtureData();
  await routeSyntheticApi(page, { products, taps });
  await openModal(page);
  await page.getByRole('button', { name: /Selecionar Tap 2, Tap IPA/ }).click();
  await page.getByRole('button', { name: /473 ml/ }).click();
  expect(await page.getByRole('button', { name: /473 ml/ }).getAttribute('aria-pressed')).toBe('true');

  taps[1]!.chopeAtual = { ...taps[3]!.chopeAtual! };
  await expect(page.getByRole('alert')).toContainText('A montagem ou os preços desta Tap mudaram', { timeout: 20_000 });
  await expect(page.getByRole('button', { name: /473 ml/ })).toHaveCount(0);
  await expect(page.getByText('Chope IPA (473 ml)')).toHaveCount(0);
  await expect(page.locator('#selection-result')).toHaveText('');
  await page.getByRole('button', { name: /Selecionar Tap 2, Tap IPA/ }).click();
  await expect(page.getByRole('button', { name: /Selecionar Tap 2, Tap IPA, chope Chope Stout/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /473 ml/ })).toBeVisible();
});
