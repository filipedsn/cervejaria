import type { PerfMetric, TestResult } from './types.js';

interface RenderInput {
  generatedAt: string;
  apiBase: string;
  durationMs: number;
  loadProfile: { breweries: number; employeesPerBrewery: number; comandasPerBrewery: number };
  workers: { count: number; attempted: number; success: number; failed: number };
  summary: { total: number; passed: number; failed: number; warnings: number; skipped: number };
  results: TestResult[];
  perf: PerfMetric[];
  recommendations: string[];
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function badge(status: TestResult['status']): string {
  const map = {
    passed: ['#22c55e', 'PASS'],
    failed: ['#ef4444', 'FAIL'],
    warning: ['#f59e0b', 'ALERTA'],
    skipped: ['#94a3b8', 'SKIP'],
  } as const;
  const [c, label] = map[status];
  return `<span class="badge" style="background:${c}1f;color:${c};border-color:${c}55">${label}</span>`;
}

function resultRow(t: TestResult): string {
  const ea =
    t.expected || t.actual
      ? `<div class="ea"><span>esperado <b>${esc(t.expected ?? '—')}</b></span><span>obtido <b>${esc(t.actual ?? '—')}</b></span></div>`
      : '';
  const details = t.details ? `<pre>${esc(t.details)}</pre>` : '';
  return `<tr class="row-${t.status}">
    <td><code>${esc(t.id)}</code></td>
    <td>${esc(t.name)}${ea}</td>
    <td>${badge(t.status)}</td>
    <td class="num">${t.durationMs ? t.durationMs.toFixed(0) + ' ms' : '—'}</td>
    <td>${esc(t.message ?? '')}${details}</td>
  </tr>`;
}

function categorySection(cat: string, items: TestResult[]): string {
  const pass = items.filter((i) => i.status === 'passed').length;
  const fail = items.filter((i) => i.status === 'failed').length;
  const warn = items.filter((i) => i.status === 'warning').length;
  return `<section class="card">
    <div class="card-head">
      <h2>${esc(cat)}</h2>
      <span class="pill">${pass} pass${fail ? ` · ${fail} fail` : ''}${warn ? ` · ${warn} alerta` : ''}</span>
    </div>
    <table>
      <thead><tr><th>ID</th><th>Caso</th><th>Status</th><th>Tempo</th><th>Detalhe</th></tr></thead>
      <tbody>${items.map(resultRow).join('')}</tbody>
    </table>
  </section>`;
}

function perfRow(p: PerfMetric): string {
  const over = p.target !== undefined && p.p95 > p.target;
  const barPct = p.target ? Math.min(100, Math.round((p.p95 / (p.target * 1.5)) * 100)) : 40;
  const color = over ? '#ef4444' : '#22c55e';
  return `<tr>
    <td><code>${esc(p.label)}</code></td>
    <td class="num">${p.samples}</td>
    <td class="num">${p.p50.toFixed(0)}</td>
    <td class="num"><b style="color:${color}">${p.p95.toFixed(0)}</b></td>
    <td class="num">${p.p99.toFixed(0)}</td>
    <td class="num">${p.max.toFixed(0)}</td>
    <td class="num">${p.target ?? '—'}</td>
    <td class="num">${p.errors}</td>
    <td><div class="bar"><div style="width:${barPct}%;background:${color}"></div></div></td>
  </tr>`;
}

export function renderHtml(d: RenderInput): string {
  const passRate = d.summary.total ? Math.round((d.summary.passed / d.summary.total) * 100) : 0;
  const criticalFail = d.results.some(
    (r) => r.status === 'failed' && ['Multi-tenant', 'Sessão', 'Concorrência', 'Integridade'].includes(r.category),
  );
  const prodReady = d.summary.failed === 0;

  const categories = [...new Set(d.results.map((r) => r.category))];
  const sections = categories.map((c) => categorySection(c, d.results.filter((r) => r.category === c))).join('');

  const findings = d.results
    .filter((r) => r.status === 'failed' || r.status === 'warning')
    .map((r) => `<li><b>${esc(r.id)}</b> <span class="ftag ${r.status}">${r.status === 'failed' ? 'FALHA' : 'ALERTA'}</span> ${esc(r.name)} — ${esc(r.message ?? '')}</li>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>QA Aprofundado — Cervejaria Móvel</title>
<style>
:root{--bg:#0d1117;--card:#161b22;--card2:#1c2330;--text:#e6edf3;--muted:#8b949e;--brand:#e69500;--line:#ffffff12}
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:var(--bg);color:var(--text);line-height:1.55}
.wrap{max-width:1180px;margin:0 auto;padding:28px 20px 64px}
h1{font-size:1.7rem;margin:0 0 2px}
.meta{color:var(--muted);font-size:.85rem;margin-bottom:20px}
.verdict{border-radius:14px;padding:18px 22px;margin-bottom:22px;font-weight:600;font-size:1.02rem}
.verdict.ok{background:#22c55e14;border:1px solid #22c55e44;color:#86efac}
.verdict.no{background:#ef444414;border:1px solid #ef444444;color:#fca5a5}
.hero{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-bottom:22px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;text-align:center}
.stat b{display:block;font-size:1.7rem;font-variant-numeric:tabular-nums}
.stat span{font-size:.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 20px;margin-bottom:18px;overflow-x:auto}
.card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
h2{font-size:.95rem;margin:0;color:var(--brand);text-transform:uppercase;letter-spacing:.07em}
.pill{font-size:.72rem;color:var(--muted);background:var(--card2);border:1px solid var(--line);padding:3px 10px;border-radius:999px}
table{width:100%;border-collapse:collapse;font-size:.86rem}
th,td{padding:9px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{color:var(--muted);font-size:.7rem;text-transform:uppercase;letter-spacing:.04em}
td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
code{font-size:.8em;background:#ffffff0d;padding:2px 6px;border-radius:5px}
.badge{font-size:.68rem;font-weight:700;padding:2px 8px;border-radius:999px;border:1px solid;white-space:nowrap}
.row-failed{background:#ef44440a}
.row-warning{background:#f59e0b0a}
.ea{display:flex;gap:14px;margin-top:4px;font-size:.74rem;color:var(--muted)}
.ea b{color:var(--text)}
pre{margin:6px 0 0;font-size:.72rem;color:var(--muted);white-space:pre-wrap;background:#00000030;padding:8px;border-radius:6px;border:1px solid var(--line)}
.bar{height:8px;min-width:90px;background:#ffffff12;border-radius:4px;overflow:hidden}
.bar div{height:100%;border-radius:4px}
ul{margin:0;padding-left:20px}
li{margin:7px 0}
.findings li{color:var(--text)}
.ftag{font-size:.66rem;font-weight:700;padding:1px 6px;border-radius:4px}
.ftag.failed{background:#ef44442a;color:#fca5a5}
.ftag.warning{background:#f59e0b2a;color:#fcd34d}
.recs li{color:var(--muted)}
footer{margin-top:28px;font-size:.72rem;color:var(--muted);text-align:center}
</style></head><body><div class="wrap">
<h1>Relatório de QA Aprofundado — Cervejaria Móvel</h1>
<p class="meta">Gerado em ${esc(d.generatedAt)} · API ${esc(d.apiBase)} · Suíte ${(d.durationMs / 1000).toFixed(1)}s · Concorrência: ${d.workers.count} processos</p>

<div class="verdict ${prodReady ? 'ok' : 'no'}">
${prodReady
    ? `✓ ${passRate}% de aprovação · 0 falhas · ${d.summary.warnings} alerta(s). Candidata a produção com os alertas endereçados.`
    : `✗ ${d.summary.failed} falha(s)${criticalFail ? ' incluindo áreas críticas (sessão/multi-tenant/concorrência/integridade)' : ''} · ${d.summary.warnings} alerta(s). Corrigir antes do go-live.`}
</div>

<div class="hero">
  <div class="stat"><b>${d.summary.total}</b><span>Casos</span></div>
  <div class="stat"><b style="color:#22c55e">${d.summary.passed}</b><span>Pass</span></div>
  <div class="stat"><b style="color:#ef4444">${d.summary.failed}</b><span>Fail</span></div>
  <div class="stat"><b style="color:#f59e0b">${d.summary.warnings}</b><span>Alerta</span></div>
  <div class="stat"><b style="color:#8b949e">${d.summary.skipped}</b><span>Skip</span></div>
  <div class="stat"><b>${d.loadProfile.breweries}</b><span>Cervejarias</span></div>
  <div class="stat"><b>${d.workers.count}</b><span>Workers</span></div>
  <div class="stat"><b>${d.workers.success}</b><span>Itens conc.</span></div>
</div>

<section class="card">
  <div class="card-head"><h2>Escopo do ensaio</h2></div>
  <p style="margin:0;color:var(--muted);font-size:.86rem">
    ${d.loadProfile.breweries} cervejarias × ${d.loadProfile.employeesPerBrewery} usuários × ${d.loadProfile.comandasPerBrewery} comandas ·
    arena de concorrência atacada por ${d.workers.count} processos (subagents) totalizando ${d.workers.attempted} operações
    (${d.workers.success} OK / ${d.workers.failed} falhas). Cobertura: sessão/JWT, RBAC, isolamento multi-tenant (IDOR),
    ciclo de vida funcional, performance e integridade transacional.
  </p>
</section>

${findings ? `<section class="card"><div class="card-head"><h2>Achados (falhas & alertas)</h2></div><ul class="findings">${findings}</ul></section>` : ''}

${sections}

<section class="card">
  <div class="card-head"><h2>Performance (latência, ms)</h2></div>
  <table>
    <thead><tr><th>Cenário</th><th>Amostras</th><th>p50</th><th>p95</th><th>p99</th><th>max</th><th>meta p95</th><th>erros</th><th></th></tr></thead>
    <tbody>${d.perf.map(perfRow).join('') || '<tr><td colspan="9">Sem dados</td></tr>'}</tbody>
  </table>
</section>

<section class="card">
  <div class="card-head"><h2>Recomendações priorizadas</h2></div>
  <ul class="recs">${d.recommendations.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
</section>

<footer>QA automatizado (setup → suite → workers multi-processo → report) · Não substitui UAT manual completo</footer>
</div></body></html>`;
}
