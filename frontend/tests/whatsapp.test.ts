import assert from 'node:assert/strict';
import test from 'node:test';
import { linkWhatsAppPedidoPronto } from '../src/lib/whatsapp';

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
