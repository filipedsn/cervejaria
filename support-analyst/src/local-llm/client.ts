import { assertLoopbackUrl, chatOllama, type OllamaChatResult } from '../llm-benchmark/client.js';
export { assertLoopbackUrl, chatOllama };
export type OllamaModelInfo = { name: string; digest?: string; quantization?: string; processor?: string; sizeVram?: number };
export async function getModelInfo(endpoint: string, model: string, fetchImpl: typeof fetch = fetch): Promise<OllamaModelInfo | undefined> {
  assertLoopbackUrl(endpoint);
  const response = await fetchImpl(new URL('/api/tags', endpoint));
  if (!response.ok) throw new Error(`Ollama tags failed with HTTP ${response.status}.`);
  const tags = await response.json() as { models?: Array<{ name?: unknown; digest?: unknown; details?: { quantization_level?: unknown } }> };
  const found = tags.models?.find((item) => item.name === model);
  if (!found) return undefined;
  return { name: model, digest: typeof found.digest === 'string' ? found.digest : undefined, quantization: typeof found.details?.quantization_level === 'string' ? found.details.quantization_level : undefined };
}
export async function getLoadedModelInfo(endpoint: string, model: string, fetchImpl: typeof fetch = fetch): Promise<Pick<OllamaModelInfo, 'processor' | 'sizeVram'>> {
  const response = await fetchImpl(new URL('/api/ps', endpoint));
  if (!response.ok) return {};
  const body = await response.json() as { models?: Array<{ name?: unknown; processor?: unknown; size_vram?: unknown }> };
  const found = body.models?.find((item) => item.name === model);
  return { processor: typeof found?.processor === 'string' ? found.processor : undefined, sizeVram: typeof found?.size_vram === 'number' ? found.size_vram : undefined };
}
export type { OllamaChatResult };
