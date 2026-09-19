import { prisma } from '../../src/lib/prisma.js';
import { ativarModuloQuiosque } from '../../src/lib/quiosque/modulo.js';
import { inicializarMontagemEvento } from '../../src/lib/tap-montagem.js';
import { hashPassword } from '../../src/lib/utils.js';
import { signToken, userJwtPayload } from './jwt.js';
import type { AdminFixture, Arena, ConfigTenantFixture, MultiTrailerFixture, TenantFixture } from './types.js';
export const QA_PREFIX = 'qa-load-';
export const CFG_PREFIX = 'qa-cfg-';
export const ARENA_SLUG = 'qa-arena';
export const MULTI_TRAILER_SLUG = 'qa-multi-trailer';
export const CONCURRENCY_PREFIX = 'qa-concurrency-';
export const QA_ADMIN_EMAIL = 'qa-admin@qa.test';
const PWD = 'qa123456';

export const CONFIG_DEFINITIONS = [
  { code: 'CERVEJARIA', slug: `${CFG_PREFIX}cervejaria`, moduloCervejaria: true, moduloQuiosque: false, controlaEstoque: false, temCozinha: false, exclusivo: false },
  { code: 'QUIOSQUE-00', slug: `${CFG_PREFIX}quiosque-00`, moduloCervejaria: false, moduloQuiosque: true, controlaEstoque: false, temCozinha: false, exclusivo: true },
  { code: 'QUIOSQUE-10', slug: `${CFG_PREFIX}quiosque-10`, moduloCervejaria: false, moduloQuiosque: true, controlaEstoque: true, temCozinha: false, exclusivo: true },
  { code: 'QUIOSQUE-01', slug: `${CFG_PREFIX}quiosque-01`, moduloCervejaria: false, moduloQuiosque: true, controlaEstoque: false, temCozinha: true, exclusivo: true },
  { code: 'QUIOSQUE-11', slug: `${CFG_PREFIX}quiosque-11`, moduloCervejaria: false, moduloQuiosque: true, controlaEstoque: true, temCozinha: true, exclusivo: true },
  // Legacy HIBRIDA labels remain fixture identifiers only. The former mixed
  // combination is now represented by CAIXA plus optional capabilities.
  { code: 'HIBRIDA-00', slug: `${CFG_PREFIX}hibrida-00`, moduloCervejaria: false, moduloQuiosque: true, controlaEstoque: false, temCozinha: false, exclusivo: true },
  { code: 'HIBRIDA-10', slug: `${CFG_PREFIX}hibrida-10`, moduloCervejaria: false, moduloQuiosque: true, controlaEstoque: true, temCozinha: false, exclusivo: true },
  { code: 'HIBRIDA-01', slug: `${CFG_PREFIX}hibrida-01`, moduloCervejaria: false, moduloQuiosque: true, controlaEstoque: false, temCozinha: true, exclusivo: true },
  { code: 'HIBRIDA-11', slug: `${CFG_PREFIX}hibrida-11`, moduloCervejaria: false, moduloQuiosque: true, controlaEstoque: true, temCozinha: true, exclusivo: true },
] as const;

async function cleanupQuiosqueForBrewery(cervejariaId: string) {
  await prisma.movimentoEstoqueQuiosque.deleteMany({ where: { cervejariaId } });
  const sessoes = await prisma.sessaoCaixaQuiosque.findMany({ where: { cervejariaId }, select: { id: true } });
  const sessaoIds = sessoes.map((s) => s.id);
  if (sessaoIds.length) {
    await prisma.movimentoCaixaQuiosque.deleteMany({ where: { sessaoId: { in: sessaoIds } } });
  }
  await prisma.sessaoCaixaQuiosque.deleteMany({ where: { cervejariaId } });
  const comandas = await prisma.comanda.findMany({
    where: { origem: 'QUIOSQUE', pontoVenda: { cervejariaId } },
    select: { id: true },
  });
  const comandaIds = comandas.map((c) => c.id);
  if (comandaIds.length) {
    await prisma.itemComanda.deleteMany({ where: { comandaId: { in: comandaIds } } });
    await prisma.pagamento.deleteMany({ where: { comandaId: { in: comandaIds } } });
    await prisma.pedidoQuiosque.deleteMany({ where: { comandaId: { in: comandaIds } } });
    await prisma.comanda.deleteMany({ where: { id: { in: comandaIds } } });
  }
  await prisma.estoqueSaldoQuiosque.deleteMany({ where: { cervejariaId } });
  await prisma.produtoQuiosque.deleteMany({ where: { cervejariaId } });
  await prisma.pontoVenda.deleteMany({ where: { cervejariaId } });
  await prisma.configuracaoQuiosque.deleteMany({ where: { cervejariaId } });
}

