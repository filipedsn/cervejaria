import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test';

const ownerCookie = process.env.RBAC_QA_OWNER_COOKIE!;
const staffCookie = process.env.RBAC_QA_STAFF_COOKIE!;
const staffId = process.env.RBAC_QA_STAFF_ID!;
const baseURL = process.env.RBAC_QA_BASE_URL!;
const checkpointDir = process.env.RBAC_QA_CHECKPOINT_DIR ?? join(process.env.PDV_QA_TEMP_PARENT ?? process.cwd(), 'checkpoints');
const pendingKeys = [
  'payment.receive', 'debt.receive', 'command.close', 'discount.apply', 'command.item.cancel',
  'command.item.cancel.delivered', 'command.cancel', 'kitchen.cancel', 'sale.refund',
];
const stageStates = new Map<string, Record<string, string>>();
const evidenceByKey = new Map<string, string[]>();

async function saveCheckpoint(key: string, testInfo?: TestInfo) {
  const mode = process.env.PDV_CANONICAL_CONFIG_QA === '0' ? 'LEGACY' : 'CANONICAL_PDV';
  const modeDir = join(checkpointDir, mode.toLowerCase());
  await mkdir(modeDir, { recursive: true });
  const states = stageStates.get(key) ?? {};
  const index = pendingKeys.indexOf(key);
  const completed = ['disabled', 'enabled', 'revoked'].every((stage) => states[stage] === 'PASS');
  const checkpoint = {
    permission: key,
    mode,
    result: testInfo?.status && testInfo.status !== 'passed' ? testInfo.status.toUpperCase() : completed ? 'PASS' : 'IN_PROGRESS',
    stages: states,
    evidence: evidenceByKey.get(key) ?? [],
    nextPending: pendingKeys.slice(Math.max(0, index + 1)),
    testTitle: testInfo?.title,
    updatedAt: new Date().toISOString(),
  };
  const file = join(modeDir, `${key.replaceAll('.', '-')}.json`);
  const temp = `${file}.tmp`;
  await writeFile(temp, `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
  await writeFile(file, await readFile(temp));
  console.log(`RBAC_CHECKPOINT ${JSON.stringify(checkpoint)}`);
}

async function stage(key: string, name: 'disabled' | 'enabled' | 'revoked', evidence: string, testInfo: TestInfo) {
  const states = stageStates.get(key) ?? {};
  states[name] = 'PASS';
  stageStates.set(key, states);
  const entries = evidenceByKey.get(key) ?? [];
  entries.push(`${name}: ${evidence}`);
  evidenceByKey.set(key, entries);
  await saveCheckpoint(key, testInfo);
}

test.afterEach(async ({}, testInfo) => {
  const key = [...pendingKeys].sort((a, b) => b.length - a.length).find((candidate) => testInfo.title.includes(candidate));
  if (key && testInfo.status !== 'passed') await saveCheckpoint(key, testInfo);
});

async function contexts(browser: Browser, permissions: string[] = [], width = 390) {
  const ownerContext = await browser.newContext({ viewport: { width, height: 844 } });
  await ownerContext.addCookies([{ name: 'token', value: ownerCookie.replace(/^token=/, ''), url: baseURL }]);
  const owner = await ownerContext.newPage();
  await owner.goto('/operacao/caixa');
  expect((await ownerContext.request.get('/api/auth/me')).status()).toBe(200);
  await setPermissions(ownerContext, permissions);
  const staffContext = await browser.newContext({ viewport: { width, height: 844 } });
  await staffContext.addCookies([{ name: 'token', value: staffCookie.replace(/^token=/, ''), url: baseURL }]);
  const staff = await staffContext.newPage();
  await staff.goto('/operacao/caixa');
  expect((await staffContext.request.get('/api/auth/me')).status()).toBe(200);
  await expect.poll(async () => (await (await staffContext.request.get('/api/auth/me')).json()).usuario.permissoesOperacao)
    .toEqual(permissions);
  return { ownerContext, staffContext, owner, staff };
}

async function setPermissions(context: BrowserContext, permissions: string[]) {
  const response = await context.request.patch(`/api/usuarios/${staffId}/permissoes-operacao`, { data: { permissoesOperacao: permissions } });
  expect(response.status(), await response.text()).toBe(200);
}

async function command(ownerContext: BrowserContext, id: string) {
  const response = await ownerContext.request.get(`/api/operacao/comandas/${id}`);
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

async function assertDenied(response: { status(): number }) {
  expect([401, 403]).toContain(response.status());
}

async function payThroughUi(staff: Page, commandId: string) {
  await staff.goto(`/operacao/comandas/${commandId}`);
  const close = staff.getByRole('button', { name: /Fechar Comanda/ });
  await expect(close).toBeVisible();
  await expect(close).toBeEnabled();
  await close.click();
  const dialog = staff.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /Revisar pagamento/ }).click();
  await dialog.getByRole('button', { name: /Efetuar pagamento/ }).click();
  await expect.poll(async () => (await commandFromPage(staff, commandId)).status).toBe('FECHADA');
}

async function commandFromPage(staff: Page, commandId: string) {
  const response = await staff.context().request.get(`/api/operacao/comandas/${commandId}`);
  expect(response.status()).toBe(200);
  return response.json();
}

test('payment.receive disabled, enabled and revoked in the same authenticated session', async ({ browser }, testInfo) => {
  const key = 'payment.receive';
  const closeId = process.env.RBAC_QA_PAYMENT_COMMAND_ID!;
  const revokeId = process.env.RBAC_QA_PAYMENT_REVOKE_COMMAND_ID!;
  const deps = ['command.read', 'command.close'];
  const { ownerContext, staffContext, staff } = await contexts(browser, deps);
  const before = await command(ownerContext, closeId);
  const denied = await staffContext.request.post(`/api/operacao/comandas/${closeId}/pagamentos`, { data: { pagamentos: [{ forma: 'PIX', valor: 10 }], deixarPendente: false } });
  await assertDenied(denied);
  const afterDenied = await command(ownerContext, closeId);
  expect({ status: afterDenied.status, payments: afterDenied.pagamentos }).toEqual({ status: before.status, payments: before.pagamentos });
  await staff.goto(`/operacao/comandas/${closeId}`);
  await expect(staff.getByRole('button', { name: /Fechar Comanda/ })).toBeDisabled();
  await stage(key, 'disabled', 'command.close retained; payment API denied and command/payment state unchanged; UI close action disabled', testInfo);
  await setPermissions(ownerContext, [...deps, key]);
  await staff.reload();
  await payThroughUi(staff, closeId);
  const paid = await command(ownerContext, closeId);
  expect(paid.status).toBe('FECHADA');
  expect(paid.pagamentos).toHaveLength(1);
  expect(paid.pagamentos[0]).toMatchObject({ forma: 'PIX', valor: 10 });
  await stage(key, 'enabled', `real UI payment persisted once; command=${paid.status}; actor=staff`, testInfo);
  await setPermissions(ownerContext, deps);
  await staff.reload();
  await staff.goto(`/operacao/comandas/${revokeId}`);
  await expect(staff.getByRole('button', { name: /Fechar Comanda/ })).toBeDisabled();
  const revokeBefore = await command(ownerContext, revokeId);
  const revoked = await staffContext.request.post(`/api/operacao/comandas/${revokeId}/pagamentos`, { data: { pagamentos: [{ forma: 'PIX', valor: 10 }], deixarPendente: false } });
  await assertDenied(revoked);
  const revokeAfter = await command(ownerContext, revokeId);
  expect(revokeAfter).toMatchObject({ status: revokeBefore.status, pagamentos: revokeBefore.pagamentos });
  await stage(key, 'revoked', 'same staff session lost close action and API payment; separate command remained unchanged', testInfo);
  await Promise.all([ownerContext.close(), staffContext.close()]);
});

test('debt.receive disabled, partial receipt, and same-session revoke', async ({ browser }, testInfo) => {
  const key = 'debt.receive';
  const debtId = process.env.RBAC_QA_DEBT_ID!;
  const name = process.env.RBAC_QA_DEBT_CUSTOMER_NAME!;
  const { ownerContext, staffContext, staff } = await contexts(browser);
  const url = `/api/operacao/contas-pendentes/${debtId}/pagamentos`;
  const body = { pontoVendaId: (await (await staffContext.request.get('/api/operacao/contexto')).json()).pontosVenda[0].id, pagamentos: [{ forma: 'PIX', valor: 5 }] };
  const deniedList = await staffContext.request.get('/api/operacao/contas-pendentes');
  await assertDenied(deniedList as never);
  const denied = await staffContext.request.post(url, { data: body });
  await assertDenied(denied);
  const ownerList = await ownerContext.request.get('/api/operacao/contas-pendentes');
  expect(ownerList.status()).toBe(200);
  expect((await ownerList.json()).find((account: { id: string }) => account.id === debtId).pagamentos).toHaveLength(0);
  await staff.goto('/operacao/contas-pendentes');
  await expect(staff.getByRole('button', { name: /Receber pagamento/ })).toHaveCount(0);
  await stage(key, 'disabled', 'operational debt list/payment API denied; no payment persisted; route inaccessible', testInfo);
  await setPermissions(ownerContext, [key]);
  await staff.reload();
  await staff.goto('/operacao/contas-pendentes');
  await expect(staff.getByRole('heading', { name: 'Contas pendentes' })).toBeVisible();
  const account = staff.locator('article').filter({ hasText: name }).first();
  await expect(account).toBeVisible();
  const receiveButton = account.getByRole('button', { name: 'Receber pagamento' });
  if (await receiveButton.count() === 0) await account.getByRole('button', { name: /Ver detalhes de/ }).click();
  await account.getByRole('button', { name: 'Receber pagamento' }).click();
  const dialog = staff.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder('R$ 0,00').fill('5,00');
  await dialog.getByRole('button', { name: /Revisar recebimento/ }).click();
  const receive = dialog.getByRole('button', { name: /Registrar recebimento/ });
  await receive.click();
  await expect.poll(async () => {
    const response = await ownerContext.request.get('/api/operacao/contas-pendentes');
    return (await response.json()).find((entry: { id: string }) => entry.id === debtId)?.recebido;
  }).toBe(5);
  const afterGrantList = await ownerContext.request.get('/api/operacao/contas-pendentes');
  const afterGrant = (await afterGrantList.json()).find((entry: { id: string }) => entry.id === debtId);
  expect(afterGrant.recebido).toBe(5);
  expect(afterGrant.saldo).toBe(5);
  expect(afterGrant.pagamentos).toHaveLength(1);
  expect(afterGrant.pagamentos[0].registradoPorId).toBe(staffId);
  await stage(key, 'enabled', 'partial R$5 receipt via real UI persisted with staff actor; saldo R$5', testInfo);
  await setPermissions(ownerContext, []);
  await staff.reload();
  await staff.goto('/operacao/contas-pendentes');
  await expect(staff.getByRole('button', { name: /Receber pagamento/ })).toHaveCount(0);
  const revoked = await staffContext.request.post(url, { data: body });
  await assertDenied(revoked);
  const finalList = await ownerContext.request.get('/api/operacao/contas-pendentes');
  const finalAccount = (await finalList.json()).find((entry: { id: string }) => entry.id === debtId);
  expect(finalAccount.pagamentos).toHaveLength(1);
  expect(finalAccount.saldo).toBe(5);
  await stage(key, 'revoked', 'same session lost debt page and API permission; balance and payment count unchanged', testInfo);
  await Promise.all([ownerContext.close(), staffContext.close()]);
});

test('command.close disabled, enabled and revoked with payment.receive retained', async ({ browser }, testInfo) => {
  const key = 'command.close';
  const allowedId = process.env.RBAC_QA_CLOSE_COMMAND_ID!;
  const revokedId = process.env.RBAC_QA_CLOSE_REVOKE_COMMAND_ID!;
  const deps = ['command.read', 'payment.receive'];
  const { ownerContext, staffContext, staff } = await contexts(browser, deps);
  const before = await command(ownerContext, allowedId);
  const denied = await staffContext.request.post(`/api/operacao/comandas/${allowedId}/pagamentos`, { data: { pagamentos: [{ forma: 'PIX', valor: 10 }], deixarPendente: false } });
  await assertDenied(denied);
  expect((await command(ownerContext, allowedId)).status).toBe(before.status);
  await staff.goto(`/operacao/comandas/${allowedId}`);
  await expect(staff.getByRole('button', { name: /Fechar Comanda/ })).toBeDisabled();
  await stage(key, 'disabled', 'payment.receive retained; command close API denied and UI control disabled', testInfo);
  await setPermissions(ownerContext, [...deps, key]);
  await staff.reload();
  await payThroughUi(staff, allowedId);
  const afterGrant = await command(ownerContext, allowedId);
  expect(afterGrant.status).toBe('FECHADA');
  expect(afterGrant.pagamentos).toHaveLength(1);
  expect(afterGrant.pagamentos[0]).toMatchObject({ forma: 'PIX', valor: 10 });
  await stage(key, 'enabled', 'real UI closed the command and persisted its payment; database actor is checked by the isolated runner', testInfo);
  await setPermissions(ownerContext, deps);
  await staff.reload();
  await staff.goto(`/operacao/comandas/${revokedId}`);
  await expect(staff.getByRole('button', { name: /Fechar Comanda/ })).toBeDisabled();
  const beforeRevoke = await command(ownerContext, revokedId);
  const revoked = await staffContext.request.post(`/api/operacao/comandas/${revokedId}/pagamentos`, { data: { pagamentos: [{ forma: 'PIX', valor: 10 }], deixarPendente: false } });
  await assertDenied(revoked);
  expect(await command(ownerContext, revokedId)).toMatchObject({ status: beforeRevoke.status, pagamentos: beforeRevoke.pagamentos });
  await stage(key, 'revoked', 'same session lost close control while payment.receive remained; denial made no writes', testInfo);
  await Promise.all([ownerContext.close(), staffContext.close()]);
});

test('discount.apply disabled, enabled and revoked while close and payment remain granted', async ({ browser }, testInfo) => {
  const key = 'discount.apply';
  const allowedId = process.env.RBAC_QA_DISCOUNT_COMMAND_ID!;
  const revokedId = process.env.RBAC_QA_DISCOUNT_REVOKE_COMMAND_ID!;
  const deps = ['command.read', 'command.close', 'payment.receive'];
  const { ownerContext, staffContext, staff } = await contexts(browser, deps);
  const before = await command(ownerContext, allowedId);
  const denied = await staffContext.request.patch(`/api/operacao/comandas/${allowedId}/desconto`, { data: { desconto: 2.5 } });
  await assertDenied(denied);
  expect((await command(ownerContext, allowedId)).desconto).toBe(before.desconto);
  await staff.goto(`/operacao/comandas/${allowedId}`);
  await staff.getByRole('button', { name: /Fechar Comanda/ }).click();
  await expect(staff.getByLabel('Desconto')).toHaveCount(0);
  await stage(key, 'disabled', 'financial dependencies retained; direct discount API denied and discount control absent', testInfo);
  await setPermissions(ownerContext, [...deps, key]);
  await staff.reload();
  await staff.goto(`/operacao/comandas/${allowedId}`);
  await staff.getByRole('button', { name: /Fechar Comanda/ }).click();
  const discount = staff.getByLabel('Desconto');
  await expect(discount).toBeVisible();
  await discount.fill('2,50');
  await expect(discount).toHaveValue(/2,50/);
  const dialog = staff.getByRole('dialog');
  await expect(dialogTotalWithDiscount(staff)).toContainText(/7,50/);
  await dialog.getByRole('button', { name: /Revisar pagamento/ }).click();
  await dialog.getByRole('button', { name: /Efetuar pagamento/ }).click();
  await expect.poll(async () => (await command(ownerContext, allowedId)).status).toBe('FECHADA');
  const persisted = await command(ownerContext, allowedId);
  expect(Number(persisted.desconto)).toBe(2.5);
  expect(persisted.status).toBe('FECHADA');
  await stage(key, 'enabled', 'real UI applied R$2.50 discount and closed with exact discounted payment', testInfo);
  await setPermissions(ownerContext, deps);
  await staff.reload();
  await staff.goto(`/operacao/comandas/${revokedId}`);
  await staff.getByRole('button', { name: /Fechar Comanda/ }).click();
  await expect(staff.getByLabel('Desconto')).toHaveCount(0);
  const revokeBefore = await command(ownerContext, revokedId);
  const revoked = await staffContext.request.patch(`/api/operacao/comandas/${revokedId}/desconto`, { data: { desconto: 2.5 } });
  await assertDenied(revoked);
  expect((await command(ownerContext, revokedId)).desconto).toBe(revokeBefore.desconto);
  await stage(key, 'revoked', 'same authenticated session lost discount field and PATCH; stored discount unchanged', testInfo);
  await Promise.all([ownerContext.close(), staffContext.close()]);
});

function dialogTotalWithDiscount(staff: Page) {
  return staff.getByRole('dialog').getByText('Total com desconto').locator('..');
}

test('command.item.cancel disabled, enabled and revoked with command.read retained', async ({ browser }, testInfo) => {
  const key = 'command.item.cancel';
  const allowedId = process.env.RBAC_QA_ITEM_CANCEL_COMMAND_ID!;
  const revokedId = process.env.RBAC_QA_ITEM_CANCEL_REVOKE_COMMAND_ID!;
  const deps = ['command.read'];
  const { ownerContext, staffContext, staff } = await contexts(browser, deps);
  const before = await command(ownerContext, allowedId);
  const item = before.pedidos[0].itens[0];
  const denied = await staffContext.request.patch(`/api/operacao/comandas/${allowedId}/itens/${item.id}`, { data: { quantidade: 1 } });
  await assertDenied(denied);
  expect((await command(ownerContext, allowedId)).pedidos[0].itens[0].quantidade).toBe(2);
  await staff.goto(`/operacao/comandas/${allowedId}`);
  await expect(staff.getByRole('button', { name: new RegExp(`Remover um ${item.nome}`) })).toBeDisabled();
  await stage(key, 'disabled', 'quantity reduction API denied and remove-one control disabled; quantity stayed 2', testInfo);
  await setPermissions(ownerContext, [...deps, key]);
  await staff.reload();
  await staff.goto(`/operacao/comandas/${allowedId}`);
  await staff.getByRole('button', { name: new RegExp(`Remover um ${item.nome}`) }).click();
  await expect.poll(async () => (await command(ownerContext, allowedId)).pedidos[0].itens[0].quantidade).toBe(1);
  const afterGrant = await command(ownerContext, allowedId);
  expect(afterGrant.pedidos[0].itens[0].quantidade).toBe(1);
  await stage(key, 'enabled', 'real UI reduced one of two units; command total and item quantity persisted', testInfo);
  await setPermissions(ownerContext, deps);
  await staff.reload();
  await staff.goto(`/operacao/comandas/${revokedId}`);
  const revokeBefore = await command(ownerContext, revokedId);
  const revokeItem = revokeBefore.pedidos[0].itens[0];
  await expect(staff.getByRole('button', { name: new RegExp(`Remover um ${revokeItem.nome}`) })).toBeDisabled();
  const revoked = await staffContext.request.patch(`/api/operacao/comandas/${revokedId}/itens/${revokeItem.id}`, { data: { quantidade: 1 } });
  await assertDenied(revoked);
  expect((await command(ownerContext, revokedId)).pedidos[0].itens[0].quantidade).toBe(2);
  await stage(key, 'revoked', 'same session lost remove control and quantity PATCH; item remained quantity 2', testInfo);
  await Promise.all([ownerContext.close(), staffContext.close()]);
});

test('command.item.cancel.delivered requires common permission and revokes during the session', async ({ browser }, testInfo) => {
  const key = 'command.item.cancel.delivered';
  const allowedId = process.env.RBAC_QA_DELIVERED_CANCEL_COMMAND_ID!;
  const allowedItemId = process.env.RBAC_QA_DELIVERED_CANCEL_ITEM_ID!;
  const revokedId = process.env.RBAC_QA_DELIVERED_CANCEL_REVOKE_COMMAND_ID!;
  const revokedItemId = process.env.RBAC_QA_DELIVERED_CANCEL_REVOKE_ITEM_ID!;
  const deps = ['command.read', 'command.item.cancel'];
  const { ownerContext, staffContext, staff } = await contexts(browser, deps);
  const payload = { quantidade: 1, quantidadeEsperada: 2, motivo: 'QA delivered item permission', tratamentoEstoque: 'PREPARADO_ENTREGUE_OU_PERDIDO', idempotencyKey: crypto.randomUUID() };
  const before = await command(ownerContext, allowedId);
  const denied = await staffContext.request.delete(`/api/operacao/comandas/${allowedId}/itens/${allowedItemId}`, { data: payload });
  await assertDenied(denied);
  expect((await command(ownerContext, allowedId)).pedidos[0].itens[0].quantidade).toBe(before.pedidos[0].itens[0].quantidade);
  await staff.goto(`/operacao/comandas/${allowedId}`);
  await expect(staff.getByRole('button', { name: /^Remover / })).toHaveCount(0);
  await stage(key, 'disabled', 'common cancel permission retained; delivered-specific API denied and no removal control shown', testInfo);
  await setPermissions(ownerContext, [...deps, key]);
  await staff.reload();
  await staff.goto(`/operacao/comandas/${allowedId}`);
  await staff.getByRole('button', { name: /^Remover / }).click();
  const dialog = staff.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Cancelar item já entregue' })).toBeVisible();
  await dialog.getByLabel('Motivo obrigatório').fill(payload.motivo);
  await dialog.getByLabel('Quantidade a cancelar').fill('1');
  await dialog.getByRole('button', { name: 'Confirmar cancelamento' }).click();
  await expect.poll(async () => (await command(ownerContext, allowedId)).pedidos[0].itens[0].quantidade).toBe(1);
  const afterGrant = await command(ownerContext, allowedId);
  expect(afterGrant.pedidos[0].itens[0].cancelamentosEntregue).toHaveLength(1);
  expect(afterGrant.pedidos[0].itens[0].cancelamentosEntregue[0].motivo).toBe(payload.motivo);
  await stage(key, 'enabled', 'real UI cancelled one delivered unit; reason/audit persisted and remaining quantity stayed 1', testInfo);
  await setPermissions(ownerContext, deps);
  await staff.reload();
  await staff.goto(`/operacao/comandas/${revokedId}`);
  await expect(staff.getByRole('button', { name: /^Remover / })).toHaveCount(0);
  const revoked = await staffContext.request.delete(`/api/operacao/comandas/${revokedId}/itens/${revokedItemId}`, { data: { ...payload, idempotencyKey: crypto.randomUUID() } });
  await assertDenied(revoked);
  expect((await command(ownerContext, revokedId)).pedidos[0].itens[0].quantidade).toBe(2);
  await stage(key, 'revoked', 'same session retained common cancel but lost delivered-specific control; API denial preserved 2 units', testInfo);
  await Promise.all([ownerContext.close(), staffContext.close()]);
});

test('command.cancel disabled, enabled and revoked for eligible empty commands', async ({ browser }, testInfo) => {
  const key = 'command.cancel';
  const allowedId = process.env.RBAC_QA_COMMAND_CANCEL_COMMAND_ID!;
  const revokedId = process.env.RBAC_QA_COMMAND_CANCEL_REVOKE_COMMAND_ID!;
  const deps = ['command.read'];
  const { ownerContext, staffContext, staff } = await contexts(browser, deps);
  const before = await command(ownerContext, allowedId);
  const denied = await staffContext.request.post(`/api/operacao/comandas/${allowedId}/cancelar`);
  await assertDenied(denied);
  expect((await command(ownerContext, allowedId)).status).toBe(before.status);
  await staff.goto(`/operacao/comandas/${allowedId}`);
  await expect(staff.getByRole('button', { name: 'Encerrar comanda' })).toHaveCount(0);
  await stage(key, 'disabled', 'empty command eligible; API denied and full-command cancellation action absent', testInfo);
  await setPermissions(ownerContext, [...deps, key]);
  await staff.reload();
  await staff.goto(`/operacao/comandas/${allowedId}`);
  await staff.getByRole('button', { name: 'Encerrar comanda' }).click();
  await expect.poll(async () => (await command(ownerContext, allowedId)).status).toBe('CANCELADA');
  const afterGrant = await command(ownerContext, allowedId);
  expect(afterGrant.status).toBe('CANCELADA');
  expect(afterGrant.pedidos).toHaveLength(0);
  await stage(key, 'enabled', 'real UI cancelled only the empty eligible command; no items or payments were created', testInfo);
  await setPermissions(ownerContext, deps);
  await staff.reload();
  await staff.goto(`/operacao/comandas/${revokedId}`);
  const revokeBefore = await command(ownerContext, revokedId);
  const revoked = await staffContext.request.post(`/api/operacao/comandas/${revokedId}/cancelar`);
  await assertDenied(revoked);
  expect((await command(ownerContext, revokedId)).status).toBe(revokeBefore.status);
  await stage(key, 'revoked', 'same session lost full cancellation; second eligible command remained open', testInfo);
  await Promise.all([ownerContext.close(), staffContext.close()]);
});

test('kitchen.cancel requires sale.refund and revokes while the session stays logged in', async ({ browser }, testInfo) => {
  const key = 'kitchen.cancel';
  const orderId = process.env.RBAC_QA_KITCHEN_CANCEL_ORDER_ID!;
  const itemName = process.env.RBAC_QA_KITCHEN_CANCEL_ITEM_NAME!;
  const deps = ['kitchen.read', 'sale.refund'];
  const { ownerContext, staffContext, staff } = await contexts(browser, deps);
  const queueUrl = '/api/operacao/cozinha';
  const statusUrl = `/api/operacao/cozinha/${orderId}/status`;
  const denied = await staffContext.request.patch(statusUrl, { data: { status: 'CANCELAMENTO_PENDENTE' } });
  await assertDenied(denied);
  const deniedQueue = await staffContext.request.get(queueUrl);
  expect(deniedQueue.status()).toBe(200);
  expect((await deniedQueue.json()).find((order: { id: string }) => order.id === orderId).status).toBe('RECEBIDO');
  await staff.goto('/operacao/cozinha');
  const card = staff.locator('article:visible').filter({ hasText: itemName }).first();
  await expect(card).toBeVisible();
  await expect(card.getByRole('button', { name: 'Cancelar pedido' })).toHaveCount(0);
  await stage(key, 'disabled', 'sale.refund retained; queue is readable but cancel control and status transition are denied', testInfo);
  await setPermissions(ownerContext, [...deps, key]);
  await staff.reload();
  expect((await (await staffContext.request.get('/api/auth/me')).json()).usuario.permissoesOperacao).toEqual([...deps, key]);
  await staff.goto('/operacao/cozinha');
  await expect.poll(() => new URL(staff.url()).pathname).toBe('/operacao/cozinha');
  const allowedCard = staff.locator('article:visible').filter({ hasText: itemName }).first();
  await allowedCard.getByRole('button', { name: 'Cancelar pedido' }).click();
  const dialog = staff.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Solicitar cancelamento' }).click();
  await expect.poll(async () => (await (await staffContext.request.get(queueUrl)).json()).find((order: { id: string }) => order.id === orderId).status).toBe('CANCELAMENTO_PENDENTE');
  await stage(key, 'enabled', 'real kitchen UI requested cancellation; order status persisted as CANCELAMENTO_PENDENTE', testInfo);
  await setPermissions(ownerContext, deps);
  await staff.reload();
  const revokedOrderId = process.env.RBAC_QA_KITCHEN_CANCEL_REVOKE_ORDER_ID!;
  const revokedItemName = process.env.RBAC_QA_KITCHEN_CANCEL_REVOKE_ITEM_NAME!;
  await staff.goto('/operacao/cozinha');
  const revokedCard = staff.locator('article:visible').filter({ hasText: revokedItemName }).first();
  await expect(revokedCard).toBeVisible();
  await expect(revokedCard.getByRole('button', { name: 'Cancelar pedido' })).toHaveCount(0);
  const revoked = await staffContext.request.patch(`/api/operacao/cozinha/${revokedOrderId}/status`, { data: { status: 'CANCELAMENTO_PENDENTE' } });
  await assertDenied(revoked);
  expect((await (await staffContext.request.get(queueUrl)).json()).find((order: { id: string }) => order.id === revokedOrderId).status).toBe('RECEBIDO');
  await stage(key, 'revoked', 'same session kept kitchen.read/sale.refund but lost kitchen.cancel; second order remained RECEBIDO', testInfo);
  await Promise.all([ownerContext.close(), staffContext.close()]);
});

test('sale.refund requires kitchen.cancel and revokes same-session confirmation', async ({ browser }, testInfo) => {
  const key = 'sale.refund';
  const orderId = process.env.RBAC_QA_REFUND_ORDER_ID!;
  const itemName = process.env.RBAC_QA_REFUND_ITEM_NAME!;
  const deps = ['kitchen.read', 'kitchen.cancel'];
  const { ownerContext, staffContext, staff } = await contexts(browser, deps);
  const queueUrl = '/api/operacao/cozinha';
  const statusUrl = `/api/operacao/cozinha/${orderId}/status`;
  const before = await staffContext.request.get(queueUrl);
  expect(before.status()).toBe(200);
  expect((await before.json()).find((order: { id: string }) => order.id === orderId).status).toBe('CANCELAMENTO_PENDENTE');
  const denied = await staffContext.request.patch(statusUrl, { data: { status: 'CANCELADO' } });
  await assertDenied(denied);
  await staff.goto('/operacao/cozinha');
  const card = staff.locator('article:visible').filter({ hasText: itemName }).first();
  await expect(card).toBeVisible();
  await expect(card.getByRole('button', { name: 'Confirmar cancelamento' })).toHaveCount(0);
  await stage(key, 'disabled', 'kitchen.cancel retained; sale/refund confirmation denied and pending order preserved', testInfo);
  await setPermissions(ownerContext, [...deps, key]);
  await staff.reload();
  expect((await (await staffContext.request.get('/api/auth/me')).json()).usuario.permissoesOperacao).toEqual([...deps, key]);
  await staff.goto('/operacao/cozinha');
  await expect.poll(() => new URL(staff.url()).pathname).toBe('/operacao/cozinha');
  const allowedCard = staff.locator('article:visible').filter({ hasText: itemName }).first();
  await allowedCard.getByRole('button', { name: 'Confirmar cancelamento' }).click();
  await expect.poll(async () => (await (await staffContext.request.get(queueUrl)).json()).find((order: { id: string }) => order.id === orderId).status).toBe('CANCELADO');
  const commandId = process.env.RBAC_QA_REFUND_COMMAND_ID!;
  const afterGrant = await command(ownerContext, commandId);
  expect(afterGrant.pagamentos.some((payment: { valor: string | number }) => Number(payment.valor) < 0)).toBe(true);
  await stage(key, 'enabled', 'real UI confirmed paid-sale cancellation; negative refund payment persisted', testInfo);
  await setPermissions(ownerContext, deps);
  await staff.reload();
  const revokedOrderId = process.env.RBAC_QA_REFUND_REVOKE_ORDER_ID!;
  await staff.goto('/operacao/cozinha');
  const revokedCard = staff.locator('article:visible').filter({ hasText: process.env.RBAC_QA_REFUND_REVOKE_ITEM_NAME! }).first();
  await expect(revokedCard.getByRole('button', { name: 'Confirmar cancelamento' })).toHaveCount(0);
  const revoked = await staffContext.request.patch(`/api/operacao/cozinha/${revokedOrderId}/status`, { data: { status: 'CANCELADO' } });
  await assertDenied(revoked);
  expect((await (await staffContext.request.get(queueUrl)).json()).find((order: { id: string }) => order.id === revokedOrderId).status).toBe('CANCELAMENTO_PENDENTE');
  await stage(key, 'revoked', 'same session retained kitchen.cancel but lost sale.refund; second paid cancellation stayed pending', testInfo);
  await Promise.all([ownerContext.close(), staffContext.close()]);
});
