import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { request as playwrightRequest, type APIRequestContext, type Page } from '@playwright/test';
import { expect, test as base, type Evidence } from './fixtures';

export const baseURL = process.env.RELEASE_QA_BASE_URL!;
export const seed = JSON.parse(readFileSync(process.env.RELEASE_QA_CONTEXT!, 'utf8')) as {
  releaseSha: string;
  runId: string;
  tenants: Array<{ id: string; slug: string }>;
  points: Record<string, string>;
  users: Record<string, { id: string; email: string; password: string }>;
  admin: { id: string; email: string; password: string };
};
export const tenantA = seed.tenants[0]!;
export const tenantB = seed.tenants[1]!;

export type ApiResult<T = any> = { status: number; body: T; headers: Record<string, string> };

export const ALL_PERMISSIONS = [
  'cash.open', 'cash.close', 'cash.values.read', 'cash.movement.write', 'payment.receive', 'debt.receive',
  'command.close', 'discount.apply', 'command.item.cancel', 'command.item.cancel.delivered', 'command.cancel',
  'kitchen.cancel', 'sale.refund', 'dashboard.read', 'event.dashboard.read', 'reports.read', 'command.operate',
  'command.read', 'kitchen.read', 'kitchen.operate', 'inventory.read', 'inventory.adjust', 'catalog.manage',
  'catalog.shift.manage', 'clients.manage', 'taps.operate', 'agenda.manage', 'event.menu.manage',
] as const;

export const PERSONA_PERMISSIONS = {
  salao: ['command.read', 'command.operate'],
  caixa: ['cash.open', 'cash.close', 'cash.values.read', 'cash.movement.write', 'payment.receive', 'debt.receive', 'command.read', 'command.operate', 'command.close', 'discount.apply'],
  cozinha: ['kitchen.read', 'kitchen.operate'],
  cozinhaLider: ['kitchen.read', 'kitchen.operate', 'kitchen.cancel', 'sale.refund'],
  estoque: ['inventory.read', 'inventory.adjust'],
  gerente: ALL_PERMISSIONS.filter((key) => key !== 'command.item.cancel.delivered'),
  semPermissao: [],
} satisfies Record<string, readonly string[]>;

export function uniqueSuffix() {
  return randomBytes(6).toString('hex');
}

export function strongPassword() {
  return `Qa-${randomBytes(18).toString('base64url')}-!`;
}

/** Brazilian mobile number that is unique per call, in national format. */
export function uniquePhone() {
  const digits = String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
  return `119${digits}`;
}

export function todayIso(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export async function loginPage(page: Page, email: string, senha: string) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('E-mail').fill(email);
  await page.locator('#password').fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((url) => url.pathname !== '/login', { timeout: 15_000 });
}

export class Api {
  constructor(readonly ctx: APIRequestContext, readonly who: string, private readonly evidence: Evidence) {}

  async call<T = any>(method: string, url: string, data?: unknown): Promise<ApiResult<T>> {
    const response = await this.ctx.fetch(url, { method, ...(data === undefined ? {} : { data }), failOnStatusCode: false });
    const text = await response.text();
    let body: any = text;
    try { body = text ? JSON.parse(text) : null; } catch { /* keep raw text */ }
    this.evidence.recordApi({ actor: this.who, method, url, requestBody: data, status: response.status(), responseBody: body });
    return { status: response.status(), body, headers: response.headers() };
  }

  get<T = any>(url: string) { return this.call<T>('GET', url); }
  post<T = any>(url: string, data: unknown = {}) { return this.call<T>('POST', url, data); }
  put<T = any>(url: string, data: unknown = {}) { return this.call<T>('PUT', url, data); }
  patch<T = any>(url: string, data: unknown = {}) { return this.call<T>('PATCH', url, data); }
  delete<T = any>(url: string, data?: unknown) { return this.call<T>('DELETE', url, data); }

