import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const outcome = {
  status: 'FIXTURE_SETUP_FAILURE',
  ownerLogin: 'NOT_RUN',
  staffLogin: 'NOT_RUN',
  fixture: 'NOT_CREATED',
  fixtureTag: null,
  cleanup: 'NOT_NEEDED',
};

let prisma;
let created;
let phase = 'setup';

function emit() {
  process.stdout.write(`DEV_QA_SMOKE_RESULT=${JSON.stringify(outcome)}\n`);
}

async function loginAndCheck(baseUrl, email, password, expectedRole, userId, tenantId) {
  let loginResponse;
  try {
    loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, senha: password }),
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    return 'SERVICE_ENDPOINT_FAILURE';
  }

  if ([401, 403].includes(loginResponse.status)) return 'AUTHENTICATION_FAILURE';
  if (!loginResponse.ok) return 'SERVICE_ENDPOINT_FAILURE';

  const setCookies = typeof loginResponse.headers.getSetCookie === 'function'
    ? loginResponse.headers.getSetCookie()
    : [loginResponse.headers.get('set-cookie') ?? ''];
  const cookie = setCookies.map((value) => value.split(';', 1)[0]).filter(Boolean).join('; ');
  if (!cookie) return 'AUTHENTICATION_FAILURE';

  let meResponse;
  try {
    meResponse = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { cookie },
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    return 'SERVICE_ENDPOINT_FAILURE';
  }
  if ([401, 403, 404].includes(meResponse.status)) return 'AUTHENTICATION_FAILURE';
  if (!meResponse.ok) return 'SERVICE_ENDPOINT_FAILURE';

  let me;
  try {
    me = await meResponse.json();
  } catch {
    return 'SERVICE_ENDPOINT_FAILURE';
  }
  if (me?.usuario?.id !== userId || me?.usuario?.papel !== expectedRole || me?.cervejaria?.id !== tenantId) {
    return 'AUTHENTICATION_FAILURE';
  }
  return 'PASS';
}

async function run() {
  const expectedSha = process.env.DEV_QA_RELEASE_SHA;
  const dependencyRoot = process.env.DEV_QA_DEPENDENCY_ROOT;
  const baseUrl = process.env.DEV_QA_BASE_URL;
  const databaseUrl = process.env.DATABASE_URL;

  if (process.env.NODE_ENV !== 'development' || !databaseUrl) throw new Error('DEV_ONLY_CONFIG');
  const database = new URL(databaseUrl);
  if (!database.pathname.includes('cervejaria_dev') || database.port !== '5434') throw new Error('DEV_DATABASE_GUARD');
  if (!/^[a-f0-9]{40}$/.test(expectedSha ?? '') || !dependencyRoot || !baseUrl) throw new Error('SMOKE_CONFIG');
  const target = new URL(baseUrl);
  if (target.protocol !== 'https:' || target.hostname !== 'tapdev.quivercloud.com.br') throw new Error('SMOKE_BASE_URL_GUARD');

  const manifestPath = path.resolve(process.cwd(), '..', 'deploy', 'dev-artifacts', 'manifest.json');
  const activeManifestText = fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, '');
  const activeManifest = JSON.parse(activeManifestText);
  if (activeManifest.releaseSha !== expectedSha) throw new Error('ACTIVE_RELEASE_MISMATCH');

  const normalizedDependencies = path.resolve(dependencyRoot);
  const requireFromPinnedDependencies = createRequire(path.join(normalizedDependencies, 'backend', 'package.json'));
  const { PrismaClient } = requireFromPinnedDependencies('@prisma/client');
  const bcrypt = requireFromPinnedDependencies('bcryptjs');
  prisma = new PrismaClient();

  if (process.env.DEV_QA_SMOKE_INSPECT_ONLY === '1') {
    const count = await prisma.cervejaria.count({ where: { slug: { startsWith: 'dev-rbac-smoke-' } } });
    outcome.status = 'INSPECTED';
    outcome.fixture = count === 0 ? 'NONE' : 'EXISTING_UNTOUCHED';
    outcome.leftoverTenantCount = count;
    return;
  }

  const runId = randomUUID().replaceAll('-', '');
  const slug = `dev-rbac-smoke-${runId}`;
  outcome.fixtureTag = slug;
  const password = randomBytes(32).toString('base64url');
  const passwordHash = await bcrypt.hash(password, 10);

  const ownerEmail = `${slug}-owner@example.invalid`;
  const staffEmail = `${slug}-staff@example.invalid`;
  created = await prisma.$transaction(async (tx) => {
    const tenant = await tx.cervejaria.create({
      data: { nome: `DEV RBAC smoke ${runId}`, slug },
    });
    const owner = await tx.usuario.create({
      data: { nome: 'Synthetic QA Owner', email: ownerEmail, senhaHash: passwordHash, papel: 'DONO', cervejariaId: tenant.id },
    });
    const staff = await tx.usuario.create({
      data: { nome: 'Synthetic QA Staff', email: staffEmail, senhaHash: passwordHash, papel: 'ATENDENTE', cervejariaId: tenant.id },
    });
    return { tenantId: tenant.id, ownerId: owner.id, staffId: staff.id };
  });
  outcome.fixture = 'CREATED';

  phase = 'authentication';
  const ownerResult = await loginAndCheck(baseUrl, ownerEmail, password, 'DONO', created.ownerId, created.tenantId);
  outcome.ownerLogin = ownerResult;
  const staffResult = await loginAndCheck(baseUrl, staffEmail, password, 'ATENDENTE', created.staffId, created.tenantId);
  outcome.staffLogin = staffResult;

  if (ownerResult === 'SERVICE_ENDPOINT_FAILURE' || staffResult === 'SERVICE_ENDPOINT_FAILURE') {
    outcome.status = 'SERVICE_ENDPOINT_FAILURE';
  } else if (ownerResult !== 'PASS' || staffResult !== 'PASS') {
    outcome.status = 'AUTHENTICATION_FAILURE';
  } else {
    outcome.status = 'PASS';
  }
}

try {
  await run();
} catch (error) {
  outcome.status = phase === 'authentication' ? 'SERVICE_ENDPOINT_FAILURE' : 'FIXTURE_SETUP_FAILURE';
  outcome.failureCode = error instanceof Error
    ? `${error.name}${typeof error.code === 'string' ? `:${error.code}` : ''}`
    : 'UNKNOWN_ERROR';
  if (error instanceof Error && error.message) {
    outcome.failureDetail = error.message
      .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '<DATABASE_URL>')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '<EMAIL>')
      .replace(/(password|senha|token|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=<REDACTED>')
      .slice(0, 240);
  }
} finally {
  if (created && prisma) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.usuario.deleteMany({
          where: {
            id: { in: [created.ownerId, created.staffId] },
            cervejariaId: created.tenantId,
          },
        });
        await tx.cervejaria.deleteMany({
          where: { id: created.tenantId, slug: { startsWith: 'dev-rbac-smoke-' } },
        });
      });
      outcome.cleanup = 'PASS';
      outcome.fixture = 'REMOVED';
    } catch {
      outcome.cleanup = 'FAIL';
      outcome.status = 'CLEANUP_FAILURE';
    }
  }
  if (prisma) {
    try {
      await prisma.$disconnect();
    } catch {
      outcome.cleanup = 'FAIL';
      outcome.status = 'CLEANUP_FAILURE';
    }
  }
  emit();
}

if (outcome.status !== 'PASS') process.exitCode = 1;
