#!/usr/bin/env npx tsx
/**
 * Corrige nomes de clientes já cadastrados para o padrão Title Case.
 * Uso: npx tsx scripts/normalize-cliente-nomes.ts
 * Dry-run: DRY_RUN=1 npx tsx scripts/normalize-cliente-nomes.ts
 */
import { prisma } from '../src/lib/prisma.js';
import { formatPersonName } from '../src/lib/person-name.js';

const dryRun =
  process.env.DRY_RUN === '1'
  || process.env.DRY_RUN === 'true'
  || process.argv.includes('--dry-run');

async function main() {
  const clientes = await prisma.cliente.findMany({
    where: { isSistema: false },
    select: { id: true, nome: true, cervejariaId: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`${dryRun ? '[dry-run] ' : ''}Clientes: ${clientes.length}`);

  let alterados = 0;
  for (const cliente of clientes) {
    const nome = formatPersonName(cliente.nome);
    if (nome === cliente.nome) continue;
    alterados += 1;
    console.log(`  ${cliente.id}: "${cliente.nome}" → "${nome}"`);
    if (!dryRun) {
      await prisma.cliente.update({
        where: { id: cliente.id },
        data: { nome },
      });
    }
  }

  console.log(`${dryRun ? '[dry-run] ' : ''}Concluído: ${alterados} nome(s) a ajustar.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
