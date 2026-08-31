import { DOSSIER_LIMITS, type DeterministicDossier, type DossierContext, type DossierFact, type DossierFactType, type DossierGap, type DossierHypothesis, type DossierRecommendedCheck, type EvidenceRef } from './types.js';
import { contextHash, sha256 } from './context-builder.js';

const ANALYST_VERSION = '0.1.0';
const ABSOLUTE_CAUSALITY = /\b(caused by|root cause is|caused|provoked|confirmed cause|vulnerability found|causou|causada por|causado por|causaram|causa raiz|causa confirmada|vulnerabilidade encontrada)\b/i;
const MUTATING_CHECK = /\b(deploy|rollback|restart|migration|delete|update|kill|stop-service|start-service|reiniciar|migra[çc][aã]o|executar migration|alterar banco)\b/i;

export type DossierBuildInput = { context: DossierContext; generatedAt: string; analystVersion?: string };

/** Builds a factual snapshot only; generatedAt is injected by the caller for replay determinism. */
export function buildDeterministicDossier(input: DossierBuildInput): DeterministicDossier {
  if (Number.isNaN(Date.parse(input.generatedAt))) throw new Error('Dossier generation requires a valid generatedAt timestamp.');
  const context = input.context;
  const hash = contextHash(context);
  const evidence = buildEvidence(context);
  const facts = buildFacts(context, evidence);
  const gaps = buildGaps(context);
  const hypotheses = buildHypotheses(context, facts);
  const recommendedChecks = buildChecks(context, facts);
  const dossier: DeterministicDossier = {
    schemaVersion: 1,
    dossierId: `dos1:${sha256(`${context.incident.incidentId}|${hash}`)}`,
    incidentId: context.incident.incidentId,
    incidentVersion: context.incident.incidentVersion,
    generatedAt: input.generatedAt,
    contextHash: hash,
    status: context.incident.status,
    class: context.incident.class,
    severity: context.incident.severity,
    confidence: context.incident.confidence,
    firstSeen: context.incident.firstSeen,
    lastSeen: context.incident.lastSeen,
    occurrences: context.incident.occurrences,
    ...(context.incident.service ? { service: context.incident.service } : {}),
    ...(context.incident.route ? { route: context.incident.route } : {}),
    releases: context.incident.releases,
    affectedTenantCount: context.incident.affectedTenantCount,
    facts,
    evidence,
    timeline: context.timeline,
    hypotheses,
    gaps,
    recommendedChecks,
    contextStats: context.contextStats,
    analyst: { version: input.analystVersion ?? ANALYST_VERSION, llmUsed: false }
  };
  assertDossierSafety(dossier);
  return dossier;
}

