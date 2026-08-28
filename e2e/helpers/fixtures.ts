import fs from 'node:fs';
import path from 'node:path';

export interface ArenaFixture {
  slug: string;
  trailerId: string;
  eventoId: string;
}

const API_BASE = process.env.E2E_API_BASE ?? 'http://localhost:3002';
const CONTEXT_PATH = path.resolve(process.cwd(), 'reports/qa/context.json');

function readContextArena(): ArenaFixture | null {
  try {
    if (!fs.existsSync(CONTEXT_PATH)) return null;
    const ctx = JSON.parse(fs.readFileSync(CONTEXT_PATH, 'utf-8')) as {
      arena?: { slug: string; trailerId: string; eventoId: string };
    };
    if (!ctx.arena?.slug || !ctx.arena.trailerId || !ctx.arena.eventoId) return null;
    return ctx.arena;
  } catch {
    return null;
  }
}

async function discoverArenaViaApi(): Promise<ArenaFixture | null> {
  const loginRes = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email: 'qa-arena-dono@qa.test', senha: 'qa123456' }),
  });
  if (!loginRes.ok) return null;

  const body = (await loginRes.json()) as Record<string, unknown>;
  if ('token' in body) return null;
  const setCookie = loginRes.headers.get('set-cookie');
  const match = setCookie?.match(/(?:^|,\s*)token=([^;]+)/);
  if (!match) return null;

  const eventosRes = await fetch(`${API_BASE}/api/eventos`, {
    headers: { Cookie: `token=${match[1]}`, Accept: 'application/json' },
  });
  if (!eventosRes.ok) return null;

  const eventos = (await eventosRes.json()) as {
    sessoes?: Array<{ id: string; trailerId: string; status: string }>;
  };
  const aberta = eventos.sessoes?.find((s) => s.status === 'ABERTO');
  if (!aberta) return null;

  return { slug: 'qa-arena', trailerId: aberta.trailerId, eventoId: aberta.id };
}

/** Arena QA com evento aberto — requer `npm run qa:setup` ou seed equivalente. */
export async function loadArenaFixture(): Promise<ArenaFixture | null> {
  return readContextArena() ?? (await discoverArenaViaApi());
}

export function uniquePortalPhone(): string {
  const suffix = String(Date.now()).slice(-8);
  return `119${suffix.padStart(8, '0').slice(0, 8)}`;
}
