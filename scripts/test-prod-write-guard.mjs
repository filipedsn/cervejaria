/**
 * Fail-closed guard shared by test, certification and DEV mutation runners.
 * It deliberately never loads an env file: callers must provide an already
 * selected DEV environment, and production-looking inherited state is fatal.
 */
const PROD_VALUE = /^(prod|production)$/i;
const PROD_DB = /(?:\/cervejaria(?:\?|$)|cervejaria_prod|\bprod(?:uction)?\b)/i;
const DEV_DB = /cervejaria_dev/i;
const PROD_ENV_FILE = /\.env\.production(?:$|[\\/])/i;
const PROD_API = /(?:^|\/\/)(?:[^/]*\.)?tap\.quivercloud\.com\.br(?::\d+)?(?:\/|$)|:3001(?:\/|$)/i;

export function assertTestProdWriteGuard({
  environment = process.env,
  requireDevDatabase = false,
  apiBase,
  context = 'test runner',
} = {}) {
  for (const key of ['NODE_ENV', 'APP_ENV', 'ENVIRONMENT']) {
    if (PROD_VALUE.test(String(environment[key] ?? ''))) {
      throw new Error(`${context} refused: inherited ${key}=production`);
    }
  }

  for (const key of ['ENV_FILE', 'DOTENV_CONFIG_PATH', 'CONFIG_PATH']) {
    if (PROD_ENV_FILE.test(String(environment[key] ?? ''))) {
      throw new Error(`${context} refused: ${key} selects .env.production`);
    }
  }

  const databaseUrl = String(environment.DATABASE_URL ?? '');
  if (databaseUrl && PROD_DB.test(databaseUrl) && !DEV_DB.test(databaseUrl)) {
    throw new Error(`${context} refused: DATABASE_URL is production-like`);
  }
  if (requireDevDatabase && (!DEV_DB.test(databaseUrl) || !databaseUrl.includes(':5434'))) {
    throw new Error(`${context} refused: DATABASE_URL must be cervejaria_dev on :5434`);
  }

  if (apiBase && PROD_API.test(apiBase)) {
    throw new Error(`${context} refused: API target is production-like`);
  }
}
