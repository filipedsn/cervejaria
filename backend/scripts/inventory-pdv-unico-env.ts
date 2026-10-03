export function validateInventoryEnvironment(env: NodeJS.ProcessEnv) {
  if (env.NODE_ENV !== 'development') throw new Error('Inventário permitido somente em DEV');
  let url: URL;
  try {
    url = new URL(env.DATABASE_URL ?? '');
  } catch {
    throw new Error('DATABASE_URL inválida para inventário DEV');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.port !== '5434'
    || url.pathname !== '/cervejaria_dev'
    || url.hash
    || [...url.searchParams.keys()].some((key) => !['schema', 'connection_limit', 'pool_timeout', 'sslmode'].includes(key))) {
    throw new Error('Inventário exige PostgreSQL DEV local na porta 5434 e banco cervejaria_dev');
  }
}
