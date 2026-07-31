/** Auditoria: produção alinhada com workspace? */
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../dist/app.js';
import { signUserToken } from '../dist/lib/session.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(join(__dirname, '../.env.production'), 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('=');
  if (eq < 1) continue;
  process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
}
process.env.NODE_ENV = 'production';

const prodFrontendIndex = join(__dirname, '../../deploy/prod-artifacts/frontend/index.html');
const legacyFrontendIndex = join(__dirname, '../../frontend/dist/index.html');
const indexLocalPathResolved = existsSync(prodFrontendIndex)
  ? prodFrontendIndex
  : legacyFrontendIndex;
process.env.FRONTEND_DIST = dirname(indexLocalPathResolved);

const prisma = new PrismaClient();
const dono = await prisma.usuario.findFirst({
  where: { cervejaria: { slug: 'cia-maritima' }, papel: 'DONO' },
  select: { id: true, email: true, nome: true, papel: true, cervejariaId: true, passwordChangedAt: true },
});

const app = await buildApp();
const token = signUserToken(app, dono);

const checks = [];

const indexLocal = readFileSync(indexLocalPathResolved, 'utf8');
const bundleMatch = indexLocal.match(/assets\/(index-[^"]+\.js)/);
const expectedBundle = bundleMatch?.[1] ?? '?';

const indexLive = await fetch('http://127.0.0.1:3001/').then((r) => r.text());
const liveBundleMatch = indexLive.match(/assets\/(index-[^"]+\.js)/);
const liveBundle = liveBundleMatch?.[1] ?? '?';

checks.push({
  name: 'Frontend bundle servido',
  ok: expectedBundle === liveBundle,
  expected: expectedBundle,
  actual: liveBundle,
});

const liveRes = await fetch('http://127.0.0.1:3001/api/clientes?limit=5&ordenar=ultimaVisita&q=Teste', {
  headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
});
const liveData = await liveRes.json();
const teste = liveData.items?.find((c) => c.nome === 'Teste');

checks.push({
  name: 'API live: podeExcluir Teste',
  ok: teste?.podeExcluir === true,
  actual: teste?.podeExcluir,
});
checks.push({
  name: 'API live: motivoExclusao presente',
  ok: teste && 'motivoExclusao' in teste,
  actual: teste?.motivoExclusao,
});

const pidFile = readFileSync(join(__dirname, '../../deploy/runtime/api.pid'), 'utf8').trim();
const portRes = await fetch('http://127.0.0.1:3001/api/ready');
checks.push({ name: 'API ready', ok: portRes.ok, actual: portRes.status });

const distClientes = readFileSync(join(__dirname, '../dist/routes/clientes.js'), 'utf8');
checks.push({
  name: 'backend/dist tem podeExcluir',
  ok: distClientes.includes('podeExcluir'),
});

const srcClientes = readFileSync(join(__dirname, '../src/routes/clientes.ts'), 'utf8');
const srcMtime = (await import('fs')).statSync(join(__dirname, '../src/routes/clientes.ts')).mtimeMs;
const distMtime = (await import('fs')).statSync(join(__dirname, '../dist/routes/clientes.js')).mtimeMs;
checks.push({
  name: 'backend/dist mais recente que src/clientes.ts',
  ok: distMtime >= srcMtime,
  src: new Date(srcMtime).toISOString(),
  dist: new Date(distMtime).toISOString(),
});

console.log(JSON.stringify({ pid: pidFile, checks, allOk: checks.every((c) => c.ok) }, null, 2));

await app.close();
await prisma.$disconnect();
