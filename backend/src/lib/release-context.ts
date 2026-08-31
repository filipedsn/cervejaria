/**
 * Static release metadata resolved before the application starts handling work.
 * Production receives RELEASE_SHA from deploy/prod-artifacts/manifest.json; this
 * module deliberately never reads files or runs git.
 */
export type ReleaseContext = {
  releaseSha: string;
  service: string;
  environment: string;
};

const SHA_PATTERN = /^[a-f0-9]{7,40}$/;

export function normalizeReleaseSha(value: string | undefined): string {
  const candidate = value?.trim().toLowerCase();
  if (candidate === 'dev') return candidate;
  return candidate && SHA_PATTERN.test(candidate) ? candidate : 'unknown';
}

export function resolveReleaseContext(env: NodeJS.ProcessEnv = process.env): ReleaseContext {
  const environment = env.NODE_ENV?.trim() || 'development';
  const normalizedSha = normalizeReleaseSha(env.RELEASE_SHA);
  return {
    // Local startup is allowed to be explicit without a repository lookup.
    releaseSha: normalizedSha === 'unknown' && environment !== 'production' ? 'dev' : normalizedSha,
    service: env.OTEL_SERVICE_NAME?.trim() || 'quiver-tap-api',
    environment,
  };
}

const runtimeReleaseContext = resolveReleaseContext();

/** Metadata of this process, cached once at module initialization. */
export function getReleaseContext(): ReleaseContext {
  return runtimeReleaseContext;
}
