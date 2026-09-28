import { expect, test } from '@playwright/test';
import { linkWhatsAppPedidoPronto } from '../frontend/src/lib/whatsapp';

test('intercepta o link de pedido pronto sem acessar o WhatsApp', async ({ page }) => {
  let destinoInterceptado = '';
  await page.route('https://wa.me/**', async (route) => {
    destinoInterceptado = route.request().url();
    await route.fulfill({ status: 200, contentType: 'text/plain', body: 'Interceptado pelo E2E; nenhuma mensagem enviada.' });
  });

  const url = linkWhatsAppPedidoPronto({
    telefone: '11987654321',
    clienteNome: 'Filipe',
    numeroPedido: 4,
    nomeEmpresa: 'Churrasquinho do Thiago',
  });
  expect(url).toBeTruthy();

  await page.goto('about:blank');
  await page.evaluate((destino) => window.location.assign(destino), url!);
  await expect.poll(() => destinoInterceptado).not.toBe('');

  const destino = new URL(destinoInterceptado);
  expect(destino.hostname).toBe('wa.me');
  expect(destino.pathname).toBe('/5511987654321');
  expect(destino.searchParams.get('text')).toContain('Filipe');
  expect(destino.searchParams.get('text')).toContain('senha 4');
  expect(await page.locator('body').innerText()).toContain('nenhuma mensagem enviada');
});
