import { prisma } from '../src/lib/prisma.js';
import { hashPassword, verifyPassword } from '../src/lib/utils.js';
import { assertQaEnvironment } from './lib/guard.js';

const EMAIL = 'qa-cfg-quiosque-01-dono@qa.test';
const SLUG = 'qa-cfg-quiosque-01';
const PASSWORD = 'qa123456';
const apply = process.argv.includes('--apply');

async function main() {
  assertQaEnvironment();
  const user = await prisma.usuario.findUnique({
    where: { email: EMAIL },
    include: { cervejaria: { include: { configuracaoQuiosque: true } } },
  });

  if (!user || !user.cervejaria) throw new Error(`Fixture ausente: ${EMAIL}`);
  const config = user.cervejaria.configuracaoQuiosque;
  const validFixture =
    user.cervejaria.slug === SLUG &&
    user.papel === 'DONO' &&
    user.cervejaria.ativo &&
    config?.ativo &&
    !config.controlaEstoque &&
    config.temCozinha;
  const passwordMatches = await verifyPassword(PASSWORD, user.senhaHash);

  console.log(JSON.stringify({
    exists: true,
    validFixture,
    passwordMatches,
    role: user.papel,
    breweryActive: user.cervejaria.ativo,
    quiosque: config && {
      active: config.ativo,
      controlaEstoque: config.controlaEstoque,
      temCozinha: config.temCozinha,
    },
  }));

  if (!apply || passwordMatches) return;
  if (!validFixture) throw new Error('Fixture inconsistente; restauração de senha foi recusada.');

  await prisma.usuario.update({
    where: { id: user.id },
    data: { senhaHash: await hashPassword(PASSWORD), passwordChangedAt: new Date() },
  });
  console.log(JSON.stringify({ restored: true, email: EMAIL }));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
