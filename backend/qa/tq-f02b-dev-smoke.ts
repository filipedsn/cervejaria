import assert from 'node:assert/strict';
import { prisma } from '../src/lib/prisma.js';
import { ativarModuloQuiosque } from '../src/lib/quiosque/modulo.js';
import { hashPassword } from '../src/lib/utils.js';
import { login } from './lib/http.js';

const BASE = process.env.QA_API_BASE ?? 'http://localhost:3002';
const PREFIX = `qa-f02b-${Date.now()}`;
const senha = 'F02B-senha-secreta';

async function api(path: string, token: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Cookie: token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await res.text();
  return { status: res.status, data: raw ? JSON.parse(raw) : null };
}

async function criarTenant(sufixo: string) {
  const senhaHash = await hashPassword(senha);
  const cervejaria = await prisma.cervejaria.create({ data: { nome: `QA F02B ${sufixo}`, slug: `${PREFIX}-${sufixo}` } });
  const [dono, atendente] = await Promise.all([
    prisma.usuario.create({ data: { nome: `Dono ${sufixo}`, email: `${PREFIX}-${sufixo}-dono@qa.test`, senhaHash, papel: 'DONO', cervejariaId: cervejaria.id } }),
    prisma.usuario.create({ data: { nome: `Atendente ${sufixo}`, email: `${PREFIX}-${sufixo}-at@qa.test`, senhaHash, papel: 'ATENDENTE', cervejariaId: cervejaria.id } }),
  ]);
  const { pontoVenda } = await prisma.$transaction((tx) => ativarModuloQuiosque(tx, {
    cervejariaId: cervejaria.id, controlaEstoque: false, temCozinha: false, exclusivo: true, nomePontoVenda: 'PDV smoke',
  }));
  const produto = await prisma.produto.create({ data: { cervejariaId: cervejaria.id, nome: 'Produto smoke', tipo: 'COMIDA', categoria: 'Salgados', precos: { create: [{ volumeMl: 1, preco: 10 }] }, ordem: 1 } });
  const [donoToken, atendenteToken] = await Promise.all([
    login(dono.email, senha),
    login(atendente.email, senha),
  ]);
  return {
    cervejaria, pontoVenda, produto, dono,
    donoToken,
    atendenteToken,
  };
}

async function limpar() {
  const cervejarias = await prisma.cervejaria.findMany({ where: { slug: { startsWith: PREFIX } }, select: { id: true } });
  for (const { id } of cervejarias) {
    const sessoes = await prisma.sessaoCaixaQuiosque.findMany({ where: { cervejariaId: id }, select: { id: true } });
    await prisma.movimentoCaixaQuiosque.deleteMany({ where: { sessaoId: { in: sessoes.map((s) => s.id) } } });
    await prisma.sessaoCaixaQuiosque.deleteMany({ where: { cervejariaId: id } });
    await prisma.itemComanda.deleteMany({ where: { comanda: { pontoVenda: { cervejariaId: id } } } });
    await prisma.pagamento.deleteMany({ where: { comanda: { pontoVenda: { cervejariaId: id } } } });
    await prisma.pedidoQuiosque.deleteMany({ where: { cervejariaId: id } });
    await prisma.comanda.deleteMany({ where: { pontoVenda: { cervejariaId: id } } });
    await prisma.preco.deleteMany({ where: { produto: { cervejariaId: id } } });
    await prisma.produto.deleteMany({ where: { cervejariaId: id } });
    await prisma.pontoVenda.deleteMany({ where: { cervejariaId: id } });
    await prisma.configuracaoQuiosque.deleteMany({ where: { cervejariaId: id } });
    await prisma.transacaoLog.deleteMany({ where: { cervejariaId: id } });
    await prisma.usuario.deleteMany({ where: { cervejariaId: id } });
    await prisma.cervejaria.delete({ where: { id } });
  }
}

