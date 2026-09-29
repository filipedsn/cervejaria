import assert from 'node:assert/strict';
import test from 'node:test';
import { createWhatsAppIosAppLink, linkWhatsAppPedidoPronto, navegarParaWhatsApp } from '../src/lib/whatsapp';

test('creates a prepared WhatsApp message using Brazilian national phone format', () => {
  const link = linkWhatsAppPedidoPronto({
    telefone: '(27) 9 8123-4567',
    clienteNome: 'Poliana',
    numeroPedido: 4,
    nomeEmpresa: 'Churrasquinho do Thiago',
  });
  assert.equal(
    link,
    'https://wa.me/5527981234567?text=' + encodeURIComponent('Olá, Poliana! Seu pedido (senha 4) está pronto para retirada no Churrasquinho do Thiago.'),
  );
});

test('does not create a WhatsApp link without a valid phone number', () => {
  assert.equal(linkWhatsAppPedidoPronto({ telefone: '123', clienteNome: 'Poliana', numeroPedido: 4, nomeEmpresa: 'Bar' }), null);
});

test('creates the native iOS WhatsApp app link from a wa.me link', () => {
  const link = createWhatsAppIosAppLink('https://wa.me/5527981234567?text=Oi%20Poliana');
  assert.ok(link);
  const appLink = new URL(link);
  assert.equal(appLink.protocol, 'whatsapp:');
  assert.equal(appLink.hostname, 'send');
  assert.equal(appLink.searchParams.get('phone'), '5527981234567');
  assert.equal(appLink.searchParams.get('text'), 'Oi Poliana');
});

test('does not convert non-WhatsApp URLs to an iOS app link', () => {
  assert.equal(createWhatsAppIosAppLink('https://example.com/'), null);
});

test('uses the WhatsApp app scheme on iPhone and keeps the Quiver Tap page URL', () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const assigned: string[] = [];
  const opened: unknown[][] = [];
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', platform: 'iPhone', maxTouchPoints: 5 },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { assign: (url: string) => assigned.push(url) },
      open: (...args: unknown[]) => { opened.push(args); return null; },
    },
  });

  try {
    navegarParaWhatsApp('https://wa.me/5527999999999?text=Oi');
    assert.deepEqual(assigned, ['whatsapp://send?phone=5527999999999&text=Oi']);
    assert.deepEqual(opened, []);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete (globalThis as typeof globalThis & { window?: unknown }).window;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete (globalThis as typeof globalThis & { navigator?: unknown }).navigator;
  }
});
