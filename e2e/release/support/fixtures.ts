import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test as base, type Page } from '@playwright/test';

const requireBackend = createRequire(path.join(process.cwd(), 'backend', 'package.json'));
const { PrismaClient } = requireBackend('@prisma/client') as { PrismaClient: new () => any };
const releaseRoot = path.join(process.cwd(), 'artifacts', 'release-e2e', process.env.RELEASE_SHA!);
const apiRoot = path.join(releaseRoot, 'evidence', 'api');
const dbRoot = path.join(releaseRoot, 'evidence', 'db');
const screenshotRoot = path.join(releaseRoot, 'evidence', 'screenshots');
const seededTenantIds = ['cmr9yis3c0000hvu00q9fe7y1', 'cmsry9xrn0000hvlgopjxy0oo'];

let sharedPrisma: any;
/** Disposable QA database only; used for preconditions the canonical API cannot create (e.g. legacy leftovers). */
export function prismaClient() {
  sharedPrisma ??= new PrismaClient();
  return sharedPrisma;
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) =>
    [key, /password|senha|cookie|token|authorization/i.test(key) ? '[REDACTED]' : redact(item)]));
}

async function tenantSnapshot(prisma: any, tenantId: string) {
  const byTenant = { where: { cervejariaId: tenantId }, orderBy: { id: 'asc' as const } };
  return {
    usuarios: await prisma.usuario.findMany({ ...byTenant, select: { id: true, papel: true, permissoesOperacao: true, podeDarDescontoOperacao: true } }),
    produtos: await prisma.produto.findMany({ ...byTenant, select: { id: true, nome: true, ativo: true, controlaEstoque: true, exigePreparo: true, categoriaPdvId: true, precos: { select: { id: true, preco: true, volumeMl: true }, orderBy: { id: 'asc' } } } }),
    categorias: await prisma.categoriaProdutoPdv.findMany({ ...byTenant, select: { id: true, nome: true } }),
    opcionais: await prisma.opcional.findMany({ ...byTenant, select: { id: true, nome: true, ativo: true } }),
    cardapios: await prisma.cardapio.findMany({ ...byTenant, select: { id: true, nome: true, ativo: true } }),
    taps: await prisma.tap.findMany({ ...byTenant, select: { id: true, numero: true, produtoId: true, pontoVendaId: true, ativo: true } }),
    clientes: await prisma.cliente.findMany({ ...byTenant, select: { id: true, nome: true, telefone: true, ativo: true } }),
    comandas: await prisma.comanda.findMany({ where: { pontoVenda: { cervejariaId: tenantId } }, orderBy: { id: 'asc' }, select: { id: true, status: true, tipo: true, total: true, desconto: true, identificador: true, fechadaEm: true, itens: { orderBy: { id: 'asc' }, select: { id: true, produtoId: true, quantidade: true, precoUnit: true, canceladoEm: true, cancelamentoPendenteEm: true } }, pagamentos: { orderBy: { id: 'asc' }, select: { id: true, valor: true, forma: true } }, contaReceber: { select: { id: true, valorOriginal: true, pagamentos: { select: { id: true, valor: true } } } } } }),
    pontosVenda: await prisma.pontoVenda.findMany({ ...byTenant, select: { id: true, ativo: true } }),
    configuracoesPdv: await prisma.configuracaoPontoVenda.findMany({ ...byTenant }),
    sessoesCaixa: await prisma.sessaoCaixaOperacao.findMany({ ...byTenant, select: { id: true, status: true, trocoInicial: true, fechadoEm: true, tipoEncerramento: true, contadoDinheiro: true, contadoPix: true, contadoCartaoDebito: true, contadoCartaoCredito: true, movimentos: { orderBy: { id: 'asc' }, select: { id: true, tipo: true, valor: true, correcaoDeId: true } } } }),
    pedidos: await prisma.pedidoOperacao.findMany({ ...byTenant, select: { id: true, status: true, observacao: true, entregueEm: true } }),
    estoque: await prisma.inventoryBalance.findMany({ ...byTenant, select: { id: true, produtoId: true, pontoVendaId: true, quantidade: true, estoqueMinimo: true } }),
    movimentosEstoque: await prisma.inventoryMovement.count({ where: { cervejariaId: tenantId } }),
    agendas: await prisma.agendaOperacional.findMany({ ...byTenant, select: { id: true, nome: true } }),
    ocorrencias: await prisma.ocorrenciaOperacional.findMany({ ...byTenant, select: { id: true, status: true } }),
    eventos: await prisma.evento.findMany({ ...byTenant, select: { id: true, status: true } }),
  };
}

async function databaseSnapshot(tenantIds: string[]) {
  const prisma = prismaClient();
  const tenants: Record<string, unknown> = {};
  for (const tenantId of tenantIds) tenants[tenantId] = await tenantSnapshot(prisma, tenantId);
  const canonical = JSON.stringify(tenants);
  return { capturedAt: new Date().toISOString(), tenants, sha256: createHash('sha256').update(canonical).digest('hex') };
}

export function testId(title: string) {
  return title.match(/\b[A-Z]{3,4}-[SX]\d{2}\b/)?.[0] ?? title.replace(/[^a-z0-9]+/gi, '-').slice(0, 64);
}

export type Evidence = {
  id: string;
  recordApi: (item: Record<string, unknown>) => void;
  screenshot: (step: string, page?: Page) => Promise<string>;
  /** Includes a tenant created during the test in the database proof. */
  track: (tenantId: string) => void;
  /** Re-baselines the database proof after the test prepared its own data. */
  checkpoint: () => Promise<void>;
  /** Proves nothing changed since the last checkpoint; later writes (positive controls) are allowed. */
  assertNoDbChange: () => Promise<void>;
};

