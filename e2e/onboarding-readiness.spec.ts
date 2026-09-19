import { expect, test } from '@playwright/test';
import { apiLogin, apiRequest } from './helpers/api';
import { CREDENTIALS } from './helpers/auth';

interface Readiness {
  mode: 'CAIXA' | 'EVENTO';
  canConfigure: boolean;
  firstSaleCompleted: boolean;
  modules: {
    quiosque: { enabled: boolean; ready: boolean; missingSteps: Array<{ code: string; complete: boolean }> };
    cervejaria: { enabled: boolean; ready: boolean; missingSteps: Array<{ code: string; complete: boolean }> };
  };
}

test.describe('Onboarding readiness', () => {
  test('exige autenticação e devolve prontidão do tenant autenticado', async () => {
    const anonymous = await apiRequest('GET', '/api/onboarding/readiness');
    expect(anonymous.status).toBe(401);

    const quiosqueCookie = await apiLogin(CREDENTIALS.quiosque.email, CREDENTIALS.quiosque.password);
    const baseline = await apiRequest<Readiness>('GET', '/api/onboarding/readiness', { cookie: quiosqueCookie });
    expect(baseline.status).toBe(200);
    expect(baseline.data.mode).toBe('CAIXA');
    expect(baseline.data.canConfigure).toBe(true);

    // The endpoint has no tenant selector: an arbitrary query value cannot
    // switch its source tenant or leak another company's readiness.
    const forged = await apiRequest<Readiness>('GET', '/api/onboarding/readiness?cervejariaId=tenant-b', {
      cookie: quiosqueCookie,
    });
    expect(forged.status).toBe(200);
    expect(forged.data).toEqual(baseline.data);

    const adminCookie = await apiLogin(CREDENTIALS.admin.email, CREDENTIALS.admin.password);
    const admin = await apiRequest('GET', '/api/onboarding/readiness', { cookie: adminCookie });
    expect(admin.status).toBe(403);
  });

  test('calcula módulos da híbrida separadamente', async () => {
    const cookie = await apiLogin(CREDENTIALS.hibrida.email, CREDENTIALS.hibrida.password);
    const response = await apiRequest<Readiness>('GET', '/api/onboarding/readiness', { cookie });

    expect(response.status).toBe(200);
    expect(response.data.mode).toBe('EVENTO');
    expect(response.data.modules.quiosque.enabled).toBe(false);
    expect(response.data.modules.cervejaria.enabled).toBe(true);
  });

  test('atendente pode consultar sem receber capacidade administrativa', async () => {
    const cookie = await apiLogin(CREDENTIALS.atendente.email, CREDENTIALS.atendente.password);
    const response = await apiRequest<Readiness>('GET', '/api/onboarding/readiness', { cookie });

    expect(response.status).toBe(200);
    expect(response.data.canConfigure).toBe(false);
  });
});
