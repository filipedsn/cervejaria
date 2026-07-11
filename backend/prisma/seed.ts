import '../src/lib/load-env.js';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/utils.js';

const prisma = new PrismaClient();

async function main() {
  const adminSenhaHash = await hashPassword('M1H2sy27!pedro01');
  const demoSenhaHash = await hashPassword('123456');

  await prisma.usuario.upsert({
    where: { email: 'contato@quivercloud.com.br' },
    update: { senhaHash: adminSenhaHash, nome: 'Admin Quiver Cloud', papel: 'ADMIN' },
    create: {
      nome: 'Admin Quiver Cloud',
      email: 'contato@quivercloud.com.br',
      senhaHash: adminSenhaHash,
      papel: 'ADMIN',
    },
  });

  const cervejaria = await prisma.cervejaria.upsert({
    where: { slug: 'demo-chopp' },
    update: {},
    create: {
      nome: 'Demo Chopp Móvel',
      slug: 'demo-chopp',
      usuarios: {
        create: {
          nome: 'João Dono',
          email: 'dono@demo.com',
          senhaHash: demoSenhaHash,
          papel: 'DONO',
        },
      },
    },
  });

  await prisma.usuario.upsert({
    where: { email: 'atendente@demo.com' },
    update: {},
    create: {
      nome: 'Maria Atendente',
      email: 'atendente@demo.com',
      senhaHash: demoSenhaHash,
      papel: 'ATENDENTE',
      cervejariaId: cervejaria.id,
    },
  });

  const produtos = [
    {
      nome: 'Pilsen',
      descricao: 'Cerveja leve e refrescante',
      cor: '#F5C842',
      estilo: 'Pilsen',
      precos: [
        { volumeMl: 300, preco: 8 },
        { volumeMl: 500, preco: 12 },
        { volumeMl: 700, preco: 16 },
      ],
    },
    {
      nome: 'IPA',
      descricao: 'Amargor marcante, notas cítricas',
      cor: '#E67E22',
      estilo: 'IPA',
      precos: [
        { volumeMl: 300, preco: 10 },
        { volumeMl: 500, preco: 15 },
        { volumeMl: 700, preco: 20 },
      ],
    },
    {
      nome: 'Weiss',
      descricao: 'Trigo, levemente frutada',
      cor: '#FAD7A0',
      estilo: 'Weiss',
      precos: [
        { volumeMl: 300, preco: 9 },
        { volumeMl: 500, preco: 14 },
        { volumeMl: 700, preco: 18 },
      ],
    },
  ];

  for (const p of produtos) {
    const existing = await prisma.produto.findFirst({
      where: { cervejariaId: cervejaria.id, nome: p.nome },
    });
    if (!existing) {
      await prisma.produto.create({
        data: {
          nome: p.nome,
          descricao: p.descricao,
          cor: p.cor,
          estilo: p.estilo,
          cervejariaId: cervejaria.id,
          precos: { create: p.precos },
        },
      });
    }
  }

  const createdProdutos = await prisma.produto.findMany({
    where: { cervejariaId: cervejaria.id },
    orderBy: { nome: 'asc' },
  });

  const trailer = await prisma.trailer.upsert({
    where: { id: `trailer_${cervejaria.id}` },
    update: {},
    create: {
      id: `trailer_${cervejaria.id}`,
      nome: 'Principal',
      cervejariaId: cervejaria.id,
    },
  });

  for (let i = 0; i < Math.min(4, createdProdutos.length); i++) {
    const tapNum = i + 1;
    await prisma.tap.upsert({
      where: { trailerId_numero: { trailerId: trailer.id, numero: tapNum } },
      update: { produtoId: createdProdutos[i % createdProdutos.length].id },
      create: {
        numero: tapNum,
        nome: `Tap ${tapNum}`,
        produtoId: createdProdutos[i % createdProdutos.length].id,
        cervejariaId: cervejaria.id,
        trailerId: trailer.id,
      },
    });
  }

  console.log('Seed concluído!');
  console.log('Login admin: contato@quivercloud.com.br');
  console.log('Login dono: dono@demo.com / 123456');
  console.log('Login atendente: atendente@demo.com / 123456');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
