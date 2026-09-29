import assert from 'node:assert/strict';
import test from 'node:test';
import { createWhatsAppIosAppLink, linkWhatsAppPedidoPronto, linkWhatsAppResumoConta, navegarParaWhatsApp } from '../src/lib/whatsapp';

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

test('sends only confirmed account items and identifies kitchen items excluded from the partial total', () => {
  const link = linkWhatsAppResumoConta({
    telefone: '(27) 9965-0060',
    clienteNome: 'Poliana',
    nomeEmpresa: 'Cervejaria',
    identificacaoComanda: 'Mesa 3',
    itens: [{ nome: 'Latão Amistel', quantidade: 1, total: 'R$ 10,00' }],
    subtotal: 'R$ 10,00',
    desconto: null,
    total: 'R$ 10,00',
    valorEmPreparo: 'R$ 14,00',
  });

  assert.ok(link);
  const mensagem = new URL(link).searchParams.get('text') ?? '';
  assert.match(mensagem, /Latão Amistel/);
  assert.match(mensagem, /Itens em preparo \(R\$ 14,00\) ainda não estão incluídos/);
  assert.match(mensagem, /Total parcial: R\$ 10,00/);
  assert.doesNotMatch(mensagem, /Churrasquinho/);
});

test('does not create an account-summary link without a valid client phone', () => {
  assert.equal(linkWhatsAppResumoConta({
    telefone: null,
    clienteNome: 'Poliana',
    nomeEmpresa: 'Cervejaria',
    identificacaoComanda: 'Mesa 3',
    itens: [],
    subtotal: 'R$ 0,00',
    desconto: null,
    total: 'R$ 0,00',
    valorEmPreparo: null,
  }), null);
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
