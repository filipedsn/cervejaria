/** Resolve the validator safety gate without making any network request. */
export function resolveValidatorPolicy(env = process.env) {
  const environment = normalize(env.SUPPORT_ANALYST_ENV || 'dev');
  if (environment !== 'dev' && environment !== 'prd') {
    throw new Error('SUPPORT_ANALYST_ENV deve ser dev ou prd.');
  }
  const allowPrd = String(env.SUPPORT_ANALYST_ALLOW_PRD || '').trim().toLowerCase() === 'true';
  const credentialEnvironment = optionalEnvironment(env.SUPPORT_ANALYST_CREDENTIAL_ENV);
  const endpointEnvironment = optionalEnvironment(env.SUPPORT_ANALYST_ENDPOINT_ENV);
  if (credentialEnvironment === 'invalid' || endpointEnvironment === 'invalid') {
    throw new Error('classificação de credencial/endpoint deve ser dev ou prd.');
  }
  if (environment === 'prd' && !allowPrd) throw new Error('PROD_ANALYST_EXPLICIT_ALLOW_REQUIRED');
  if (credentialEnvironment && credentialEnvironment !== environment) throw new Error('PROD_DEV_CREDENTIAL_TARGET_MISMATCH');
  if (endpointEnvironment && endpointEnvironment !== environment) throw new Error('PROD_DEV_ENDPOINT_TARGET_MISMATCH');
  if (environment === 'prd' && credentialEnvironment !== 'prd') throw new Error('PROD_ANALYST_CREDENTIAL_CLASSIFICATION_REQUIRED');
  if (environment === 'prd' && endpointEnvironment !== 'prd') throw new Error('PROD_ANALYST_ENDPOINT_CLASSIFICATION_REQUIRED');
  const apiKey = String(env.SUPPORT_ANALYST_ES_API_KEY || '').trim();
  if (!apiKey) throw new Error(environment === 'prd' ? 'PROD_ANALYST_CREDENTIAL_MISSING' : 'SUPPORT_ANALYST_ES_API_KEY é obrigatória; não existe fallback privilegiado.');
  const rawUrl = String(env.SUPPORT_ANALYST_ES_URL || '').trim();
  if (!rawUrl) throw new Error('SUPPORT_ANALYST_ES_URL é obrigatória.');
  let url;
  try { url = new URL(rawUrl); } catch { throw new Error('SUPPORT_ANALYST_ES_URL deve ser uma URL HTTP(S) válida.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('SUPPORT_ANALYST_ES_URL deve ser HTTP(S), sem credenciais embutidas.');
  return { environment, allowPrd, credentialEnvironment, endpointEnvironment, apiKey, baseUrl: rawUrl.replace(/\/$/, '') };
}

function normalize(value) { return String(value).trim().toLowerCase(); }
function optionalEnvironment(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const normalized = normalize(value);
  return normalized === 'dev' || normalized === 'prd' ? normalized : 'invalid';
}
