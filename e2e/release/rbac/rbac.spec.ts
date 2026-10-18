import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from '../support/fixtures';
import { personaContext } from '../support/personas';

const baseURL = process.env.RELEASE_QA_BASE_URL!;
const context = JSON.parse(readFileSync(process.env.RELEASE_QA_CONTEXT!, 'utf8'));
const permissionKeys = [
  'cash.open', 'cash.close', 'cash.values.read', 'cash.movement.write', 'payment.receive', 'debt.receive',
  'command.close', 'discount.apply', 'command.item.cancel', 'command.item.cancel.delivered', 'command.cancel',
  'kitchen.cancel', 'sale.refund', 'dashboard.read', 'event.dashboard.read', 'reports.read', 'command.operate',
  'command.read', 'kitchen.read', 'kitchen.operate', 'inventory.read', 'inventory.adjust', 'catalog.manage',
  'catalog.shift.manage', 'clients.manage', 'taps.operate', 'agenda.manage', 'event.menu.manage',
];
const initialCashierPermissions = ['cash.open', 'cash.close', 'command.read', 'command.operate', 'command.close', 'payment.receive', 'debt.receive', 'discount.apply'];

test('RBAC-S01 concede e revoga as 28 chaves sem novo login', async ({ browser, evidence }) => {
  const owner = await personaContext(browser, baseURL, 'owner');
  const staff = await personaContext(browser, baseURL, 'cashier');
  const failures: string[] = [];
  try {
    for (const permission of permissionKeys) {
      const granted = await owner.request.patch(`/api/usuarios/${context.users.cashier.id}/permissoes-operacao`, { data: { permissoesOperacao: [permission] } });
      evidence.recordApi({ method: 'PATCH', path: '/api/usuarios/:id/permissoes-operacao', status: granted.status(), body: await granted.json().catch(() => null), permission });
      if (granted.status() !== 200) { failures.push(`${permission}: grant HTTP ${granted.status()}`); continue; }
      const live = await staff.request.get('/api/auth/me');
      const liveData = await live.json();
      if (live.status() !== 200 || !liveData.usuario.permissoesOperacao.includes(permission)) failures.push(`${permission}: grant not reflected without relogin`);
      const revoked = await owner.request.patch(`/api/usuarios/${context.users.cashier.id}/permissoes-operacao`, { data: { permissoesOperacao: [] } });
      if (revoked.status() !== 200) { failures.push(`${permission}: revoke HTTP ${revoked.status()}`); continue; }
      const afterRevoke = await staff.request.get('/api/auth/me');
      if ((await afterRevoke.json()).usuario.permissoesOperacao.includes(permission)) failures.push(`${permission}: revoke not reflected without relogin`);
    }
    expect(permissionKeys).toHaveLength(28);
    expect(failures, 'All 28 permissions must grant and revoke through the owner UI contract').toEqual([]);
  } finally {
    await owner.request.patch(`/api/usuarios/${context.users.cashier.id}/permissoes-operacao`, { data: { permissoesOperacao: initialCashierPermissions } });
    await owner.close(); await staff.close();
  }
});

test('RBAC-S02 dono acessa o contexto operacional completo', async ({ browser }) => {
  const owner = await personaContext(browser, baseURL, 'owner');
  try {
    const response = await owner.request.get('/api/operacao/contexto');
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ ativo: true, operationalSettingsSource: 'CANONICAL_PDV', temCozinha: true, controlaEstoque: true });
  } finally { await owner.close(); }
});

test('RBAC-S03 cadastro pelo dono cria sempre ATENDENTE sem acesso inicial', async ({ browser, evidence }) => {
  const owner = await personaContext(browser, baseURL, 'owner');
  try {
    const suffix = randomBytes(10).toString('hex');
    const response = await owner.request.post('/api/usuarios', { data: { nome: 'Novo Atendente QA', email: `new-${suffix}@example.invalid`, senha: `Qa-${randomBytes(24).toString('base64url')}-!` } });
    const body = await response.json();
    evidence.recordApi({ method: 'POST', path: '/api/usuarios', status: response.status(), body });
    expect(response.status()).toBe(201);
    expect(body).toMatchObject({ papel: 'ATENDENTE', permissoesOperacao: [] });
  } finally { await owner.close(); }
});