function tenantSlug(i: number) {
  return `${QA_PREFIX}${String(i).padStart(3, '0')}`;
}

/** Deletes all QA breweries respecting FK order (ItemComanda.produto is Restrict). */
export async function cleanupQa() {
  const breweries = await prisma.cervejaria.findMany({
    where: {
      OR: [
        { slug: { startsWith: QA_PREFIX } },
        { slug: { startsWith: CFG_PREFIX } },
        { slug: { startsWith: CONCURRENCY_PREFIX } },
        { slug: ARENA_SLUG },
        { slug: MULTI_TRAILER_SLUG },
      ],
    },
    select: { id: true },
  });
  for (const { id } of breweries) {
    await cleanupQuiosqueForBrewery(id);
    const eventos = await prisma.evento.findMany({ where: { cervejariaId: id }, select: { id: true } });
    const eventoIds = eventos.map((e) => e.id);
    if (eventoIds.length) {
      const comandas = await prisma.comanda.findMany({
        where: { eventoId: { in: eventoIds } },
        select: { id: true },
      });
      const comandaIds = comandas.map((c) => c.id);
      if (comandaIds.length) {
        await prisma.itemComanda.deleteMany({ where: { comandaId: { in: comandaIds } } });
        await prisma.pagamento.deleteMany({ where: { comandaId: { in: comandaIds } } });
        await prisma.comanda.deleteMany({ where: { id: { in: comandaIds } } });
      }
      await prisma.tapMontagem.deleteMany({ where: { eventoId: { in: eventoIds } } });
      await prisma.eventoProduto.deleteMany({ where: { eventoId: { in: eventoIds } } });
      await prisma.evento.deleteMany({ where: { id: { in: eventoIds } } });
    }
    await prisma.cliente.deleteMany({ where: { cervejariaId: id } });
    await prisma.tap.deleteMany({ where: { cervejariaId: id } });
    await prisma.trailer.deleteMany({ where: { cervejariaId: id } });
    await prisma.preco.deleteMany({ where: { produto: { cervejariaId: id } } });
    await prisma.produto.deleteMany({ where: { cervejariaId: id } });
    await prisma.usuario.deleteMany({ where: { cervejariaId: id } });
    await prisma.cervejaria.delete({ where: { id } });
  }
  await prisma.usuario.deleteMany({ where: { email: QA_ADMIN_EMAIL } });
}

/** ADMIN da plataforma (sem cervejaria) para testes de isolamento e rotas /api/admin. */
export async function seedAdmin(): Promise<AdminFixture> {
  const senhaHash = await hashPassword(PWD);
  await prisma.usuario.deleteMany({ where: { email: QA_ADMIN_EMAIL } });
  const admin = await prisma.usuario.create({
    data: {
      nome: 'QA Admin Plataforma',
      email: QA_ADMIN_EMAIL,
      senhaHash,
      papel: 'ADMIN',
    },
    select: { id: true, email: true, nome: true, papel: true, cervejariaId: true, passwordChangedAt: true },
  });

  return {
    email: QA_ADMIN_EMAIL,
    senha: PWD,
    token: signToken(userJwtPayload(admin), { expiresInSec: 8 * 3600 }),
  };
}

