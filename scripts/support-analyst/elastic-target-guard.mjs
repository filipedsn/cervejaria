/** Configuration-only guard: no request may be made before it succeeds. */
export function assertDevElasticTarget({ environment, baseUrl, indexPatterns = [] }) {
  if (String(environment || '').trim().toLowerCase() !== 'dev') {
    throw new Error('Observability DEV aceita somente SUPPORT_ANALYST_ENV=dev.');
  }
  const target = String(baseUrl || '').trim();
  if (!target) throw new Error('SUPPORT_ANALYST_ES_URL deve apontar explicitamente para Elastic DEV.');
  if (/(^|[.\-_/])(?:prd|prod|production)(?:[.\-_/]|$)/i.test(target)) {
    throw new Error('Target PRD/PROD bloqueado antes de qualquer consulta.');
  }
  for (const pattern of indexPatterns) {
    if (!/\.otel-dev\*?$/i.test(pattern) && pattern !== 'quiver-tap-alert-events-dev') {
      throw new Error(`Dataset nao-DEV bloqueado: ${pattern}`);
    }
  }
}
