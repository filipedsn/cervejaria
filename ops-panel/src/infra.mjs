/**
 * Infraestrutura do VPS (Hostinger) para o cartão "Site dos clientes".
 * Funções puras sobre o relatório do servidor (deploy/tap-quiver/ops-report.sh)
 * e o histórico de leituras que o painel guarda (última hora).
 */

export const HISTORY_MAX_AGE_S = 60 * 60;
const HISTORY_MIN_GAP_S = 50;

const UNITS = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 };

/** Tamanho no formato do `docker stats` ("109.4MiB", "78.3MB", "0B") em bytes; inválido → null. */
export function parseBytes(text) {
  const m = String(text ?? '').trim().match(/^(\d+(?:\.\d+)?)\s*([kmgt]?i?b)$/i);
  if (!m) return null;
  const unit = UNITS[m[2].toLowerCase()];
  return unit ? Math.round(Number(m[1]) * unit) : null;
}

/** "78.3MB / 65.1MB" → [78300000, 65100000] */
export function parsePair(text) {
  const [a, b] = String(text ?? '').split('/');
  return [parseBytes(a), parseBytes(b)];
}

const percent = (text) => {
  const n = Number.parseFloat(String(text ?? ''));
  return Number.isFinite(n) ? n : null;
};

const decimal = (value, digits = 1, minDigits = digits) =>
  value.toLocaleString('pt-BR', { minimumFractionDigits: minDigits, maximumFractionDigits: digits });

/** Base 1024, como o hPanel: "110 MB", "1,9 GB", "16 GB". */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  const steps = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < steps.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${decimal(value, i === 0 || value >= 100 ? 0 : 1, 0)} ${steps[i]}`;
}

/** Duração curta: "5 min", "47 h", "3 dias". */
export function upFor(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} dias`;
}

/** Nome para quem não é da área; essenciais parados deixam o site fora. */
const CONTAINERS = {
  'cervejaria-api': { label: 'Sistema (API)', role: 'O Tap Quiver que os clientes usam', essential: true },
  'cervejaria-db': { label: 'Banco de dados', role: 'Postgres com os dados dos clientes', essential: true },
  'quiver-edot-collector-prd': { label: 'Coletor de observabilidade', role: 'Leva logs e métricas ao Elasticsearch' },
  elasticsearch: { label: 'Elasticsearch', role: 'Guarda logs e métricas do site' },
  kibana: { label: 'Kibana', role: 'Telas para consultar logs e métricas' },
};
const ORDER = Object.keys(CONTAINERS);

const gaugeLevel = (pct, warn, bad) => (pct == null ? 'off' : pct >= bad ? 'bad' : pct >= warn ? 'warn' : 'ok');
const round = (n) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : null);

function containerHealth(c, essential) {
  if (c.status === 'running') {
    if (c.health === 'unhealthy') return [essential ? 'bad' : 'warn', 'com problema'];
    if (c.health === 'starting') return ['run', 'iniciando'];
    return ['ok', c.health === 'healthy' ? 'saudável' : 'rodando'];
  }
  if (c.status === 'restarting') return ['warn', 'reiniciando'];
  if (c.status === 'paused') return ['warn', 'pausado'];
  return [essential ? 'bad' : 'warn', 'parado'];
}

export function containerView(c, host, nowS) {
  const meta = CONTAINERS[c.name] ?? { label: c.name, role: c.image ?? '' };
  const [level, statusText] = containerHealth(c, meta.essential);
  const running = c.status === 'running';
  const cpu = running ? percent(c.cpu) : null;
  const [mem] = running ? parsePair(c.mem) : [null];
  const [rx, tx] = running ? parsePair(c.net) : [null, null];
  const started = Date.parse(c.started ?? '');
  return {
    name: c.name,
    label: meta.label,
    role: meta.role,
    image: c.image ?? '',
    level,
    statusText,
    essential: Boolean(meta.essential),
    // `docker stats` mede CPU em % de um núcleo; a barra mostra a fatia do servidor inteiro.
    cpuPct: cpu == null ? null : round(cpu / Math.max(1, host?.cpus ?? 1)),
    memBytes: mem,
    memText: formatBytes(mem),
    memPct: mem != null && host?.mem_total ? round((100 * mem) / host.mem_total) : null,
    // Contêiner na rede do próprio servidor (network_mode: host) não tem tráfego separado.
    net: rx || tx ? { rx: formatBytes(rx), tx: formatBytes(tx) } : null,
    restarts: c.restarts ?? 0,
    upText: running && Number.isFinite(started) ? `no ar há ${upFor(nowS - started / 1000)}` : `parado${c.exit_code ? ` (código ${c.exit_code})` : ''}`,
  };
}

