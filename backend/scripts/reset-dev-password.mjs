#!/usr/bin/env node
/**
 * Redefine senha de um usuário apenas no banco informado via DATABASE_URL.
 * Uso: node scripts/run-with-env.mjs development node scripts/reset-dev-password.mjs email@exemplo.com NovaSenha
 */
import { prisma } from '../src/lib/prisma.js';
import { hashPassword } from '../src/lib/utils.js';

const email = process.argv[2];
const senha = process.argv[3];

if (!email || !senha) {
  console.error('Uso: node scripts/reset-dev-password.mjs <email> <senha>');
  process.exit(1);
}

if (!process.env.DATABASE_URL?.includes('cervejaria_dev')) {
  console.error('Bloqueado: DATABASE_URL deve apontar para cervejaria_dev.');
  process.exit(1);
}

const hash = await hashPassword(senha);
const usuario = await prisma.usuario.update({
  where: { email },
  data: { senhaHash: hash, passwordChangedAt: new Date() },
  select: { email: true, nome: true, papel: true },
});

console.log(`Senha atualizada em dev: ${usuario.nome} (${usuario.email}, ${usuario.papel})`);
await prisma.$disconnect();
