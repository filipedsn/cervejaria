/**
 * Smoke test — pagamento conjunto (espelha fluxo da ComandasPage).
 * Uso: npx tsx qa/smoke-pagamento-conjunto.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { api, chopeItemBody, staffComandaBody } from './lib/http.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ctx = JSON.parse(readFileSync(path.join(__dirname, '../../reports/qa/context.json'), 'utf-8'));
const func = ctx.tenants[3];

async function main() {
  const checks: Array<{ id: string; ok: boolean; detail: string }> = [];

  const push = (id: string, ok: boolean, detail: string) => {
    checks.push({ id, ok, detail });
    console.log(`${ok ? 'OK' : 'XX'} ${id} — ${detail}`);
  };

  // UI-1/2: pré-requisito — evento aberto + 2 comandas com itens
  const c1 = await api<{ id: string }>('POST', '/api/comandas', {
    token: func.atendenteTokens[0],
    body: staffComandaBody(func.eventoId, `Smoke A ${Date.now()}`, 40),
  });
  const c2 = await api<{ id: string }>('POST', '/api/comandas', {
    token: func.atendenteTokens[0],
    body: staffComandaBody(func.eventoId, `Smoke B ${Date.now()}`, 41),
  });
  push('UI-1', c1.status === 201 && c2.status === 201, `Comandas criadas (${c1.status}/${c2.status})`);

  for (const id of [c1.data!.id, c2.data!.id]) {
    const item = await api('POST', `/api/comandas/${id}/itens`, {
      token: func.atendenteTokens[0],
      body: chopeItemBody(func.produtoId, func.tapId, 500),
    });
    if (item.status !== 201) push('UI-2', false, `Item falhou em ${id}`);
  }
  push('UI-2', true, 'Itens adicionados nas 2 comandas');

  const dashBefore = await api<{ resumo: { valorFechado: number; comandasFechadas: number } }>(
    'GET',
    `/api/eventos/${func.eventoId}/dashboard`,
    { token: func.donoToken },
  );
  const beforeFechado = dashBefore.data?.resumo.valorFechado ?? 0;

  const fullA = await api<{ total: string | number }>('GET', `/api/comandas/${c1.data!.id}`, { token: func.donoToken });
  const fullB = await api<{ total: string | number }>('GET', `/api/comandas/${c2.data!.id}`, { token: func.donoToken });
  const totalGrupo = Number(fullA.data.total) + Number(fullB.data.total);

  // UI-5: POST /fechar-grupo (mesmo endpoint da ComandasPage)
  const close = await api<{ comandas: unknown[]; totalGrupo: number }>('POST', '/api/pagamentos/fechar-grupo', {
    token: func.atendenteTokens[0],
    body: {
      comandaIds: [c1.data!.id, c2.data!.id],
      pagamentos: [{ forma: 'PIX', valor: totalGrupo }],
    },
  });
  push('UI-5', close.status === 200 && close.data.comandas.length === 2, `fechar-grupo HTTP ${close.status}`);

  const dashAfter = await api<{ resumo: { valorFechado: number; comandasFechadas: number } }>(
    'GET',
    `/api/eventos/${func.eventoId}/dashboard`,
    { token: func.donoToken },
  );
  const delta = (dashAfter.data?.resumo.valorFechado ?? 0) - beforeFechado;
  push('UI-6', Math.abs(delta - totalGrupo) <= 0.01, `Dashboard valorFechado +${delta.toFixed(2)}`);

  // UI-8: regressão fechamento individual
  const c3 = await api<{ id: string }>('POST', '/api/comandas', {
    token: func.atendenteTokens[0],
    body: staffComandaBody(func.eventoId, `Smoke solo ${Date.now()}`, 42),
  });
  await api('POST', `/api/comandas/${c3.data!.id}/itens`, {
    token: func.atendenteTokens[0],
    body: chopeItemBody(func.produtoId, func.tapId, 300),
  });
  const solo = await api<{ total: string | number }>('GET', `/api/comandas/${c3.data!.id}`, { token: func.donoToken });
  const soloClose = await api('POST', `/api/pagamentos/comandas/${c3.data!.id}/fechar`, {
    token: func.atendenteTokens[0],
    body: { pagamentos: [{ forma: 'DINHEIRO', valor: Number(solo.data.total) }] },
  });
  push('UI-8', soloClose.status === 200, `Fechamento individual HTTP ${soloClose.status}`);

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n[smoke] ${checks.length - failed.length}/${checks.length} OK`);
  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
