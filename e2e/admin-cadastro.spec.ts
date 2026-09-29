import { expect, test } from '@playwright/test';
import path from 'node:path';
import { apiLogin, apiRequest, campoPorRotulo } from './helpers/api';
import { CREDENTIALS } from './helpers/auth';

const adminAuth = path.join(process.cwd(), 'e2e/.auth/admin.json');
const stamp = Date.now();
const nome = `QA Operation Mode ${stamp}`;
let createdId = '';
type Configuration = { plannedOperationsEnabled: boolean | null; tapsEnabled: boolean | null; inventoryEnabled: boolean | null; kitchenEnabled: boolean | null; setupCompletedAt: string | null };

test.use({ storageState: adminAuth });
test.describe.configure({ mode: 'serial' });
test.describe('Admin — cadastro e configuração inicial', () => {
  test.afterAll(async () => {
    if (!createdId) return;
    const cookie = await apiLogin(CREDENTIALS.admin.email, CREDENTIALS.admin.password);
    await apiRequest('PATCH', `/api/admin/cervejarias/${createdId}/ativo`, { cookie, body: { ativo: false } });
  });

  test('cria estabelecimento sem antecipar a configuração do primeiro acesso', async ({ page }) => {
    await page.goto('/admin/cervejarias');
    await page.getByRole('button', { name: '+ Nova Empresa' }).click();
    const modal = page.getByRole('dialog');
    await expect(modal.getByText('Como este estabelecimento trabalha?')).toHaveCount(0);
    await campoPorRotulo(modal, 'Nome da empresa').fill(nome);
    await campoPorRotulo(modal, 'Nome do proprietário').fill('Dono Mode');
    await campoPorRotulo(modal, 'E-mail do proprietário').fill(`qa-e2e-mode-${stamp}@qa.test`);
    await campoPorRotulo(modal, 'Senha inicial').fill('qa123456');
    await campoPorRotulo(modal, 'Confirmar senha').fill('qa123456');
    await modal.getByRole('button', { name: 'Cadastrar' }).click();
    await expect(modal).toBeHidden();
    const cookie = await apiLogin(CREDENTIALS.admin.email, CREDENTIALS.admin.password);
    const list = await apiRequest<Array<{ id: string; nome: string }>>('GET', '/api/admin/cervejarias', { cookie });
    createdId = list.data!.find((item) => item.nome === nome)!.id;
    const config = await apiRequest<Configuration>('GET', `/api/admin/cervejarias/${createdId}/configuracao-operacional`, { cookie });
    expect(config.data).toMatchObject({ plannedOperationsEnabled: null, tapsEnabled: null, inventoryEnabled: null, kitchenEnabled: null, setupCompletedAt: null });
  });
});
