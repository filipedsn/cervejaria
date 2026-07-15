#!/usr/bin/env npx tsx
/**
 * Recalcula ClienteEstatisticas a partir de comandas FECHADA existentes.
 * Uso: npx tsx scripts/backfill-cliente-stats.ts
 */
import { prisma } from '../src/lib/prisma.js';
import { recalculateClienteStats } from '../src/lib/cliente-stats.js';

async function main() {
  const clientes = await prisma.cliente.findMany({ select: { id: true, nome: true } });
  console.log(`Recalculando stats de ${clientes.length} clientes...`);

  let ok = 0;
  for (const cliente of clientes) {
    await prisma.$transaction(async (tx) => {
      await recalculateClienteStats(tx, cliente.id);
    });
    ok += 1;
    if (ok % 50 === 0) console.log(`  ${ok}/${clientes.length}`);
  }

  console.log(`Concluido: ${ok} clientes.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
