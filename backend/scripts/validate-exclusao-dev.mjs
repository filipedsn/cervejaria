/**
 * Valida campos de exclusão na listagem e cliente bloqueado (DEV).
 */
const API = process.env.QA_API_BASE ?? 'http://127.0.0.1:3002';

async function req(method, path, { token, body } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
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
  return { status: res.status, data };
}

const ctx = await import('fs').then((fs) =>
  JSON.parse(fs.readFileSync(new URL('../../reports/qa/context.json', import.meta.url), 'utf8')),
);
const t = ctx.tenants[2];
const token = t.donoToken;

const phone = `116${String(Date.now()).slice(-8)}`;
const created = await req('POST', '/api/clientes', {
  token,
  body: { nome: `QA List Excluir ${Date.now()}`, telefone: phone },
});
if (created.status !== 201) {
  console.error('FAIL create', created.status, created.data);
  process.exit(1);
}

const list = await req('GET', '/api/clientes?q=QA List Excluir&limit=5', { token });
const inList = list.data?.items?.find((c) => c.id === created.data.id);
if (!inList?.podeExcluir) {
  console.error('FAIL listagem sem podeExcluir=true', inList);
  process.exit(1);
}
console.log('OK listagem: podeExcluir=true para cliente sem comandas');

const comanda = await req('POST', '/api/comandas', {
  token: t.atendenteTokens[0],
  body: { eventoId: t.eventoId, clienteNome: created.data.nome, clienteTelefone: phone },
});
if (comanda.status !== 201) {
  console.error('FAIL comanda aberta', comanda.status);
  process.exit(1);
}

const blocked = await req('GET', `/api/clientes/${created.data.id}`, { token });
if (blocked.data?.podeExcluir !== false || !blocked.data?.motivoExclusao?.includes('aberta')) {
  console.error('FAIL bloqueio com comanda aberta', blocked.data);
  process.exit(1);
}
console.log('OK bloqueio:', blocked.data.motivoExclusao);

await req('POST', `/api/comandas/${comanda.data.id}/cancelar`, { token: t.atendenteTokens[0] });
const afterCancel = await req('GET', `/api/clientes/${created.data.id}`, { token });
if (!afterCancel.data?.podeExcluir) {
  console.error('FAIL após cancelar', afterCancel.data);
  process.exit(1);
}
console.log('OK após cancelar: podeExcluir=true (UI mostraria lixeira para Dono)');

await req('DELETE', `/api/clientes/${created.data.id}`, { token });
console.log('OK validação exclusão DEV completa');