test('RBAC-X01 sem permissões recebe 403 ao consultar comandas', async ({ browser, evidence }) => {
  const staff = await personaContext(browser, baseURL, 'staffB');
  try {
    const response = await staff.request.get('/api/operacao/comandas');
    evidence.recordApi({ method: 'GET', path: '/api/operacao/comandas', status: response.status(), body: await response.json().catch(() => null) });
    expect(response.status()).toBe(403);
  } finally { await staff.close(); }
});

test('RBAC-X03 e-mail duplicado retorna 409 e preserva os dados', async ({ browser, evidence }) => {
  const owner = await personaContext(browser, baseURL, 'owner');
  try {
    const response = await owner.request.post('/api/usuarios', { data: { nome: 'Duplicado QA', email: context.users.cashier.email, senha: `Qa-${randomBytes(24).toString('base64url')}-!` } });
    evidence.recordApi({ method: 'POST', path: '/api/usuarios', status: response.status(), body: await response.json().catch(() => null) });
    expect(response.status()).toBe(409);
  } finally { await owner.close(); }
});

test('RBAC-X04 atendente não pode editar permissões de si mesmo', async ({ browser, evidence }) => {
  const staff = await personaContext(browser, baseURL, 'cashier');
  try {
    const response = await staff.request.patch(`/api/usuarios/${context.users.cashier.id}/permissoes-operacao`, { data: { permissoesOperacao: [] } });
    evidence.recordApi({ method: 'PATCH', path: '/api/usuarios/:id/permissoes-operacao', status: response.status(), body: await response.json().catch(() => null) });
    expect(response.status()).toBe(403);
  } finally { await staff.close(); }
});

test('RBAC-X05 dono A não altera permissões de atendente da empresa B', async ({ browser, evidence }) => {
  const owner = await personaContext(browser, baseURL, 'owner');
  try {
    const response = await owner.request.patch(`/api/usuarios/${context.users.staffB.id}/permissoes-operacao`, { data: { permissoesOperacao: ['command.read'] } });
    evidence.recordApi({ method: 'PATCH', path: '/api/usuarios/:id/permissoes-operacao', status: response.status(), body: await response.json().catch(() => null) });
    expect(response.status()).toBe(404);
  } finally { await owner.close(); }
});

test('RBAC-X06 dono não edita alvo ADMIN', async ({ browser, evidence }) => {
  const owner = await personaContext(browser, baseURL, 'owner');
  try {
    const response = await owner.request.patch(`/api/usuarios/${context.users.owner.id}/permissoes-operacao`, { data: { permissoesOperacao: ['command.read'] } });
    evidence.recordApi({ method: 'PATCH', path: '/api/usuarios/:id/permissoes-operacao', status: response.status(), body: await response.json().catch(() => null) });
    expect(response.status()).toBe(409);
  } finally { await owner.close(); }
});

test('RBAC-X07 registra a disponibilidade das chaves de evento no canônico', async ({ browser, evidence }) => {
  const owner = await personaContext(browser, baseURL, 'owner');
  const staff = await personaContext(browser, baseURL, 'cashier');
  try {
    const response = await owner.request.patch(`/api/usuarios/${context.users.cashier.id}/permissoes-operacao`, { data: { permissoesOperacao: ['event.dashboard.read', 'event.menu.manage'] } });
    evidence.recordApi({ method: 'PATCH', path: '/api/usuarios/:id/permissoes-operacao', status: response.status(), body: await response.json().catch(() => null) });
    expect(response.status()).toBe(200);
    const current = await staff.request.get('/api/auth/me');
    const user = (await current.json()).usuario;
    expect(user.permissoesOperacao).toEqual(expect.arrayContaining(['event.dashboard.read', 'event.menu.manage']));
    test.info().annotations.push({ type: 'product-decision', description: 'O endpoint aceita e persiste event.dashboard.read/event.menu.manage no usuário canônico; a decisão sobre o efeito dessas chaves nas telas do modelo único permanece pendente.' });
  } finally {
    await owner.request.patch(`/api/usuarios/${context.users.cashier.id}/permissoes-operacao`, { data: { permissoesOperacao: initialCashierPermissions } });
    await owner.close(); await staff.close();
  }
});
