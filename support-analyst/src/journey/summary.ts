import type { LocalLlmConfig } from '../config.js';
import { assertLoopbackUrl } from '../local-llm/client.js';

const MAX_TIMELINE_CHARS = 12_000;

export const JOURNEY_SUMMARY_SYSTEM = 'Você é o analista de suporte do Quiver Tap. Responda em português do Brasil, em no máximo 8 linhas curtas, usando só os fatos da linha do tempo: quem (usuário e papel), o quê (ações principais), onde (telas), erros e onde travou (último passo antes de parar ou de errar). Não invente nada.';

export function buildSummaryPrompt(timeline: string): { system: string; user: string } {
  const clipped = timeline.length > MAX_TIMELINE_CHARS ? `${timeline.slice(0, MAX_TIMELINE_CHARS)}\n[linha do tempo truncada]` : timeline;
  return { system: JOURNEY_SUMMARY_SYSTEM, user: `Linha do tempo:\n${clipped}\n\nResumo (quem, o quê, onde, erros, onde travou):` };
}

/** Local Ollama only (loopback enforced). Returns undefined when the LLM is not available. */
export async function summarizeJourney(timeline: string, config: Pick<LocalLlmConfig, 'endpoint' | 'model' | 'timeoutMs' | 'numCtx'>, fetchImpl: typeof fetch = fetch): Promise<string | undefined> {
  try {
    const url = assertLoopbackUrl(config.endpoint);
    url.pathname = '/api/chat';
    const prompt = buildSummaryPrompt(timeline);
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(config.timeoutMs),
      body: JSON.stringify({ model: config.model, stream: false, think: false, keep_alive: '5m', options: { num_ctx: config.numCtx, temperature: 0.2, num_predict: 400 }, messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }] }),
    });
    if (!response.ok) return undefined;
    const body = await response.json() as { message?: { content?: unknown } };
    const content = typeof body.message?.content === 'string' ? body.message.content.trim() : '';
    return content || undefined;
  } catch {
    return undefined;
  }
}