  /** Asserts the exact status and returns the body. */
  async expect<T = any>(result: Promise<ApiResult<T>>, status: number, label?: string): Promise<T> {
    const resolved = await result;
    expect(resolved.status, `${label ?? 'request'} (${this.who}) -> ${JSON.stringify(resolved.body)?.slice(0, 400)}`).toBe(status);
    return resolved.body;
  }
}

export type Catalog = {
  categoriaId: string;
  chope: { id: string; precos: Record<300 | 500 | 700, number> };
  porcao: { id: string; preco: number };
  opcional: { id: string; preco: number };
  lata: { id: string; preco: number };
  agua: { id: string; preco: number };
  inativo: { id: string };
  tapId: string;
  cardapioId: string;
};

export class Tenant {
  catalog?: Catalog;
  constructor(
    readonly ops: Ops,
    readonly id: string,
    readonly slug: string,
    readonly pointId: string,
    readonly owner: Api,
    readonly ownerEmail: string,
    readonly ownerPassword: string,
  ) {}

  /** Creates an attendant with exactly these permissions and returns a logged-in API session. */
  async staff(label: string, permissions: readonly string[]) {
    const email = `${label.toLowerCase()}-${uniqueSuffix()}@example.invalid`;
    const senha = strongPassword();
    const created = await this.owner.expect(this.owner.post('/api/usuarios', { nome: `${label} QA`, email, senha }), 201, `create ${label}`);
    if (permissions.length) await this.owner.expect(this.owner.patch(`/api/usuarios/${created.id}/permissoes-operacao`, { permissoesOperacao: permissions }), 200, `grant ${label}`);
    const api = await this.ops.login(email, senha, `${label}@${this.slug}`);
    return Object.assign(api, { userId: created.id as string, email, senha });
  }

  async configure(patch: Record<string, unknown>) {
    return this.owner.expect(this.owner.patch('/api/cervejaria/configuracao-operacional', patch), 200, 'configure PDV');
  }

  async seedCatalog(): Promise<Catalog> {
    const o = this.owner;
    const categoria = await o.expect(o.post('/api/operacao/produtos/categorias', { nome: `Cardápio ${uniqueSuffix()}` }), 201, 'categoria');
    const chopePrecos = { 300: 12, 500: 18, 700: 24 } as const;
    const chope = await o.expect(o.post('/api/operacao/produtos', { nome: 'Pilsen QA', categoriaPdvId: categoria.id, formato: 'CHOPE', tipo: 'BEBIDA', precos: [300, 500, 700].map((volumeMl) => ({ volumeMl, preco: chopePrecos[volumeMl as 300] })) }), 201, 'chope');
    const porcao = await o.expect(o.post('/api/operacao/produtos', { nome: 'Porção QA', categoriaPdvId: categoria.id, tipo: 'COMIDA', precoUnit: 30, exigePreparo: true, controlaEstoque: true }), 201, 'porcao');
    const lata = await o.expect(o.post('/api/operacao/produtos', { nome: 'Lata QA', categoriaPdvId: categoria.id, tipo: 'BEBIDA', formato: 'LATA', precoUnit: 8, controlaEstoque: true }), 201, 'lata');
    const agua = await o.expect(o.post('/api/operacao/produtos', { nome: 'Água QA', categoriaPdvId: categoria.id, tipo: 'BEBIDA', formato: 'OUTRO', precoUnit: 5, controlaEstoque: false }), 201, 'agua');
    const inativo = await o.expect(o.post('/api/operacao/produtos', { nome: 'Inativo QA', categoriaPdvId: categoria.id, tipo: 'BEBIDA', formato: 'OUTRO', precoUnit: 9, controlaEstoque: false }), 201, 'inativo');
    await o.expect(o.put(`/api/operacao/produtos/${inativo.id}`, { ativo: false }), 200, 'desativar produto');
    const opcional = await o.expect(o.post('/api/operacao/produtos/opcionais', { nome: 'Bacon QA', preco: 5 }), 201, 'opcional');
    await o.expect(o.put(`/api/operacao/produtos/${porcao.id}/opcionais`, { opcionalIds: [opcional.id] }), 200, 'vincular opcional');
    const tap = await o.expect(o.post('/api/taps', { numero: 1, produtoId: chope.id, pontoVendaId: this.pointId }), 201, 'tap');
    for (const [produtoId, quantidade] of [[chope.id, 50], [porcao.id, 20], [lata.id, 10]] as const) {
      await o.expect(o.post('/api/operacao/estoque/entrada', { pontoVendaId: this.pointId, produtoId, quantidade }), 201, 'estoque inicial');
    }
    const cardapio = await o.expect(o.post('/api/operacao/cardapios', { nome: `Cardápio QA ${uniqueSuffix()}`, produtoIds: [chope.id, porcao.id, lata.id, agua.id] }), 201, 'cardapio');
    this.catalog = {
      categoriaId: categoria.id,
      chope: { id: chope.id, precos: chopePrecos },
      porcao: { id: porcao.id, preco: 30 },
      opcional: { id: opcional.id, preco: 5 },
      lata: { id: lata.id, preco: 8 },
      agua: { id: agua.id, preco: 5 },
      inativo: { id: inativo.id },
      tapId: tap.id,
      cardapioId: cardapio.id,
    };
    return this.catalog;
  }

