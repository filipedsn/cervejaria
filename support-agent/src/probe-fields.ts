/**
 * Descobre como os campos de `attributes` estao mapeados no Elasticsearch.
 * Necessario porque o mapping `otel` do exporter decide se `attributes.event.action`
 * e um objeto aninhado, um campo com ponto no nome, ou um `flattened`.
 *
 *   npm run probe:fields --prefix support-agent
 */
import { config, esAuthHeaders } from './config.js';
import { esSearch } from './es.js';

const CANDIDATES = [
  'attributes.event.action',
  'attributes.event.outcome',
  'attributes.http.route',
  'attributes.http.response.status_code',
  'attributes.cervejaria.slug',
  'attributes.metadata.stack',
  'attributes.error.stack_trace',
  'attributes.exception.stacktrace',
  'severity_text',
  'data_stream.dataset',
];

const DEFAULT_FIELD_PATTERN = 'attributes.*,severity_text,data_stream.dataset';

async function fieldCaps(index: string, fieldPattern: string): Promise<void> {
  const res = await fetch(
    `${config.es.url}/${encodeURIComponent(index)}/_field_caps?fields=${encodeURIComponent(fieldPattern)}&ignore_unavailable=true`,
    { headers: esAuthHeaders() },
  );
  if (!res.ok) {
    console.log(`_field_caps indisponivel: HTTP ${res.status}`);
    return;
  }
  const body = (await res.json()) as { fields?: Record<string, Record<string, { type?: string }>> };
  const fields = body.fields ?? {};
  console.log(`\n--- campos mapeados em ${index} (${Object.keys(fields).length}) ---`);
  for (const name of Object.keys(fields).sort()) {
    const types = Object.keys(fields[name] ?? {}).join(',');
    console.log(`  ${types.padEnd(12)} ${name}`);
  }
}

async function aggregable(index: string, field: string): Promise<void> {
  try {
    const res = await esSearch(index, {
      size: 0,
      aggs: { v: { terms: { field, size: 5 } } },
    });
    const agg = res.aggregations?.v as { buckets?: { key: unknown; doc_count: number }[] } | undefined;
    const buckets = agg?.buckets ?? [];
    const preview = buckets.map((b) => `${String(b.key)}(${b.doc_count})`).join(' ');
    console.log(`  ${buckets.length ? 'OK  ' : 'VAZIO'} ${field.padEnd(42)} ${preview}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ERRO  ${field.padEnd(42)} ${msg.slice(0, 90)}`);
  }
}

async function main(): Promise<void> {
  const index = process.argv[2] ?? config.es.logIndex;
  // Segundo argumento permite inspecionar outros indices, ex.: metricas do agente:
  //   npm run probe:fields -- "metrics-generic.otel-prd*" "metrics.*"
  const fieldPattern = process.argv[3] ?? DEFAULT_FIELD_PATTERN;
  await fieldCaps(index, fieldPattern);

  if (process.argv[3]) return;

  console.log(`\n--- agregacao por campo em ${index} ---`);
  for (const field of CANDIDATES) {
    await aggregable(index, field);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
