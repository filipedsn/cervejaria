import { prisma } from '../../src/lib/prisma.js';
import { api, portalSessao, uniquePortalTestPhone } from './http.js';
import { signToken } from './jwt.js';
import { ensureTenantEventoAberto } from './tenant-evento.js';
import type { QaContext, TenantFixture } from './types.js';

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

/** Cookie de sessão do cliente: 12h de validade, conforme cliente-session.ts. */
const MAX_AGE_ESPERADO = 12 * 60 * 60;

interface SessaoPayload {
  cervejariaId: string;
  eventoId: string;
  trailerId: string;
  clienteId: string;
  comandaId: string;
  portalGeneration: number;
}

/** Ciclo de vida do JWT do portal do cliente (cookie `cliente_token`). */
export async function runPortalJwtTests(ctx: QaContext, test: TestFn) {
  const tenant: TenantFixture | undefined = ctx.tenants[5] ?? ctx.tenants[0];
  if (!tenant) {
    await test(
      { id: 'PJW-01', category: 'Portal JWT', name: 'Seed PJW', requirement: 'PJW' },
      async () => ({ status: 'failed', message: 'Tenant indisponível' }),
    );
    return;
  }

  let base: SessaoPayload | null = null;

  /** Abre uma sessão real e devolve payload equivalente ao que o servidor assina. */
  async function abrirSessao(nome: string, salt: number) {
    await ensureTenantEventoAberto(tenant);
    const sessao = await portalSessao(tenant.slug, tenant.trailerId, {
      nome,
      telefone: uniquePortalTestPhone(72, salt),
    });
    if (sessao.status !== 201 || !sessao.cookie || !sessao.comandaId || !sessao.clienteId) {
      return { sessao, payload: null as SessaoPayload | null };
    }
    const evento = await prisma.evento.findUnique({
      where: { id: tenant.eventoId },
      select: { portalGeneration: true },
    });
    return {
      sessao,
      payload: {
        cervejariaId: tenant.cervejariaId,
        eventoId: tenant.eventoId,
        trailerId: tenant.trailerId,
        clienteId: sessao.clienteId,
        comandaId: sessao.comandaId,
        portalGeneration: evento?.portalGeneration ?? 0,
      },
    };
  }

  function cookieCom(payload: Record<string, unknown>, opts: Parameters<typeof signToken>[1] = {}) {
    return `cliente_token=${signToken({ type: 'cliente', ...payload }, opts)}`;
  }

  await test(
    { id: 'PJW-01', category: 'Portal JWT', name: 'Sessão válida acessa comanda do cliente', requirement: 'PJW-01' },
    async () => {
      const { sessao, payload } = await abrirSessao('QA PJW Base', 1);
      if (!payload) {
        return { status: 'failed', message: 'Abrir sessão', expected: '201', actual: `${sessao.status} ${sessao.raw.slice(0, 120)}` };
      }
      base = payload;

      const r = await api('GET', '/api/public/cliente/comanda', { cookie: sessao.cookie! });
      if (r.status !== 200) {
        return { status: 'failed', message: 'Comanda com cookie válido', expected: '200', actual: String(r.status) };
      }
      return { message: 'Cookie legítimo autentica o portal', expected: '200', actual: '200' };
    },
  );

  await test(
    { id: 'PJW-02', category: 'Portal JWT', name: 'Cookie expirado → 401', requirement: 'PJW-02' },
    async () => {
      if (!base) return { status: 'skipped', message: 'Sessão base indisponível' };

      // exp no passado: assinatura continua válida, só o prazo venceu.
      const r = await api('GET', '/api/public/cliente/comanda', {
        cookie: cookieCom(base, { expiresInSec: -60 }),
      });
      if (r.status !== 401) {
        return { status: 'failed', message: 'Token expirado', expected: '401', actual: `${r.status} ${r.raw.slice(0, 120)}` };
      }
      return { message: 'Token vencido rejeitado', expected: '401', actual: '401' };
    },
  );

  await test(
    { id: 'PJW-03', category: 'Portal JWT', name: 'Set-Cookie com Max-Age de 12h e HttpOnly', requirement: 'PJW-03' },
    async () => {
      const { sessao } = await abrirSessao('QA PJW Cookie', 2);
      if (sessao.status !== 201) {
        return { status: 'failed', message: 'Abrir sessão', expected: '201', actual: String(sessao.status) };
      }

      const header = sessao.setCookies.find((c) => c.startsWith('cliente_token='));
      if (!header) {
        return { status: 'failed', message: 'Set-Cookie ausente', expected: 'cliente_token=...', actual: sessao.setCookies.join(' | ') };
      }

      const maxAge = Number(header.match(/Max-Age=(\d+)/i)?.[1] ?? NaN);
      if (maxAge !== MAX_AGE_ESPERADO) {
        return { status: 'failed', message: 'Max-Age', expected: String(MAX_AGE_ESPERADO), actual: String(maxAge) };
      }
      if (!/HttpOnly/i.test(header)) {
        return { status: 'failed', message: 'Cookie sem HttpOnly', expected: 'HttpOnly', actual: header.slice(0, 160) };
      }
      if (!/SameSite=Lax/i.test(header)) {
        return { status: 'failed', message: 'SameSite', expected: 'SameSite=Lax', actual: header.slice(0, 160) };
      }
      if (!/Path=\//i.test(header)) {
        return { status: 'failed', message: 'Path', expected: 'Path=/', actual: header.slice(0, 160) };
      }

      return { message: 'Max-Age 43200s, HttpOnly, SameSite=Lax', expected: '12h + flags', actual: `${maxAge}s` };
    },
  );

  await test(
    { id: 'PJW-04', category: 'Portal JWT', name: 'Token de outro evento → 401', requirement: 'PJW-04' },
    async () => {
      if (!base) return { status: 'skipped', message: 'Sessão base indisponível' };
      const outro = ctx.tenants.find((t) => t.eventoId !== tenant.eventoId);
      if (!outro) return { status: 'skipped', message: 'Sem segundo evento' };

      const r = await api('GET', '/api/public/cliente/comanda', {
        cookie: cookieCom({ ...base, eventoId: outro.eventoId }, { expiresInSec: 3600 }),
      });
      if (r.status !== 401) {
        return { status: 'failed', message: 'Evento trocado', expected: '401', actual: `${r.status} ${r.raw.slice(0, 120)}` };
      }
      return { message: 'Sessão amarrada ao evento de origem', expected: '401', actual: '401' };
    },
  );

  await test(
    { id: 'PJW-05', category: 'Portal JWT', name: 'portalGeneration antigo → 401', requirement: 'PJW-05' },
    async () => {
      if (!base) return { status: 'skipped', message: 'Sessão base indisponível' };

      const r = await api('GET', '/api/public/cliente/comanda', {
        cookie: cookieCom({ ...base, portalGeneration: base.portalGeneration - 1 }, { expiresInSec: 3600 }),
      });
      if (r.status !== 401) {
        return { status: 'failed', message: 'Geração antiga', expected: '401', actual: `${r.status} ${r.raw.slice(0, 120)}` };
      }
      return { message: 'Geração do portal invalida cookie antigo', expected: '401', actual: '401' };
    },
  );

  await test(
    { id: 'PJW-06', category: 'Portal JWT', name: 'Assinatura com segredo errado → 401', requirement: 'PJW-06' },
    async () => {
      if (!base) return { status: 'skipped', message: 'Sessão base indisponível' };

      const r = await api('GET', '/api/public/cliente/comanda', {
        cookie: cookieCom(base, { expiresInSec: 3600, secret: 'segredo-invalido-qa' }),
      });
      if (r.status !== 401) {
        return { status: 'failed', message: 'Segredo forjado', expected: '401', actual: String(r.status) };
      }
      return { message: 'HMAC divergente rejeitado', expected: '401', actual: '401' };
    },
  );

  await test(
    { id: 'PJW-07', category: 'Portal JWT', name: 'alg=none → 401', requirement: 'PJW-07' },
    async () => {
      if (!base) return { status: 'skipped', message: 'Sessão base indisponível' };

      const r = await api('GET', '/api/public/cliente/comanda', {
        cookie: cookieCom(base, { alg: 'none', expiresInSec: 3600 }),
      });
      if (r.status !== 401) {
        return { status: 'failed', message: 'alg=none aceito', expected: '401', actual: String(r.status) };
      }
      return { message: 'Downgrade de algoritmo bloqueado', expected: '401', actual: '401' };
    },
  );

  await test(
    { id: 'PJW-08', category: 'Portal JWT', name: 'Token de staff não vale como cliente → 401', requirement: 'PJW-08' },
    async () => {
      const r = await api('GET', '/api/public/cliente/comanda', {
        cookie: `cliente_token=${tenant.donoToken}`,
      });
      if (r.status !== 401) {
        return { status: 'failed', message: 'Token de staff aceito no portal', expected: '401', actual: String(r.status) };
      }
      return { message: 'Payload sem type=cliente rejeitado', expected: '401', actual: '401' };
    },
  );

  await test(
    { id: 'PJW-09', category: 'Portal JWT', name: 'Sem cookie → 401', requirement: 'PJW-09' },
    async () => {
      const r = await api('GET', '/api/public/cliente/comanda');
      if (r.status !== 401) {
        return { status: 'failed', message: 'Requisição anônima', expected: '401', actual: String(r.status) };
      }
      return { message: 'Rota do cliente exige cookie', expected: '401', actual: '401' };
    },
  );

  await test(
    {
      id: 'PJW-10',
      category: 'Portal JWT',
      name: 'Comanda fechada invalida a sessão',
      requirement: 'PJW-10',
    },
    async () => {
      const { sessao, payload } = await abrirSessao('QA PJW Fecha', 3);
      if (!payload) {
        return { status: 'failed', message: 'Abrir sessão', expected: '201', actual: String(sessao.status) };
      }

      const antes = await api('GET', '/api/public/cliente/comanda', { cookie: sessao.cookie! });
      if (antes.status !== 200) {
        return { status: 'failed', message: 'Sessão deveria valer antes do fechamento', expected: '200', actual: String(antes.status) };
      }

      await prisma.comanda.update({
        where: { id: payload.comandaId },
        data: { status: 'CANCELADA' },
      });

      const depois = await api('GET', '/api/public/cliente/comanda', { cookie: sessao.cookie! });
      if (depois.status !== 401) {
        return { status: 'failed', message: 'Comanda encerrada', expected: '401', actual: String(depois.status) };
      }
      return { message: 'Encerrar comanda derruba a sessão', expected: '401', actual: '401' };
    },
  );
}
