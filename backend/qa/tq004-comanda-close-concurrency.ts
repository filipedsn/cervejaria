import { prisma } from '../src/lib/prisma.js';
import { lockComandaItemsInTx } from '../src/lib/comanda-service.js';
import { api, chopeItemBody, login, uniqueStaffComandaBody } from './lib/http.js';
import { assertQaEnvironment } from './lib/guard.js';
import { CONTEXT_PATH, readJson } from './lib/store.js';
import type { QaContext } from './lib/types.js';

type Item = { precoUnit: number | string; quantidade: number };
type Pagamento = { valor: number | string };
type Comanda = {
  id: string;
  status: 'ABERTA' | 'FECHADA' | 'CANCELADA';
  total: number | string;
  desconto?: number | string;
  itens: Item[];
  pagamentos: Pagamento[];
};

const ctx = readJson<QaContext>(CONTEXT_PATH);
const fixture = ctx.arena;
const comandaIds: string[] = [];
let sequence = 0;
let atendenteToken = '';
let donoToken = '';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function valor(value: number | string | undefined): number {
  return Number(value ?? 0);
}

function subtotal(comanda: Comanda): number {
  return comanda.itens.reduce((sum, item) => sum + valor(item.precoUnit) * item.quantidade, 0);
}

function pagamentosTotal(comanda: Comanda): number {
  return comanda.pagamentos.reduce((sum, pagamento) => sum + valor(pagamento.valor), 0);
}

function assertEstadoConsistente(comanda: Comanda, label: string) {
  assert(Math.abs(valor(comanda.total) - Math.max(0, subtotal(comanda) - valor(comanda.desconto))) <= 0.01, `${label}: total divergente dos itens/desconto`);
  if (comanda.status === 'FECHADA') {
    assert(Math.abs(pagamentosTotal(comanda) - valor(comanda.total)) <= 0.01, `${label}: pagamentos divergentes do total fechado`);
  } else {
    assert(comanda.pagamentos.length === 0, `${label}: pagamento gravado em comanda não fechada`);
  }
}

async function abrirComItem(label: string): Promise<Comanda> {
  const criada = await api<Comanda>('POST', '/api/comandas', {
    token: atendenteToken,
    body: uniqueStaffComandaBody(fixture.eventoId, `TQ004 ${label}`, sequence++),
  });
  assert(criada.status === 201 && criada.data.id, `${label}: criar comanda falhou (${criada.status})`);
  comandaIds.push(criada.data.id);

  const item = await api<Comanda>('POST', `/api/comandas/${criada.data.id}/itens`, {
    token: atendenteToken,
    body: chopeItemBody(fixture.produtoId, fixture.tapId, fixture.volumeMl),
  });
  assert(item.status === 201, `${label}: adicionar item inicial falhou (${item.status})`);
  return item.data;
}

async function buscar(comandaId: string): Promise<Comanda> {
  const resposta = await api<Comanda>('GET', `/api/comandas/${comandaId}`, { token: donoToken });
  assert(resposta.status === 200, `buscar ${comandaId}: HTTP ${resposta.status}`);
  return resposta.data;
}

