/** Configuration-only guard: no request may be made before it succeeds. */
export function assertElasticTarget({ environment, baseUrl, indexPatterns = [] }) {
  const targetEnvironment = String(environment || '').trim().toLowerCase();
  if (targetEnvironment !== 'dev' && targetEnvironment !== 'prd') throw new Error('Ambiente Elastic inválido.');
  const target = String(baseUrl || '').trim();
  if (!target) throw new Error(`SUPPORT_ANALYST_ES_URL deve apontar explicitamente para Elastic ${targetEnvironment.toUpperCase()}.`);
  if (targetEnvironment === 'dev' && /(^|[.\-_/])(?:prd|prod|production)(?:[.\-_/]|$)/i.test(target)) {
    throw new Error('Target PRD/PROD bloqueado antes de qualquer consulta.');
  }
  const otherEnvironment = targetEnvironment === 'dev' ? 'prd' : 'dev';
  for (const pattern of indexPatterns) {
    const expected = new RegExp(`^(?:logs|metrics|traces)-[a-z0-9*._-]*\\.otel-${targetEnvironment}\\*?$`, 'i');
    const infraAllowed = /^(?:logs|metrics)-[a-z0-9*._-]*\.otel-infra\*?$/i.test(pattern);
    const alertAllowed = (targetEnvironment === 'dev' && pattern === 'quiver-tap-alert-events-dev')
      || (targetEnvironment === 'prd' && pattern === 'quiver-tap-alert-events');
    const crossEnvironment = new RegExp(`otel-${otherEnvironment}`, 'i').test(pattern);
    if (crossEnvironment || (!expected.test(pattern) && !alertAllowed && !infraAllowed)) throw new Error(`Dataset fora da allowlist ${targetEnvironment.toUpperCase()}: ${pattern}`);
  }
}

export function assertDevElasticTarget(options) { return assertElasticTarget({ ...options, environment: 'dev' }); }
