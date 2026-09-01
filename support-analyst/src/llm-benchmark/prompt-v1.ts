import type { DeterministicDossier } from '../dossiers/types.js';
import { OUTPUT_SCHEMA_VERSION, PROMPT_VERSION } from './types.js';

export const outputJsonSchema = {
  type: 'object', additionalProperties: false,
  required: ['executiveSummary', 'analysis', 'hypotheses', 'gaps', 'recommendedChecks'],
  properties: {
    executiveSummary: { type: 'string', maxLength: 1200 },
    analysis: { type: 'string', maxLength: 1800 },
    hypotheses: { type: 'array', maxItems: 5, items: { type: 'object', additionalProperties: false, required: ['statement', 'supportingFactIds'], properties: { statement: { type: 'string', maxLength: 500 }, supportingFactIds: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'string' } } } } },
    gaps: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 400 } },
    recommendedChecks: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 400 } }
  }
} as const;

export function buildPrompt(dossier: DeterministicDossier): { system: string; user: string } {
  return {
    system: `Você é uma camada experimental de análise do Support Analyst. Responda em pt-BR e apenas no JSON do schema solicitado. O dossiê determinístico é a autoridade: não altere nem declare uma nova classe, severidade, confiança, identidade, contagem, tenant ou release. Não invente facts, tenants, releases, event IDs, evidence IDs ou rawRef. Hipóteses devem ser condicionais e cada uma deve citar somente factIds existentes. Não afirme causalidade, causa raiz, ataque, invasão ou vulnerabilidade. Recomende somente verificações investigativas não mutadoras; nunca deploy, rollback, restart, migration, alteração de banco, reset ou revogação. Não exponha segredos, PII ou raciocínio interno.`,
    user: `Prompt ${PROMPT_VERSION}; schema ${OUTPUT_SCHEMA_VERSION}. Analise exclusivamente este dossiê sanitizado:\n${JSON.stringify(dossier)}`
  };
}