async function createBrewery(slug: string, nome: string, atendentes: number) {
  const senhaHash = await hashPassword(PWD);
  const donoEmail = `${slug}-dono@qa.test`;
  const atendenteEmails = Array.from({ length: atendentes }, (_, k) => `${slug}-a${k + 1}@qa.test`);

  const cervejaria = await prisma.cervejaria.create({
    data: {
      nome,
      slug,
      usuarios: {
        create: [
          { nome: `Dono ${slug}`, email: donoEmail, senhaHash, papel: 'DONO' },
          ...atendenteEmails.map((email, k) => ({
            nome: `Atendente ${k + 1} ${slug}`,
            email,
            senhaHash,
            papel: 'ATENDENTE' as const,
          })),
        ],
      },
      produtos: {
        create: {
          nome: 'Pilsen QA',
          estilo: 'Pilsen',
          cor: '#F5C842',
          tipo: 'BEBIDA',
          formato: 'CHOPE',
          precos: { create: [{ volumeMl: 300, preco: 8 }, { volumeMl: 500, preco: 12 }] },
        },
      },
      trailers: {
        create: { nome: 'Principal' },
      },
    },
    include: { produtos: true, trailers: true },
  });

  const produto = cervejaria.produtos[0];
  const trailer = cervejaria.trailers[0];
  const tap = await prisma.tap.create({
    data: { numero: 1, nome: 'Tap 1', produtoId: produto.id, cervejariaId: cervejaria.id, trailerId: trailer.id },
  });

  const usuarios = await prisma.usuario.findMany({
    where: { cervejariaId: cervejaria.id },
    select: { id: true, email: true, nome: true, papel: true, cervejariaId: true, passwordChangedAt: true },
  });
  const dono = usuarios.find((u) => u.papel === 'DONO');
  if (!dono) throw new Error(`Dono não encontrado para ${slug}`);
  const donoToken = signToken(userJwtPayload(dono), { expiresInSec: 8 * 3600 });
  const atendenteTokens = usuarios
    .filter((u) => u.papel === 'ATENDENTE')
    .map((u) => signToken(userJwtPayload(u), { expiresInSec: 8 * 3600 }));

  return { cervejaria, produto, trailer, tap, donoEmail, donoToken, atendenteEmails, atendenteTokens };
}

export async function seedTenants(count: number, comandasPer: number, atendentes: number): Promise<TenantFixture[]> {
  const fixtures: TenantFixture[] = [];
  for (let i = 1; i <= count; i++) {
    const slug = tenantSlug(i);
    const b = await createBrewery(slug, `QA Cervejaria ${i}`, atendentes);

    const evento = await prisma.evento.create({
      data: {
        nome: `Evento QA ${i}`,
        local: `Local ${i}`,
        data: new Date(),
        horaInicio: '18:00',
        status: 'ABERTO',
        cervejariaId: b.cervejaria.id,
        trailerId: b.trailer.id,
      },
    });
    await inicializarMontagemEvento(evento.id, b.trailer.id);

    const comandaIds: string[] = [];
    for (let c = 1; c <= comandasPer; c++) {
      const cliente = await prisma.cliente.create({
        data: { nome: `Cliente ${c} ${slug}`, telefone: `${i}${String(c).padStart(5, '0')}`, cervejariaId: b.cervejaria.id },
      });
      const comanda = await prisma.comanda.create({
        data: { eventoId: evento.id, clienteId: cliente.id, status: 'ABERTA' },
      });
      comandaIds.push(comanda.id);
    }

    fixtures.push({
      index: i,
      slug,
      cervejariaId: b.cervejaria.id,
      donoEmail: b.donoEmail,
      donoToken: b.donoToken,
      atendenteEmails: b.atendenteEmails,
      atendenteTokens: b.atendenteTokens,
      eventoId: evento.id,
      trailerId: b.trailer.id,
      tapId: b.tap.id,
      produtoId: b.produto.id,
      volumeMl: 500,
      preco: 12,
      comandaIds,
    });
  }
  return fixtures;
}

