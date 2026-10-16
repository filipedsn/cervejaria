export function validateIsolatedQaEnvironment(env) {
  if (env.PDV_ISOLATED_QA !== '1') throw new Error('Operação exige marcador explícito do QA isolado');
  let url;
  try { url = new URL(env.QA_DATABASE_URL ?? ''); } catch { throw new Error('QA_DATABASE_URL inválida'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || !/^(?:554(?:3[9]|4[0-9])|55450)$/.test(url.port)
    || url.pathname !== '/cervejaria_qa_pdv_unico'
    || url.hash
    || [...url.searchParams.keys()].some((key) => !['schema', 'connection_limit', 'pool_timeout'].includes(key))) {
    throw new Error('QA exige PostgreSQL isolado local em 127.0.0.1:55439-55450/cervejaria_qa_pdv_unico');
  }
  return url;
}