async function disputarLock<T, U>(comandaId: string, primeira: () => Promise<T>, segunda: () => Promise<U>) {
  let primeiraPromise!: Promise<T>;
  let segundaPromise!: Promise<U>;

  await prisma.$transaction(async (tx) => {
    await lockComandaItemsInTx(tx, comandaId);
    primeiraPromise = primeira();
    segundaPromise = segunda();
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  return Promise.all([primeiraPromise, segundaPromise]) as Promise<[T, U]>;
}

async function fechar(comanda: Comanda) {
  return api<Comanda>('POST', `/api/pagamentos/comandas/${comanda.id}/fechar`, {
    token: atendenteToken,
    body: { pagamentos: [{ forma: 'PIX', valor: valor(comanda.total) }] },
  });
}

async function main() {
  assertQaEnvironment();
  atendenteToken = await login(`${fixture.slug}-a1@qa.test`, 'qa123456');
  donoToken = await login(`${fixture.slug}-dono@qa.test`, 'qa123456');
  try {
    const normal = await abrirComItem('normal');
    const normalClose = await fechar(normal);
    assert(normalClose.status === 200 && normalClose.data.status === 'FECHADA', `normal: fechamento falhou (${normalClose.status})`);
    assertEstadoConsistente(await buscar(normal.id), 'normal');

    const inclusao = await abrirComItem('inclusao');
    const [incluir, fecharInclusao] = await disputarLock(
      inclusao.id,
      () => api<Comanda>('POST', `/api/comandas/${inclusao.id}/itens`, {
        token: atendenteToken,
        body: chopeItemBody(fixture.produtoId, fixture.tapId, fixture.volumeMl),
      }),
      () => fechar(inclusao),
    );
    const inclusaoFinal = await buscar(inclusao.id);
    assertEstadoConsistente(inclusaoFinal, 'inclusão concorrente');
    assert(
      inclusaoFinal.status !== 'FECHADA' || incluir.status !== 201 || fecharInclusao.status === 400,
      'inclusão concorrente: item persistiu após fechamento sem pagamento correspondente',
    );

    const remocao = await abrirComItem('remocao');
    const itemParaRemover = remocao.itens[0] as Item & { id?: string };
    const detalhada = await api<Comanda & { itens: Array<Item & { id: string }> }>('GET', `/api/comandas/${remocao.id}`, {
      token: donoToken,
    });
    const itemId = detalhada.data.itens[0]?.id ?? itemParaRemover.id;
    assert(itemId, 'remoção concorrente: item inicial ausente');
    const [remover] = await disputarLock(
      remocao.id,
      () => api<Comanda>('DELETE', `/api/comandas/${remocao.id}/itens/${itemId}`, { token: atendenteToken }),
      () => fechar(remocao),
    );
    const remocaoFinal = await buscar(remocao.id);
    assertEstadoConsistente(remocaoFinal, 'remoção concorrente');
    assert(remocaoFinal.status !== 'FECHADA' || remover.status !== 200, 'remoção concorrente: item foi removido após fechamento');

    const desconto = await abrirComItem('desconto');
    const [aplicarDesconto] = await disputarLock(
      desconto.id,
      () => api<Comanda>('PATCH', `/api/comandas/${desconto.id}/desconto`, {
        token: donoToken,
        body: { desconto: 1 },
      }),
      () => fechar(desconto),
    );
    const descontoFinal = await buscar(desconto.id);
    assertEstadoConsistente(descontoFinal, 'desconto concorrente');
    assert(descontoFinal.status !== 'FECHADA' || aplicarDesconto.status !== 200, 'desconto concorrente: desconto aplicado após fechamento');

    const aposFechar = await abrirComItem('apos-fechar');
    const aposFecharClose = await fechar(aposFechar);
    assert(aposFecharClose.status === 200, `mutação posterior: fechamento falhou (${aposFecharClose.status})`);
    const mutacaoTardia = await api<Comanda>('POST', `/api/comandas/${aposFechar.id}/itens`, {
      token: atendenteToken,
      body: chopeItemBody(fixture.produtoId, fixture.tapId, fixture.volumeMl),
    });
    assert(mutacaoTardia.status !== 201, 'mutação posterior: item aceito após fechamento');
    assertEstadoConsistente(await buscar(aposFechar.id), 'mutação posterior');

    const duplo = await abrirComItem('duplo-fechamento');
    const [primeiroFechamento, segundoFechamento] = await disputarLock(duplo.id, () => fechar(duplo), () => fechar(duplo));
    assert(
      [primeiroFechamento.status, segundoFechamento.status].filter((status) => status === 200).length === 1,
      `duplo fechamento: esperava um sucesso, recebeu ${primeiroFechamento.status}/${segundoFechamento.status}`,
    );
    assertEstadoConsistente(await buscar(duplo.id), 'duplo fechamento');

    console.log('TQ004 comanda/fechamento concorrência: PASS');
  } finally {
    await prisma.comanda.deleteMany({ where: { id: { in: comandaIds } } });
  }
}

main().catch((error) => {
  console.error('TQ004 comanda/fechamento concorrência: FAIL', error);
  process.exitCode = 1;
});