async function main() {
  const a = await criarTenant('a');
  const b = await criarTenant('b');
  try {
    assert.notEqual(
      (await api('/api/quiosque/config', a.atendenteToken, 'PATCH', { quantidadeMesas: 12 })).status,
      200,
    );
    let r = await api('/api/quiosque/config', a.donoToken, 'PATCH', { quantidadeMesas: 12 });
    assert.equal(r.status, 200);
    r = await api('/api/quiosque/contexto', a.atendenteToken);
    assert.equal(r.status, 200); assert.equal(r.data.quantidadeMesas, 12);

    r = await api('/api/quiosque/caixa/abrir', a.atendenteToken, 'POST', { pontoVendaId: a.pontoVenda.id, trocoInicial: 50 });
    assert.equal(r.status, 201);
    r = await api('/api/quiosque/comandas', a.atendenteToken, 'POST', { pontoVendaId: a.pontoVenda.id, tipo: 'MESA', identificador: '3', itens: [{ produtoId: a.produto.id, quantidade: 1 }] });
    assert.equal(r.status, 201); const mesaId = r.data.id;
    r = await api(`/api/quiosque/comandas/${mesaId}/cancelar`, a.donoToken, 'POST'); assert.equal(r.status, 200);
    r = await api('/api/quiosque/comandas', a.atendenteToken, 'POST', { pontoVendaId: a.pontoVenda.id, tipo: 'MESA', identificador: '3', itens: [{ produtoId: a.produto.id, quantidade: 1 }] });
    assert.equal(r.status, 201); assert.ok(r.data.numero > 0);
    await api(`/api/quiosque/comandas/${r.data.id}/cancelar`, a.donoToken, 'POST');

    r = await api('/api/quiosque/caixa/movimentos', a.atendenteToken, 'POST', { pontoVendaId: a.pontoVenda.id, tipo: 'SUPRIMENTO', valor: 150 });
    assert.equal(r.status, 201); const original = r.data.movimentos.at(-1);
    const corrigir = (token: string, body: object) => api(`/api/quiosque/caixa/movimentos/${original.id}/corrigir`, token, 'POST', body);
    const base = { pontoVendaId: a.pontoVenda.id, valorCorrigido: 15, motivo: 'Valor digitado incorretamente', autorizadorEmail: a.dono.email };
    assert.notEqual((await corrigir(a.atendenteToken, base)).status, 201);
    assert.notEqual((await corrigir(a.atendenteToken, { ...base, autorizadorSenha: 'errada' })).status, 201);
    assert.notEqual((await corrigir(a.atendenteToken, { ...base, autorizadorEmail: b.dono.email, autorizadorSenha: senha })).status, 201);
    assert.notEqual((await corrigir(a.atendenteToken, { ...base, motivo: '', autorizadorSenha: senha })).status, 201);
    const ok = await corrigir(a.atendenteToken, { ...base, autorizadorSenha: senha }); assert.equal(ok.status, 201);
    const movimentos = ok.data.movimentos;
    const raiz = movimentos.find((m: any) => m.id === original.id);
    const derivados = movimentos.filter((m: any) => m.correcaoDeId === original.id);
    assert.ok(raiz.corrigidoEm && raiz.autorizadoPorId === a.dono.id && raiz.solicitadoPorId);
    assert.equal(derivados.length, 2); assert.equal(derivados.filter((m: any) => m.naturezaCorrecao === 'ESTORNO').length, 1); assert.equal(derivados.filter((m: any) => m.naturezaCorrecao === 'SUBSTITUICAO' && Number(m.valor) === 15).length, 1);
    assert.equal(ok.data.gaveta.esperadoDinheiro, 65);
    assert.notEqual((await corrigir(a.atendenteToken, { ...base, autorizadorSenha: senha })).status, 201);
    assert.notEqual((await api(`/api/quiosque/caixa/movimentos/${a.produto.id}/corrigir`, a.atendenteToken, 'POST', { ...base, autorizadorSenha: senha })).status, 201);

    r = await api('/api/quiosque/caixa/movimentos', a.atendenteToken, 'POST', { pontoVendaId: a.pontoVenda.id, tipo: 'SANGRIA', valor: 30 });
    assert.equal(r.status, 201); const concorrenteId = r.data.movimentos.at(-1).id;
    const corrida = await Promise.all([
      api(`/api/quiosque/caixa/movimentos/${concorrenteId}/corrigir`, a.atendenteToken, 'POST', { ...base, valorCorrigido: 3, autorizadorSenha: senha }),
      api(`/api/quiosque/caixa/movimentos/${concorrenteId}/corrigir`, a.atendenteToken, 'POST', { ...base, valorCorrigido: 3, autorizadorSenha: senha }),
    ]);
    assert.equal(corrida.filter((item) => item.status === 201).length, 1);
    const filhosConcorrentes = await prisma.movimentoCaixaQuiosque.count({ where: { correcaoDeId: concorrenteId } });
    assert.equal(filhosConcorrentes, 2);

    r = await api('/api/quiosque/caixa/movimentos', a.atendenteToken, 'POST', { pontoVendaId: a.pontoVenda.id, tipo: 'SUPRIMENTO', valor: 20 });
    assert.equal(r.status, 201); const fecharCorrigirId = r.data.movimentos.at(-1).id;
    const [correcaoFechar, fechamento] = await Promise.all([
      api(`/api/quiosque/caixa/movimentos/${fecharCorrigirId}/corrigir`, a.atendenteToken, 'POST', { ...base, valorCorrigido: 2, autorizadorSenha: senha }),
      api('/api/quiosque/caixa/fechar', a.atendenteToken, 'POST', { pontoVendaId: a.pontoVenda.id, contadoDinheiro: 0, contadoPix: 0, contadoCartaoDebito: 0, contadoCartaoCredito: 0 }),
    ]);
    assert.ok([200, 201].includes(fechamento.status));
    assert.ok([201, 400].includes(correcaoFechar.status));
    const registroFechar = await prisma.movimentoCaixaQuiosque.findUniqueOrThrow({ where: { id: fecharCorrigirId }, include: { correcoes: true } });
    assert.ok((registroFechar.corrigidoEm === null && registroFechar.correcoes.length === 0) || (registroFechar.corrigidoEm !== null && registroFechar.correcoes.length === 2));

    await new Promise((resolve) => setTimeout(resolve, 150));
    const audit = await prisma.transacaoLog.findFirst({ where: { cervejariaId: a.cervejaria.id, tipo: 'QUIOSQUE_CAIXA_MOVIMENTO_CORRIGIDO' } });
    assert.ok(audit); assert.ok(!JSON.stringify(audit.metadata).includes(senha));
    console.log('TQ-F02B SMOKE PASS');
  } finally { await limpar(); }
}
main().catch(async (err) => { console.error(err); await limpar(); process.exitCode = 1; });