function buildEvidence(context: DossierContext): EvidenceRef[] {
  return context.timeline.slice(0, DOSSIER_LIMITS.evidence).map((item) => ({
    evidenceId: `ev1:${sha256(`${item.eventId}|${item.rawRef.index}|${item.rawRef.id}`)}`,
    eventId: item.eventId,
    rawRef: item.rawRef,
    ...(item.relationLevel ? { relationLevel: item.relationLevel } : {}),
    ...(item.relationReasons?.length ? { relationReasons: item.relationReasons } : {})
  }));
}
function buildFacts(context: DossierContext, evidence: EvidenceRef[]): DossierFact[] {
  const facts: DossierFact[] = [];
  const all = evidence.map((item) => item.evidenceId);
  const add = (type: DossierFactType, statement: string, refs: string[] = all): void => { if (refs.length && facts.length < DOSSIER_LIMITS.facts) facts.push({ factId: `fact:${type.toLowerCase()}`, type, statement, evidenceRefs: [...new Set(refs)].sort() }); };
  const refs = (predicate: (index: number) => boolean): string[] => evidence.filter((_value, index) => predicate(index)).map((item) => item.evidenceId);
  add('INCIDENT_CLASS', `O incidente está classificado como ${context.incident.class}.`);
  add('INCIDENT_SEVERITY', `O incidente está classificado como ${context.incident.severity}.`);
  add('INCIDENT_CONFIDENCE', `A confiança técnica do incidente é ${context.incident.confidence}.`);
  add('OCCURRENCE_COUNT', `O incidente registra ${context.incident.occurrences} ocorrência(s).`);
  add('FIRST_LAST_SEEN', `As ocorrências foram registradas entre ${context.incident.firstSeen} e ${context.incident.lastSeen}.`);
  if (context.incident.service) add('SERVICE', `O serviço técnico observado é ${context.incident.service}.`, refs((index) => context.timeline[index]?.source !== undefined));
  if (context.incident.route) add('ROUTE', `A rota técnica observada é ${context.incident.route}.`, refs((index) => context.timeline[index]?.http?.route === context.incident.route));
  if (context.incident.releases.length) add('RELEASE', `O incidente contém eventos associados a ${context.incident.releases.length} release(s) técnica(s).`, refs((index) => Boolean(context.timeline[index]?.release)));
  const tenantRefs = refs((index) => Boolean(context.timeline[index]?.tenant));
  if (tenantRefs.length) add('TENANT_IMPACT', `O incidente contém eventos associados a ${Math.min(context.incident.affectedTenantCount, DOSSIER_LIMITS.tenants)} tenant(s) técnico(s).`, tenantRefs);
  const http = refs((index) => (context.timeline[index]?.http?.statusCode ?? 0) >= 500);
  if (http.length) add('HTTP_FAILURES', `${http.length} evento(s) HTTP 5xx foram selecionados como evidência.`, http);
  const db = refs((index) => Boolean(context.timeline[index]?.dbCategory) && context.timeline[index]?.dbCategory !== 'UNKNOWN');
  if (db.length) add('DB_FAILURES', `${db.length} evento(s) de falha de banco foram selecionados como evidência.`, db);
  const slow = refs((index) => context.timeline[index]?.dbCategory === 'TIMEOUT' || context.incident.class === 'DATABASE_SLOW' && Boolean(context.timeline[index]?.dbCategory));
  if (slow.length || context.incident.class === 'DATABASE_SLOW') add('DB_SLOW', `Há sinal técnico de lentidão ou timeout de banco no contexto selecionado.`, slow.length ? slow : all);
  const auth = refs((index) => /auth/i.test(`${context.timeline[index]?.eventType ?? ''} ${context.timeline[index]?.action ?? ''} ${context.timeline[index]?.realtimeReason ?? ''}`));
  if (auth.length) add('AUTH_FAILURES', `${auth.length} evento(s) de autenticação ou autorização foram selecionados como evidência.`, auth);
  const realtime = refs((index) => Boolean(context.timeline[index]?.realtimeReason));
  if (realtime.length) add('REALTIME_FAILURES', `${realtime.length} evento(s) de realtime foram selecionados como evidência.`, realtime);
  if (context.incident.class === 'AVAILABILITY') add('AVAILABILITY_SIGNAL', 'Há sinal técnico de disponibilidade no incidente.', all);
  if (context.contextStats.contextTruncated) add('CONTEXT_TRUNCATED', `Foram selecionados ${context.contextStats.selectedEvents} de ${context.contextStats.totalEvents} eventos para a timeline.`, all);
  return facts;
}
function buildGaps(context: DossierContext): DossierGap[] {
  const gaps: string[] = [];
  for (const failure of context.sourceFailures) gaps.push(`A fonte ${failure.source} informou falha ${failure.kind}; a cobertura de contexto pode estar incompleta.`);
  if (context.normalizationSummary?.rejected) gaps.push(`${context.normalizationSummary.rejected} evento(s) foram rejeitados na normalização e não compõem este dossiê.`);
  if (context.contextStats.contextTruncated) gaps.push(`O contexto foi limitado a ${context.contextStats.selectedEvents} de ${context.contextStats.totalEvents} eventos.`);
  if (!context.timeline.some((item) => item.tenant)) gaps.push('Nenhum tenant técnico foi identificado no contexto selecionado.');
  if (!context.incident.releases.length) gaps.push('Nenhuma release técnica foi identificada no incidente.');
  if (context.timeline.some((item) => item.relationLevel === 'WEAK') && !context.timeline.some((item) => item.relationLevel && item.relationLevel !== 'WEAK')) gaps.push('As relações disponíveis são somente WEAK e não comprovam correlação cross-source.');
  if (context.incident.confidence === 'LOW') gaps.push('A confiança técnica do incidente é LOW; o contexto não comprova uma explicação específica.');
  return gaps.map((statement, index) => ({ gapId: `gap:${index + 1}`, statement }));
}
function buildHypotheses(context: DossierContext, facts: DossierFact[]): DossierHypothesis[] {
  const byType = new Map(facts.map((fact) => [fact.type, fact.factId]));
  const make = (statement: string, types: DossierFactType[], supportLevel: 'SUPPORTED' | 'LIMITED'): DossierHypothesis => ({ hypothesisId: `hyp:${types.join('-').toLowerCase()}`, statement, basedOnFactIds: types.map((type) => byType.get(type)).filter((value): value is string => Boolean(value)), supportLevel });
  let result: DossierHypothesis[];
  if (context.incident.class === 'DATABASE_FAILURE' && context.timeline.some((item) => item.dbCategory === 'CONNECTION')) result = [make('Falha de conectividade com o banco pode estar contribuindo para o incidente.', ['DB_FAILURES'], context.incident.occurrences >= 2 ? 'SUPPORTED' : 'LIMITED')];
  else if (context.incident.class === 'DATABASE_SLOW') result = [make('Latência de operações de banco pode estar contribuindo para a degradação observada.', ['DB_SLOW'], 'LIMITED')];
  else if (context.incident.class === 'APPLICATION_ERROR' || facts.some((fact) => fact.type === 'HTTP_FAILURES')) result = [make('Uma falha técnica recorrente na rota observada pode estar contribuindo para os erros.', ['HTTP_FAILURES'], context.incident.occurrences >= 2 ? 'SUPPORTED' : 'LIMITED')];
  else if (['AUTH_FAILURE', 'AUTHORIZATION_DENIED', 'REALTIME_AUTH_FAILURE'].includes(context.incident.class)) result = [make('O padrão observado pode representar falhas legítimas de autenticação ou comportamento anômalo e requer validação.', ['AUTH_FAILURES'], 'LIMITED')];
  else result = [make('Não há evidência suficiente para formular uma hipótese técnica específica.', ['INCIDENT_CLASS'], 'LIMITED')];
  return result.slice(0, DOSSIER_LIMITS.hypotheses);
}
function buildChecks(context: DossierContext, facts: DossierFact[]): DossierRecommendedCheck[] {
  const factIds = facts.map((fact) => fact.factId);
  const statements = context.incident.class === 'DATABASE_FAILURE'
    ? ['Verificar disponibilidade do PostgreSQL no intervalo do incidente.', 'Verificar logs técnicos do PostgreSQL no intervalo do incidente.', 'Verificar conexões recusadas ou timeouts no intervalo do incidente.']
    : context.incident.class === 'DATABASE_SLOW'
      ? ['Verificar duração e saturação das consultas no intervalo do incidente.', 'Verificar lock ou transaction contention no intervalo do incidente.']
      : context.incident.class === 'APPLICATION_ERROR'
        ? ['Verificar logs técnicos da rota observada.', 'Comparar a release observada com releases anteriores.', 'Reproduzir o fluxo em DEV quando viável.']
        : ['AUTH_FAILURE', 'AUTHORIZATION_DENIED', 'REALTIME_AUTH_FAILURE'].includes(context.incident.class)
          ? ['Verificar padrões de 401/403 ou falhas de autenticação no intervalo.', 'Confirmar se a origem e o comportamento observados são esperados.', 'Revisar regras de sessão ou autorização aplicáveis.']
          : context.incident.class === 'AVAILABILITY'
            ? ['Verificar o serviço e as dependências na janela do incidente.']
            : ['Revisar a timeline selecionada e a cobertura das fontes antes de formular uma hipótese.'];
  return statements.slice(0, DOSSIER_LIMITS.recommendedChecks).map((statement, index) => ({ checkId: `check:${index + 1}`, statement, basedOnFactIds: factIds.slice(0, 3) }));
}

export function assertDossierSafety(value: DeterministicDossier): void {
  const text = JSON.stringify(value);
  if (ABSOLUTE_CAUSALITY.test(text)) throw new Error('Dossier rejects unsupported causal language.');
  if (value.recommendedChecks.some((check) => MUTATING_CHECK.test(check.statement))) throw new Error('Dossier rejects remediation language in recommended checks.');
}
