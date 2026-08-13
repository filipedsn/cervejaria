import { api } from './http.js';
import type { QaContext } from './types.js';

type TestStatus = 'passed' | 'failed' | 'skipped' | 'warning';

interface Outcome {
  status?: TestStatus;
  message?: string;
  details?: string;
  expected?: string;
  actual?: string;
}

type TestFn = (
  meta: { id: string; category: string; name: string; requirement?: string },
  fn: () => Promise<Outcome>,
) => Promise<void>;

function hasErrorShape(raw: string): boolean {
  try {
    const body = JSON.parse(raw) as { error?: unknown; stack?: unknown };
    return typeof body.error === 'string' && body.stack === undefined;
  } catch {
    return false;
  }
}

/** Health, readiness, audit UI e contrato de erros HTTP. */
export async function runObsTests(ctx: QaContext, test: TestFn) {
  const token = ctx.tenants[0]?.donoToken;
  if (!token) {
    await test(
      { id: 'OBS-00', category: 'Observabilidade', name: 'Contexto QA', requirement: 'OBS' },
      async () => ({ status: 'failed', message: 'Tenant QA ausente no contexto' }),
    );
    return;
  }

  await test(
    { id: 'OBS-01', category: 'Observabilidade', name: 'GET /api/health responde ok', requirement: 'OBS-01' },
    async () => {
      const r = await api<{ status?: string; timestamp?: string }>('GET', '/api/health');
      if (r.status !== 200 || r.data.status !== 'ok' || !r.data.timestamp) {
        return {
          status: 'failed',
          message: 'Health check indisponível',
          expected: '200 { status: ok, timestamp }',
          actual: `${r.status} ${r.raw.slice(0, 120)}`,
        };
      }
      return { message: 'Health OK', expected: '200', actual: '200' };
    },
  );

  await test(
    { id: 'OBS-02', category: 'Observabilidade', name: 'GET /api/ready quando DB up', requirement: 'OBS-02' },
    async () => {
      const r = await api<{ status?: string }>('GET', '/api/ready');
      if (r.status !== 200 || r.data.status !== 'ready') {
        return {
          status: 'failed',
          message: 'Readiness falhou com DB dev ativo',
          expected: '200 ready',
          actual: `${r.status} ${r.raw.slice(0, 160)}`,
        };
      }
      return { message: 'Ready OK', expected: 'ready', actual: r.data.status };
    },
  );

  await test(
    { id: 'OBS-03', category: 'Observabilidade', name: 'Rota inexistente → 404 JSON sem stack', requirement: 'OBS-03' },
    async () => {
      const r = await api('GET', '/api/rota-inexistente-qa-404', { token });
      if (r.status !== 404) {
        return { status: 'failed', message: '404 esperado', expected: '404', actual: String(r.status) };
      }
      if (!hasErrorShape(r.raw)) {
        return {
          status: 'failed',
          message: 'Corpo 404 deve ser { error } sem stack',
          expected: '{ error: string }',
          actual: r.raw.slice(0, 200),
        };
      }
      return { message: '404 com contrato de erro', expected: '404', actual: '404' };
    },
  );

  await test(
    { id: 'OBS-04', category: 'Observabilidade', name: 'Zod inválido → 400 JSON', requirement: 'OBS-04' },
    async () => {
      const r = await api('POST', '/api/auth/reset-password', { body: { token: 'qa-token', senha: '12' } });
      if (r.status !== 400) {
        return { status: 'failed', message: 'Validação deve retornar 400', expected: '400', actual: String(r.status) };
      }
      if (!hasErrorShape(r.raw)) {
        return {
          status: 'failed',
          message: '400 deve expor { error }',
          expected: '{ error }',
          actual: r.raw.slice(0, 200),
        };
      }
      return { message: 'Validação Zod → 400', expected: '400', actual: '400' };
    },
  );

  await test(
    { id: 'OBS-05', category: 'Observabilidade', name: 'Audit UI sem auth → 401', requirement: 'OBS-05' },
    async () => {
      const r = await api('POST', '/api/audit/events', {
        body: { events: [{ type: 'click', page: '/qa', label: 'teste' }] },
      });
      if (r.status !== 401) {
        return { status: 'failed', message: 'Audit exige sessão', expected: '401', actual: String(r.status) };
      }
      return { message: 'Audit protegido', expected: '401', actual: '401' };
    },
  );

  await test(
    { id: 'OBS-06', category: 'Observabilidade', name: 'Audit UI payload inválido → 400', requirement: 'OBS-06' },
    async () => {
      const r = await api('POST', '/api/audit/events', {
        token,
        body: { events: [{ type: 'click', page: '' }] },
      });
      if (r.status !== 400) {
        return { status: 'failed', message: 'Payload inválido rejeitado', expected: '400', actual: String(r.status) };
      }
      return { message: 'Audit valida payload', expected: '400', actual: '400' };
    },
  );

  await test(
    { id: 'OBS-07', category: 'Observabilidade', name: 'Audit UI evento válido → 204', requirement: 'OBS-07' },
    async () => {
      const r = await api('POST', '/api/audit/events', {
        token,
        body: {
          events: [
            { type: 'page_view', page: '/qa/obs', label: 'QA OBS' },
            { type: 'click', page: '/qa/obs', element: 'btn', label: 'Salvar' },
          ],
        },
      });
      if (r.status !== 204) {
        return {
          status: 'failed',
          message: 'Eventos UI aceitos',
          expected: '204',
          actual: `${r.status} ${r.raw.slice(0, 120)}`,
        };
      }
      return { message: 'Audit UI 204', expected: '204', actual: '204' };
    },
  );

  await test(
    { id: 'OBS-08', category: 'Observabilidade', name: 'Erro de negócio → 4xx { error } sem stack', requirement: 'OBS-08' },
    async () => {
      const r = await api('POST', '/api/comandas', {
        token,
        body: { eventoId: 'evento-inexistente', clienteId: 'x', tipo: 'MESA' },
      });
      if (r.status < 400 || r.status >= 500) {
        return {
          status: 'failed',
          message: 'Regra de negócio deve falhar em 4xx',
          expected: '4xx',
          actual: String(r.status),
        };
      }
      if (!hasErrorShape(r.raw) || r.raw.includes('at ')) {
        return {
          status: 'failed',
          message: 'Resposta 4xx não deve vazar stack trace',
          expected: '{ error } limpo',
          actual: r.raw.slice(0, 240),
        };
      }
      return { message: `Erro de negócio ${r.status}`, expected: '4xx limpo', actual: String(r.status) };
    },
  );

  await test(
    { id: 'OBS-09', category: 'Observabilidade', name: 'JWT inválido → 401 { error }', requirement: 'OBS-09' },
    async () => {
      const r = await api('GET', '/api/eventos', { token: 'Bearer lixo' });
      if (r.status !== 401) {
        return { status: 'failed', message: 'JWT inválido', expected: '401', actual: String(r.status) };
      }
      if (!hasErrorShape(r.raw)) {
        return {
          status: 'failed',
          message: '401 deve usar contrato { error }',
          expected: '{ error }',
          actual: r.raw.slice(0, 200),
        };
      }
      return { message: '401 padronizado', expected: '401', actual: '401' };
    },
  );
}
