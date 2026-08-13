import { config, esAuthHeaders } from './config.js';

export type EsHit<T = Record<string, unknown>> = {
  _id?: string;
  _index?: string;
  _source?: T;
};

export type EsSearchResponse<T = Record<string, unknown>> = {
  hits?: { total?: { value?: number }; hits?: EsHit<T>[] };
  aggregations?: Record<string, unknown>;
};

export async function esSearch<T = Record<string, unknown>>(
  index: string,
  body: unknown,
): Promise<EsSearchResponse<T>> {
  const url = `${config.es.url}/${encodeURIComponent(index)}/_search?ignore_unavailable=true`;
  const res = await fetch(url, {
    method: 'POST',
    headers: esAuthHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Elasticsearch ${res.status} em ${index}: ${detail.slice(0, 400)}`);
  }
  return (await res.json()) as EsSearchResponse<T>;
}

/** Marca o alerta como processado pelo agente, sem colidir com o flag do alert-poller. */
export async function markTriaged(alertId: string, issueNumber: number | null): Promise<void> {
  const url = `${config.es.url}/${encodeURIComponent(config.es.alertIndex)}/_update/${encodeURIComponent(alertId)}`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: esAuthHeaders(),
      body: JSON.stringify({
        doc: {
          supportAgentTriaged: true,
          supportAgentTriagedAt: new Date().toISOString(),
          supportAgentIssue: issueNumber,
        },
      }),
    });
  } catch {
    // best-effort: o estado local em support-agent-state.json e a fonte primaria
  }
}

export async function esReachable(): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(`${config.es.url}/_cluster/health`, { headers: esAuthHeaders() });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const body = (await res.json()) as { status?: string };
    return { ok: true, detail: `cluster ${body.status ?? 'desconhecido'}` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
