import { readFileSync } from 'node:fs';
import { expect, test } from '../support/fixtures';
import { personaContext } from '../support/personas';

const baseURL = process.env.RELEASE_QA_BASE_URL!;
const context = JSON.parse(readFileSync(process.env.RELEASE_QA_CONTEXT!, 'utf8'));

test('CXA-X02 troco inicial negativo é recusado', async ({ browser, evidence }) => {
  const cashier = await personaContext(browser, baseURL, 'cashier');
  try {
    const response = await cashier.request.post('/api/operacao/caixa/abrir', { data: {
      pontoVendaId: context.points['cmr9yis3c0000hvu00q9fe7y1'],
      trailerId: context.trailers['cmr9yis3c0000hvu00q9fe7y1'],
      trocoInicial: -1,
    } });
    const body = await response.json();
    evidence.recordApi({ method: 'POST', path: '/api/operacao/caixa/abrir', status: response.status(), body });
    expect(response.status()).toBe(400);
    expect(body.error).toMatch(/maior|igual|negativ|troco/i);
  } finally { await cashier.close(); }
});

test('CXA-X06 venda sem caixa aberto é recusada', async ({ browser, evidence }) => {
  const cashier = await personaContext(browser, baseURL, 'cashier');
  try {
    const response = await cashier.request.post('/api/operacao/comandas', { data: {
      pontoVendaId: context.points['cmr9yis3c0000hvu00q9fe7y1'],
      tipo: 'APELIDO', identificador: `Sem caixa ${context.runId}`,
    } });
    const body = await response.json().catch(() => ({}));
    evidence.recordApi({ method: 'POST', path: '/api/operacao/comandas', status: response.status(), body });
    expect(response.status()).toBe(400);
    expect(body.error).toMatch(/caixa|turno/i);
  } finally { await cashier.close(); }
});