/** Dedicated brewery whose single comanda is hammered by concurrent workers. */
export async function seedArena(runId?: string, comandaCount = 1): Promise<Arena & { comandaIds?: string[] }> {
  const slug = runId ? `${CONCURRENCY_PREFIX}${runId}` : ARENA_SLUG;
  const b = await createBrewery(slug, 'QA Arena Concorrência', 4);

  const evento = await prisma.evento.create({
    data: {
      nome: 'Arena de Concorrência',
      local: 'Estresse',
      data: new Date(),
      horaInicio: '18:00',
      status: 'ABERTO',
      cervejariaId: b.cervejaria.id,
      trailerId: b.trailer.id,
    },
  });
  await inicializarMontagemEvento(evento.id, b.trailer.id);

  const cliente = await prisma.cliente.create({
    data: { nome: 'Cliente Arena', telefone: '0000000000', cervejariaId: b.cervejaria.id },
  });
  const comanda = await prisma.comanda.create({
    data: { eventoId: evento.id, clienteId: cliente.id, status: 'ABERTA' },
  });
  const comandaIds = [comanda.id];
  for (let i = 1; i < comandaCount; i++) {
    const extraCliente = await prisma.cliente.create({
      data: { nome: `Cliente Arena ${i + 1}`, telefone: `000000${String(i).padStart(4, '0')}`, cervejariaId: b.cervejaria.id },
    });
    const extra = await prisma.comanda.create({ data: { eventoId: evento.id, clienteId: extraCliente.id, status: 'ABERTA' } });
    comandaIds.push(extra.id);
  }

  return {
    slug,
    cervejariaId: b.cervejaria.id,
    eventoId: evento.id,
    trailerId: b.trailer.id,
    tapId: b.tap.id,
    comandaId: comanda.id,
    produtoId: b.produto.id,
    volumeMl: 500,
    preco: 12,
    atendenteTokens: b.atendenteTokens,
    donoToken: b.donoToken,
    ...(runId ? { comandaIds } : {}),
  };
}

/** Removes only a disposable concurrency fixture; never accepts a non-QA slug. */
export async function cleanupConcurrencyArena(slug: string) {
  if (!slug.startsWith(CONCURRENCY_PREFIX)) throw new Error(`Recusa limpar fixture fora do escopo QA: ${slug}`);
  const brewery = await prisma.cervejaria.findUnique({ where: { slug }, select: { id: true } });
  if (!brewery) return;
  const eventos = await prisma.evento.findMany({ where: { cervejariaId: brewery.id }, select: { id: true } });
  const eventoIds = eventos.map((e) => e.id);
  const comandas = await prisma.comanda.findMany({ where: { eventoId: { in: eventoIds } }, select: { id: true } });
  const comandaIds = comandas.map((c) => c.id);
  await prisma.itemComanda.deleteMany({ where: { comandaId: { in: comandaIds } } });
  await prisma.pagamento.deleteMany({ where: { comandaId: { in: comandaIds } } });
  await prisma.comanda.deleteMany({ where: { id: { in: comandaIds } } });
  await prisma.tapMontagem.deleteMany({ where: { eventoId: { in: eventoIds } } });
  await prisma.eventoProduto.deleteMany({ where: { eventoId: { in: eventoIds } } });
  await prisma.evento.deleteMany({ where: { id: { in: eventoIds } } });
  await prisma.cliente.deleteMany({ where: { cervejariaId: brewery.id } });
  await prisma.tap.deleteMany({ where: { cervejariaId: brewery.id } });
  await prisma.trailer.deleteMany({ where: { cervejariaId: brewery.id } });
  await prisma.preco.deleteMany({ where: { produto: { cervejariaId: brewery.id } } });
  await prisma.produto.deleteMany({ where: { cervejariaId: brewery.id } });
  await prisma.usuario.deleteMany({ where: { cervejariaId: brewery.id } });
  await prisma.cervejaria.delete({ where: { id: brewery.id } });
}