/** Leitura que entra no histórico: % de CPU e de memória do servidor. */
export function historySample(report) {
  const h = report?.host;
  if (!h || !Number.isFinite(report.now)) return null;
  const mem = h.mem_total && h.mem_avail != null ? round((100 * (h.mem_total - h.mem_avail)) / h.mem_total) : null;
  return { t: report.now, cpu: h.cpu_pct ?? null, mem };
}

/** Acrescenta a leitura (no máximo uma por ~minuto) e descarta o que passou de uma hora. */
export function pushSample(history, sample) {
  if (!sample) return history;
  const last = history.at(-1);
  if (last && sample.t - last.t < HISTORY_MIN_GAP_S) return history;
  return [...history, sample].filter((s) => sample.t - s.t <= HISTORY_MAX_AGE_S);
}

const series = (history, key) => history.map((s) => s[key]).filter((v) => Number.isFinite(v));

export function infraView(report, history = [], nowMs = Date.now()) {
  const h = report?.host;
  if (!h) return null;
  const nowS = report.now ?? nowMs / 1000;
  const memUsed = h.mem_total && h.mem_avail != null ? h.mem_total - h.mem_avail : null;
  const memPct = memUsed != null ? round((100 * memUsed) / h.mem_total) : null;
  const diskPct = h.disk_total ? round((100 * h.disk_used) / h.disk_total) : (report.disk_pct ?? null);
  const load = Array.isArray(h.load) ? h.load[0] : null;

  const containers = (report.containers ?? [])
    .map((c) => containerView(c, h, nowS))
    .sort((a, b) => {
      const ia = ORDER.indexOf(a.name);
      const ib = ORDER.indexOf(b.name);
      return (ia < 0 ? ORDER.length : ia) - (ib < 0 ? ORDER.length : ib) || a.name.localeCompare(b.name);
    });
  const troubled = containers.filter((c) => c.level !== 'ok');

  const issues = troubled.filter((c) => c.level !== 'run').map((c) => `${c.label} ${c.statusText}`);
  if (memPct >= 90) issues.push(`memória ${Math.round(memPct)}% usada`);

  return {
    spec: [
      h.cpus ? `${h.cpus} vCPUs` : null,
      h.mem_total ? `${formatBytes(h.mem_total)} de memória` : null,
      h.disk_total ? `${formatBytes(h.disk_total)} de disco` : null,
    ].filter(Boolean).join(' · '),
    uptime: upFor(h.uptime_s),
    gauges: [
      {
        id: 'cpu',
        label: 'CPU',
        pct: h.cpu_pct ?? null,
        level: gaugeLevel(h.cpu_pct, 75, 90),
        detail: load != null ? `carga ${decimal(load, 2)}` : '',
        series: series(history, 'cpu'),
      },
      {
        id: 'mem',
        label: 'Memória',
        pct: memPct,
        level: gaugeLevel(memPct, 80, 90),
        detail: memUsed != null ? `${formatBytes(memUsed)} de ${formatBytes(h.mem_total)}` : '',
        series: series(history, 'mem'),
      },
      {
        id: 'disk',
        label: 'Disco',
        pct: diskPct,
        level: gaugeLevel(diskPct, 85, 95),
        detail: h.disk_total ? `${formatBytes(h.disk_used)} de ${formatBytes(h.disk_total)}` : '',
        series: [],
      },
    ],
    containers,
    summary: !containers.length
      ? 'nenhum encontrado'
      : troubled.length
        ? `${troubled.length} de ${containers.length} com atenção`
        : `${containers.length}, todos funcionando`,
    issues,
  };
}
