import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apiLogin, apiRequest, campoPorRotulo } from './helpers/api';
import { CREDENTIALS } from './helpers/auth';

const adminAuth = path.join(process.cwd(), 'e2e/.auth/admin.json');

/** PNG 1x1 válido — basta para o pipeline de branding extrair a cor. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const stamp = Date.now();
/** Prefixo "QA CFG" gera slug `qa-cfg-…`, varrido pelo cleanup do `qa:setup`. */
const nomeBase = `QA CFG E2E ${stamp}`;
const criadas: string[] = [];

interface CervejariaAdmin {
  id: string;
  nome: string;
  ativo?: boolean;
  logoUrl?: string | null;
  corPrimaria?: string | null;
  modulos: {
    cervejaria: boolean;
    quiosque: boolean;
    quiosqueControlaEstoque: boolean;
    quiosqueTemCozinha: boolean;
  };
}

test.use({ storageState: adminAuth });
test.describe.configure({ mode: 'serial' });

test.describe('Admin — cadastro de cervejarias', () => {
  let logoPath = '';

  test.beforeAll(() => {
    logoPath = path.join(os.tmpdir(), `qa-e2e-logo-${stamp}.png`);
    fs.writeFileSync(logoPath, PNG_1X1);
  });

  test.afterAll(async () => {
    // Sem rota de exclusão no painel: desativa para não liberar login e deixa o
    // cleanup do próximo `qa:setup` remover pelo prefixo do slug.
    const cookie = await apiLogin(CREDENTIALS.admin.email, CREDENTIALS.admin.password);
    for (const id of criadas) {
      await apiRequest('PATCH', `/api/admin/cervejarias/${id}/ativo`, { cookie, body: { ativo: false } });
    }
    fs.rmSync(logoPath, { force: true });
  });

  async function buscarPorNome(nome: string): Promise<CervejariaAdmin | undefined> {
    const cookie = await apiLogin(CREDENTIALS.admin.email, CREDENTIALS.admin.password);
    const r = await apiRequest<CervejariaAdmin[]>('GET', '/api/admin/cervejarias', { cookie });
    return r.data?.find((c) => c.nome === nome);
  }

  test('cadastra empresa só com módulo cervejaria', async ({ page }) => {
    const nome = `${nomeBase} Cervejaria`;
    await page.goto('/admin/cervejarias');
    await page.getByRole('button', { name: '+ Nova Cervejaria' }).click();

    const modal = page.getByRole('dialog');
    await expect(modal.getByText('Cadastrar Cervejaria')).toBeVisible();

    await campoPorRotulo(modal, 'Nome da cervejaria').fill(nome);
    await campoPorRotulo(modal, 'Nome do proprietário').fill('Dono E2E');
    await campoPorRotulo(modal, 'E-mail do proprietário').fill(`qa-e2e-cerv-${stamp}@qa.test`);
    await campoPorRotulo(modal, 'Senha inicial').fill('qa123456');
    await campoPorRotulo(modal, 'Confirmar senha').fill('qa123456');

    // Cervejaria já vem marcada; quiosque permanece desligado.
    await expect(modal.getByRole('checkbox', { name: /^Cervejaria/ })).toBeChecked();
    await modal.getByRole('button', { name: 'Cadastrar' }).click();

    await expect(modal).not.toBeVisible();
    await expect(page.getByText(nome).first()).toBeVisible();

    const criada = await buscarPorNome(nome);
    expect(criada, 'cervejaria criada deve aparecer na API').toBeTruthy();
    expect(criada!.modulos.cervejaria).toBe(true);
    expect(criada!.modulos.quiosque).toBe(false);
    criadas.push(criada!.id);
  });

  test('cadastra quiosque exclusivo com cozinha', async ({ page }) => {
    const nome = `${nomeBase} Quiosque`;
    await page.goto('/admin/cervejarias');
    await page.getByRole('button', { name: '+ Nova Cervejaria' }).click();

    const modal = page.getByRole('dialog');
    await campoPorRotulo(modal, 'Nome da cervejaria').fill(nome);
    await campoPorRotulo(modal, 'Nome do proprietário').fill('Dono Quiosque E2E');
    await campoPorRotulo(modal, 'E-mail do proprietário').fill(`qa-e2e-quiosque-${stamp}@qa.test`);
    await campoPorRotulo(modal, 'Senha inicial').fill('qa123456');
    await campoPorRotulo(modal, 'Confirmar senha').fill('qa123456');

    await modal.getByRole('checkbox', { name: /^Cervejaria/ }).uncheck();
    await modal.getByRole('checkbox', { name: /^Quiosque/ }).check();
    // Submódulos só aparecem depois que o quiosque é ligado.
    await modal.getByRole('checkbox', { name: /^Tem cozinha/ }).check();
    await modal.getByRole('button', { name: 'Cadastrar' }).click();

    await expect(modal).not.toBeVisible();
    const criada = await buscarPorNome(nome);
    expect(criada).toBeTruthy();
    expect(criada!.modulos.cervejaria).toBe(false);
    expect(criada!.modulos.quiosque).toBe(true);
    expect(criada!.modulos.quiosqueTemCozinha).toBe(true);
    criadas.push(criada!.id);

    const linha = page.getByRole('row', { name: new RegExp(nome) });
    await expect(linha.getByText('Quiosque', { exact: true })).toBeVisible();
    await expect(linha.getByText('Cozinha', { exact: true })).toBeVisible();
  });

  test('cadastra híbrida com logo e aplica branding', async ({ page }) => {
    const nome = `${nomeBase} Hibrida`;
    await page.goto('/admin/cervejarias');
    await page.getByRole('button', { name: '+ Nova Cervejaria' }).click();

    const modal = page.getByRole('dialog');
    await campoPorRotulo(modal, 'Nome da cervejaria').fill(nome);
    await modal.locator('input[type="file"]').setInputFiles(logoPath);
    await expect(modal.getByAltText('Prévia da logo')).toBeVisible();

    await campoPorRotulo(modal, 'Nome do proprietário').fill('Dono Híbrida E2E');
    await campoPorRotulo(modal, 'E-mail do proprietário').fill(`qa-e2e-hibrida-${stamp}@qa.test`);
    await campoPorRotulo(modal, 'Senha inicial').fill('qa123456');
    await campoPorRotulo(modal, 'Confirmar senha').fill('qa123456');
    await modal.getByRole('checkbox', { name: /^Quiosque/ }).check();
    await modal.getByRole('button', { name: 'Cadastrar' }).click();

    await expect(modal).not.toBeVisible();
    const criada = await buscarPorNome(nome);
    expect(criada).toBeTruthy();
    expect(criada!.modulos.cervejaria).toBe(true);
    expect(criada!.modulos.quiosque).toBe(true);
    expect(criada!.logoUrl, 'logo enviada deve ser persistida').toBeTruthy();
    expect(criada!.corPrimaria, 'branding extraído da logo').toBeTruthy();
    criadas.push(criada!.id);

    const linha = page.getByRole('row', { name: new RegExp(nome) });
    await expect(linha.getByText('Cervejaria', { exact: true })).toBeVisible();
    await expect(linha.getByText('Quiosque', { exact: true })).toBeVisible();
  });

  test('cadastro sem módulo é bloqueado', async ({ page }) => {
    await page.goto('/admin/cervejarias');
    await page.getByRole('button', { name: '+ Nova Cervejaria' }).click();

    const modal = page.getByRole('dialog');
    await campoPorRotulo(modal, 'Nome da cervejaria').fill(`${nomeBase} SemModulo`);
    await campoPorRotulo(modal, 'Nome do proprietário').fill('Sem Módulo');
    await campoPorRotulo(modal, 'E-mail do proprietário').fill(`qa-e2e-semmodulo-${stamp}@qa.test`);
    await campoPorRotulo(modal, 'Senha inicial').fill('qa123456');
    await campoPorRotulo(modal, 'Confirmar senha').fill('qa123456');
    await modal.getByRole('checkbox', { name: /^Cervejaria/ }).uncheck();
    await modal.getByRole('button', { name: 'Cadastrar' }).click();

    await expect(modal.getByText('Selecione ao menos um módulo para a empresa')).toBeVisible();
    await expect(modal).toBeVisible();
    expect(await buscarPorNome(`${nomeBase} SemModulo`)).toBeUndefined();
  });

  test('senhas divergentes bloqueiam o cadastro', async ({ page }) => {
    await page.goto('/admin/cervejarias');
    await page.getByRole('button', { name: '+ Nova Cervejaria' }).click();

    const modal = page.getByRole('dialog');
    await campoPorRotulo(modal, 'Nome da cervejaria').fill(`${nomeBase} SenhaRuim`);
    await campoPorRotulo(modal, 'Nome do proprietário').fill('Senha Ruim');
    await campoPorRotulo(modal, 'E-mail do proprietário').fill(`qa-e2e-senha-${stamp}@qa.test`);
    await campoPorRotulo(modal, 'Senha inicial').fill('qa123456');
    await campoPorRotulo(modal, 'Confirmar senha').fill('qa654321');
    await modal.getByRole('button', { name: 'Cadastrar' }).click();

    await expect(modal.getByText('As senhas não coincidem')).toBeVisible();
  });
});