export const test = base.extend<{ evidence: Evidence }>({
  evidence: [async ({ page }, use, testInfo) => {
    const id = testId(testInfo.title);
    const tenantIds = [...seededTenantIds];
    const api: Record<string, unknown>[] = [];
    const consoleErrors: string[] = [];
    const serverErrors: Record<string, unknown>[] = [];
    const checkpoints: Array<{ label: string; sha256: string; unchanged?: boolean }> = [];
    let baseline = await databaseSnapshot(tenantIds);
    const before = baseline;
    let verified = false;
    const forbiddenPageRequests: string[] = [];
    // Network failures are judged by status below, so the generic browser line is not counted twice.
    page.on('console', (message) => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) consoleErrors.push(message.text()); });
    page.on('pageerror', (error) => consoleErrors.push(error.message));
    page.on('response', async (response) => {
      const request = response.request();
      const pathname = new URL(response.url()).pathname;
      if (!pathname.startsWith('/api/')) return;
      const entry = { method: request.method(), url: pathname, status: response.status() };
      api.push(redact(entry) as Record<string, unknown>);
      if (response.status() >= 500) serverErrors.push(entry);
      // A screen must not call endpoints the signed-in persona cannot use.
      if (response.status() === 403) forbiddenPageRequests.push(`${request.method()} ${pathname}`);
    });
    const evidence: Evidence = {
      id,
      recordApi: (item) => {
        const safeItem = {
          actor: item.actor,
          method: item.method,
          url: typeof item.url === 'string' ? new URL(item.url, process.env.RELEASE_QA_BASE_URL).pathname : undefined,
          status: item.status,
        };
        api.push(redact(safeItem) as Record<string, unknown>);
        if (typeof item.status === 'number' && item.status >= 500) serverErrors.push(item);
      },
      screenshot: async (step, target = page) => {
        await mkdir(screenshotRoot, { recursive: true });
        const file = path.join(screenshotRoot, `${id}_${testInfo.project.name}_${step}.png`);
        await target.screenshot({ path: file, fullPage: true });
        return path.relative(process.cwd(), file);
      },
      track: (tenantId) => { if (!tenantIds.includes(tenantId)) tenantIds.push(tenantId); },
      checkpoint: async () => {
        baseline = await databaseSnapshot(tenantIds);
        checkpoints.push({ label: 'checkpoint', sha256: baseline.sha256 });
      },
      assertNoDbChange: async () => {
        const current = await databaseSnapshot(tenantIds);
        const unchanged = current.sha256 === baseline.sha256;
        checkpoints.push({ label: 'assertNoDbChange', sha256: current.sha256, unchanged });
        verified = true;
        expect(unchanged, `${id} must leave the database unchanged`).toBe(true);
      },
    };
    await use(evidence);
    const after = await databaseSnapshot(tenantIds);
    if (page.isClosed() === false && page.url() !== 'about:blank') await evidence.screenshot('final').catch(() => undefined);
    await Promise.all([mkdir(apiRoot, { recursive: true }), mkdir(dbRoot, { recursive: true })]);
    const apiPath = path.join(apiRoot, `${id}.json`);
    const previous = await readFile(apiPath, 'utf8').then((value) => JSON.parse(value)).catch(() => ({ runs: [] }));
    if (!Array.isArray(previous.runs)) previous.runs = [];
    previous.runs.push({ project: testInfo.project.name, requests: api, consoleErrors, serverErrors, forbiddenPageRequests });
    await writeFile(apiPath, JSON.stringify(redact(previous), null, 2));
    const dbPath = path.join(dbRoot, `${id}.json`);
    const priorDb = await readFile(dbPath, 'utf8').then((value) => JSON.parse(value)).catch(() => ({ runs: [] }));
    if (!Array.isArray(priorDb.runs)) priorDb.runs = [];
    const unchangedSinceBaseline = baseline.sha256 === after.sha256;
    priorDb.runs.push({ project: testInfo.project.name, tenants: tenantIds, before: { sha256: before.sha256, capturedAt: before.capturedAt }, checkpoints, after: { sha256: after.sha256, capturedAt: after.capturedAt }, verified, unchangedSinceBaseline });
    await writeFile(dbPath, JSON.stringify(priorDb, null, 2));
    const isException = /\b[A-Z]{3,4}-X\d{2}\b/.test(testInfo.title);
    if (isException && !verified) expect(unchangedSinceBaseline, `${id} must leave the database unchanged`).toBe(true);
    const expectedOfflineSocketError = (message: string) =>
      id === 'PWA-S02' && /^WebSocket connection to 'ws:\/\/(?:127\.0\.0\.1|localhost):\d+\/socket\.io\/\?EIO=4&transport=websocket' failed: Error in connection establishment: net::ERR_INTERNET_DISCONNECTED$/.test(message);
    const unexpectedConsoleErrors = consoleErrors.filter((message) => !expectedOfflineSocketError(message));
    expect(unexpectedConsoleErrors, `${id} must have no unexpected browser console errors`).toEqual([]);
    expect(serverErrors, `${id} must have no HTTP 5xx responses`).toEqual([]);
    expect([...new Set(forbiddenPageRequests)], `${id} screens must not request endpoints the persona cannot access`).toEqual([]);
  }, { auto: true }],
});

export { expect };
