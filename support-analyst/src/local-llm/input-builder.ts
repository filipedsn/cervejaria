import { createHash } from 'node:crypto';
import { assertDossierPrivacy } from '../dossiers/store.js';
import type { DeterministicDossier } from '../dossiers/types.js';

export const MAX_LLM_INPUT_BYTES = 16_000;
export type LlmInput = { context: Record<string, unknown>; serialized: string; contextHash: string; inputTruncated: boolean; inputBytes: number };

export class LlmInputBuilder {
  build(dossier: DeterministicDossier): LlmInput {
    const context: Record<string, unknown> = {
      schemaVersion: 1, class: dossier.class, severity: dossier.severity, confidence: dossier.confidence, occurrences: dossier.occurrences,
      service: dossier.service, route: dossier.route, releases: dossier.releases, affectedTenantCount: dossier.affectedTenantCount,
      facts: dossier.facts.map(({ factId, type, statement }) => ({ factId, type, statement })),
      hypotheses: dossier.hypotheses.map(({ statement, basedOnFactIds, supportLevel }) => ({ statement, basedOnFactIds, supportLevel })),
      gaps: dossier.gaps.map(({ gapId, statement }) => ({ gapId, statement })),
      recommendedChecks: dossier.recommendedChecks.map(({ statement, basedOnFactIds }) => ({ statement, basedOnFactIds }))
    };
    let inputTruncated = false;
    const timeline = dossier.timeline.map(({ timestamp, source, eventType, action, severity, http, dbCategory, realtimeReason, release, relationLevel }) => ({ timestamp, source, eventType, action, severity, http, dbCategory, realtimeReason, release, relationLevel }));
    if (timeline.length) context.timeline = timeline;
    let serialized = JSON.stringify(context);
    if (Buffer.byteLength(serialized) > MAX_LLM_INPUT_BYTES && 'timeline' in context) { delete context.timeline; inputTruncated = true; serialized = JSON.stringify(context); }
    while (Buffer.byteLength(serialized) > MAX_LLM_INPUT_BYTES && Array.isArray(context.facts) && context.facts.length > 1) { context.facts = context.facts.slice(0, -1); inputTruncated = true; serialized = JSON.stringify(context); }
    if (Buffer.byteLength(serialized) > MAX_LLM_INPUT_BYTES) throw new Error('Sanitized LLM input exceeds its size limit.');
    assertLlmInputPrivacy(context); assertDossierPrivacy(context);
    return { context, serialized, contextHash: `llmctx1:${createHash('sha256').update(serialized).digest('hex')}`, inputTruncated, inputBytes: Buffer.byteLength(serialized) };
  }
}

export function assertLlmInputPrivacy(value: unknown): void {
  // A header-like Authorization value is unsafe, but the allowlisted incident
  // class AUTHORIZATION_DENIED is a safe classification identifier.
  const prohibited = /(?:\bhttps?:\/\/|\bauthorization\s*:|\bcookie\b|\btoken\b|\bpassword\b|\bsecret\b|\bapi[-_ ]?key\b|\bactor\s*id\b|\bemail\b|\be-mail\b|\btelefone\b|\bphone\b|\bsql\b|\bbindings\b|\bstack\b|\b_source\b|\brawref\b)/i;
  const visit = (item: unknown): void => { if (typeof item === 'string') { if (prohibited.test(item)) throw new Error('LLM input violates the privacy boundary.'); return; } if (Array.isArray(item)) return void item.forEach(visit); if (item && typeof item === 'object') for (const [key, nested] of Object.entries(item as Record<string, unknown>)) { if (prohibited.test(key)) throw new Error('LLM input violates the privacy boundary.'); visit(nested); } };
  visit(value);
}
