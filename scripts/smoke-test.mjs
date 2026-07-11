const BASE = 'http://localhost:3001';

async function req(method, path, { body, cookie } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json, setCookie };
}

const checks = [];

function ok(name, cond, detail = '') {
  checks.push({ name, pass: !!cond, detail });
  console.log(`${cond ? 'OK' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  const health = await req('GET', '/api/health');
  ok('health', health.status === 200 && health.json?.status === 'ok', String(health.status));

  const login = await req('POST', '/api/auth/login', {
    body: { email: 'dono@demo.com', senha: '123456' },
  });
  ok('login', login.status === 200, String(login.status));
  const cookie = login.setCookie?.split(';')[0] ?? '';
  ok('session cookie', !!cookie);

  const eventos = await req('GET', '/api/eventos', { cookie });
  ok('GET /eventos', eventos.status === 200, String(eventos.status));

  const sessoes = eventos.json?.sessoes ?? [];
  const aberta = sessoes.find((e) => e.status === 'ABERTO') ?? sessoes[0];

  if (aberta) {
    const dash = await req('GET', `/api/eventos/${aberta.id}/dashboard`, { cookie });
    ok('GET dashboard', dash.status === 200, String(dash.status));

    const comandas = await req('GET', `/api/comandas/evento/${aberta.id}?status=ABERTA`, { cookie });
    ok('GET comandas', comandas.status === 200, String(comandas.status));

    const trans = await req('GET', `/api/eventos/${aberta.id}/transacoes?limit=5`, { cookie });
    ok('GET transacoes (dono)', trans.status === 200, String(trans.status));
    ok('transacoes array', Array.isArray(trans.json), typeof trans.json);
  } else {
    console.log('SKIP  sem sessão para testar dashboard/comandas/transacoes');
  }

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} passou`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
