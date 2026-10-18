import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from '../support/fixtures';
import { personaContext } from '../support/personas';

const baseURL = process.env.RELEASE_QA_BASE_URL!;
const context = JSON.parse(readFileSync(process.env.RELEASE_QA_CONTEXT!, 'utf8'));

test('ADM-S02 empresa provisionada pelo Admin nasce em PDV canônico', async ({ browser, evidence }) => {
  const admin = await personaContext(browser, baseURL, 'admin');
  const suffix = randomBytes(10).toString('hex');
  const password = `Qa-${randomBytes(24).toString('base64url')}-!`;
  try {
    const provision = await admin.request.post('/api/admin/cervejarias/provision', { data: {
      nome: `Empresa Canônica ${suffix}`,
      dono: { nome: 'Dono Provisionado QA', email: `owner-${suffix}@example.invalid`, senha: password },
      enablements: { plannedOperations: false, taps: true, inventory: true, kitchen: true },
    } });
    const provisionBody = await provision.json();
    evidence.recordApi({ method: 'POST', path: '/api/admin/cervejarias/provision', status: provision.status(), body: provisionBody });
    expect(provision.status()).toBe(201);
    const owner = await admin.request.post('/api/auth/login', { data: { email: `owner-${suffix}@example.invalid`, senha: password } });
    expect(owner.status()).toBe(200);
    const configuration = await admin.request.get('/api/cervejaria/configuracao-operacional');
    const configurationBody = await configuration.json();
    evidence.recordApi({ method: 'GET', path: '/api/cervejaria/configuracao-operacional', status: configuration.status(), body: configurationBody });
    expect(configuration.status()).toBe(200);
    expect(configurationBody.configurationSource).toBe('CANONICAL_PDV');
    expect(configurationBody.configurationSource).not.toBe('LEGACY');
  } finally { await admin.close(); }
});
