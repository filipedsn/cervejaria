import { outputJsonSchema, SYSTEM_PROMPT_V1 } from '../llm-benchmark/prompt-v1.js';
import { LOCAL_LLM_PROMPT_VERSION } from './types.js';
export { outputJsonSchema };
export function buildLocalLlmPrompt(context: unknown): { system: string; user: string } {
  return { system: SYSTEM_PROMPT_V1, user: `Prompt ${LOCAL_LLM_PROMPT_VERSION}. Analise exclusivamente este contexto sanitizado:\n${JSON.stringify(context)}` };
}