  async openCash(api: Api = this.owner, trocoInicial = 100) {
    const catalog = this.catalog ?? await this.seedCatalog();
    return api.expect(api.post('/api/operacao/caixa/abrir', { pontoVendaId: this.pointId, trocoInicial, cardapioId: catalog.cardapioId }), 201, 'abrir caixa');
  }

  async cashState(api: Api = this.owner) {
    return api.expect(api.get(`/api/operacao/caixa?pontoVendaId=${this.pointId}`), 200, 'estado do caixa');
  }

  async closeCash(api: Api = this.owner, counts: Partial<Record<'contadoDinheiro' | 'contadoPix' | 'contadoCartaoDebito' | 'contadoCartaoCredito', number>> = {}) {
    const state = await this.cashState(api);
    const expected = state.sessao;
    return api.expect(api.post('/api/operacao/caixa/fechar', {
      pontoVendaId: this.pointId,
      contadoDinheiro: counts.contadoDinheiro ?? expected.gaveta.esperadoDinheiro,
      contadoPix: counts.contadoPix ?? expected.esperado.pix,
      contadoCartaoDebito: counts.contadoCartaoDebito ?? expected.esperado.cartaoDebito,
      contadoCartaoCredito: counts.contadoCartaoCredito ?? expected.esperado.cartaoCredito,
    }), 200, 'fechar caixa');
  }

  chopeItem(volumeMl: 300 | 500 | 700, quantidade = 1) {
    return { produtoId: this.catalog!.chope.id, quantidade, tapId: this.catalog!.tapId, volumeMl };
  }

  porcaoItem(quantidade = 1, extras: Record<string, unknown> = {}) {
    return { produtoId: this.catalog!.porcao.id, quantidade, ...extras };
  }

  item(key: 'lata' | 'agua' | 'inativo', quantidade = 1) {
    return { produtoId: this.catalog![key].id, quantidade };
  }

  async openComanda(api: Api, itens: unknown[], extra: Record<string, unknown> = {}) {
    return api.expect(api.post('/api/operacao/comandas', { pontoVendaId: this.pointId, tipo: 'APELIDO', identificador: `QA ${uniqueSuffix()}`, itens, ...extra }), 201, 'abrir comanda');
  }

  async comanda(api: Api, id: string) {
    return api.expect(api.get(`/api/operacao/comandas/${id}`), 200, 'ler comanda');
  }

  async pay(api: Api, comandaId: string, pagamentos: unknown[], deixarPendente = false) {
    return api.post(`/api/operacao/comandas/${comandaId}/pagamentos`, { pagamentos, deixarPendente });
  }

