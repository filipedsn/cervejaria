const SHA_PATTERN = /^[a-f0-9]{7,40}$/;

function normalizeReleaseSha(value: string | undefined): string {
  const candidate = value?.trim().toLowerCase();
  if (candidate === 'dev') return candidate;
  return candidate && SHA_PATTERN.test(candidate) ? candidate : 'unknown';
}

/** Static build metadata. Vite replaces VITE_RELEASE_SHA while building. */
const viteEnv = import.meta.env ?? {};
export const frontendReleaseSha = normalizeReleaseSha(viteEnv.VITE_RELEASE_SHA);
