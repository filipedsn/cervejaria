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
const tenantIds = ['cmr9yis3c0000hvu00q9fe7y1', 'cmsry9xrn0000hvlgopjxy0oo'];

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) =>
    [key, /password|senha|cookie|token|authorization/i.test(key) ? '[REDACTED]' : redact(item)]));
}

async function databaseSnapshot() {
  const prisma = new PrismaClient();
  try {
    const counts: Record<string, Record<string, unknown>> = {};
    for (const tenantId of tenantIds) {
      counts[tenantId] = {
        usuarios: await prisma.usuario.count({ where: { cervejariaId: tenantId } }),
        userPermissions: await prisma.usuario.findMany({ where: { cervejariaId: tenantId }, select: { id: true, permissoesOperacao: true, podeDarDescontoOperacao: true }, orderBy: { id: 'asc' } }),
        produtos: await prisma.produto.count({ where: { cervejariaId: tenantId } }),
        productState: await prisma.produto.findMany({ where: { cervejariaId: tenantId }, select: { id: true, nome: true, ativo: true, controlaEstoque: true, exigePreparo: true, precos: { select: { id: true, preco: true, volumeMl: true } } }, orderBy: { id: 'asc' } }),
        clientes: await prisma.cliente.count({ where: { cervejariaId: tenantId } }),
        clientState: await prisma.cliente.findMany({ where: { cervejariaId: tenantId }, select: { id: true, nome: true, telefone: true, ativo: true }, orderBy: { id: 'asc' } }),
        comandas: await prisma.comanda.count({ where: { pedidos: { some: { cervejariaId: tenantId } } } }).catch(() => 0),
        commandState: await prisma.comanda.findMany({ where: { pontoVenda: { cervejariaId: tenantId } }, select: { id: true, status: true, tipo: true, total: true, desconto: true, identificador: true, fechadaEm: true, itens: { select: { id: true, produtoId: true, quantidade: true, precoUnit: true, canceladoEm: true } }, pagamentos: { select: { id: true, valor: true, forma: true } } }, orderBy: { id: 'asc' } }),
        pontosVenda: await prisma.pontoVenda.count({ where: { cervejariaId: tenantId } }),
        sessoesCaixa: await prisma.sessaoCaixaOperacao.count({ where: { cervejariaId: tenantId } }),
        cashSessionState: await prisma.sessaoCaixaOperacao.findMany({ where: { cervejariaId: tenantId }, select: { id: true, status: true, trocoInicial: true, fechadoEm: true, contadoDinheiro: true, contadoPix: true, contadoCartaoDebito: true, contadoCartaoCredito: true }, orderBy: { id: 'asc' } }),
        pedidosOperacao: await prisma.pedidoOperacao.count({ where: { cervejariaId: tenantId } }),
        kitchenState: await prisma.pedidoOperacao.findMany({ where: { cervejariaId: tenantId }, select: { id: true, status: true, observacao: true, entregueEm: true, itensComanda: { select: { id: true, cancelamentoPendenteEm: true, canceladoEm: true } } }, orderBy: { id: 'asc' } }),
        inventoryBalances: await prisma.inventoryBalance.count({ where: { cervejariaId: tenantId } }),
        inventoryState: await prisma.inventoryBalance.findMany({ where: { cervejariaId: tenantId }, select: { id: true, produtoId: true, pontoVendaId: true, quantidade: true, estoqueMinimo: true }, orderBy: { id: 'asc' } }),
        inventoryMovements: await prisma.inventoryMovement.count({ where: { cervejariaId: tenantId } }),
        movementState: await prisma.inventoryMovement.findMany({ where: { cervejariaId: tenantId }, select: { id: true, produtoId: true, quantidade: true, tipo: true }, orderBy: { id: 'asc' } }),
        eventStates: await prisma.evento.findMany({ where: { cervejariaId: tenantId }, select: { id: true, status: true }, orderBy: { id: 'asc' } }),
      };
    }
    const canonical = JSON.stringify(counts);
    return { capturedAt: new Date().toISOString(), counts, sha256: createHash('sha256').update(canonical).digest('hex') };
  } finally {
    await prisma.$disconnect();
  }
}

function testId(title: string) {
  return title.match(/\b[A-Z]{3,4}-[SX]\d{2}\b/)?.[0] ?? title.replace(/[^a-z0-9]+/gi, '-').slice(0, 64);
}

type Evidence = {
  id: string;
  recordApi: (item: Record<string, unknown>) => void;
  screenshot: (step: string, page?: Page) => Promise<string>;
  assertNoDbChange: () => Promise<void>;
};

export const test = base.extend<{ evidence: Evidence }>({
  evidence: [async ({ page }, use, testInfo) => {
    const id = testId(testInfo.title);
    const api: Record<string, unknown>[] = [];
    const consoleErrors: string[] = [];
    const serverErrors: Record<string, unknown>[] = [];
    const before = await databaseSnapshot();
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('pageerror', (error) => consoleErrors.push(error.message));
    page.on('response', async (response) => {
      const request = response.request();
      if (!new URL(response.url()).pathname.startsWith('/api/')) return;
      const entry = { method: request.method(), url: response.url(), status: response.status(), requestBody: request.postData(), responseBody: await response.text().catch(() => '') };
      api.push(redact(entry) as Record<string, unknown>);
      if (response.status() >= 500) serverErrors.push(entry);
    });
    const evidence: Evidence = {
      id,
      recordApi: (item) => api.push(redact(item) as Record<string, unknown>),
      screenshot: async (step, target = page) => {
        await mkdir(screenshotRoot, { recursive: true });
        const file = path.join(screenshotRoot, `${id}_${testInfo.project.name}_${step}.png`);
        await target.screenshot({ path: file, fullPage: true });
        return path.relative(process.cwd(), file);
      },
      assertNoDbChange: async () => expect((await databaseSnapshot()).sha256, `${id} must leave the database unchanged`).toBe(before.sha256),
    };
    await use(evidence);
    const after = await databaseSnapshot();
    if (page.isClosed() === false) await evidence.screenshot('final').catch(() => undefined);
    await Promise.all([mkdir(apiRoot, { recursive: true }), mkdir(dbRoot, { recursive: true })]);
    const apiPath = path.join(apiRoot, `${id}.json`);
    const previous = await readFile(apiPath, 'utf8').then((value) => JSON.parse(value)).catch(() => ({ runs: [] }));
    if (!Array.isArray(previous.runs)) previous.runs = [];
    previous.runs.push({ project: testInfo.project.name, requests: api, consoleErrors, serverErrors });
    await writeFile(apiPath, JSON.stringify(redact(previous), null, 2));
    const dbPath = path.join(dbRoot, `${id}.json`);
    const priorDb = await readFile(dbPath, 'utf8').then((value) => JSON.parse(value)).catch(() => ({ runs: [] }));
    if (!Array.isArray(priorDb.runs)) priorDb.runs = [];
    const unchanged = before.sha256 === after.sha256;
    priorDb.runs.push({ project: testInfo.project.name, before, after, unchanged });
    await writeFile(dbPath, JSON.stringify(priorDb, null, 2));
    const isException = /\b[A-Z]{3,4}-X\d{2}\b/.test(testInfo.title);
    if (isException) expect(unchanged, `${id} must leave the database unchanged`).toBe(true);
    expect(consoleErrors, `${id} must have no browser console errors`).toEqual([]);
    expect(serverErrors, `${id} must have no HTTP 5xx responses`).toEqual([]);
  }, { auto: true }],
});

export { expect };
