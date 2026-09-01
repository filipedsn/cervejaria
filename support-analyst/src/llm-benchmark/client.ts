import { outputJsonSchema } from './prompt-v1.js';
import type { LlmBenchmarkSettings } from './types.js';

export type OllamaMetrics = { totalDuration?: number; loadDuration?: number; promptEvalCount?: number; promptEvalDuration?: number; evalCount?: number; evalDuration?: number };
export type OllamaChatResult = { content: string; metrics: OllamaMetrics };

export function assertLoopbackUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('LLM benchmark only permits an HTTP loopback Ollama endpoint.');
  return url;
}

export async function chatOllama(baseUrl: string, model: string, prompt: { system: string; user: string }, settings: LlmBenchmarkSettings, fetchImpl: typeof fetch = fetch): Promise<OllamaChatResult> {
  const url = assertLoopbackUrl(baseUrl); url.pathname = '/api/chat';
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
  try {
    const response = await fetchImpl(url, { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, stream: false, think: false, format: outputJsonSchema, keep_alive: '5m', options: { num_ctx: settings.numCtx, temperature: settings.temperature, seed: settings.seed, num_predict: settings.numPredict }, messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }] }) });
    if (!response.ok) throw new Error(`Ollama chat failed with HTTP ${response.status}.`);
    const body = await response.json() as { message?: { content?: unknown }; total_duration?: unknown; load_duration?: unknown; prompt_eval_count?: unknown; prompt_eval_duration?: unknown; eval_count?: unknown; eval_duration?: unknown };
    if (typeof body.message?.content !== 'string') throw new Error('Ollama response has no assistant content.');
    const number = (value: unknown): number | undefined => typeof value === 'number' ? value : undefined;
    return { content: body.message.content, metrics: { totalDuration: number(body.total_duration), loadDuration: number(body.load_duration), promptEvalCount: number(body.prompt_eval_count), promptEvalDuration: number(body.prompt_eval_duration), evalCount: number(body.eval_count), evalDuration: number(body.eval_duration) } };
  } finally { clearTimeout(timer); }
}