/** Cervejaria com 2 trailers e 2 eventos abertos simultâneos (cenário operacional multi-trailer). */
export async function seedMultiTrailer(): Promise<MultiTrailerFixture> {
  const senhaHash = await hashPassword(PWD);
  const slug = MULTI_TRAILER_SLUG;
  const donoEmail = `${slug}-dono@qa.test`;
  const atendenteEmails = [`${slug}-a1@qa.test`, `${slug}-a2@qa.test`];

  const cervejaria = await prisma.cervejaria.create({
    data: {
      nome: 'QA Multi-Trailer',
      slug,
      usuarios: {
        create: [
          { nome: 'Dono Multi', email: donoEmail, senhaHash, papel: 'DONO' },
          ...atendenteEmails.map((email, k) => ({
            nome: `Atendente ${k + 1} Multi`,
            email,
            senhaHash,
            papel: 'ATENDENTE' as const,
          })),
        ],
      },
      produtos: {
        create: {
          nome: 'IPA QA Multi',
          estilo: 'IPA',
          cor: '#E8A838',
          tipo: 'BEBIDA',
          formato: 'CHOPE',
          precos: { create: [{ volumeMl: 500, preco: 14 }] },
        },
      },
      trailers: {
        create: [{ nome: 'Trailer Alpha' }, { nome: 'Trailer Beta' }],
      },
    },
    include: { produtos: true, trailers: true },
  });

  const produto = cervejaria.produtos[0];
  const [trailerA, trailerB] = cervejaria.trailers;
  await prisma.tap.createMany({
    data: [
      { numero: 1, nome: 'Tap A1', produtoId: produto.id, cervejariaId: cervejaria.id, trailerId: trailerA.id },
      { numero: 1, nome: 'Tap B1', produtoId: produto.id, cervejariaId: cervejaria.id, trailerId: trailerB.id },
    ],
  });

  const usuarios = await prisma.usuario.findMany({
    where: { cervejariaId: cervejaria.id },
    select: { id: true, email: true, nome: true, papel: true, cervejariaId: true, passwordChangedAt: true },
  });
  const dono = usuarios.find((u) => u.papel === 'DONO');
  if (!dono) throw new Error('Dono multi-trailer não encontrado');
  const donoToken = signToken(userJwtPayload(dono), { expiresInSec: 8 * 3600 });
  const atendenteTokens = usuarios
    .filter((u) => u.papel === 'ATENDENTE')
    .map((u) => signToken(userJwtPayload(u), { expiresInSec: 8 * 3600 }));

  const today = new Date();
  const eventoA = await prisma.evento.create({
    data: {
      nome: 'Evento Alpha',
      local: 'Praça A',
      data: today,
      horaInicio: '18:00',
      status: 'ABERTO',
      cervejariaId: cervejaria.id,
      trailerId: trailerA.id,
    },
  });
  const eventoB = await prisma.evento.create({
    data: {
      nome: 'Evento Beta',
      local: 'Praça B',
      data: today,
      horaInicio: '18:00',
      status: 'ABERTO',
      cervejariaId: cervejaria.id,
      trailerId: trailerB.id,
    },
  });
  await inicializarMontagemEvento(eventoA.id, trailerA.id);
  await inicializarMontagemEvento(eventoB.id, trailerB.id);

  const taps = await prisma.tap.findMany({
    where: { trailerId: { in: [trailerA.id, trailerB.id] } },
  });
  const tapA = taps.find((t) => t.trailerId === trailerA.id);
  const tapB = taps.find((t) => t.trailerId === trailerB.id);
  if (!tapA || !tapB) throw new Error('Taps multi-trailer não encontrados');

  const clienteA = await prisma.cliente.create({
    data: { nome: 'Cliente Alpha', telefone: '1111111111', cervejariaId: cervejaria.id },
  });
  const clienteB = await prisma.cliente.create({
    data: { nome: 'Cliente Beta', telefone: '2222222222', cervejariaId: cervejaria.id },
  });
  const comandaA = await prisma.comanda.create({
    data: { eventoId: eventoA.id, clienteId: clienteA.id, status: 'ABERTA' },
  });
  const comandaB = await prisma.comanda.create({
    data: { eventoId: eventoB.id, clienteId: clienteB.id, status: 'ABERTA' },
  });

  return {
    slug,
    cervejariaId: cervejaria.id,
    donoEmail,
    donoToken,
    atendenteTokens,
    produtoId: produto.id,
    volumeMl: 500,
    preco: 14,
    trailers: [
      { id: trailerA.id, nome: trailerA.nome, eventoId: eventoA.id, comandaId: comandaA.id, tapId: tapA.id },
      { id: trailerB.id, nome: trailerB.nome, eventoId: eventoB.id, comandaId: comandaB.id, tapId: tapB.id },
    ],
  };
}

