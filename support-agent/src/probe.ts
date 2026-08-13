/**
 * Diagnostico do que o agente enxerga no Elasticsearch.
 *
 *   npm run probe --prefix support-agent
 *
 * Mostra conectividade, um alerta de exemplo e um log de auditoria de exemplo,
 * para conferir se os campos usados pelo enriquecimento realmente existem.
 */
import { config, esAuthHeaders } from './config.js';
import { esReachable, esSearch } from './es.js';

async function listIndices(): Promise<void> {
  const res = await fetch(`${config.es.url}/_cat/indices?format=json&h=index,docs.count`, {
    headers: esAuthHeaders(),
  });
  if (!res.ok) {
    console.log(`\nNao foi possivel listar indices: HTTP ${res.status}`);
    return;
  }
  const rows = (await res.json()) as { index?: string; 'docs.count'?: string }[];
  // data streams sao respaldados por indices .ds-*, que precisam aparecer aqui
  const relevant = rows
    .filter((r) => r.index && (!r.index.startsWith('.') || r.index.startsWith('.ds-')))
    .filter((r) => Number(r['docs.count'] ?? '0') > 0)
    .sort((a, b) => (a.index ?? '').localeCompare(b.index ?? ''));
  console.log('\n--- indices com dados ---');
  for (const row of relevant) {
    console.log(`  ${(row['docs.count'] ?? '0').padStart(9)}  ${row.index}`);
  }
}

function printDoc(label: string, source: unknown): void {
  console.log(`\n--- ${label} ---`);
  if (!source) {
    console.log('(nenhum documento encontrado)');
    return;
  }
  console.log(JSON.stringify(source, null, 2).slice(0, 3000));
}

async function main(): Promise<void> {
  console.log(`Elasticsearch: ${config.es.url}`);
  console.log(`Auth: ${config.es.apiKey ? 'ApiKey' : config.es.password ? `Basic (${config.es.user})` : 'NENHUMA'}`);

  const health = await esReachable();
  console.log(`Conexao: ${health.ok ? 'OK' : 'FALHA'} — ${health.detail}`);
  if (!health.ok) process.exit(1);

  await listIndices();

  const alerts = await esSearch(config.es.alertIndex, {
    size: 1,
    sort: [{ '@timestamp': 'desc' }],
  }).catch((err) => {
    console.log(`\nIndice de alertas indisponivel: ${err.message}`);
    return null;
  });
  printDoc(`alerta mais recente (${config.es.alertIndex})`, alerts?.hits?.hits?.[0]?._source);
  console.log(`total de alertas: ${alerts?.hits?.total?.value ?? 0}`);

  const logs = await esSearch(config.es.logIndex, {
    size: 1,
    sort: [{ '@timestamp': 'desc' }],
  }).catch((err) => {
    console.log(`\nIndice de logs indisponivel: ${err.message}`);
    return null;
  });
  printDoc(`log de auditoria mais recente (${config.es.logIndex})`, logs?.hits?.hits?.[0]?._source);

  const datasets = await esSearch(config.es.logIndex, {
    size: 0,
    aggs: {
      datasets: { terms: { field: 'data_stream.dataset', size: 30 } },
      severities: { terms: { field: 'severity_text', size: 20 } },
      actions: { terms: { field: 'attributes.event\\.action', size: 20 } },
    },
  }).catch((err) => {
    console.log(`\nAgregacao indisponivel: ${err.message}`);
    return null;
  });
  if (datasets?.aggregations) {
    console.log('\n--- agregacoes do indice de logs ---');
    console.log(JSON.stringify(datasets.aggregations, null, 2).slice(0, 2500));
  }

  const failures = await esSearch(config.es.logIndex, {
    size: 1,
    query: {
      bool: {
        should: [
          { term: { 'attributes.event\\.outcome': 'failure' } },
          { terms: { severity_text: ['error', 'fatal', 'ERROR', 'FATAL'] } },
          { range: { 'attributes.http\\.response\\.status_code': { gte: 500 } } },
        ],
        minimum_should_match: 1,
      },
    },
    sort: [{ '@timestamp': 'desc' }],
  }).catch((err) => {
    console.log(`\nBusca de falhas indisponivel: ${err.message}`);
    return null;
  });
  printDoc('log de falha mais recente', failures?.hits?.hits?.[0]?._source);
  console.log(`total de falhas: ${failures?.hits?.total?.value ?? 0}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