  async kitchenOrders(api: Api, incluirEntregues = false) {
    return api.expect(api.get(`/api/operacao/cozinha${incluirEntregues ? '?incluirEntregues=true' : ''}`), 200, 'fila da cozinha');
  }

  async advanceKitchen(api: Api, pedidoId: string, path: string[]) {
    let current = 'RECEBIDO';
    for (const status of path) {
      await api.expect(api.patch(`/api/operacao/cozinha/${pedidoId}/status`, { status, expectedStatus: current }), 200, `cozinha ${current}->${status}`);
      current = status;
    }
  }

  async stock(api: Api = this.owner) {
    const body = await api.expect(api.get(`/api/operacao/estoque?pontoVendaId=${this.pointId}`), 200, 'estoque');
    const items = (Array.isArray(body) ? body : body.itens ?? body.produtos ?? []) as Array<Record<string, any>>;
    return (produtoId: string) => {
      const row = items.find((item) => item.produtoId === produtoId || item.id === produtoId);
      return row ? Number(row.quantidade ?? row.saldo ?? 0) : undefined;
    };
  }
}

export class Ops {
  private readonly contexts: APIRequestContext[] = [];
  constructor(readonly evidence: Evidence) {}

  async login(email: string, senha: string, who: string) {
    const ctx = await playwrightRequest.newContext({ baseURL });
    this.contexts.push(ctx);
    const response = await ctx.post('/api/auth/login', { data: { email, senha }, failOnStatusCode: false });
    this.evidence.recordApi({ actor: who, method: 'POST', url: '/api/auth/login', status: response.status() });
    if (response.status() !== 200) throw new Error(`Login ${who} failed: HTTP ${response.status()} ${await response.text()}`);
    return new Api(ctx, who, this.evidence);
  }

  async anonymous(who = 'anonymous') {
    const ctx = await playwrightRequest.newContext({ baseURL });
    this.contexts.push(ctx);
    return new Api(ctx, who, this.evidence);
  }

  admin() {
    return this.login(seed.admin.email, seed.admin.password, 'admin');
  }

  persona(key: 'owner' | 'ownerB' | 'cashier' | 'kitchen' | 'staffB') {
    const user = seed.users[key]!;
    return this.login(user.email, user.password, key);
  }

  /** Provisions an isolated canonical tenant through the Admin API (one PDV, its own cash register). */
  async tenant(enablements: { taps?: boolean; inventory?: boolean; kitchen?: boolean } = {}, settings: Record<string, unknown> = { kitchenItemsChargeAtLaunch: true }) {
    const admin = await this.admin();
    const suffix = uniqueSuffix();
    const email = `owner-${suffix}@example.invalid`;
    const senha = strongPassword();
    const provisioned = await admin.expect(admin.post('/api/admin/cervejarias/provision', {
      nome: `QA Release ${suffix}`,
      dono: { nome: 'Dono QA', email, senha },
      enablements: { plannedOperations: false, taps: enablements.taps ?? true, inventory: enablements.inventory ?? true, kitchen: enablements.kitchen ?? true },
    }), 201, 'provision tenant');
    const tenantId = provisioned.cervejaria.id as string;
    this.evidence.track(tenantId);
    const owner = await this.login(email, senha, `owner@${provisioned.cervejaria.slug}`);
    const pointId = (provisioned.pontoVenda?.id ?? (await owner.expect(owner.get('/api/operacao/contexto'), 200, 'contexto')).pontosVenda[0].id) as string;
    const tenant = new Tenant(this, tenantId, provisioned.cervejaria.slug, pointId, owner, email, senha);
    if (Object.keys(settings).length) await tenant.configure(settings);
    return tenant;
  }

  async dispose() {
    await Promise.all(this.contexts.map((ctx) => ctx.dispose().catch(() => undefined)));
  }
}

export const test = base.extend<{ ops: Ops }>({
  ops: async ({ evidence }, use) => {
    const ops = new Ops(evidence);
    await use(ops);
    await ops.dispose();
  },
});

export { expect, randomUUID };
