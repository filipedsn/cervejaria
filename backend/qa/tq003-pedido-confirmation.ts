import { prisma } from '../src/lib/prisma.js';
import { api, login, portalPedidoBody, portalSessao, uniquePortalTestPhone } from './lib/http.js';
import { assertQaEnvironment } from './lib/guard.js';
import { CONTEXT_PATH, readJson } from './lib/store.js';
import type { QaContext } from './lib/types.js';

type PedidoCriado = { id: string; comandaId: string; clienteId: string };

const ctx = readJson<QaContext>(CONTEXT_PATH);
const arena = ctx.arena;
const comandaIds: string[] = [];
let donoToken: string;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function criarPedido(label: string): Promise<PedidoCriado> {
  const sessao = await portalSessao(arena.slug, arena.trailerId, {
    nome: `TQ003 ${label}`,
    telefone: uniquePortalTestPhone(73, comandaIds.length),
  });
  assert(sessao.status === 201 && sessao.cookie && sessao.comandaId && sessao.clienteId, `${label}: sessao portal falhou`);
  comandaIds.push(sessao.comandaId);

  const pedido = await api<PedidoCriado>('POST', '/api/public/cliente/pedidos', {
    cookie: sessao.cookie,
    body: portalPedidoBody(arena.produtoId, arena.tapId, arena.volumeMl, `TQ003-${label}`),
  });
  assert(pedido.status === 201 && pedido.data.id, `${label}: criacao do pedido falhou (${pedido.status})`);
  return pedido.data;
}

async function confirmar(pedidoId: string) {
  return api('POST', `/api/pedidos/${pedidoId}/confirmar`, {
    token: donoToken,
    body: {},
  });
}

async function main() {
  assertQaEnvironment();
  donoToken = await login(`${arena.slug}-dono@qa.test`, 'qa123456');

  try {
    const normal = await criarPedido('normal');
    const normalBefore = await prisma.itemComanda.count({ where: { comandaId: normal.comandaId } });
    const normalConfirm = await confirmar(normal.id);
    assert(normalConfirm.status === 200, `normal: confirmar retornou ${normalConfirm.status}`);
    const normalAfter = await prisma.itemComanda.count({ where: { comandaId: normal.comandaId } });
    const normalPedido = await prisma.pedidoCliente.findUniqueOrThrow({ where: { id: normal.id } });
    assert(normalAfter === normalBefore + 1 && normalPedido.status === 'CONFIRMADO', 'normal: confirmacao nao aplicou exatamente um item');

    const repeat = await confirmar(normal.id);
    const repeatAfter = await prisma.itemComanda.count({ where: { comandaId: normal.comandaId } });
    assert(repeat.status !== 200 && repeatAfter === normalAfter, 'repeticao: pedido confirmado duplicou item');

    const concurrent = await criarPedido('concurrent');
    const concurrentBefore = await prisma.itemComanda.count({ where: { comandaId: concurrent.comandaId } });
    const concurrentResponses = await Promise.all([confirmar(concurrent.id), confirmar(concurrent.id)]);
    assert(concurrentResponses.filter((response) => response.status === 200).length === 1, 'concorrencia: mais de uma confirmacao teve sucesso');
    const concurrentAfter = await prisma.itemComanda.count({ where: { comandaId: concurrent.comandaId } });
    const concurrentPedido = await prisma.pedidoCliente.findUniqueOrThrow({ where: { id: concurrent.id } });
    assert(concurrentAfter === concurrentBefore + 1 && concurrentPedido.status === 'CONFIRMADO', 'concorrencia: itens duplicados ou status incorreto');

    const falhaSessao = await portalSessao(arena.slug, arena.trailerId, {
      nome: 'TQ003 failure',
      telefone: uniquePortalTestPhone(73, comandaIds.length),
    });
    assert(falhaSessao.status === 201 && falhaSessao.comandaId && falhaSessao.clienteId, 'falha: sessao portal falhou');
    comandaIds.push(falhaSessao.comandaId);
    const falhaPedido = await prisma.pedidoCliente.create({
      data: {
        eventoId: arena.eventoId,
        comandaId: falhaSessao.comandaId,
        clienteId: falhaSessao.clienteId,
        observacao: 'TQ003-failure',
        itens: {
          create: [
            { produtoId: arena.produtoId, tapId: arena.tapId, volumeMl: arena.volumeMl, quantidade: 1, precoUnit: arena.preco },
            { produtoId: arena.produtoId, tapId: arena.tapId, volumeMl: 999999, quantidade: 1, precoUnit: arena.preco },
          ],
        },
      },
    });
    const falhaBefore = await prisma.itemComanda.count({ where: { comandaId: falhaSessao.comandaId } });
    const falhaConfirm = await confirmar(falhaPedido.id);
    const falhaAfter = await prisma.itemComanda.count({ where: { comandaId: falhaSessao.comandaId } });
    const falhaAtual = await prisma.pedidoCliente.findUniqueOrThrow({ where: { id: falhaPedido.id } });
    assert(falhaConfirm.status !== 200 && falhaAfter === falhaBefore && falhaAtual.status === 'PENDENTE', 'falha intermediaria deixou aplicacao parcial');

    console.log('TQ003 pedido confirmation: PASS');
  } finally {
    await prisma.comanda.deleteMany({ where: { id: { in: comandaIds } } });
  }
}

main().catch((error) => {
  console.error('TQ003 pedido confirmation: FAIL', error);
  process.exitCode = 1;
});
