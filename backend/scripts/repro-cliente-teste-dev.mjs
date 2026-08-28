/**
 * Reproduz cenário do cliente Teste em DEV: comanda cancelada → podeExcluir true.
 */
const API = process.env.QA_API_BASE ?? 'http://127.0.0.1:3002';

async function req(method, path, { cookie, body } = {}) {
  const headers = { Accept: 'application/json' };
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const raw = await res.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { raw };
  }
  return { status: res.status, data, setCookie: res.headers.get('set-cookie') };
}

const login = await req('POST', '/api/auth/login', {
  body: { email: 'qa-load-003-dono@qa.test', senha: 'qa123456' },
});
const cookieMatch = login.setCookie?.match(/(?:^|,\s*)token=([^;]+)/);
if ('token' in login.data || !cookieMatch) {
  console.error('FAIL login', login.status);
  process.exit(1);
}
const cookie = `token=${cookieMatch[1]}`;

const ctx = await import('fs').then((fs) =>
  JSON.parse(fs.readFileSync(new URL('../../reports/qa/context.json', import.meta.url), 'utf8')),
);
const t = ctx.tenants[2];
const phone = `117${String(Date.now()).slice(-8)}`;

const created = await req('POST', '/api/clientes', {
  cookie,
  body: { nome: `QA Teste Excluir ${Date.now()}`, telefone: phone },
});
if (created.status !== 201) {
  console.error('FAIL create cliente', created.status, created.data);
  process.exit(1);
}

const comanda = await req('POST', '/api/comandas', {
  cookie,
  body: {
    eventoId: t.eventoId,
    clienteNome: created.data.nome,
    clienteTelefone: phone,
  },
});
if (comanda.status !== 201) {
  console.error('FAIL create comanda', comanda.status, comanda.data);
  process.exit(1);
}

const cancel = await req('POST', `/api/comandas/${comanda.data.id}/cancelar`, {
  cookie,
});
if (cancel.status !== 200) {
  console.error('FAIL cancel comanda', cancel.status, cancel.data);
  process.exit(1);
}

const fetched = await req('GET', `/api/clientes/${created.data.id}`, { cookie });
const c = fetched.data;
console.log('podeExcluir:', c?.podeExcluir);
console.log('motivoExclusao:', c?.motivoExclusao);
console.log('comandasAbertas:', c?.comandasAbertas, 'comandasFechadas:', c?.comandasFechadas);

if (!c?.podeExcluir) {
  console.error('FAIL esperava podeExcluir=true após comanda cancelada');
  process.exit(1);
}

const del = await req('DELETE', `/api/clientes/${created.data.id}`, { cookie });
if (del.status !== 204) {
  console.error('FAIL delete', del.status, del.data);
  process.exit(1);
}

console.log('OK cenário Teste: comanda cancelada → podeExcluir → DELETE 204');
