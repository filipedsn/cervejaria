import { config } from './config.js';
import { esSearch } from './es.js';
import type { Alert, AlertDoc } from './types.js';

/**
 * Fase 2 — watcher.
 *
 * Poll no indice `quiver-tap-alert-events`, alimentado pelo connector `.index` do
 * Kibana (o plano Basic nao tem webhook). Roda em paralelo ao alert-poller do backend
 * e nao consome o flag `processed` dele — cada um tem seu proprio marcador.
 */

const MAX_ALERTS_PER_POLL = 50;

export async function fetchNewAlerts(sinceIso: string): Promise<Alert[]> {
  const res = await esSearch<AlertDoc>(config.es.alertIndex, {
    size: MAX_ALERTS_PER_POLL,
    query: {
      bool: {
        must: [{ range: { '@timestamp': { gt: sinceIso } } }],
        must_not: [{ term: { supportAgentTriaged: true } }],
      },
    },
    sort: [{ '@timestamp': 'asc' }],
  });

  const hits = res.hits?.hits ?? [];
  return hits
    .filter((hit) => hit._id)
    .map((hit) => {
      const src = hit._source ?? {};
      return {
        id: hit._id as string,
        ruleName: src.ruleName?.trim() || 'desconhecida',
        alertState: src.alertState?.trim() ?? '',
        reason: src.reason?.trim() ?? '',
        viewInAppUrl: src.viewInAppUrl?.trim() ?? '',
        timestamp: src['@timestamp'] ?? new Date().toISOString(),
      };
    });
}

/**
 * O connector do Kibana grava um documento tanto na abertura quanto na recuperacao
 * do alerta. Recuperacao nao e bug novo — nao deve abrir Issue.
 */
export function isRecovery(alert: Alert): boolean {
  const state = alert.alertState.toLowerCase();
  return state === 'recovered' || state === 'ok' || state === 'closed';
}