/** Nove configuracoes de empresa para matriz CFG (modulos e subflags). */
export async function seedConfigTenants(): Promise<ConfigTenantFixture[]> {
  const senhaHash = await hashPassword(PWD);
  const fixtures: ConfigTenantFixture[] = [];

  for (const def of CONFIG_DEFINITIONS) {
    const donoEmail = `${def.slug}-dono@qa.test`;

    const cervejaria = await prisma.cervejaria.create({
      data: {
        nome: `QA ${def.code}`,
        slug: def.slug,
        ...(def.moduloCervejaria ? { trailers: { create: { nome: 'Principal CFG' } } } : {}),
      },
      include: { trailers: true },
    });

    const dono = await prisma.usuario.create({
      data: {
        nome: `Dono ${def.code}`,
        email: donoEmail,
        senhaHash,
        papel: 'DONO',
        cervejariaId: cervejaria.id,
      },
      select: { id: true, email: true, nome: true, papel: true, cervejariaId: true, passwordChangedAt: true },
    });

    await prisma.usuario.createMany({
      data: [1, 2].map((n) => ({
        nome: `Atendente ${n} ${def.code}`,
        email: `${def.slug}-a${n}@qa.test`,
        senhaHash,
        papel: 'ATENDENTE' as const,
        cervejariaId: cervejaria.id,
      })),
    });

    let pontoVendaId: string | undefined;
    let produtoId: string | undefined;
    let produtoPreparoId: string | undefined;
    let eventoId: string | undefined;

    if (def.moduloQuiosque) {
      const { pontoVenda } = await prisma.$transaction(async (tx) =>
        ativarModuloQuiosque(tx, {
          cervejariaId: cervejaria.id,
          controlaEstoque: def.controlaEstoque,
          temCozinha: def.temCozinha,
          exclusivo: def.exclusivo,
          nomePontoVenda: `PDV ${def.code}`,
        }),
      );
      pontoVendaId = pontoVenda.id;

      const bebida = await prisma.produtoQuiosque.create({
        data: {
          cervejariaId: cervejaria.id,
          nome: 'Cerveja CFG',
          categoria: 'Cervejas',
          precoUnit: 8,
          exigePreparo: false,
          controlaEstoque: def.controlaEstoque,
          ordem: 1,
        },
      });
      produtoId = bebida.id;

      const preparo = await prisma.produtoQuiosque.create({
        data: {
          cervejariaId: cervejaria.id,
          nome: 'Pastel CFG',
          categoria: 'Salgados',
          precoUnit: 12,
          exigePreparo: true,
          controlaEstoque: def.controlaEstoque,
          ordem: 2,
        },
      });
      produtoPreparoId = preparo.id;

      if (def.controlaEstoque) {
        await prisma.estoqueSaldoQuiosque.createMany({
          data: [
            { cervejariaId: cervejaria.id, pontoVendaId, produtoId: bebida.id, quantidade: 100 },
            { cervejariaId: cervejaria.id, pontoVendaId, produtoId: preparo.id, quantidade: 100 },
          ],
        });
      }
    }

    if (def.moduloCervejaria && cervejaria.trailers[0]) {
      const trailer = cervejaria.trailers[0];
      const produto = await prisma.produto.create({
        data: {
          nome: 'Pilsen CFG',
          estilo: 'Pilsen',
          cor: '#F5C842',
          tipo: 'BEBIDA',
          formato: 'CHOPE',
          cervejariaId: cervejaria.id,
          precos: { create: [{ volumeMl: 500, preco: 12 }] },
        },
      });
      await prisma.tap.create({
        data: {
          numero: 1,
          nome: 'Tap CFG',
          produtoId: produto.id,
          cervejariaId: cervejaria.id,
          trailerId: trailer.id,
        },
      });
      const evento = await prisma.evento.create({
        data: {
          nome: `Evento CFG ${def.code}`,
          local: 'Local CFG',
          data: new Date(),
          horaInicio: '18:00',
          status: 'ABERTO',
          cervejariaId: cervejaria.id,
          trailerId: trailer.id,
        },
      });
      await inicializarMontagemEvento(evento.id, trailer.id);
      eventoId = evento.id;
    }

    fixtures.push({
      code: def.code,
      slug: def.slug,
      cervejariaId: cervejaria.id,
      donoEmail,
      donoToken: signToken(userJwtPayload(dono), { expiresInSec: 8 * 3600 }),
      moduloCervejaria: def.moduloCervejaria,
      moduloQuiosque: def.moduloQuiosque,
      controlaEstoque: def.controlaEstoque,
      temCozinha: def.temCozinha,
      exclusivo: def.exclusivo,
      pontoVendaId,
      produtoId,
      produtoPreparoId,
      eventoId,
    });
  }

  return fixtures;
}
