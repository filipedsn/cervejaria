import type { DeterministicDossier } from '../dossiers/types.js';
import type { DeterministicBrief } from './types.js';

/** Deliberately mechanical baseline: it only projects deterministic dossier fields. */
export class DeterministicBriefRenderer {
  render(dossier: DeterministicDossier): DeterministicBrief {
    const target = dossier.service ?? 'serviço não informado';
    return {
      summary: `Incidente ${dossier.class}, severidade ${dossier.severity}, confiança ${dossier.confidence}, com ${dossier.occurrences} ocorrência(s) no serviço ${target}.`,
      hypotheses: dossier.hypotheses.map((item) => item.statement),
      gaps: dossier.gaps.map((item) => item.statement),
      recommendedChecks: dossier.recommendedChecks.map((item) => item.statement)
    };
  }
}
