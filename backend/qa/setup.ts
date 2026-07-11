import { prisma } from '../src/lib/prisma.js';
import { API_BASE, api } from './lib/http.js';
import { jwtSecret } from './lib/jwt.js';
import { cleanupQa, seedArena, seedMultiTrailer, seedTenants } from './lib/seed.js';
import { CONTEXT_PATH, ensureDirs, clearWorkerResults, writeJson } from './lib/store.js';
import type { QaContext } from './lib/types.js';

const BREWERIES = Number(process.env.QA_BREWERIES ?? 40);
const COMANDAS = Number(process.env.QA_COMANDAS ?? 10);
const ATENDENTES = Number(process.env.QA_ATENDENTES ?? 3);

async function main() {
  console.log('[setup] Verificando API...');
  const health = await api<{ status: string }>('GET', '/api/health');
  if (health.status !== 200) {
    throw new Error(`API indisponível em ${API_BASE} (HTTP ${health.status}). Suba o backend antes.`);
  }

  console.log('[setup] Limpando dados QA anteriores...');
  await cleanupQa();

  console.log(`[setup] Semeando ${BREWERIES} cervejarias (${COMANDAS} comandas, ${ATENDENTES} atendentes)...`);
  const t0 = performance.now();
  const tenants = await seedTenants(BREWERIES, COMANDAS, ATENDENTES);

  console.log('[setup] Criando arena de concorrência...');
  const arena = await seedArena();

  console.log('[setup] Criando cervejaria multi-trailer (2 eventos abertos)...');
  const multiTrailer = await seedMultiTrailer();

  const context: QaContext = {
    createdAt: new Date().toISOString(),
    apiBase: API_BASE,
    jwtSecret: jwtSecret(),
    loadProfile: { breweries: BREWERIES, employeesPerBrewery: ATENDENTES + 1, comandasPerBrewery: COMANDAS },
    tenants,
    arena,
    multiTrailer,
  };

  ensureDirs();
  clearWorkerResults();
  writeJson(CONTEXT_PATH, context);

  const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`[setup] OK — ${tenants.length} cervejarias + arena em ${elapsed}s`);
  console.log(`[setup] Contexto salvo em ${CONTEXT_PATH}`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('[setup] FALHOU:', err);
  await prisma.$disconnect();
  process.exit(1);
});
