export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type ProbeResult = { ok: boolean; detail: string };

export async function probeUrl(fetchImpl: FetchLike, url: string, timeoutMs = 10_000): Promise<ProbeResult> {
  try {
    const response = await fetchImpl(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    await response.body?.cancel().catch(() => undefined);
    return response.status === 200 ? { ok: true, detail: 'HTTP 200' } : { ok: false, detail: `HTTP ${response.status}` };
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    return { ok: false, detail: name === 'TimeoutError' || name === 'AbortError' ? `timeout ${timeoutMs / 1000}s` : 'erro de rede' };
  }
}

export async function readReleaseSha(fetchImpl: FetchLike, publicUrl: string): Promise<string | undefined> {
  try {
    const response = await fetchImpl(`${publicUrl}/api/health`, { method: 'GET', signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return undefined;
    const body = await response.json() as { releaseSha?: unknown };
    return typeof body.releaseSha === 'string' && /^[0-9a-f]{7,40}$/i.test(body.releaseSha) ? body.releaseSha : undefined;
  } catch {
    return undefined;
  }
}
